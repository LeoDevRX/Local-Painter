import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { Ch, TextureSet } from './TextureSet';
import { averagedNormals } from './HighBaker';

export type ViewMode = 'material' | Ch | 'ao' | 'curv' | 'mask' | 'bnormal' | 'bheight' | 'rays' | 'id' | 'wsn' | 'pos' | 'thick';
/** What a flat view shows: a texture and which component (0 = rgb, 1 = r as gray, 2 = g as gray). */
export interface ViewSource { tex: THREE.Texture; mode: 0 | 1 | 2 | 3 | 4 }
/** mode 3 = ray check: blue where the ray hit the high poly, red where it missed (from .g). */
export type ToneMap = 'neutral' | 'aces' | 'agx' | 'none';
export interface Region { x: number; y: number; w: number; h: number }

/**
 * Environment gain chosen so a matte surface facing the camera renders at
 * (about) the base color you picked. Measured for the built-in studio light.
 */
const STUDIO_GAIN = 1.0;

const VIEW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VIEW_FRAG = /* glsl */ `
uniform sampler2D map;
uniform int mode;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  if (mode == 3) c = mix(vec3(0.92, 0.18, 0.12), vec3(0.16, 0.42, 0.95), step(0.5, c.g));
  gl_FragColor = vec4(mode == 1 ? vec3(c.r) : mode == 2 ? vec3(c.g) : mode == 4 ? vec3(c.b) : c, 1.0);
}`;

export interface Hit { point: THREE.Vector3; normal: THREE.Vector3; uv?: THREE.Vector2; mesh?: number; face?: number }

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  private pmrem: THREE.PMREMGenerator;
  private group = new THREE.Group();
  meshes: THREE.Mesh[] = [];
  /** Lit material of texture set 0 (the settings below apply to every set's material). */
  readonly litMat: THREE.MeshStandardMaterial;
  private viewMat: THREE.ShaderMaterial;
  /** One lit / flat-view material per texture set. */
  private litMats: THREE.MeshStandardMaterial[] = [];
  private viewMats: THREE.ShaderMaterial[] = [];
  /** Texture set of each mesh. */
  private setOf: number[] = [];
  private hiddenSets = new Set<number>();
  private cursor: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  view: ViewMode = 'material';
  envName = 'Studio';
  private envTex: THREE.Texture | null = null;
  private bgTex: THREE.Texture | null = null;
  bgMode: 'env' | 'solid' = 'solid';
  private cage = new THREE.Group();
  private cageParts: { src: THREE.BufferGeometry; front: THREE.Mesh; rear: THREE.Mesh }[] = [];
  private highGroup = new THREE.Group();
  private hl: THREE.Mesh | null = null;
  private hlKey = '';
  private pathLine: THREE.Line;
  private pathDots: THREE.Points;
  private pathHandles!: THREE.LineSegments;
  private pathHandleDots!: THREE.Points;
  private pathSel!: THREE.Points;
  /** 3D view area inside the canvas, in CSS pixels from the top-left. */
  region: Region = { x: 0, y: 0, w: 1, h: 1 };
  canvasW = 1;
  canvasH = 1;
  toneMap: ToneMap = 'aces';
  envGain = STUDIO_GAIN;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; // TextureCraft / Painter default
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    this.canvas = r.domElement;
    container.appendChild(this.canvas);

    this.camera.position.set(1.55, 1.15, 2.75); // three-quarter view shows edges + top
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 20;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE,
    };

    this.pmrem = new THREE.PMREMGenerator(r);
    this.setStudioEnv();
    this.scene.add(this.group);

    this.litMat = this.makeLit();
    this.viewMat = this.makeView();
    this.litMats = [this.litMat]; this.viewMats = [this.viewMat];

    const ring = new THREE.RingGeometry(0.94, 1, 64);
    this.cursor = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false,
    }));
    this.cursor.renderOrder = 999;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.cage.visible = false;
    this.highGroup.visible = false;
    this.scene.add(this.cage, this.highGroup);
    const lm = new THREE.LineBasicMaterial({ color: 0xc4a0ff, depthTest: false, transparent: true, toneMapped: false });
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), lm);
    this.pathDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 7, sizeAttenuation: false, depthTest: false, toneMapped: false }));
    this.pathLine.renderOrder = this.pathDots.renderOrder = 1000;
    this.pathLine.frustumCulled = this.pathDots.frustumCulled = false;
    this.scene.add(this.pathLine, this.pathDots);
    this.pathHandles = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8f7bd6, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
    this.pathHandleDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xc4a0ff, size: 6, sizeAttenuation: false, depthTest: false, toneMapped: false }));
    this.pathSel = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x9b5cff, size: 11, sizeAttenuation: false, depthTest: false, toneMapped: false }));
    for (const o of [this.pathHandles, this.pathHandleDots, this.pathSel]) { o.renderOrder = 1001; o.frustumCulled = false; this.scene.add(o); }
    (this.raycaster as any).firstHitOnly = true;
  }

  // ------------------------------------------------------------ environment

  private setEnv(env: THREE.Texture, bg: THREE.Texture) {
    this.envTex?.dispose();
    if (this.bgTex !== this.envTex) this.bgTex?.dispose();
    this.envTex = env;
    this.bgTex = bg;
    this.scene.environment = env;
    this.scene.environmentIntensity = this.envGain;
    this.applyBackground();
  }

  /**
   * Soft studio: an even, slightly top-lit dome with a gentle key light.
   * Matte colors render close to the picked color everywhere on the model,
   * while the key light still shows the shape and roughness.
   */
  private makeSoftStudio(): THREE.Texture {
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float L = mix(0.62, 1.12, smoothstep(-0.9, 0.9, d.y));
          vec3 key = normalize(vec3(0.55, 0.65, 0.75));
          vec3 rim = normalize(vec3(-0.6, 0.35, -0.75));
          L += 1.8 * pow(max(dot(d, key), 0.0), 24.0);
          L += 0.9 * pow(max(dot(d, rim), 0.0), 18.0);
          gl_FragColor = vec4(vec3(L), 1.0);
        }`,
    }));
    scene.add(dome);
    const tex = this.pmrem.fromScene(scene, 0).texture;
    dome.geometry.dispose(); (dome.material as THREE.Material).dispose();
    return tex;
  }

  /**
   * Procedural HDR environments, ported from TextureCraft's ibl.rs
   * (https://github.com/storytold/texturecraft, MIT OR Apache-2.0): a sky gradient
   * plus soft rectangular lights. "Studio Soft" is TextureCraft's default.
   */
  private makeProcEnv(name: string): THREE.Texture {
    const W = 1024, H = 512;
    const data = new Float32Array(W * H * 4);
    const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const sky = (y: number, z: number[], h: number[], g: number[]) => {
      const out = [0, 0, 0];
      if (y >= 0) { const f = Math.pow(y, 0.6); for (let k = 0; k < 3; k++) out[k] = h[k] + (z[k] - h[k]) * f; }
      else { const f = Math.pow(-y, 0.25); for (let k = 0; k < 3; k++) out[k] = h[k] + (g[k] - h[k]) * f; }
      return out;
    };
    const box = (dx: number, dy: number, dz: number, az: number, el: number, hw: number, hh: number) => {
      const e = (Math.asin(Math.max(-1, Math.min(1, dy))) * 180) / Math.PI;
      const a = (Math.atan2(dz, dx) * 180) / Math.PI;
      const daz = (((a - az + 540) % 360) + 360) % 360 - 180;
      const ex = (t: number) => 1 - smooth((t - 0.8) / 0.4);
      return ex(Math.abs(daz) / hw) * ex(Math.abs(e - el) / hh);
    };
    const add = (c: number[], col: number[], f: number) => { c[0] += col[0] * f; c[1] += col[1] * f; c[2] += col[2] * f; };
    // TextureCraft's dir_of(u, v): theta = v·π, phi = u·2π
    const dirOf = (u: number, v: number) => { const th = v * Math.PI, ph = u * Math.PI * 2; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
    const sun = dirOf(0.12, 0.47);
    const radiance = (x: number, y: number, z: number): number[] => {
      let c: number[];
      switch (name) {
        case 'Studio Contrast':
          c = sky(y, [0.04, 0.04, 0.04], [0.03, 0.03, 0.03], [0.01, 0.01, 0.01]);
          add(c, [14, 13.2, 12], box(x, y, z, 35, 30, 22, 18));
          add(c, [4, 4.4, 5], box(x, y, z, -150, 40, 6, 30));
          return c;
        case 'Overcast':
          c = sky(y, [1.2, 1.25, 1.35], [0.95, 0.95, 0.95], [0.18, 0.2, 0.15]);
          add(c, [0.6, 0.6, 0.6], box(x, y, z, 60, 55, 40, 25));
          return c;
        case 'Sunset': {
          c = sky(y, [0.15, 0.25, 0.55], [1.4, 0.65, 0.3], [0.08, 0.06, 0.05]);
          const sd = smooth((x * sun[0] + y * sun[1] + z * sun[2] - 0.9985) / 0.0012) * 120;
          add(c, [1, 0.6, 0.3], sd);
          return c;
        }
        case 'Warehouse':
          c = sky(y, [0.25, 0.25, 0.25], [0.18, 0.18, 0.18], [0.06, 0.06, 0.06]);
          for (let k = 0; k < 6; k++) add(c, [9, 8.5, 7.5], box(x, y, z, -150 + k * 60, 50, 6, 3));
          add(c, [1.6, 1.8, 2.2], box(x, y, z, 90, 5, 30, 12));
          return c;
        case 'Night':
          c = sky(y, [0.01, 0.015, 0.04], [0.03, 0.03, 0.06], [0.005, 0.005, 0.005]);
          add(c, [0.4, 1.6, 4], box(x, y, z, 20, 15, 10, 10));
          add(c, [4, 0.8, 1.6], box(x, y, z, -110, 10, 12, 8));
          return c;
        default: // Studio Soft
          c = sky(y, [0.5, 0.52, 0.56], [0.32, 0.32, 0.33], [0.08, 0.075, 0.07]);
          add(c, [5.5, 5.2, 4.8], box(x, y, z, 40, 35, 28, 20));
          add(c, [1.1, 1.25, 1.5], box(x, y, z, -125, 20, 35, 22));
          add(c, [3, 3, 3], box(x, y, z, 175, 55, 8, 25));
          return c;
      }
    };
    // three.js equirect layout: u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5 (row 0 = bottom).
    for (let row = 0; row < H; row++) {
      const lat = ((row + 0.5) / H - 0.5) * Math.PI;
      for (let col = 0; col < W; col++) {
        const ph = ((col + 0.5) / W - 0.5) * Math.PI * 2;
        const x = Math.cos(lat) * Math.cos(ph), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(ph);
        const c = radiance(x, y, z), o = (row * W + col) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 1;
      }
    }
    const eq = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    eq.mapping = THREE.EquirectangularReflectionMapping;
    eq.colorSpace = THREE.LinearSRGBColorSpace;
    eq.magFilter = eq.minFilter = THREE.LinearFilter;
    eq.needsUpdate = true;
    const env = this.pmrem.fromEquirectangular(eq).texture;
    eq.dispose();
    return env;
  }

  static readonly ENVIRONMENTS = ['Studio Soft', 'Studio Contrast', 'Overcast', 'Sunset', 'Warehouse', 'Night'];
  studioKind = 'Studio Soft';

  setStudioEnv(kind: string = this.studioKind) {
    this.studioKind = kind;
    const env = kind === 'soft' ? this.makeSoftStudio() : kind === 'room' ? this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture : this.makeProcEnv(kind);
    this.envName = 'Studio';
    this.envGain = STUDIO_GAIN;
    this.setEnv(env, env);
  }

  async loadHDR(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const tex = await new HDRLoader().loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const env = this.pmrem.fromEquirectangular(tex).texture;
      this.envName = file.name;
      this.envGain = 1;
      this.setEnv(env, tex);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applyBackground() {
    if (this.bgMode === 'solid') {
      this.scene.background = new THREE.Color(0x232323);
    } else {
      this.scene.background = this.bgTex;
      this.scene.backgroundBlurriness = 0.55;
      this.scene.backgroundIntensity = 0.55;
    }
  }


  private makeLit(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      roughness: 1, metalness: 1, side: THREE.DoubleSide,
      emissive: new THREE.Color(1, 1, 1), emissiveIntensity: this.litMat?.emissiveIntensity ?? 1, aoMapIntensity: this.litMat?.aoMapIntensity ?? 0.6,
    });
    // Our base-color texture holds sRGB values in a float texture: decode in the shader.
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec3 srgbC = clamp( sampledDiffuseColor.rgb, 0.0, 1.0 );
  sampledDiffuseColor.rgb = mix( srgbC / 12.92, pow( ( srgbC + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), srgbC ) );
  diffuseColor *= sampledDiffuseColor;
#endif`).replace('#include <emissivemap_fragment>', /* glsl */ `
#ifdef USE_EMISSIVEMAP
  vec3 srgbE = clamp( texture2D( emissiveMap, vEmissiveMapUv ).rgb, 0.0, 1.0 );
  totalEmissiveRadiance *= mix( srgbE / 12.92, pow( ( srgbE + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), srgbE ) );
#endif`);
    };
    return m;
  }
  private makeView(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VIEW_VERT, fragmentShader: VIEW_FRAG,
      uniforms: { map: { value: null }, mode: { value: 0 } },
      side: THREE.DoubleSide,
    });
  }
  private lit(set: number) { while (this.litMats.length <= set) this.litMats.push(this.makeLit()); return this.litMats[set]; }
  private flat(set: number) { while (this.viewMats.length <= set) this.viewMats.push(this.makeView()); return this.viewMats[set]; }

  /** Light direction: turn around the model (degrees) and tilt up / down (degrees, ±60). */
  envYaw = 0;
  envTilt = 0;
  set envRotation(deg: number) { this.envYaw = deg; this.applyEnvRotation(); }
  set envTiltDeg(deg: number) { this.envTilt = Math.max(-60, Math.min(60, deg)); this.applyEnvRotation(); }
  private applyEnvRotation() {
    const y = THREE.MathUtils.degToRad(this.envYaw), x = THREE.MathUtils.degToRad(this.envTilt);
    this.scene.environmentRotation.set(x, y, 0, 'YXZ');
    this.scene.backgroundRotation.set(x, y, 0, 'YXZ');
  }

  set exposure(v: number) { this.renderer.toneMappingExposure = v; }

  setToneMap(t: ToneMap) {
    this.toneMap = t;
    this.renderer.toneMapping = {
      neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping,
      agx: THREE.AgXToneMapping, none: THREE.NoToneMapping,
    }[t];
    for (const m of this.litMats) m.needsUpdate = true;
  }
  set aoStrength(v: number) { for (const m of this.litMats) m.aoMapIntensity = v; }
  set emissiveStrength(v: number) { for (const m of this.litMats) m.emissiveIntensity = v; }

  // ------------------------------------------------------------ model

  /** `setOf`: texture set of each geometry (every set gets its own material and textures). */
  setModel(geometries: THREE.BufferGeometry[], setOf: number[] = []) {
    this.setOf = geometries.map((_, i) => setOf[i] ?? 0);
    this.hiddenSets.clear();
    for (const m of this.meshes) {
      this.group.remove(m);
      (m.geometry as any).disposeBoundsTree?.();
      m.geometry.dispose();
    }
    this.clearCage();
    this.cage.visible = false;
    this.setHighPreview(null, false);
    this.setHighlight('', null);
    this.setPath([], []);
    this.meshes = geometries.map((g, i) => {
      const set = this.setOf[i];
      const m = new THREE.Mesh(g, this.view === 'material' ? this.lit(set) : this.flat(set));
      this.group.add(m);
      return m;
    });
    this.frame();
  }

  /** Show / hide one texture set's meshes (the eye in the Texture Set List). */
  setSetVisible(set: number, v: boolean) {
    if (v) this.hiddenSets.delete(set); else this.hiddenSets.add(set);
    this.meshes.forEach((m, i) => { m.visible = !this.hiddenSets.has(this.setOf[i]); });
  }
  /** Texture set of mesh `i`. */
  setOfMesh(i: number) { return this.setOf[i] ?? 0; }

  bindTextures(ts: TextureSet, set = 0) {
    const m = this.lit(set);
    m.map = ts.final.color.texture;
    m.roughnessMap = ts.final.rough.texture;
    m.metalnessMap = ts.final.metal.texture;
    m.emissiveMap = ts.final.emit.texture;
    m.normalMap = ts.finalN.texture;
    m.normalMapType = THREE.TangentSpaceNormalMap;
    m.aoMap = ts.meshRT.texture;
    m.needsUpdate = true;
  }

  /** null = lit material; otherwise a flat (unlit) view of one map. */
  /** Compile the mesh-map view shader too (it's used for the first time when a bake finishes). */
  warmup() {
    const r = this.renderer;
    try {
      const keep = this.meshes.map((m) => m.material);
      this.meshes.forEach((m, i) => (m.material = this.flat(this.setOf[i])));
      r.compile(this.scene, this.camera);
      this.meshes.forEach((m, i) => (m.material = keep[i]));
      r.compile(this.scene, this.camera);
    } catch { /* fine */ }
  }

  /** `src` may differ per texture set (each set has its own textures). */
  setView(view: ViewMode, src: ViewSource | null | ((set: number) => ViewSource | null)) {
    this.view = view;
    const at = typeof src === 'function' ? src : () => src;
    const sets = new Set(this.setOf.length ? this.setOf : [0]);
    const used = new Map<number, ViewSource | null>();
    for (const k of sets) {
      const s = at(k);
      used.set(k, s);
      if (s) { const v = this.flat(k); v.uniforms.map.value = s.tex; v.uniforms.mode.value = s.mode; }
    }
    this.meshes.forEach((m, i) => { const k = this.setOf[i] ?? 0; m.material = used.get(k) ? this.flat(k) : this.lit(k); });
  }

  private camAnim = 0;
  /**
   * Blender-style view: look from a direction (e.g. front = +Z) at the model, framed to fit.
   * Animates for a moment, like Blender's smooth view.
   */
  viewFrom(dir: THREE.Vector3, ms = 260) {
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(0.2, this.camera.aspect));
    const dist = 1.12 / Math.sin(Math.min(vf, hf) / 2);
    const d = dir.clone().normalize();
    // Straight up / down would lock the orbit; tilt a hair so it still turns.
    if (Math.abs(d.y) > 0.999) d.set(0, Math.sign(d.y), 0.0015).normalize();
    const fromT = this.controls.target.clone();
    const fromOff = this.camera.position.clone().sub(fromT);
    const fromDist = fromOff.length();
    const fromDir = fromOff.normalize();
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromUnitVectors(fromDir, d);
    const t0 = performance.now();
    const id = ++this.camAnim;
    const step = () => {
      if (id !== this.camAnim) return;
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const q = q0.clone().slerp(q1, e);
      const cur = fromDir.clone().applyQuaternion(q).normalize();
      if (t >= 1) cur.copy(d);
      this.controls.target.lerpVectors(fromT, new THREE.Vector3(), e);
      this.camera.position.copy(this.controls.target).addScaledVector(cur, fromDist + (dist - fromDist) * e);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  frame() {
    // Fit the unit sphere in whichever of the vertical / horizontal FOV is smaller.
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(0.2, this.camera.aspect));
    const dist = 1.12 / Math.sin(Math.min(vf, hf) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0, 0.1, 1).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.controls.update();
  }

  // ------------------------------------------------------------ bake cage preview

  /**
   * Blue shell = max frontal distance (where rays start), red shell = max rear
   * distance (how deep they search). The high poly should sit between them.
   */
  setCage(geoms: THREE.BufferGeometry[] | null, front: number, rear: number, show: boolean, average = true) {
    if (!geoms || !show) { this.cage.visible = false; return; }
    if (this.cageParts.length !== geoms.length || this.cageParts.some((c, i) => c.src !== geoms[i])) {
      this.clearCage();
      const mk = (color: number, opacity: number, depthTest: boolean) => new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false,
      });
      for (const g of geoms) {
        const cg = (geo: THREE.BufferGeometry) => {
          const c = new THREE.BufferGeometry();
          c.setAttribute('position', geo.attributes.position.clone());
          if (geo.index) c.setIndex(geo.index);
          return c;
        };
        const front = new THREE.Mesh(cg(g), mk(0x3b82f6, 0.22, true));
        const rear = new THREE.Mesh(cg(g), new THREE.MeshBasicMaterial({
          color: 0xff5a5a, wireframe: true, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, toneMapped: false,
        }));
        const fw = new THREE.Mesh(front.geometry, new THREE.MeshBasicMaterial({ color: 0x7fb0ff, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
        front.add(fw);
        front.renderOrder = 5; rear.renderOrder = 4;
        this.cage.add(front, rear);
        this.cageParts.push({ src: g, front, rear });
      }
    }
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const c of this.cageParts) {
      const sp = c.src.attributes.position;
      const sn = average ? averagedNormals(c.src) : c.src.attributes.normal;
      const fp = c.front.geometry.attributes.position as THREE.BufferAttribute;
      const rp = c.rear.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) {
        p.fromBufferAttribute(sp, i); n.fromBufferAttribute(sn, i);
        fp.setXYZ(i, p.x + n.x * front, p.y + n.y * front, p.z + n.z * front);
        rp.setXYZ(i, p.x - n.x * rear, p.y - n.y * rear, p.z - n.z * rear);
      }
      fp.needsUpdate = true; rp.needsUpdate = true;
      c.front.geometry.computeBoundingSphere(); c.rear.geometry.computeBoundingSphere();
    }
    this.cage.visible = true;
  }

  private clearCage() {
    for (const c of this.cageParts) {
      c.front.geometry.dispose(); c.rear.geometry.dispose();
      (c.front.material as THREE.Material).dispose(); (c.rear.material as THREE.Material).dispose();
    }
    this.cage.clear();
    this.cageParts = [];
  }

  /** Show the high poly (gray) for comparing with the low poly. */
  setHighPreview(geoms: THREE.BufferGeometry[] | null, show: boolean) {
    for (const m of this.highGroup.children) (m as THREE.Mesh).material && ((m as THREE.Mesh).material as THREE.Material).dispose();
    this.highGroup.clear();
    if (geoms && show) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
      for (const g of geoms) { const m = new THREE.Mesh(g, mat); m.raycast = () => {}; this.highGroup.add(m); }
    }
    this.highGroup.visible = !!(geoms && show);
    for (const m of this.meshes) m.visible = !this.highGroup.visible;
  }

  // ------------------------------------------------------------ polygon-fill highlight + path overlay

  /** Highlight a mesh region (polygon fill / drop target). `key` avoids rebuilding the same one. */
  setHighlight(key: string, make: (() => THREE.BufferGeometry) | null, color = 0x9b5cff) {
    if (key === this.hlKey) return;
    this.hlKey = key;
    if (this.hl) {
      this.hl.geometry.dispose(); // highlight geometries own their buffers
      (this.hl.material as THREE.Material).dispose();
      this.scene.remove(this.hl);
      this.hl = null;
    }
    if (!make) return;
    this.hl = new THREE.Mesh(make(), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: color === 0x9b5cff ? 0.35 : 0.5, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.hl.renderOrder = 6;
    this.hl.raycast = () => {};
    this.scene.add(this.hl);
  }

  /** Path (vector) tool: the clicked points and the curve through them. */
  /** Path overlay: points, the curve, bezier handles (pairs: point → handle end) and the selected point. */
  setPath(points: THREE.Vector3[], curve: THREE.Vector3[], handles: [THREE.Vector3, THREE.Vector3][] = [], selected: THREE.Vector3 | null = null) {
    for (const o of [this.pathDots, this.pathLine, this.pathHandles, this.pathHandleDots, this.pathSel]) o.geometry.dispose();
    this.pathDots.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(curve);
    this.pathHandles.geometry = new THREE.BufferGeometry().setFromPoints(handles.flat());
    this.pathHandleDots.geometry = new THREE.BufferGeometry().setFromPoints(handles.map((h) => h[1]));
    this.pathSel.geometry = new THREE.BufferGeometry().setFromPoints(selected ? [selected] : []);
  }

  private mirror?: THREE.LineSegments;
  /** Red lines where the symmetry planes cut the model (null hides them). */
  private overlapMesh: THREE.Mesh | null = null;
  /** Overlapping-UV triangles shown as dark spots on the model (null clears). */
  setOverlap(geo: THREE.BufferGeometry | null, visible: boolean) {
    if (this.overlapMesh) { this.scene.remove(this.overlapMesh); this.overlapMesh.geometry.dispose(); (this.overlapMesh.material as THREE.Material).dispose(); this.overlapMesh = null; }
    if (!geo) return;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    m.renderOrder = 7;
    m.raycast = () => {};
    m.visible = visible;
    this.overlapMesh = m;
    this.scene.add(m);
  }
  setOverlapVisible(on: boolean) { if (this.overlapMesh) this.overlapMesh.visible = on; }

  setMirrorLines(segs: Float32Array | null) {
    if (!this.mirror) {
      this.mirror = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3b4a, toneMapped: false, transparent: true, opacity: 0.95 }));
      this.mirror.frustumCulled = false;
      this.mirror.renderOrder = 900;
      this.scene.add(this.mirror);
    }
    this.mirror.geometry.dispose();
    const g = new THREE.BufferGeometry();
    if (segs && segs.length) g.setAttribute('position', new THREE.BufferAttribute(segs, 3));
    this.mirror.geometry = g;
    this.mirror.visible = !!segs && segs.length > 0;
  }

  /** The view ray under a cursor position (null outside the 3D view). */
  rayAt(clientX: number, clientY: number): THREE.Ray | null {
    const rect = this.canvas.getBoundingClientRect();
    const g = this.region;
    const px = clientX - rect.left - g.x, py = clientY - rect.top - g.y;
    if (px < 0 || py < 0 || px > g.w || py > g.h) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((px / g.w) * 2 - 1, -(py / g.h) * 2 + 1), this.camera);
    return this.raycaster.ray.clone();
  }

  // ------------------------------------------------------------ picking & cursor

  pick(clientX: number, clientY: number): Hit | null {
    const rect = this.canvas.getBoundingClientRect();
    const g = this.region;
    const px = clientX - rect.left - g.x, py = clientY - rect.top - g.y;
    if (px < 0 || py < 0 || px > g.w || py > g.h) return null;
    const ndc = new THREE.Vector2((px / g.w) * 2 - 1, -(py / g.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible), false)[0];
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone();
    if (n.dot(this.raycaster.ray.direction) > 0) n.negate();
    return { point: hit.point.clone(), normal: n, uv: hit.uv?.clone(), mesh: this.meshes.indexOf(hit.object as THREE.Mesh), face: hit.faceIndex ?? undefined };
  }

  showCursor(hit: Hit | null, radius: number) {
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.002);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    this.cursor.scale.setScalar(radius);
  }

  // ------------------------------------------------------------ frame

  /** Size of the whole canvas (shared by the 3D and UV views). */
  resize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.canvasW = w; this.canvasH = h;
    this.renderer.setSize(w, h, false);
  }

  setRegion(g: Region) {
    this.region = g;
    if (g.w < 2 || g.h < 2) return;
    this.camera.aspect = g.w / g.h;
    this.camera.updateProjectionMatrix();
  }

  /** Render a scene into a region of the canvas. */
  renderRegion(scene: THREE.Scene, camera: THREE.Camera, g: Region) {
    if (g.w < 2 || g.h < 2) return;
    const r = this.renderer;
    const y = this.canvasH - g.y - g.h; // three.js viewport origin is bottom-left
    r.setViewport(g.x, y, g.w, g.h);
    r.setScissor(g.x, y, g.w, g.h);
    r.setScissorTest(true);
    r.render(scene, camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvasW, this.canvasH);
  }

  render() {
    this.controls.update();
    this.renderRegion(this.scene, this.camera, this.region);
  }
}
