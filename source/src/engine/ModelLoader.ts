import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Fast raycasting (needed to paint smoothly on dense meshes).
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type ModelSource =
  | { kind: 'builtin'; id: BuiltinId }
  | { kind: 'file'; name: string; bytes: ArrayBuffer };

export interface LoadedModel {
  name: string;
  geometries: THREE.BufferGeometry[];
  warnings: string[];
  triangles: number;
  source: ModelSource;
  /** How the model was centered/scaled into the unit sphere (a high poly reuses the low poly's). */
  xf: ModelXf;
  /** Material names, indexed by the material id in each geometry's groups. */
  materials?: string[];
  /** Texture set (material id) of each geometry: models with several materials get one texture set per material. */
  setOf?: number[];
}

/**
 * Split geometries so each one uses a single material (like Substance, where every material is its own texture set
 * with its own UV space). Each piece keeps only the vertices it uses.
 */
function splitByMaterial(geos: THREE.BufferGeometry[]): { geos: THREE.BufferGeometry[]; setOf: number[] } {
  const out: THREE.BufferGeometry[] = [], setOf: number[] = [];
  for (const g of geos) {
    const ids = new Set(g.groups.map((x) => x.materialIndex ?? 0));
    if (ids.size <= 1) { out.push(g); setOf.push(g.groups[0]?.materialIndex ?? 0); continue; }
    const total = g.index ? g.index.count : g.attributes.position.count;
    const vi = (i: number) => (g.index ? g.index.getX(i) : i);
    for (const id of [...ids].sort((a, b) => a - b)) {
      const remap = new Map<number, number>(), order: number[] = [], idx: number[] = [];
      for (const gr of g.groups) {
        if ((gr.materialIndex ?? 0) !== id) continue;
        const end = Math.min(total, gr.start + gr.count);
        for (let i = gr.start; i < end; i++) {
          const v = vi(i);
          let n = remap.get(v);
          if (n === undefined) { n = order.length; remap.set(v, n); order.push(v); }
          idx.push(n);
        }
      }
      if (!idx.length) continue;
      const ng = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes)) {
        const src = a as THREE.BufferAttribute, k = src.itemSize;
        const arr = new Float32Array(order.length * k);
        order.forEach((v, j) => { for (let c = 0; c < k; c++) arr[j * k + c] = src.array[v * k + c] as number; });
        ng.setAttribute(name, new THREE.BufferAttribute(arr, k));
      }
      ng.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      ng.addGroup(0, idx.length, id);
      ng.name = g.name;
      ng.userData = { ...g.userData };
      out.push(ng); setOf.push(id);
    }
    g.dispose();
  }
  return { geos: out, setOf };
}

/**
 * Model files often point at texture files (or carry them inside). LocalPaint paints its own textures, so the loaders
 * get a 1×1 stand-in for every texture: nothing is read from disk, no "texture not found" errors, and big embedded
 * textures don't slow the import down. Only the meshes, UVs and which material each part uses are kept.
 */
const NO_TEX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
function noTextureManager() {
  const m = new THREE.LoadingManager();
  m.setURLModifier(() => NO_TEX);
  return m;
}
/** The material's identity for "same material": its name (like Substance's texture sets), or the object when unnamed. */
function materialKey(mat: THREE.Material | undefined): string {
  if (!mat) return '(no material)';
  const n = (mat.name || '').trim();
  return n || 'unnamed:' + mat.uuid;
}
function materialLabel(mat: THREE.Material | undefined, i: number): string {
  const n = (mat?.name || '').trim();
  return n || `Material ${i + 1}`;
}
export interface ModelXf { center: [number, number, number]; scale: number }
export interface LoadOpts {
  /** Reuse this transform instead of fitting the model (high poly → same space as the low poly). */
  xf?: ModelXf;
  /** High poly: UVs are not needed. */
  highPoly?: boolean;
}

export type BuiltinId = 'box' | 'vase' | 'sphere' | 'knot';
export const BUILTINS: { id: BuiltinId; label: string }[] = [
  { id: 'box', label: 'Rounded box' },
  { id: 'vase', label: 'Test vase' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'knot', label: 'Torus knot' },
];

export const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj'];

/** Copy any attribute (interleaved / quantized) into a plain Float32 attribute. */
function toFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const n = attr.count, s = attr.itemSize;
  const out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) {
    out[i * s] = attr.getX(i);
    if (s > 1) out[i * s + 1] = attr.getY(i);
    if (s > 2) out[i * s + 2] = attr.getZ(i);
    if (s > 3) out[i * s + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, s);
}

function finalize(geos: THREE.BufferGeometry[], name: string, warnings: string[], source: ModelSource, opts: LoadOpts = {}): LoadedModel {
  if (!geos.length) throw new Error(opts.highPoly ? 'No meshes found in that file.' : 'No paintable meshes found (meshes need UVs).');
  // Center and scale so the model fits in a sphere of radius 1 (or reuse the low poly's transform).
  let center: THREE.Vector3, s: number;
  if (opts.xf) {
    center = new THREE.Vector3().fromArray(opts.xf.center);
    s = opts.xf.scale;
  } else {
    const box = new THREE.Box3();
    for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    s = 1 / radius;
  }
  let tris = 0, outside = 0, uvCount = 0;
  for (const g of geos) {
    g.translate(-center.x, -center.y, -center.z);
    g.scale(s, s, s);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    (g as any).computeBoundsTree();
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const uv = g.attributes.uv;
    if (!uv) continue;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) outside++;
    }
    uvCount += uv.count;
  }
  if (!opts.highPoly && outside > uvCount * 0.01) {
    warnings.push('Some UVs are outside the 0–1 range; those parts won\'t paint correctly.');
  }
  return {
    name, geometries: geos, warnings, triangles: Math.round(tris), source,
    xf: { center: [center.x, center.y, center.z], scale: s },
  };
}

function fromObject(root: THREE.Object3D, name: string, flipV: boolean, source: ModelSource, opts: LoadOpts = {}): LoadedModel {
  root.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const warnings: string[] = [];
  let noUv = 0;
  // One id per material across the whole file, so parts sharing a material share an id (and an ID map colour).
  const matIds = new Map<string, number>();
  const matNames: string[] = [];
  const matId = (mat: THREE.Material | undefined) => {
    const k = materialKey(mat);
    let id = matIds.get(k);
    if (id === undefined) { id = matNames.length; matIds.set(k, id); matNames.push(materialLabel(mat, id)); }
    return id;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const g = m.geometry;
    if (!g.attributes.uv && !opts.highPoly) { noUv++; return; }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', toFloat(g.attributes.position));
    if (g.attributes.normal) ng.setAttribute('normal', toFloat(g.attributes.normal));
    if (g.attributes.uv) {
      const uv = toFloat(g.attributes.uv);
      // glTF uses top-left UV origin; convert to the OpenGL/FBX/Roblox convention.
      if (flipV) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      ng.setAttribute('uv', uv);
    }
    if (g.index) ng.setIndex(new THREE.BufferAttribute(new Uint32Array(Array.from(g.index.array as ArrayLike<number>)), 1));
    // Vertex colors and material groups feed the ID map baker.
    if (g.attributes.color) ng.setAttribute('color', toFloat(g.attributes.color));
    // Material of every face (the material linked to that part of the mesh, never its textures).
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const total = g.index ? g.index.count : g.attributes.position.count;
    if (Array.isArray(m.material) && g.groups.length) for (const gr of g.groups) ng.addGroup(gr.start, Math.min(gr.count, total - gr.start), matId(mats[gr.materialIndex ?? 0]));
    else ng.addGroup(0, total, matId(mats[0]));
    ng.applyMatrix4(m.matrixWorld);
    if (!ng.attributes.normal) ng.computeVertexNormals();
    // The mesh name drives "bake by mesh name" (Helmet_low ↔ Helmet_high).
    ng.name = m.name || m.parent?.name || '';
    ng.userData.materials = matNames;
    geos.push(ng);
  });
  if (noUv) warnings.push(`${noUv} mesh${noUv > 1 ? 'es have' : ' has'} no UVs and ${noUv > 1 ? 'were' : 'was'} skipped.`);
  // Several materials: one texture set per material (the high poly stays whole, it's only baked from).
  const split = !opts.highPoly && matNames.length > 1 ? splitByMaterial(geos) : { geos, setOf: geos.map((g) => g.groups[0]?.materialIndex ?? 0) };
  const model = finalize(split.geos, name, warnings, source, opts);
  model.materials = matNames;
  model.setOf = split.setOf;
  return model;
}

export async function parseModel(name: string, bytes: ArrayBuffer, opts: LoadOpts = {}): Promise<LoadedModel> {
  const ext = name.split('.').pop()!.toLowerCase();
  const source: ModelSource = { kind: 'file', name, bytes };
  const base = name.replace(/\.[^.]+$/, '');
  if (ext === 'glb' || ext === 'gltf') {
    const gltf: any = await new Promise((res, rej) => new GLTFLoader(noTextureManager()).parse(bytes, '', res, rej));
    return fromObject(gltf.scene, base, true, source, opts);
  }
  if (ext === 'fbx') {
    const root = new FBXLoader(noTextureManager()).parse(bytes, '');
    return fromObject(root, base, false, source, opts);
  }
  if (ext === 'obj') {
    const root = new OBJLoader().parse(new TextDecoder().decode(bytes));
    return fromObject(root, base, false, source, opts);
  }
  throw new Error(`Unsupported model format ".${ext}". Use GLB, FBX or OBJ.`);
}

/**
 * Rounded box with a non-overlapping 3×2 UV atlas (one cell per face).
 * Grid points are packed toward the edges so the bevels are smooth.
 */
function roundedBox(radius = 0.14, n = 44, detail = false): THREE.BufferGeometry {
  const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  ];
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const t = (i: number) => -Math.cos((Math.PI * i) / n); // -1..1, dense at the ends
  const inner = 1 - radius;
  const p = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  faces.forEach(([nn, right, up], f) => {
    const cx = f % 3, cy = Math.floor(f / 3);
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const a = t(i), b = t(j);
        p.copy(nn).addScaledVector(right, a).addScaledVector(up, b);
        c.set(THREE.MathUtils.clamp(p.x, -inner, inner), THREE.MathUtils.clamp(p.y, -inner, inner), THREE.MathUtils.clamp(p.z, -inner, inner));
        d.subVectors(p, c);
        const len = d.length();
        const nrmv = len > 1e-6 ? d.clone().divideScalar(len) : nn.clone();
        const q = c.clone().addScaledVector(nrmv, radius);
        if (detail) q.addScaledVector(nrmv, panelDetail(a, b));
        pos.push(q.x * 0.8, q.y * 0.8, q.z * 0.8);
        nrm.push(nrmv.x, nrmv.y, nrmv.z);
        const pad = 0.02;
        uvs.push((cx + pad + (1 - 2 * pad) * (a * 0.5 + 0.5)) / 3, (cy + pad + (1 - 2 * pad) * (b * 0.5 + 0.5)) / 2);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c2 = a + (n + 1), d2 = c2 + 1;
        idx.push(a, b, d2, a, d2, c2);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (detail) g.computeVertexNormals();
  return g;
}

/** Sci-fi panel detail for the demo high poly: a groove outline, an inset panel and four bolts. */
function panelDetail(a: number, b: number): number {
  const ax = Math.abs(a), bx = Math.abs(b);
  if (ax > 0.82 || bx > 0.82) return 0;
  const sq = Math.max(ax, bx);
  let h = -0.03 * Math.exp(-Math.pow((sq - 0.5) / 0.018, 2));      // groove
  if (sq < 0.32) h -= 0.018 * (1 - THREE.MathUtils.smoothstep(sq, 0.29, 0.32)); // inset panel
  const bolt = Math.hypot(ax - 0.66, bx - 0.66);
  h += 0.025 * (1 - THREE.MathUtils.smoothstep(bolt, 0.045, 0.07));               // bolts
  const slot = Math.abs(a) < 0.2 && Math.abs(b + 0.0) < 0.03 ? -0.012 : 0;     // small slot
  return h + slot;
}

/** Demo high poly that matches the built-in rounded box (for trying high-to-low baking). */
export function demoHighPoly(low: LoadedModel): LoadedModel | null {
  if (low.source.kind !== 'builtin' || low.source.id !== 'box') return null;
  const g = roundedBox(0.14, 180, true);
  return finalize([g], 'Sci-fi box (demo high poly)', [], { kind: 'builtin', id: 'box' }, { xf: low.xf, highPoly: true });
}

export function builtinModel(id: BuiltinId): LoadedModel {
  let g: THREE.BufferGeometry;
  if (id === 'box') {
    g = roundedBox();
  } else if (id === 'sphere') {
    g = new THREE.SphereGeometry(1, 128, 64);
  } else if (id === 'knot') {
    g = new THREE.TorusKnotGeometry(0.6, 0.22, 320, 48);
  } else {
    // A vase-like lathe: curved surfaces, a lip and a foot to test painting.
    const pts: THREE.Vector2[] = [];
    const prof = (t: number) => {
      const y = -1 + 2 * t;
      let r = 0.42 + 0.28 * Math.sin(Math.PI * (t * 1.1 + 0.05)) - 0.18 * Math.exp(-Math.pow((t - 0.82) / 0.07, 2));
      if (t > 0.94) r += (t - 0.94) * 2.2; // flared lip
      if (t < 0.05) r = 0.3 + t * 2.4; // foot
      return new THREE.Vector2(Math.max(0.02, r), y);
    };
    pts.push(new THREE.Vector2(0.001, -1));
    for (let i = 0; i <= 120; i++) pts.push(prof(i / 120));
    g = new THREE.LatheGeometry(pts, 160);
  }
  const label = BUILTINS.find((b) => b.id === id)!.label;
  return finalize([g], label, [], { kind: 'builtin', id });
}

/** The shape smart-material previews are rendered on: a rounded box with panel lines, so wear, dirt and AO show. */
export function previewModel(): LoadedModel {
  return finalize([roundedBox(0.12, 72, true)], 'Preview', [], { kind: 'builtin', id: 'box' });
}
