import * as THREE from 'three';
import type { GPU } from './gpu';

/**
 * High → low baking. For every texel of the low poly we cast a ray from the
 * frontal cage (low surface pushed out by `front`) inward along the low normal,
 * up to `rear` behind the surface, and record what it hits on the high poly.
 */
export interface HighBakeSettings {
  /** Max frontal distance (blue cage), in model units (the model fits in a radius-1 sphere). */
  front: number;
  /** Max rear distance (red cage). */
  rear: number;
  /** Cast rays along normals averaged across hard edges, so the cage doesn't split open. */
  average: boolean;
  /** Ignore high poly faces seen from behind. */
  ignoreBack?: boolean;
}
export const DEFAULT_HIGH: HighBakeSettings = { front: 0.03, rear: 0.03, average: true };

/**
 * Smooth normals averaged across split vertices (same position), area weighted.
 * Stored as the 'rayNormal' attribute and used for ray directions / the cage.
 */
export function averagedNormals(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const cached = g.getAttribute('rayNormal') as THREE.BufferAttribute | undefined;
  if (cached && (cached as any).isAveraged) return cached;
  const pos = g.attributes.position;
  const n = pos.count;
  const key = new Int32Array(n);
  const map = new Map<string, number>();
  const q = 1e5;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    key[i] = id;
  }
  const acc = new Float32Array(map.size * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  const idx = g.index;
  const tris = idx ? idx.count / 3 : n / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    fn.subVectors(c, b).cross(a.clone().sub(b)); // area-weighted face normal
    // keep the orientation of the shading normals
    const sn = g.attributes.normal;
    if (sn && fn.dot(new THREE.Vector3().fromBufferAttribute(sn, i0)) < 0) fn.negate();
    for (const i of [i0, i1, i2]) { const k = key[i] * 3; acc[k] += fn.x; acc[k + 1] += fn.y; acc[k + 2] += fn.z; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = key[i] * 3;
    fn.set(acc[k], acc[k + 1], acc[k + 2]).normalize();
    out[i * 3] = fn.x; out[i * 3 + 1] = fn.y; out[i * 3 + 2] = fn.z;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  (attr as any).isAveraged = true;
  g.setAttribute('rayNormal', attr);
  return attr;
}

export interface HighBakeResult {
  /** Tangent-space normal, RGBA8, rows bottom-up, a = coverage. */
  normal: Uint8Array;
  /** r = height (0.5 = on the low surface), g = ray hit (1) or miss (0), a = coverage. */
  height: Uint8Array;
  /** High-poly surface position / normal per texel (for AO + curvature from the high poly). */
  pos: Float32Array;
  nrm: Float32Array;
  /** ID colors of the high poly (RGBA8), when asked for. */
  id: Uint8Array | null;
  hits: number;
  texels: number;
}

// Texel frames of the low poly, rasterised in UV space.
export const FRAME_VERT = /* glsl */ `
attribute vec3 rayNormal;
varying vec3 vP;
varying vec3 vN;
varying vec3 vR;
varying vec2 vUv;
void main() {
  vP = position; vN = normal; vR = rayNormal; vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
// mode 0 position, 1 normal, 2 tangent (∇u), 3 bitangent (∇v), 4 ray direction normal.
// The tangent frame matches three.js' derivative normal mapping, so the baked
// normals display correctly in the viewport without a tangent attribute.
export const FRAME_FRAG = /* glsl */ `
uniform int mode;
varying vec3 vP;
varying vec3 vN;
varying vec3 vR;
varying vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  if (mode == 0) { gl_FragColor = vec4(vP, 1.0); return; }
  if (mode == 4) { gl_FragColor = vec4(normalize(vR), 1.0); return; }
  if (mode == 1) { gl_FragColor = vec4(N, 1.0); return; }
  vec3 q0 = dFdx(vP), q1 = dFdy(vP);
  vec2 st0 = dFdx(vUv), st1 = dFdy(vUv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float sgn = sign(dot(cross(q0, q1), N));
  T *= sgn; B *= sgn;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  gl_FragColor = vec4((mode == 2 ? T : B) * sc, 1.0);
}`;

export function readFrames(gpu: GPU, low: THREE.BufferGeometry[], size: number, average: boolean) {
  // The shader reads 'rayNormal'; without averaging it is just the shading normal.
  for (const g of low) {
    if (average) averagedNormals(g);
    else g.setAttribute('rayNormal', g.attributes.normal);
  }
  const r = gpu.renderer;
  const scene = new THREE.Scene();
  const mk = (wire: boolean) => new THREE.ShaderMaterial({
    vertexShader: FRAME_VERT, fragmentShader: FRAME_FRAG, uniforms: { mode: { value: 0 } },
    side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending, wireframe: wire,
  });
  const wire = mk(true), solid = mk(false);
  const wires: THREE.Mesh[] = [];
  for (const g of low) {
    const mw = new THREE.Mesh(g, wire); mw.frustumCulled = false; mw.renderOrder = 0;
    const ms = new THREE.Mesh(g, solid); ms.frustumCulled = false; ms.renderOrder = 1;
    wires.push(mw);
    scene.add(mw, ms);
  }
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
    depthBuffer: false, generateMipmaps: false, colorSpace: THREE.NoColorSpace,
  });
  const out: Float32Array[] = [];
  const saved = new THREE.Color(); const sa = r.getClearAlpha(); r.getClearColor(saved);
  const modes = average ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
  for (const mode of modes) {
    wire.uniforms.mode.value = mode;
    solid.uniforms.mode.value = mode;
    // Derivatives are meaningless on wireframe lines: only use them for position/normal padding.
    for (const w of wires) w.visible = mode !== 2 && mode !== 3;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(scene, gpu.camera);
    const buf = new Float32Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    out.push(buf);
  }
  r.setClearColor(saved, sa);
  r.setRenderTarget(null);
  rt.dispose(); wire.dispose(); solid.dispose();
  return { pos: out[0], nrm: out[1], tan: out[2], bit: out[3], dir: out[4] ?? out[1] };
}

/** Invert [T B N] and apply to n (all column vectors). Returns false if singular. */
function toTangent(T: THREE.Vector3, B: THREE.Vector3, N: THREE.Vector3, n: THREE.Vector3, out: THREE.Vector3): boolean {
  const a = T.x, b = B.x, c = N.x, d = T.y, e = B.y, f = N.y, g = T.z, h = B.z, i = N.z;
  const A = e * i - f * h, Bc = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * Bc + c * C;
  if (Math.abs(det) < 1e-10) return false;
  const inv = 1 / det;
  const m00 = A * inv, m01 = -(b * i - c * h) * inv, m02 = (b * f - c * e) * inv;
  const m10 = Bc * inv, m11 = (a * i - c * g) * inv, m12 = -(a * f - c * d) * inv;
  const m20 = C * inv, m21 = -(a * h - b * g) * inv, m22 = (a * e - b * d) * inv;
  out.set(m00 * n.x + m01 * n.y + m02 * n.z, m10 * n.x + m11 * n.y + m12 * n.z, m20 * n.x + m21 * n.y + m22 * n.z);
  if (out.z < 0) out.z = 0;
  out.normalize();
  return true;
}

export async function bakeHighToLow(
  gpu: GPU, low: THREE.BufferGeometry[], high: THREE.BufferGeometry[], size: number,
  s: HighBakeSettings, onProgress?: (f: number) => void, isCancelled?: () => boolean,
  ids?: { tri: (Int32Array | null)[]; vertexColor: boolean; color: (id: number) => [number, number, number]; global?: boolean },
  /** Match by mesh name: low mesh (index + 1) per texel, and the name group of every low / high mesh. */
  match?: { lowIdx: Float32Array; lowKey: number[]; highKey: number[] },
): Promise<HighBakeResult | null> {
  const fr = readFrames(gpu, low, size, s.average);
  const N = size * size;
  const normal = new Uint8Array(N * 4);
  const height = new Uint8Array(N * 4);
  const pos = new Float32Array(N * 4);
  const nrm = new Float32Array(N * 4);
  const id = ids ? new Uint8Array(N * 4) : null;

  const ray = new THREE.Ray();
  const T = new THREE.Vector3(), Bv = new THREE.Vector3(), Nv = new THREE.Vector3(), P = new THREE.Vector3(), D = new THREE.Vector3();
  const hn = new THREE.Vector3(), tn = new THREE.Vector3(), bc = new THREE.Vector3();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const far = s.front + s.rear;
  const range = Math.max(s.front, s.rear, 1e-5);
  let hits = 0, texels = 0;

  // Fill missing tangent frames (UV island borders) from a neighbour.
  const frameAt = (i: number) => {
    const o = i * 4;
    if (fr.tan[o + 3] > 0.5 && (fr.tan[o] || fr.tan[o + 1] || fr.tan[o + 2])) return o;
    const x = i % size, y = (i / size) | 0;
    for (let rr = 1; rr <= 3; rr++) {
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const q = (yy * size + xx) * 4;
        if (fr.tan[q + 3] > 0.5) return q;
      }
    }
    return -1;
  };

  let lastYield = performance.now();
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    if (fr.pos[o + 3] < 0.5) continue;
    texels++;
    P.set(fr.pos[o], fr.pos[o + 1], fr.pos[o + 2]);
    Nv.set(fr.nrm[o], fr.nrm[o + 1], fr.nrm[o + 2]).normalize();
    const fo = frameAt(i);
    if (fo >= 0) { T.set(fr.tan[fo], fr.tan[fo + 1], fr.tan[fo + 2]); Bv.set(fr.bit[fo], fr.bit[fo + 1], fr.bit[fo + 2]); }
    else { T.set(1, 0, 0); Bv.set(0, 1, 0); }

    D.set(fr.dir[o], fr.dir[o + 1], fr.dir[o + 2]);
    if (D.lengthSq() < 0.5) D.copy(Nv); else D.normalize();
    ray.origin.copy(P).addScaledVector(D, s.front);
    ray.direction.copy(D).negate();
    let best: any = null, bestG: THREE.BufferGeometry | null = null;
    const want = match ? match.lowKey[Math.round(match.lowIdx[i]) - 1] ?? -1 : -1;
    for (let hi = 0; hi < high.length; hi++) {
      const g = high[hi];
      if (match && match.highKey[hi] !== want) continue;
      const bvh = (g as any).boundsTree;
      const hit = bvh ? bvh.raycastFirst(ray, s.ignoreBack ? THREE.FrontSide : THREE.DoubleSide, 0, far) : null;
      if (hit && hit.distance <= far && (!best || hit.distance < best.distance)) { best = hit; bestG = g; }
    }
    let ok = false;
    if (best && bestG) {
      const pa = bestG.attributes.position, na = bestG.attributes.normal;
      const f = best.face;
      va.fromBufferAttribute(pa, f.a); vb.fromBufferAttribute(pa, f.b); vc.fromBufferAttribute(pa, f.c);
      tri.set(va, vb, vc);
      tri.getBarycoord(best.point, bc);
      if (na) {
        hn.set(0, 0, 0)
          .addScaledVector(va.fromBufferAttribute(na, f.a), bc.x)
          .addScaledVector(vb.fromBufferAttribute(na, f.b), bc.y)
          .addScaledVector(vc.fromBufferAttribute(na, f.c), bc.z).normalize();
      } else hn.copy(f.normal);
      if (hn.dot(Nv) < 0) hn.negate();
      ok = toTangent(T, Bv, Nv, hn, tn);
      if (ok) {
        hits++;
        normal[o] = Math.round((tn.x * 0.5 + 0.5) * 255);
        normal[o + 1] = Math.round((tn.y * 0.5 + 0.5) * 255);
        normal[o + 2] = Math.round((tn.z * 0.5 + 0.5) * 255);
        const d = s.front - best.distance; // + = high surface is outside the low surface
        height[o] = Math.round((0.5 + 0.5 * THREE.MathUtils.clamp(d / range, -1, 1)) * 255);
        height[o + 1] = 255;
        pos[o] = best.point.x; pos[o + 1] = best.point.y; pos[o + 2] = best.point.z; pos[o + 3] = 1;
        nrm[o] = hn.x; nrm[o + 1] = hn.y; nrm[o + 2] = hn.z; nrm[o + 3] = 1;
        if (id && ids) {
          const gi = high.indexOf(bestG);
          const ca = bestG.attributes.color;
          let c: [number, number, number];
          if (ids.vertexColor && ca) {
            c = [0, 1, 2].map((k) => {
              const get = (v: number) => (k === 0 ? ca.getX(v) : k === 1 ? ca.getY(v) : ca.getZ(v));
              return get(f.a) * bc.x + get(f.b) * bc.y + get(f.c) * bc.z;
            }) as [number, number, number];
          } else {
            const t = ids.tri[gi];
            c = ids.color((ids.global ? 0 : gi * 7919) + (t ? t[best.faceIndex] : 0));
          }
          id[o] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
          id[o + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
          id[o + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
          id[o + 3] = 255;
        }
      }
    }
    if (!ok) {
      normal[o] = 128; normal[o + 1] = 128; normal[o + 2] = 255;
      height[o] = 128; height[o + 1] = 0;
      pos[o] = P.x; pos[o + 1] = P.y; pos[o + 2] = P.z; pos[o + 3] = 1;
      nrm[o] = Nv.x; nrm[o + 1] = Nv.y; nrm[o + 2] = Nv.z; nrm[o + 3] = 1;
    }
    normal[o + 3] = 255;
    height[o + 3] = 255;
    if ((i & 2047) === 0 && performance.now() - lastYield > 30) {
      onProgress?.(i / N);
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled?.()) return null;
      lastYield = performance.now();
    }
  }
  onProgress?.(1);
  return { normal, height, pos, nrm, id, hits, texels };
}
