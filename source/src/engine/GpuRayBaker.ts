/**
 * Ray-traced mesh maps on the graphics card (like Substance's GPU baker): ambient occlusion, thickness and curvature
 * for every texel, using the same per-texel ray pattern as the CPU baker in rayWorker.ts (same directions, same random
 * rotation per texel, same weighting), so the maps look the same, just many times faster.
 *
 * The meshes go into one BVH (three-mesh-bvh), packed into textures; a full-screen shader walks it per texel.
 * Work is split in bands of rows so no single draw runs long enough to upset the graphics driver.
 */
import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, BVHShaderGLSL, SAH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RayParams } from './rayWorker';
import { SAMPLE_FLOATS } from './RayBaker';

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
uniform BVH bvh;
uniform sampler2D nrmTex;
uniform sampler2D sP;
uniform sampler2D sN;
uniform sampler2D sG;
uniform int W;
uniform int count;
uniform int mode;      // 0 ambient occlusion, 1 thickness, 2 curvature
uniform int rays;
uniform float minD;
uniform float maxD;
uniform float eps;
uniform float cosMax;
uniform float sinMax;
uniform bool uniformDist;
uniform int atten;     // 0 none, 1 linear, 2 smooth
uniform bool ground;
uniform float groundY;
uniform bool cull;
uniform float meshScale;
uniform float radius;
uniform bool high;
layout(location = 0) out highp vec4 outColor;

const float PI = 3.14159265358979;

// Closest hit within far (or -1). tri: vertex indices, bary: weights of a, b, c.
float castRay(vec3 o, vec3 d, float far, out uvec3 tri, out vec3 bary) {
  tri = uvec3(0u); bary = vec3(0.0);
  if (!(far > 0.0)) return -1.0;
  int sp = 0;
  uint stack[BVH_STACK_DEPTH];
  stack[0] = 0u;
  float best = far;
  bool found = false;
  vec3 inv = 1.0 / d;
  while (sp > -1 && sp < BVH_STACK_DEPTH) {
    uint node = stack[sp];
    sp--;
    uint n2 = node * 2u;
    vec3 bmin = texelFetch1D(bvh.bvhBounds, n2).xyz;
    vec3 bmax = texelFetch1D(bvh.bvhBounds, n2 + 1u).xyz;
    vec3 t0 = (bmin - o) * inv, t1 = (bmax - o) * inv;
    vec3 tmn = min(t0, t1), tmx = max(t0, t1);
    float enter = max(max(tmn.x, tmn.y), tmn.z), leave = min(min(tmx.x, tmx.y), tmx.z);
    if (leave < max(enter, 0.0) || enter > best) continue;
    uvec2 info = uTexelFetch1D(bvh.bvhContents, node).xy;
    if ((info.x & 0xffff0000u) != 0u) {
      uint cnt = info.x & 0x0000ffffu, off = info.y;
      for (uint i = off; i < off + cnt; i++) {
        uvec3 ix = uTexelFetch1D(bvh.index, i).xyz;
        vec3 a = texelFetch1D(bvh.position, ix.x).xyz;
        vec3 b = texelFetch1D(bvh.position, ix.y).xyz;
        vec3 c = texelFetch1D(bvh.position, ix.z).xyz;
        vec3 e1 = b - a, e2 = c - a;
        vec3 nn = cross(e1, e2);
        float det = -dot(d, nn);
        if (abs(det) < 1e-20) continue;
        // ignore backface: triangles facing away from the ray
        if (cull && dot(nn, d) > 0.0) continue;
        float inv2 = 1.0 / det;
        vec3 ao = o - a;
        vec3 dao = cross(ao, d);
        float u = dot(e2, dao) * inv2;
        float v = -dot(e1, dao) * inv2;
        float t = dot(ao, nn) * inv2;
        float w = 1.0 - u - v;
        if (u < -1e-7 || v < -1e-7 || w < -1e-7 || t < 0.0) continue;
        if (found ? !(t < best) : t > far) continue;
        best = t; found = true; tri = ix; bary = vec3(w, u, v);
      }
    } else {
      uint left = node + 1u, right = node + info.y;
      bool ltr = d[info.x & 0x0000ffffu] >= 0.0;
      sp++; stack[sp] = ltr ? right : left;
      sp++; stack[sp] = ltr ? left : right;
    }
  }
  return found ? best : -1.0;
}
float castT(vec3 o, vec3 d, float far) { uvec3 t; vec3 b; return castRay(o, d, far, t, b); }

// glam's any_orthonormal_pair (same frames as the CPU baker)
void orthoPair(vec3 n, out vec3 t, out vec3 b) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float bb = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * bb, -s * n.x);
  b = vec3(bb, s + n.y * n.y * a, -n.y);
}
uint reverseBits(uint i) {
  i = ((i >> 1u) & 0x55555555u) | ((i & 0x55555555u) << 1u);
  i = ((i >> 2u) & 0x33333333u) | ((i & 0x33333333u) << 2u);
  i = ((i >> 4u) & 0x0f0f0f0fu) | ((i & 0x0f0f0f0fu) << 4u);
  i = ((i >> 8u) & 0x00ff00ffu) | ((i & 0x00ff00ffu) << 8u);
  return (i >> 16u) | (i << 16u);
}
vec2 rot2(uint seed) {
  uint x = seed + 0x9e3779b9u;
  x = (x ^ (x >> 16u)) * 0x85ebca6bu;
  x = (x ^ (x >> 13u)) * 0xc2b2ae35u;
  x = x ^ (x >> 16u);
  uint y = (x ^ 0x27d4eb2fu) * 0x165667b1u;
  y = y ^ (y >> 15u);
  return vec2(float(x) / 4294967296.0, float(y) / 4294967296.0);
}

float hemisphere(vec3 P, vec3 N, vec3 G, uint seed) {
  bool thick = mode == 1;
  if (dot(N, N) < 1e-12) return thick ? maxD : 1.0;
  N = normalize(N);
  G = dot(G, G) < 1e-12 ? N : normalize(G);
  if (dot(G, N) < 0.0) G = -G;
  if (thick) { N = -N; G = -G; }
  vec3 o = P + G * eps;
  vec3 T, B;
  orthoPair(N, T, B);
  vec2 r = rot2(seed);
  float acc = 0.0, n = 0.0;
  for (int i = 0; i < rays; i++) {
    float az = mod(float(i) / float(rays) + r.x, 1.0);
    float el = mod(float(reverseBits(uint(i))) / 4294967296.0 + r.y, 1.0);
    float rad, h;
    if (uniformDist) { h = 1.0 - el * (1.0 - cosMax); rad = sqrt(max(0.0, 1.0 - h * h)); }
    else { rad = sinMax * sqrt(el); h = sqrt(max(0.0, 1.0 - rad * rad)); }
    float a = az * PI * 2.0;
    vec3 D = T * (cos(a) * rad) + B * (sin(a) * rad) + N * h;
    if (dot(D, G) <= 0.0) continue;
    float len = max(0.0, maxD - minD);
    float ht = castT(o + D * minD, D, len);
    float dist = ht >= 0.0 ? ht + minD : -1.0;
    if (!thick && ground && D.y < -1e-8) {
      float gd = (groundY - o.y) / D.y;
      if (gd >= minD && gd <= maxD) dist = dist < 0.0 ? gd : min(dist, gd);
    }
    if (thick) acc += dist < 0.0 ? maxD : dist;
    else if (dist >= 0.0) {
      float f = clamp((dist - minD) / max(1e-12, maxD - minD), 0.0, 1.0);
      acc += atten == 0 ? 1.0 : atten == 1 ? 1.0 - f : 1.0 - f * f * (3.0 - 2.0 * f);
    }
    n += 1.0;
  }
  if (thick) return n > 0.0 ? acc / n : maxD;
  return n > 0.0 ? clamp(1.0 - acc / n, 0.0, 1.0) : 1.0;
}

// ---- curvature from mesh (TextureCraft's tuning, same as the CPU baker)
vec3 faceN(uvec3 ix) {
  vec3 a = texelFetch1D(bvh.position, ix.x).xyz, b = texelFetch1D(bvh.position, ix.y).xyz, c = texelFetch1D(bvh.position, ix.z).xyz;
  return normalize(cross(b - a, c - a));
}
vec3 shadedN(uvec3 ix, vec3 bary, vec3 fallback) {
  vec3 n = texelFetch1D(nrmTex, ix.x).xyz * bary.x + texelFetch1D(nrmTex, ix.y).xyz * bary.y + texelFetch1D(nrmTex, ix.z).xyz * bary.z;
  return dot(n, n) > 1e-12 ? normalize(n) : fallback;
}
float curvature(vec3 P, vec3 N, vec3 G, float texelW) {
  if (dot(N, N) < 1e-12) return 0.0;
  N = normalize(N);
  G = dot(G, G) < 1e-12 ? N : normalize(G);
  if (dot(G, N) < 0.0) G = -G;
  float texel = texelW > 0.0 ? texelW : meshScale * 1e-3;
  float radiusScale = radius / (meshScale * 0.001);
  float walls = 1.5 * radiusScale, spreadR = walls * 4.0 / 3.0;
  int per = max(1, rays / 4);
  float r = walls * texel;
  float convex = high ? 0.5 : 1.5, ratio = high ? 0.0007 : 0.003, weight = high ? 1.6 : 1.3;
  float radii[4] = float[4](r, r, spreadR * texel, meshScale * ratio * radiusScale);
  vec3 T, B;
  orthoPair(G, T, B);
  float wallv[2];
  for (int ring = 0; ring < 2; ring++) {
    float R = radii[ring], s = ring == 0 ? 0.15 : -0.15;
    vec3 o = P + G * (s * R);
    float sum = 0.0;
    for (int k = 0; k < per; k++) {
      float a = PI * 2.0 * float(k) / float(per);
      vec3 D = T * cos(a) + B * sin(a);
      uvec3 tri; vec3 bc;
      float t = castRay(o, D, R, tri, bc);
      if (t < 0.0) continue;
      if (ring == 0) {
        uvec3 t2; vec3 b2;
        float g = castRay(P + G * (0.15 * r) + D * (t * 0.85), -G, 0.5 * r, t2, b2);
        if (g < 0.0 || g >= 0.3 * r) continue;
      }
      vec3 fn = faceN(tri);
      float upright = sqrt(max(0.0, 1.0 - dot(fn, G) * dot(fn, G)));
      vec3 hn = shadedN(tri, bc, N);
      float hard = clamp((1.0 - dot(hn, N)) / 0.05, 0.0, 1.0);
      sum += (1.0 - t / R) * upright * hard;
    }
    wallv[ring] = sum / float(per);
  }
  float shading2 = 0.0, ts = 0.0, tf = 0.0;
  for (int ring = 2; ring < 4; ring++) {
    float R = radii[ring];
    float shading = 0.0, faces = 0.0;
    for (int k = 0; k < per; k++) {
      float a = PI * 2.0 * float(k) / float(per);
      vec3 D = T * cos(a) + B * sin(a);
      uvec3 tri; vec3 bc;
      float t = castRay(P + D * R + G * (0.25 * R), -G, 2.25 * R, tri, bc);
      if (t < 0.0) continue;
      vec3 hn = shadedN(tri, bc, N);
      shading += dot(hn - N, D);
      vec3 fn = faceN(tri);
      if (dot(fn, G) < 0.0) fn = -fn;
      faces += dot(fn - G, D);
    }
    if (ring == 2) shading2 = shading / float(per);
    else { ts = shading / float(per); tf = faces / float(per); }
  }
  float agreed = ts * tf <= 0.0 ? 0.0 : sign(ts) * min(abs(ts), abs(tf));
  float v = agreed * weight;
  float tight = sign(v) * max(0.0, abs(v) - 0.1);
  float value = -wallv[0] * 1.5 + max(0.0, wallv[1] - wallv[0]) * convex + shading2 * 0.5 + tight;
  return clamp(value * 2.0, -1.0, 1.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int k = px.y * W + px.x;
  if (k >= count) { outColor = vec4(0.0); return; }
  vec4 p = texelFetch(sP, px, 0);
  vec3 n = texelFetch(sN, px, 0).xyz, g = texelFetch(sG, px, 0).xyz;
  float v = mode == 2 ? curvature(p.xyz, n, g, p.w) : hemisphere(p.xyz, n, g, uint(k));
  outColor = vec4(v, 0.0, 0.0, 1.0);
}`;

const floatTex = (data: Float32Array, w: number, h: number) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

export class GpuRayBaker {
  private struct = new MeshBVHUniformStruct();
  private nrm = new FloatVertexAttributeTexture();
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  cancelled = false;

  /** Can this graphics card render to float textures (needed to read the results back)? */
  static supported(r: THREE.WebGLRenderer) {
    const gl = r.getContext();
    return gl instanceof WebGL2RenderingContext && !!gl.getExtension('EXT_color_buffer_float');
  }

  constructor(private gpu: { renderer: THREE.WebGLRenderer; run: (m: THREE.Material, t: THREE.WebGLRenderTarget | null) => void }, targets: THREE.BufferGeometry[]) {
    // One mesh with position + normal (vertex normals for curvature's shading normal).
    const parts = targets.map((g) => {
      const c = new THREE.BufferGeometry();
      c.setAttribute('position', g.attributes.position.clone());
      if (g.attributes.normal) c.setAttribute('normal', g.attributes.normal.clone());
      else { c.computeVertexNormals(); }
      const n = g.index ? g.index.clone() : null;
      if (n) c.setIndex(n); else c.setIndex([...Array(g.attributes.position.count).keys()]);
      return c;
    });
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
    if (parts.length > 1) parts.forEach((p) => p.dispose());
    this.geo = merged;
    const bvh = new MeshBVH(merged, { strategy: SAH, maxLeafSize: 8 });
    this.struct.updateFrom(bvh);
    this.nrm.updateFrom(merged.attributes.normal as THREE.BufferAttribute);
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      uniforms: {
        bvh: { value: this.struct }, nrmTex: { value: this.nrm },
        sP: { value: null }, sN: { value: null }, sG: { value: null },
        W: { value: 1 }, count: { value: 0 }, mode: { value: 0 }, rays: { value: 64 },
        minD: { value: 0 }, maxD: { value: 1 }, eps: { value: 0 }, cosMax: { value: 0 }, sinMax: { value: 1 },
        uniformDist: { value: false }, atten: { value: 0 }, ground: { value: false }, groundY: { value: 0 }, cull: { value: false },
        meshScale: { value: 1 }, radius: { value: 0 }, high: { value: false },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
  }

  /** The CPU baker handles what this one doesn't: rays limited to the texel's own mesh name, or culling by mesh name. */
  static handles(p: RayParams) { return !p.sameName && p.back !== 'name'; }

  /** One value per texel sample (same meaning as RayBaker.run). */
  async run(pts: Float32Array, p: RayParams, onProgress?: (f: number) => void): Promise<Float32Array | null> {
    const n = pts.length / SAMPLE_FLOATS;
    const out = new Float32Array(n);
    if (!n) return out;
    const W = Math.min(2048, n), H = Math.ceil(n / W);
    const P = new Float32Array(W * H * 4), Nn = new Float32Array(W * H * 4), G = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) {
      const o = i * SAMPLE_FLOATS, q = i * 4;
      P[q] = pts[o]; P[q + 1] = pts[o + 1]; P[q + 2] = pts[o + 2]; P[q + 3] = pts[o + 9];
      Nn[q] = pts[o + 3]; Nn[q + 1] = pts[o + 4]; Nn[q + 2] = pts[o + 5];
      G[q] = pts[o + 6]; G[q + 1] = pts[o + 7]; G[q + 2] = pts[o + 8];
    }
    const tP = floatTex(P, W, H), tN = floatTex(Nn, W, H), tG = floatTex(G, W, H);
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const u = this.mat.uniforms;
    const half = Math.min(Math.PI / 2, (Math.min(180, Math.max(0, p.spread)) * 0.5 * Math.PI) / 180);
    Object.assign(u.sP, { value: tP }); u.sN.value = tN; u.sG.value = tG;
    u.W.value = W; u.count.value = n;
    u.mode.value = p.kind === 'ao' ? 0 : p.kind === 'thick' ? 1 : 2;
    u.rays.value = p.rays; u.minD.value = p.minD; u.maxD.value = p.maxD; u.eps.value = p.eps;
    u.cosMax.value = Math.cos(half); u.sinMax.value = Math.sin(half);
    u.uniformDist.value = p.dist === 'uniform';
    u.atten.value = p.atten === 'none' ? 0 : p.atten === 'linear' ? 1 : 2;
    u.ground.value = !!p.ground; u.groundY.value = p.groundY;
    u.cull.value = p.back === 'always';
    u.meshScale.value = p.meshScale; u.radius.value = p.radius; u.high.value = !!p.high;
    const r = this.gpu.renderer, gl = r.getContext();
    try {
      // Spread the work over frames: each frame gets a slice of ray tracing, sized from how fast the card went so far,
      // and the window draws in between, so baking doesn't make the app stutter. The wait for the card never blocks.
      const gl2 = gl as WebGL2RenderingContext;
      const sync = () => new Promise<void>((res) => {
        const f = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl2.flush();
        if (!f) { res(); return; }
        const poll = () => {
          if (gl2.clientWaitSync(f, 0, 0) === gl2.TIMEOUT_EXPIRED) setTimeout(poll, 1);
          else { gl2.deleteSync(f); res(); }
        };
        poll();
      });
      // Next frame (or a short timeout when the window is minimised and frames stop).
      const nextFrame = () => new Promise<void>((res) => { let d = false; const go = () => { if (!d) { d = true; res(); } }; requestAnimationFrame(go); setTimeout(go, 40); });
      // While you're using the window: ~14 ms per frame so it stays smooth. When LocalPaint is in the background or
      // minimised nobody sees the frames, so it bakes in big pieces at full speed.
      const idle = () => document.hidden || !document.hasFocus();
      let pos = 0, rate = 0, first = true;
      while (pos < n) {
        if (this.cancelled) return null;
        const budget = idle() ? 80 : 14;
        const want = Math.max(256, Math.round(rate ? rate * budget : 4096));
        const start = pos, end = Math.min(n, pos + want);
        const t0 = performance.now();
        // Whole rows where possible, part rows at the ends.
        while (pos < end) {
          const x = pos % W, y = Math.floor(pos / W);
          let w: number, h: number;
          if (x === 0 && end - pos >= W) { w = W; h = Math.min(H - y, Math.floor((end - pos) / W)); }
          else { w = Math.min(W - x, end - pos); h = 1; }
          rt.scissor.set(x, y, w, h);
          rt.scissorTest = true;
          this.gpu.run(this.mat, rt);
          if (first) {
            // A shader the card can't compile renders nothing: hand the job to the CPU baker instead.
            const prog = (r.properties.get(this.mat) as { currentProgram?: { diagnostics?: { runnable: boolean } } }).currentProgram;
            if (!prog || prog.diagnostics?.runnable === false) throw new Error('GPU ray shader did not compile');
            first = false;
          }
          pos += w * h;
        }
        await sync();
        const ms = Math.max(0.5, performance.now() - t0);
        const r2 = (pos - start) / ms;
        rate = rate ? Math.min(rate * 2, r2 * 0.5 + rate * 0.5) : r2;
        onProgress?.(pos / n);
        if (idle()) await new Promise((res) => setTimeout(res, 0)); else await nextFrame();
      }
      rt.scissorTest = false;
      const buf = new Float32Array(W * H * 4);
      // Read back without stalling the window (falls back to the plain read on old three.js builds).
      const ra = (r as unknown as { readRenderTargetPixelsAsync?: (...a: unknown[]) => Promise<unknown> }).readRenderTargetPixelsAsync;
      if (ra) await ra.call(r, rt, 0, 0, W, H, buf); else r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      for (let i = 0; i < n; i++) out[i] = buf[i * 4];
      return out;
    } finally {
      u.sP.value = u.sN.value = u.sG.value = null;
      tP.dispose(); tN.dispose(); tG.dispose(); rt.dispose();
    }
  }

  dispose() {
    this.struct.dispose(); this.nrm.dispose(); this.mat.dispose(); this.geo.dispose();
  }
}

/** One GPU baker per set of target meshes, shared by every texture set of a model (built once, not once per set). */
let cached: { targets: THREE.BufferGeometry[]; baker: GpuRayBaker } | null = null;
export function gpuBakerFor(gpu: ConstructorParameters<typeof GpuRayBaker>[0], targets: THREE.BufferGeometry[]): GpuRayBaker {
  if (cached && cached.targets.length === targets.length && cached.targets.every((g, i) => g === targets[i])) { cached.baker.cancelled = false; return cached.baker; }
  cached?.baker.dispose();
  cached = { targets: [...targets], baker: new GpuRayBaker(gpu, targets) };
  return cached.baker;
}
