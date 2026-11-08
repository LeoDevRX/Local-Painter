import { LayerFx, newFxId } from './LayerFx';
import { CHANNELS, Ch, ChannelValues, FillImage, Layer, TextureSet, BlendMode, GroupLayer, FillTransform, FillAdjust, DEFAULT_XF, DEFAULT_ADJ, BakeKey, ScanRef } from './TextureSet';
import { imageTexture } from './images';
import type { ModelSource } from './ModelLoader';
import type { GenSettings } from './Masks';
import type { ProcSource } from './Procedural';
import type { GraphJSON } from '../designer/Graph';
import { SBS_FILES, SBS_LOADED, SbsState, registerSbs, stateKey } from './Substance';

/** One layer as stored in a project (.tpaint) or smart material (.tpsmart). */
export type LayerJSON =
  | {
      kind: 'fill'; name: string; visible: boolean; opacity: number; blend?: BlendMode; anchor?: boolean; fx?: LayerFx[]; tag?: number;
      values: ChannelValues; enabled: Record<Ch, boolean>;
      tiling?: number; images?: Partial<Record<Ch, { name: string; data: string; flipG?: boolean }>>;
      xf?: FillTransform; adj?: FillAdjust; note?: string;
      procs?: Partial<Record<Ch, ProcSource>>;
      graph?: GraphJSON;
      /** Maps from a scanned material (downloaded on first use). */
      scan?: ScanRef;
      /** Substance material mode: parameter values plus the .sbsar itself (base64). */
      sbs?: SbsState & { data?: string };
      mask?: MaskJSON;
    }
  | {
      kind: 'paint'; name: string; visible: boolean; opacity: number; blend?: BlendMode; anchor?: boolean; fx?: LayerFx[]; tag?: number;
      channels: Partial<Record<Ch, string>>;
      mask?: MaskJSON;
    }
  | {
      kind: 'group'; name: string; visible: boolean; opacity: number; blend?: BlendMode; open?: boolean; anchor?: boolean; fx?: LayerFx[]; tag?: number;
      children: LayerJSON[];
      mask?: MaskJSON;
    };
export interface MaskJSON { base: 'white' | 'black'; gen: GenSettings | null; paint?: string; off?: boolean; inv?: boolean }

/** Project file (.tpaint): JSON with gzipped raw layer pixels, so nothing is lost. */
export interface ProjectFile {
  format: 'texpaint-project';
  version: 1 | 2 | 3;
  name: string;
  resolution: number;
  model: { kind: 'builtin'; id: string } | { kind: 'file'; name: string; data: string };
  activeIndex: number;
  layers: LayerJSON[];
  settings?: Record<string, unknown>;
  /** Baked mesh maps (gzipped RGBA8), so high-poly bakes survive without the high poly. */
  meshMaps?: MeshMapsJSON;
  /** Models with several materials: the name of every texture set (the fields above hold the first one). */
  setNames?: string[];
  /** Texture sets 2, 3, … (same fields as the first). */
  extraSets?: SetJSON[];
  /** Texture set that was selected. */
  activeSet?: number;
}
export interface MeshMapsJSON { mesh: string; bn: string; bh: string; id?: string; wsn?: string; pos?: string; baked?: BakeKey[]; highName?: string }
export interface SetJSON { name: string; resolution: number; activeIndex: number; layers: LayerJSON[]; meshMaps?: MeshMapsJSON }

/** Smart material (.tpsmart): fill layers + masks. Masks use generators, so they adapt to any model. */
export interface SmartMaterial {
  format: 'texpaint-smart';
  version: 1;
  name: string;
  layers: LayerJSON[];
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as any]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as any]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function serializeLayer(ts: TextureSet, l: Layer, withPaint = true): Promise<LayerJSON | null> {
  const j = await serializeLayerCore(ts, l, withPaint);
  if (j) {
    if (l.fx?.length) j.fx = structuredClone(l.fx);
    if (l.tag) j.tag = l.tag;
  }
  return j;
}
async function serializeLayerCore(ts: TextureSet, l: Layer, withPaint: boolean): Promise<LayerJSON | null> {
  let mask: MaskJSON | undefined;
  if (l.mask) {
    mask = { base: l.mask.base, gen: l.mask.gen ? { ...l.mask.gen } : null, off: l.mask.off || undefined, inv: l.mask.inv || undefined };
    if (withPaint && l.mask.painted) mask.paint = toB64(await gzip(ts.readRT(l.mask.paintRT)));
  }
  if (l.kind === 'fill') {
    const images: Partial<Record<Ch, { name: string; data: string; flipG?: boolean }>> = {};
    for (const [ch, img] of Object.entries(l.images ?? {}) as [Ch, FillImage][]) {
      if (img.name.startsWith('graph:') && l.graph) continue; // rebuilt from the graph
      if (!img.bytes.byteLength) continue; // rendered on the GPU (rebuilt when opened)
      images[ch] = { name: img.name, data: toB64(new Uint8Array(img.bytes)), flipG: img.flipG };
    }
    return {
      kind: 'fill', name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, anchor: l.anchor || undefined,
      values: structuredClone(l.values), enabled: { ...l.enabled }, tiling: l.tiling, images, mask,
      xf: l.xf ? { ...l.xf } : undefined, adj: l.adj ? structuredClone(l.adj) : undefined, note: l.note,
      procs: l.procs ? structuredClone(l.procs) : undefined,
      graph: l.graph ? structuredClone(l.graph) : undefined,
      sbs: l.sbs ? { ...structuredClone(l.sbs), data: SBS_FILES.has(l.sbs.key) ? toB64(SBS_FILES.get(l.sbs.key)!.bytes) : undefined } : undefined,
    };
  }
  if (l.kind === 'group') {
    const children: LayerJSON[] = [];
    for (const c of l.children) { const j = await serializeLayer(ts, c, withPaint); if (j) children.push(j); }
    return { kind: 'group', name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, open: l.open, children, mask, anchor: l.anchor || undefined };
  }
  if (!withPaint) return null;
  const channels = {} as Record<Ch, string>;
  for (const ch of CHANNELS) channels[ch] = toB64(await gzip(ts.readLayerChannel(l, ch)));
  return { kind: 'paint', name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, channels, mask, anchor: l.anchor || undefined };
}

/** Add a stored layer to the texture set (above the active layer when `aboveActive`). */
export async function restoreLayer(ts: TextureSet, l: LayerJSON, resolution: number, aboveActive = false, parent?: GroupLayer): Promise<Layer> {
  let layer: Layer;
  if (l.kind === 'group') {
    const g = ts.addGroup(l.name, aboveActive, parent);
    g.open = l.open ?? true;
    for (const c of l.children) await restoreLayer(ts, c, resolution, false, g);
    ts.activeId = g.id;
    layer = g;
  } else if (l.kind === 'fill') {
    let images: Partial<Record<Ch, FillImage>> | undefined;
    if (l.images && Object.keys(l.images).length) {
      images = {};
      for (const [ch, im] of Object.entries(l.images) as [Ch, { name: string; data: string; flipG?: boolean }][]) {
        const bytes = fromB64(im.data).buffer as ArrayBuffer;
        images[ch] = { name: im.name, bytes, tex: await imageTexture(bytes, im.name), flipG: im.flipG };
      }
    }
    if (l.graph && ts.graphBaker) {
      try { images = { ...(images ?? {}), ...(await ts.graphBaker(l.graph)) }; } catch (e) { console.warn('graph', e); }
    }
    let sbs: SbsState | undefined, sbsKey = '';
    if (l.sbs) {
      const { data, ...st } = l.sbs;
      sbs = structuredClone(st);
      try { if (data && !SBS_FILES.has(st.key)) await registerSbs(fromB64(data), st.file); } catch (e) { console.warn('sbs', e); }
      // Saved renders are used as they are; anything missing is rendered again once the layer exists.
      const keep = images ?? {};
      if (SBS_FILES.has(st.key) && !Object.values(st.map).some((ch) => ch && !keep[ch as Ch])) sbsKey = stateKey(sbs);
    }
    if (l.scan && ts.scanResolver && !images) {
      try {
        const got = await ts.scanResolver(l.scan);
        const use = l.scan.use ?? (Object.keys(got) as Ch[]);
        images = {};
        for (const ch of use) if (got[ch]) images[ch] = got[ch];
      } catch (e) { console.warn('scan', e); }
    }
    const fl = ts.addFillLayer(l.name, l.values, l.enabled, aboveActive, images, l.tiling ?? 1, parent);
    if (l.graph) fl.graph = structuredClone(l.graph);
    if (sbs) { fl.sbs = sbs; if (sbsKey) SBS_LOADED.set(fl, sbsKey); }
    if (l.xf) fl.xf = { ...DEFAULT_XF, ...l.xf };
    if (l.adj) fl.adj = { ...DEFAULT_ADJ, ...structuredClone(l.adj) };
    if (l.note) fl.note = l.note;
    if (l.procs) fl.procs = structuredClone(l.procs);
    layer = fl;
  } else {
    const pl = ts.addPaintLayer(l.name, aboveActive, parent);
    for (const ch of CHANNELS) {
      if (!l.channels[ch]) continue; // older projects lack newer channels
      ts.writeLayerChannel(pl, ch, await gunzip(fromB64(l.channels[ch]!)), resolution);
    }
    layer = pl;
  }
  layer.visible = l.visible;
  layer.opacity = l.opacity;
  layer.blend = l.blend ?? 'normal';
  if (l.anchor) layer.anchor = true;
  if (l.fx?.length) layer.fx = structuredClone(l.fx).map((f) => ({ ...f, id: newFxId() }));
  if (l.tag) layer.tag = l.tag;
  if (l.mask) {
    ts.addMask(layer, { base: l.mask.base, gen: l.mask.gen ? structuredClone(l.mask.gen) : null });
    if (l.mask.off) layer.mask!.off = true;
    if (l.mask.inv) layer.mask!.inv = true;
    if (l.mask.paint) {
      ts.writeRT(layer.mask!.paintRT, await gunzip(fromB64(l.mask.paint)), resolution);
      layer.mask!.painted = true;
      ts.maskChanged(layer);
    }
  }
  return layer;
}

async function serializeSet(ts: TextureSet, name: string): Promise<SetJSON> {
  const layers: LayerJSON[] = [];
  for (const l of ts.layers) layers.push((await serializeLayer(ts, l, true))!);
  const out: SetJSON = { name, resolution: ts.size, activeIndex: ts.layers.findIndex((l) => l.id === ts.activeId), layers };
  if (ts.bakedOnce) {
    const m = ts.readMeshMaps();
    out.meshMaps = {
      mesh: toB64(await gzip(m.mesh)), bn: toB64(await gzip(m.bn)), bh: toB64(await gzip(m.bh)),
      id: toB64(await gzip(m.id!)), wsn: toB64(await gzip(m.wsn!)), pos: toB64(await gzip(m.pos!)), baked: m.baked,
      highName: ts.highName || undefined,
    };
  }
  return out;
}

/** `sets`: every texture set of the model (one per material); a single TextureSet works too. */
export async function serializeProject(
  sets: TextureSet | { name: string; ts: TextureSet }[], name: string, model: ModelSource, settings: Record<string, unknown>, activeSet = 0,
): Promise<Blob> {
  const list = Array.isArray(sets) ? sets : [{ name, ts: sets }];
  const first = await serializeSet(list[0].ts, list[0].name);
  const file: ProjectFile = {
    format: 'texpaint-project', version: 3, name, resolution: first.resolution,
    model: model.kind === 'builtin'
      ? { kind: 'builtin', id: model.id }
      : { kind: 'file', name: model.name, data: toB64(new Uint8Array(model.bytes)) },
    activeIndex: first.activeIndex,
    layers: first.layers, settings,
  };
  if (first.meshMaps) file.meshMaps = first.meshMaps;
  if (list.length > 1) {
    file.setNames = list.map((x) => x.name);
    file.extraSets = [];
    for (const x of list.slice(1)) file.extraSets.push(await serializeSet(x.ts, x.name));
    file.activeSet = activeSet;
  }
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** The saved data of texture set `name` (the first set lives in the file's top-level fields). */
export function setData(f: ProjectFile, name: string, index: number): ProjectFile | null {
  if (!f.extraSets?.length) return index === 0 ? f : null;
  const all: SetJSON[] = [{ name: f.setNames?.[0] ?? '', resolution: f.resolution, activeIndex: f.activeIndex, layers: f.layers, meshMaps: f.meshMaps }, ...f.extraSets];
  const hit = all.find((x) => x.name === name) ?? all[index];
  if (!hit) return null;
  return { ...f, resolution: hit.resolution, activeIndex: hit.activeIndex, layers: hit.layers, meshMaps: hit.meshMaps };
}

export { NotProjectError, parseProject } from './ProjectFormat';

export async function restoreMeshMaps(ts: TextureSet, f: ProjectFile): Promise<boolean> {
  if (!f.meshMaps) return false;
  ts.writeMeshMaps({
    mesh: await gunzip(fromB64(f.meshMaps.mesh)),
    bn: await gunzip(fromB64(f.meshMaps.bn)),
    bh: await gunzip(fromB64(f.meshMaps.bh)),
    id: f.meshMaps.id ? await gunzip(fromB64(f.meshMaps.id)) : undefined,
    wsn: f.meshMaps.wsn ? await gunzip(fromB64(f.meshMaps.wsn)) : undefined,
    pos: f.meshMaps.pos ? await gunzip(fromB64(f.meshMaps.pos)) : undefined,
    baked: f.meshMaps.baked,
  }, f.resolution);
  ts.highName = f.meshMaps.highName ?? '';
  return true;
}

/** Rebuild layers into an (empty) texture set. */
export async function restoreLayers(ts: TextureSet, f: ProjectFile) {
  const rec = ts.recording;
  ts.recording = false; // opening a project isn't an undo step
  try {
    for (const l of f.layers) await restoreLayer(ts, l, f.resolution, false);
  } finally { ts.recording = rec; }
  ts.clearHistory();
  const active = ts.layers[f.activeIndex] ?? ts.layers[ts.layers.length - 1];
  ts.activeId = active?.id ?? -1;
  ts.layerChanged();
}

export async function makeSmartMaterial(ts: TextureSet, name: string): Promise<{ smart: SmartMaterial; skipped: number }> {
  const layers: LayerJSON[] = [];
  let skipped = 0;
  // A selected folder becomes the smart material (like Substance); otherwise the whole stack.
  const act = ts.activeLayer;
  const source = act?.kind === 'group' ? act.children : ts.layers;
  for (const l of source) {
    const j = await serializeLayer(ts, l, false);
    if (j) layers.push(j); else skipped++;
  }
  return { smart: { format: 'texpaint-smart', version: 1, name, layers }, skipped };
}

/** Insert a smart material as a folder above the active layer (like Substance). */
/**
 * Like Substance Painter: a material dropped on top covers the glow (emission) of the layers below it. Its bottom
 * fill layer paints emission black when it doesn't use emission itself, so a glowing material underneath doesn't
 * shine through.
 */
function coverEmission(l: Layer | undefined) {
  const f = l as any;
  if (!f || f.kind !== 'fill' || !f.enabled || f.enabled.emit || f.images?.emit) return;
  f.enabled.emit = true;
  f.values.emit = [0, 0, 0];
}

export async function applySmartMaterial(ts: TextureSet, sm: SmartMaterial, parent?: GroupLayer): Promise<Layer> {
  // A one-layer material is just that layer (like TextureCraft's simple materials).
  if (sm.layers.length === 1 && sm.layers[0].kind !== 'group') {
    const l = await restoreLayer(ts, sm.layers[0], ts.size, !parent, parent);
    coverEmission(l);
    ts.activeId = l.id;
    ts.layerChanged();
    return l;
  }
  const g = ts.addGroup(sm.name, !parent, parent);
  for (const l of sm.layers) await restoreLayer(ts, l, ts.size, false, g);
  // The lowest fill layer of the material (inside folders too).
  const lowest = (x: Layer): Layer | undefined => (x as any).kind === 'group' ? ((x as any).children ?? []).map(lowest).find(Boolean) : x;
  coverEmission(lowest(g));
  ts.activeId = g.id;
  ts.layerChanged();
  return g;
}
