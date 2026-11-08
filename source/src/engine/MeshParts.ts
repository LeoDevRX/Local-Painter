import * as THREE from 'three';

/** How the polygon-fill tool / material drops pick a region. */
export type PartMode = 'tri' | 'island' | 'part' | 'object' | 'material';
export const PART_LABEL: Record<PartMode, string> = {
  tri: 'Triangle', island: 'UV island', part: 'Mesh part', object: 'Object', material: 'Material',
};

/** A picked region: triangles of one geometry (`more`: the same region on other geometries, e.g. a shared material). */
export interface Part { geo: number; tris: Uint32Array; key: string; more?: { geo: number; tris: Uint32Array }[] }

/** Every geometry + triangle list a part covers. */
export const partTris = (p: Part) => [{ geo: p.geo, tris: p.tris }, ...(p.more ?? [])];

/** A stable number for a string (ID map colours by material name match between the low and high poly). */
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000003;
}
/** Material name of id `id` in geometry `g` (set by the model loader). */
export const materialName = (g: THREE.BufferGeometry, id: number) => ((g.userData.materials as string[] | undefined)?.[id] ?? `Material ${id + 1}`);

/** A distinct, stable color for an ID map region. */
export function idColor(id: number): [number, number, number] {
  let h = Math.imul(id + 1, 0x9e3779b1) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  const hue = (h % 3600) / 3600, sat = 0.55 + ((h >>> 12) % 40) / 100, val = 0.75 + ((h >>> 20) % 25) / 100;
  const k = (n: number) => (n + hue * 6) % 6;
  const f = (n: number) => val - val * sat * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

class UnionFind {
  p: Int32Array;
  constructor(n: number) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(x: number): number { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a: number, b: number) { a = this.find(a); b = this.find(b); if (a !== b) this.p[a] = b; }
}

/**
 * Splits each geometry into UV islands (triangles connected through shared
 * UV vertices) and mesh parts (connected in 3D), so a click can select one.
 */
export class MeshParts {
  private geos: THREE.BufferGeometry[];
  private ids = new Map<string, Int32Array>(); // `${mode}:${geo}` → component id per triangle
  private groups = new Map<string, Map<number, Uint32Array>>();

  constructor(geos: THREE.BufferGeometry[]) { this.geos = geos; }

  private triCount(g: THREE.BufferGeometry) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

  private compute(mode: 'island' | 'part', gi: number): Int32Array {
    const k = `${mode}:${gi}`;
    const cached = this.ids.get(k);
    if (cached) return cached;
    const g = this.geos[gi];
    const pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    const n = this.triCount(g);
    const uf = new UnionFind(n);
    const owner = new Map<string, number>();
    const q = (v: number, s: number) => Math.round(v * s);
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 3; c++) {
        const v = idx ? idx.getX(t * 3 + c) : t * 3 + c;
        const pk = `${q(pos.getX(v), 1e5)},${q(pos.getY(v), 1e5)},${q(pos.getZ(v), 1e5)}`;
        // UV islands: same position AND same UV (a seam splits them). Parts: same position.
        const key = mode === 'part' ? pk : `${pk}|${q(uv.getX(v), 1e6)},${q(uv.getY(v), 1e6)}`;
        const o = owner.get(key);
        if (o === undefined) owner.set(key, t); else uf.union(t, o);
      }
    }
    const out = new Int32Array(n);
    for (let t = 0; t < n; t++) out[t] = uf.find(t);
    this.ids.set(k, out);
    return out;
  }

  /** Region id of every triangle of geometry `gi` (for the ID map). */
  triIds(mode: 'island' | 'part' | 'object' | 'material', gi: number): Int32Array {
    const g = this.geos[gi];
    const n = this.triCount(g);
    if (mode === 'island' && !g.attributes.uv) mode = 'part';
    if (mode === 'island' || mode === 'part') return this.compute(mode, gi);
    const out = new Int32Array(n);
    if (mode === 'material' && g.groups.length) {
      for (const gr of g.groups) {
        const t0 = Math.floor(gr.start / 3), t1 = Math.min(n, Math.floor((gr.start + gr.count) / 3));
        for (let t = t0; t < t1; t++) out[t] = gr.materialIndex ?? 0;
      }
    }
    return out;
  }

  /** Material id of every triangle, across all geometries (cached). */
  private matCache = new Map<number, Int32Array>();
  private mat(gi: number) {
    let a = this.matCache.get(gi);
    if (!a) { a = this.triIds('material', gi); this.matCache.set(gi, a); }
    return a;
  }
  /** Distinct materials used by the model. */
  materialCount(): number {
    const s = new Set<number>();
    for (let gi = 0; gi < this.geos.length; gi++) for (const v of this.mat(gi)) s.add(v);
    return s.size;
  }
  /** Every triangle on any geometry that uses one of `ids`. */
  private materialPart(ids: Set<number>): Part | null {
    const list: { geo: number; tris: Uint32Array }[] = [];
    for (let gi = 0; gi < this.geos.length; gi++) {
      const m = this.mat(gi), t: number[] = [];
      for (let i = 0; i < m.length; i++) if (ids.has(m[i])) t.push(i);
      if (t.length) list.push({ geo: gi, tris: Uint32Array.from(t) });
    }
    if (!list.length) return null;
    return { ...list[0], more: list.slice(1), key: `material:${[...ids].sort((a, b) => a - b).join(',')}` };
  }

  /** Triangles of geometry `gi` whose UV triangle contains `uv` (for clicks in the 2D view). */
  triAtUV(gi: number, u: number, v: number): number {
    const g = this.geos[gi];
    const uv = g.attributes.uv, idx = g.index;
    if (!uv) return -1;
    const n = this.triCount(g);
    for (let t = 0; t < n; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const ax = uv.getX(a), ay = uv.getY(a), bx = uv.getX(b), by = uv.getY(b), cx = uv.getX(c), cy = uv.getY(c);
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-14) continue;
      const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d;
      const l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d;
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return t;
    }
    return -1;
  }

  /** Every region (in `mode`) touched by triangles that pass `test`, merged per geometry. */
  select(mode: PartMode, test: (gi: number, tri: number) => boolean): Part[] {
    if (mode === 'material') {
      const ids = new Set<number>();
      for (let gi = 0; gi < this.geos.length; gi++) {
        const m = this.mat(gi);
        for (let t = 0; t < m.length; t++) if (!ids.has(m[t]) && test(gi, t)) ids.add(m[t]);
      }
      const p = ids.size ? this.materialPart(ids) : null;
      return p ? [p] : [];
    }
    const out: Part[] = [];
    for (let gi = 0; gi < this.geos.length; gi++) {
      const n = this.triCount(this.geos[gi]);
      const hit: number[] = [];
      for (let t = 0; t < n; t++) if (test(gi, t)) hit.push(t);
      if (!hit.length) continue;
      if (mode === 'tri') { out.push({ geo: gi, tris: Uint32Array.from(hit), key: `tris:${gi}:${hit.length}:${hit[0]}:${hit[hit.length - 1]}` }); continue; }
      if (mode === 'object') { out.push(this.pick('object', gi, 0)!); continue; }
      const comp = this.compute(mode, gi);
      const want = new Set(hit.map((t) => comp[t]));
      const tris: number[] = [];
      for (let t = 0; t < n; t++) if (want.has(comp[t])) tris.push(t);
      out.push({ geo: gi, tris: Uint32Array.from(tris), key: `${mode}:${gi}:${[...want].sort((a, b) => a - b).join(',')}` });
    }
    return out;
  }

  /** Triangles of the region that contains triangle `tri` of geometry `geo`. */
  pick(mode: PartMode, geo: number, tri: number): Part | null {
    const g = this.geos[geo];
    if (!g) return null;
    const n = this.triCount(g);
    if (mode === 'tri') return { geo, tris: new Uint32Array([tri]), key: `tri:${geo}:${tri}` };
    if (mode === 'material') return this.materialPart(new Set([this.mat(geo)[tri] ?? 0]));
    if (mode === 'object') {
      const all = new Uint32Array(n);
      for (let i = 0; i < n; i++) all[i] = i;
      return { geo, tris: all, key: `object:${geo}` };
    }
    const comp = this.compute(mode, geo);
    const id = comp[tri];
    const gk = `${mode}:${geo}`;
    let groups = this.groups.get(gk);
    if (!groups) {
      const lists = new Map<number, number[]>();
      for (let t = 0; t < n; t++) { const c = comp[t]; let a = lists.get(c); if (!a) lists.set(c, (a = [])); a.push(t); }
      groups = new Map([...lists].map(([c, a]) => [c, Uint32Array.from(a)]));
      this.groups.set(gk, groups);
    }
    return { geo, tris: groups.get(id)!, key: `${gk}:${id}` };
  }

  /** Geometry of a region, for the hover highlight. */
  highlightGeometry(p: Part): THREE.BufferGeometry {
    return this.highlightMany([p]);
  }

  /** One highlight geometry for several regions (any geometries); `uvSpace` lays it out flat in UV. */
  highlightMany(parts: Part[], uvSpace = false): THREE.BufferGeometry {
    parts = parts.flatMap((p) => partTris(p).map((q) => ({ ...q, key: p.key })));
    let count = 0;
    for (const p of parts) count += p.tris.length * 3;
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) {
      const src = this.geos[p.geo];
      const sp = uvSpace ? src.attributes.uv : src.attributes.position, idx = src.index;
      if (!sp) continue;
      for (let i = 0; i < p.tris.length; i++) for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(p.tris[i] * 3 + k) : p.tris[i] * 3 + k;
        pos[o++] = sp.getX(v); pos[o++] = sp.getY(v); pos[o++] = uvSpace ? 0 : sp.getZ(v);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }

}
