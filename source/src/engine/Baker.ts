import * as THREE from 'three';
import { GPU, RT, quadShader } from './gpu';

export interface BakeSettings {
  /** Trace rays on the graphics card (much faster); off = the CPU workers. */
  gpuRays?: boolean;
  /** Number of view directions (more = smoother AO). */
  samples: number;
  /** Edge band width for curvature, in model units (model fits in radius 1). */
  edgeWidth: number;
  /** Curvature contrast. */
  curvStrength: number;
  /** 'rays': ray traced like Substance's "from mesh" bakers; 'gpu': fast multi-view approximation. */
  method?: 'rays' | 'gpu';
  // Ambient occlusion (Substance defaults)
  aoRays?: number;
  /** Max occluder distance, relative to the bounding box (its largest side). */
  aoMax?: number;
  aoMin?: number;
  aoSpread?: number;
  aoDist?: 'cosine' | 'uniform';
  aoAtten?: 'none' | 'linear' | 'smooth';
  aoGround?: boolean;
  // Curvature
  curvRays?: number;
  /** Sampling radius, relative to the bounding box (its largest side). */
  curvRadius?: number;
  // Like Substance Painter's bakers: matching by mesh name ("Helmet_low" ↔ "Helmet_high").
  /** High poly → low poly: every mesh ('always'), or only meshes with the same name ('name'). */
  matchBy?: 'always' | 'name';
  lowSuffix?: string;
  highSuffix?: string;
  /** Meshes whose name contains this ignore their back faces when "Ignore backface: By mesh name". */
  bfSuffix?: string;
  /** AO: self occlusion from every mesh, or only from meshes with the same name. */
  aoSelf?: 'always' | 'name';
  aoBack?: 'never' | 'always' | 'name';
  /** Ground plane height offset, relative to the bounding box. */
  aoGroundOffset?: number;
  /** Curvature: self intersection with every mesh, or only the same mesh name. */
  curvSelf?: 'always' | 'name';
  /** Position map: all axes (RGB) or one axis (gray); normalised to the box, the sphere, or not at all. */
  posMode?: 'all' | 'x' | 'y' | 'z';
  posNorm?: 'bbox' | 'bsphere' | 'none';
}
export const DEFAULT_BAKE: BakeSettings = {
  samples: 96, edgeWidth: 0.016, curvStrength: 1.0,
  method: 'rays', aoRays: 64, aoMax: 1, aoMin: 0.00001, aoSpread: 180, aoDist: 'cosine', aoAtten: 'linear', aoGround: false,
  curvRays: 32, curvRadius: 0.001,
};

// ---------------------------------------------------------------- shaders

// Pass 1: render the model from one direction, storing world normal + view depth.
const VIEW_VERT = /* glsl */ `
varying vec3 vN;
varying float vDepth;
void main() {
  vN = normal;
  vec4 vp = modelViewMatrix * vec4(position, 1.0);
  vDepth = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;
const VIEW_FRAG = /* glsl */ `
varying vec3 vN;
varying float vDepth;
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n, vDepth);
}`;

// Pass 2 (per texel, additive): visibility toward this direction (AO) and the
// change of normal across the screen around the texel (curvature). Working in
// screen space of many views makes curvature continuous across UV seams.
const FRAG_ACCUM = /* glsl */ `
uniform sampler2D posMap;
uniform sampler2D nrmMap;
uniform sampler2D viewBuf;
uniform mat4 viewMat;
uniform mat4 projMat;
uniform vec3 dir;
uniform vec3 camRight;
uniform vec3 camUp;
uniform float pxWorld;
uniform float rPx;
uniform vec2 viewTexel;
uniform float invN;
varying vec2 vUv;
void main() {
  vec4 P = texture2D(posMap, vUv);
  if (P.a < 0.5) discard;
  vec3 n = normalize(texture2D(nrmMap, vUv).xyz);
  float w = dot(n, dir);
  if (w <= 0.0) discard;
  vec4 vp = viewMat * vec4(P.xyz, 1.0);
  float depth = -vp.z;
  vec4 cp = projMat * vp;
  vec2 suv = cp.xy * 0.5 + 0.5;
  vec4 b = texture2D(viewBuf, suv);
  float eps = pxWorld * 3.0 + 0.004 + 0.03 * (1.0 - w);
  bool vis = b.a <= 0.0 || depth <= b.a + eps;
  vec4 o = vec4(vis ? w * invN : 0.0, w * invN, 0.0, 0.0);
  if (vis && w > 0.25) {
    vec2 dx = vec2(viewTexel.x * rPx, 0.0);
    vec2 dy = vec2(0.0, viewTexel.y * rPx);
    vec4 a1 = texture2D(viewBuf, suv + dx);
    vec4 a2 = texture2D(viewBuf, suv - dx);
    vec4 b1 = texture2D(viewBuf, suv + dy);
    vec4 b2 = texture2D(viewBuf, suv - dy);
    float lim = rPx * pxWorld * 4.0 + 0.02;
    bool ok = a1.a > 0.0 && a2.a > 0.0 && b1.a > 0.0 && b2.a > 0.0 &&
      abs(a1.a - depth) < lim && abs(a2.a - depth) < lim && abs(b1.a - depth) < lim && abs(b2.a - depth) < lim;
    if (ok) {
      float c = dot(a1.xyz - a2.xyz, camRight) + dot(b1.xyz - b2.xyz, camUp);
      float ww = w * w * invN;
      o.z = c * ww;
      o.w = ww;
    }
  }
  gl_FragColor = o;
}`;

/** Fibonacci-sphere directions, evenly spread. */
function directions(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(ga * i) * r, y, Math.sin(ga * i) * r));
  }
  return out;
}

export class MeshBaker {
  private gpu: GPU;
  private scene = new THREE.Scene();
  private viewMat: THREE.ShaderMaterial;
  private accumMat: THREE.ShaderMaterial;
  cancelled = false;

  constructor(gpu: GPU, geometries: THREE.BufferGeometry[]) {
    this.gpu = gpu;
    this.viewMat = new THREE.ShaderMaterial({
      vertexShader: VIEW_VERT, fragmentShader: VIEW_FRAG, side: THREE.DoubleSide, blending: THREE.NoBlending,
    });
    for (const g of geometries) {
      const m = new THREE.Mesh(g, this.viewMat);
      m.frustumCulled = false;
      this.scene.add(m);
    }
    this.accumMat = quadShader(FRAG_ACCUM, {
      posMap: { value: null }, nrmMap: { value: null }, viewBuf: { value: null },
      viewMat: { value: new THREE.Matrix4() }, projMat: { value: new THREE.Matrix4() },
      dir: { value: new THREE.Vector3() }, camRight: { value: new THREE.Vector3() }, camUp: { value: new THREE.Vector3() },
      pxWorld: { value: 0.002 }, rPx: { value: 6 }, viewTexel: { value: new THREE.Vector2() }, invN: { value: 1 },
    }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
  }

  /** Accumulate AO/curvature sums into `accum` (cleared first). Yields to the UI between chunks. */
  async run(posTex: THREE.Texture, nrmTex: THREE.Texture, accum: RT, s: BakeSettings, onProgress?: (f: number) => void): Promise<boolean> {
    const r = this.gpu.renderer;
    const floatOk = r.extensions.has('EXT_color_buffer_float');
    const V = accum.width >= 2048 ? 2048 : 1024;
    const viewRT = new THREE.WebGLRenderTarget(V, V, {
      type: floatOk ? THREE.FloatType : THREE.HalfFloatType,
      magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      depthBuffer: true, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
    });
    const extent = 1.08;
    const cam = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.05, 10);
    const pxWorld = (2 * extent) / V;
    const u = this.accumMat.uniforms;
    u.posMap.value = posTex;
    u.nrmMap.value = nrmTex;
    u.viewBuf.value = viewRT.texture;
    u.pxWorld.value = pxWorld;
    u.rPx.value = Math.max(1.5, s.edgeWidth / pxWorld);
    u.viewTexel.value.set(1 / V, 1 / V);
    const dirs = directions(s.samples);
    u.invN.value = 1 / dirs.length;

    this.gpu.clear(accum);
    const savedColor = new THREE.Color();
    const chunk = 6;
    for (let i = 0; i < dirs.length; i++) {
      if (this.cancelled) { viewRT.dispose(); return false; }
      const d = dirs[i];
      const up = Math.abs(d.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      cam.position.copy(d).multiplyScalar(3);
      cam.up.copy(up);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      // pass 1
      r.getClearColor(savedColor);
      const ca = r.getClearAlpha();
      r.setRenderTarget(viewRT);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(this.scene, cam);
      r.setClearColor(savedColor, ca);
      r.setRenderTarget(null);
      // pass 2
      u.viewMat.value.copy(cam.matrixWorldInverse);
      u.projMat.value.copy(cam.projectionMatrix);
      u.dir.value.copy(d);
      u.camRight.value.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      u.camUp.value.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      this.gpu.run(this.accumMat, accum);
      if (i % chunk === chunk - 1) {
        onProgress?.((i + 1) / dirs.length);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    viewRT.dispose();
    onProgress?.(1);
    return true;
  }

  dispose() {
    this.viewMat.dispose();
    this.accumMat.dispose();
  }
}
