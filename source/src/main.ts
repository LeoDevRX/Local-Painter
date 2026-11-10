import './style.css';
import * as THREE from 'three';
import { GPU } from './engine/gpu';
import { Viewport, ViewMode, ViewSource, Hit, Region, ToneMap } from './engine/Viewport';
import { UVView } from './engine/UVView';
import {
  TextureSet, Brush, CHANNELS, CH_LABEL, Ch, ChannelValues, Layer, FillLayer, FillImage,
  PaintTarget, BlendMode, BLEND_LABEL, GroupLayer, BakeKey, IdSource, ID_SOURCE_LABEL, DEFAULT_XF, DEFAULT_ADJ, FillAdjust, ScanRef,
} from './engine/TextureSet';
import { BrushPreset, BrushSettings, BUILTIN_TIPS, STARTER_BRUSHES, brushCategory, builtinTip, builtinTipThumb, imageTip, tipTexture, tipPreview } from './brushes';
import { ALPHA_LIBRARY } from './alphas';
import { installColorPopover } from './colorPopover';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { meshKey } from './engine/meshNames';
import { LayerFx, LayerFxKind, defaultFx, FILTERS, FILTER_TYPES, FilterType, fxTitle, FX_KIND_LABEL } from './engine/LayerFx';
import { DEFAULT_THICK } from './engine/Thickness';
import { GEN_LABEL, GEN_TYPES, GenType, defaultGen, Axis, SMART_MASKS, smartMask, findSmartMask, MaskFx, FX_BLENDS, FX_BLEND_LABEL, GenSettings, SHAPE_KINDS, SHAPE_LABEL, ShapeKind, MICRO_TYPES } from './engine/Masks';
import { PATTERNS, PATTERN_LABEL, PatternType } from './engine/Procedural';
import { GrungeLib } from './engine/GrungeLib';
import { SP_DEFS, SP_KINDS, SpKind, SpParam, spDefaults, GRUNGE_CATS, GRUNGE_CAT_LABEL, parseGrungeRef } from './engine/PainterGen';
import { MeshParts, PartMode, PART_LABEL, Part, partTris, materialName } from './engine/MeshParts';
import { MaterialPreset, PresetShelf, ShelfItem , isDesktopApp, openNativePresets , splitMapName, MapSlot } from './engine/Presets';
import { imageTexture } from './engine/images';
import { ThumbRenderer } from './engine/Thumbs';
import { SmartPreview } from './engine/SmartPreview';
import { findUVOverlaps, overlapTexture, overlapMesh, UVOverlap } from './engine/UVOverlap';
import { BUILTINS, BuiltinId, LoadedModel, MODEL_EXTS, builtinModel, parseModel, demoHighPoly } from './engine/ModelLoader';
import { saveFiles, downloadBlob, pixelsToPng } from './engine/Exporter';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import {
  ExportState, ExportTemplate, OutMap, ExpSrc, SrcInfo, MapMode, FileType, PadMode, Pix, SOURCES, MODE_SLOTS, PAD_LABEL, TEMPLATE_GROUPS, DEFAULT_EXPORT,
  loadExportState, saveExportState, allTemplates, fileName, channelsOf, compose, nearestFill, pad, encodePNG, encodeTGA, encodeJPG,
} from './engine/ExportTemplates';
import {
  LayerJSON, parseProject, restoreLayers, restoreLayer, serializeLayer, serializeProject, toB64, fromB64, makeSmartMaterial, applySmartMaterial, restoreMeshMaps, setData,
} from './engine/Project';
import { checkProjectFileName } from './engine/ProjectFormat';
import { STARTER } from './starter';
import { SCAN_SMART, SCAN_SMART_MORE } from './smartScans';
import { PAINTER_SMART } from './painterSmart';
import SCAN_PREVIEWS from './assets/scanPreviews.json';
import { libraryMaterials } from './materialLib';
import { VERSION } from './version';
import { Settings, loadSettings, saveSettings, weakComputer } from './settings';
import { GUIDES, CATS, Guide, GuideShow, searchGuides, guideById, tipsNow, fmt as guideFmt, TOURS, TourStep } from './guide';
import { loadThumbs, saveThumb, flush as flushThumbs } from './thumbCache';
import iconSmall from './assets/localpaint-32.png?inline';
import iconBig from './assets/localpaint-256.png?inline';
import { Designer } from './designer/DesignerUI';
import { GraphRunner, GraphJSON, OUTPUT_CHANNELS, presetGraphs } from './designer/Graph';
import { translateSpsm, translateSpmsk, Translation, SpNode } from './engine/SubstanceReader';
import { SBS_FILES, SBS_LOADED, SbsGraph, SbsParam, SbsState, SbsFeed, FEED_LABEL, registerSbs, newSbsState, graphOf, stateKey, visible, cliValue, isGlossy, readSbsPackage } from './engine/Substance';
import { SbsNativeRunner, nativeFor } from './engine/SbsNative';
import { el, slider, select, hexToRgb, rgbToHex, toast, pickFile, pickFiles, ICON2 as I } from './ui';

/**
 * Like Substance's number fields: hold the mouse on the number and drag left / right to lower / raise it (live).
 * A plain click (no drag) still lets you type. Shift = fine steps, Ctrl = big steps.
 */
function scrubNumber(input: HTMLInputElement, min: number, max: number, apply: () => void) {
  input.classList.add('scrub');
  input.draggable = false;
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || document.activeElement === input) return;
    e.preventDefault(); e.stopPropagation();
    const row = input.closest('[draggable]') as HTMLElement | null;
    const wasDraggable = row?.draggable;
    if (row) row.draggable = false;
    const x0 = e.clientX, v0 = +input.value || 0;
    let moved = false;
    try { input.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      document.body.classList.add('scrubbing');
      const k = ev.shiftKey ? 0.1 : ev.ctrlKey ? 2 : 0.5;
      const v = Math.round(Math.min(max, Math.max(min, v0 + dx * k)));
      if (String(v) !== input.value) { input.value = String(v); apply(); }
    };
    const up = () => {
      input.removeEventListener('pointermove', move); input.removeEventListener('pointerup', up); input.removeEventListener('pointercancel', up);
      document.body.classList.remove('scrubbing');
      if (row && wasDraggable !== undefined) row.draggable = wasDraggable;
      if (!moved) { input.focus(); input.select(); }
    };
    input.addEventListener('pointermove', move); input.addEventListener('pointerup', up); input.addEventListener('pointercancel', up);
  });
  // The wheel only changes the number while you're typing in it (no accidental changes while scrolling the panel).
  input.addEventListener('wheel', (e) => { if (document.activeElement !== input) input.blur(); }, { passive: true });
}

const RESOLUTIONS = [512, 1024, 2048, 4096];
const RES_LABEL = (r: number) => (r >= 1024 ? `${r / 1024}K` : `${r}`) + ` (${r} × ${r})`;
const VIEWS: { v: ViewMode; label: string }[] = [
  { v: 'material', label: 'Material' },
  { v: 'color', label: CH_LABEL.color },
  { v: 'rough', label: CH_LABEL.rough },
  { v: 'metal', label: CH_LABEL.metal },
  { v: 'height', label: CH_LABEL.height },
  { v: 'emit', label: CH_LABEL.emit },
  { v: 'normal', label: CH_LABEL.normal },
  { v: 'ao', label: 'Ambient occlusion' },
  { v: 'curv', label: 'Curvature' },
  { v: 'mask', label: 'Layer mask' },
  { v: 'bnormal', label: 'Baked normal' },
  { v: 'bheight', label: 'Baked height' },
  { v: 'rays', label: 'Ray check' },
  { v: 'id', label: 'ID map' },
  { v: 'wsn', label: 'World space normal' },
  { v: 'pos', label: 'Position' },
  { v: 'thick', label: 'Thickness' },
];
const BAKE_QUALITY = [
  { value: 32, label: 'Draft (32 directions)' }, { value: 64, label: 'Normal (64)' },
  { value: 96, label: 'High (96)' }, { value: 160, label: 'Very high (160)' },
];
type Tool = 'paint' | 'erase' | 'picker' | 'fill' | 'path' | 'smudge' | 'clone' | 'blur';
/** Tools that work with the brush (size, hardness, tip…). */
const BRUSH_TOOLS: Tool[] = ['paint', 'erase', 'smudge', 'clone', 'blur'];
type DropMode = 'whole' | PartMode;
type Mode = 'paint' | 'bake' | 'design';
type Layout = 'split' | '3d' | '2d';
type BakeItem = 'common' | BakeKey;
const BAKE_ITEMS: [BakeKey, string][] = [
  ['normal', 'Normal'], ['wsn', 'World space normal'], ['id', 'ID'], ['ao', 'Ambient occlusion'],
  ['curv', 'Curvature'], ['pos', 'Position'], ['thick', 'Thickness'], ['height', 'Height'],
];
const BAKE_VIEW: Record<BakeItem, ViewMode> = {
  common: 'rays', normal: 'bnormal', wsn: 'wsn', id: 'id', ao: 'ao', curv: 'curv', pos: 'pos', thick: 'thick', height: 'bheight',
};
type ShelfFilter = 'all' | 'model' | 'smart' | 'material' | 'textures' | 'brush' | 'alpha' | 'unsupported' | 'mask' | 'env' | 'graph' | 'cloud';

/** Dock: a titled panel like the ones in Substance (title bar + body). */
/** Colour tags for layers (Substance's colour labels); index 0 = none. */
const TAG_COLORS = ['', '#d24a4a', '#e07b39', '#c9a227', '#6aa84f', '#2f9e8f', '#3d7fd6', '#8e5bd6'];
const FX_ICON: Record<LayerFxKind, string> = { filter: '≋', generator: '◐', levels: '▥', fill: '◼' };
const FX_CHANS: [Ch, string][] = [['color', 'color'], ['height', 'height'], ['rough', 'rough'], ['metal', 'metal'], ['normal', 'nrm'], ['emit', 'emiss']];

function dock(title: string | HTMLElement, body: HTMLElement, cls = '') {
  return el('section', { class: 'dock ' + cls }, el('div', { class: 'dock-head' }, title), body);
}
/** Collapsible group inside a dock. */
function group(title: string, ...children: (Node | null | false | undefined)[]) {
  return el('div', { class: 'group' }, el('h4', {}, title), ...children);
}
function icon(svg: string, title: string, onclick: () => void, cls = '') {
  const b = el('button', { class: 'ib ' + cls, title, onclick });
  b.innerHTML = svg;
  return b;
}

class App {
  vp: Viewport;
  gpu: GPU;
  ts!: TextureSet;
  model!: LoadedModel;
  private _modified = false;
  get modified() { return this._modified; }
  set modified(v: boolean) { if (v !== this._modified) { this._modified = v; this.updateTitle?.(); } }
  exportPreset = 'pbr-gl';
  paintTarget: PaintTarget = 'content';
  tool: Tool = 'paint';
  mode: Mode = 'paint';
  layout3: Layout = 'split';
  view3: ViewMode = 'material';
  view2: ViewMode = 'material';

  brush: Brush = {
    radius: 0.06, hardness: 0.5, flow: 1, spacing: 0.12, erase: false,
    tip: 'round', angle: 0, angleJitter: 0, followStroke: false, sizeJitter: 0, scatter: 0,
    // Emission is on and black by default (like Painter): painting covers the glow of the layers below.
    channels: { color: true, rough: true, metal: true, height: false, emit: true, normal: false },
    values: { color: [0.61, 0.36, 1], rough: 0.4, metal: 0, height: 0.75, emit: [0, 0, 0] },
  };
  shelf = new PresetShelf();
  thumbs = new ThumbRenderer();
  /** CC0 grunge library used by the Painter-style generators. */
  grunges = new GrungeLib((window as any).texpaintNative);
  private grungeCount(cat: string) { return this.grunges.count(cat); }
  /** Runs smart materials for real on a preview shape (made on first use). */
  private smartPrev: SmartPreview | null = null;
  private get smartPreview() {
    if (!this.smartPrev) { this.smartPrev = new SmartPreview(this.gpu, this.settings.lowPerf ? 128 : 256); this.smartPrev.graphBaker = (g) => this.bakeGraph(g); this.smartPrev.scanResolver = (r) => this.scanImagesIfDownloaded(r); this.smartPrev.grungeResolver = (r) => this.grunges.resolve(r); }
    return this.smartPrev;
  }
  /** Last time the user did something (pointer, keys, drops): background previews wait until they've paused. */
  private lastInput = 0;
  private previewMissedScan = false;
  private noPersist = new Set<string>();
  private async waitIdle() {
    // Never while loading (the loading screen wants them), otherwise after 1.5 s without input.
    while (document.getElementById('splash') === null && performance.now() - this.lastInput < 1500) await new Promise((r) => setTimeout(r, 300));
  }
  private async smartThumb(key: string, sm: any): Promise<string> {
    await this.waitIdle();
    this.previewMissedScan = false;
    const px = await this.smartPreview.maps(sm);
    const url = await this.thumbs.previewMaps(key, this.smartPreview.geometry, px);
    // A preview made without a scan that isn't downloaded yet is shown, but not saved: it's made again later.
    if (this.previewMissedScan) this.noPersist.add(key);
    return url;
  }
  private shelfFilter: ShelfFilter = 'all';
  private shelfSearch = '';

  uv = new UVView();
  split = 0.5;
  private container!: HTMLElement;
  private uvOverlay = el('div', { id: 'uv-overlay' });
  private designEl = el('div', { id: 'designer' });
  private designer!: Designer;
  /** Fill layer the Designer's graph is linked to. */
  private designLinked = -1;
  private graphRunner!: GraphRunner;
  private uvSplitter = el('div', { id: 'uv-split', title: 'Drag to resize' });
  private sel3 = el('div', { class: 'pane-sel' });
  private sel2 = el('div', { class: 'pane-sel' });
  private flyout = el('div', { id: 'flyout' });
  private uvStroke: { uv: THREE.Vector2 } | null = null;
  private uvPan: { x: number; y: number } | null = null;
  private uvHover: THREE.Vector2 | null = null;
  private layerRowEls = new Map<number, { kind: HTMLElement; op: HTMLInputElement }>();

  private stroke: { hit: Hit; x: number; y: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  /** Brush sliders exist in the tool bar and in Properties; keep them in sync. */
  private brushSync = new Map<string, { el: HTMLElement; set: (v: number) => void }[]>();
  private brushPreview: HTMLCanvasElement | null = null;
  private matPreview: HTMLImageElement | null = null;
  private renaming = -1;
  private bakeProgress = -1;
  high: LoadedModel | null = null;
  private useHigh = true;
  private showCage = true;
  private showHigh = false;
  private bakeItem: BakeItem = 'common';
  private layersTab: 'layers' | 'settings' = 'layers';
  private mapThumbs = new Map<string, string>();
  private framedOnce = false;
  parts!: MeshParts;
  fillMode: PartMode = 'island';
  dropMode: DropMode = 'whole';
  private dragItem: ShelfItem | null = null;
  private dragLayer = -1;
  /** Layers being dragged together (multi-selection). */
  private dragLayers: number[] = [];
  /** Ctrl / Shift-click multi-selection in the Layers panel (always holds the active layer). */
  private sel = new Set<number>();
  private rowOrder: number[] = [];
  /** Ctrl-click multi-selection on the assets shelf. */
  private shelfPick = new Set<ShelfItem>();
  private dragMany: ShelfItem[] | null = null;
  private pickBar: HTMLElement | null = null;
  /** Brush tips by id (the texture set is rebuilt per model, so they're re-registered from here). */
  private tipCanvases = new Map<string, HTMLCanvasElement>();
  private tipUrls = new Map<string, string>();
  private refreshQueued = false;
  private tipPng = new Map<string, string>();
  /** Polygon fill box selection in progress. */
  private box: { pane: '3d' | '2d'; x0: number; y0: number; x1: number; y1: number; moved: boolean; parts: Part[]; queued: boolean } | null = null;
  private boxEl = el('div', { id: 'box-sel' });
  /** Ctrl + drag brush adjust (right button: size / hardness, left button: rotation / flow). */
  private adjust: { x: number; y: number; mode: 'hard' | 'angle'; r0: number; h0: number; f0: number; a0: number } | null = null;
  private adjustEl = el('div', { id: 'brush-adjust' });
  /** ID color selection mask waiting for a click on the model (layer id), or -1. */
  private idPick = -1;
  private uvHoverKey = '';
  private uvHoverPart: Part | null = null;
  private uvSelKey = '';
  private lastEnd3: THREE.Vector3 | null = null;
  private lastEnd2: THREE.Vector2 | null = null;
  /** Path (vector) tool: points clicked so far, in the 3D or the 2D view. */
  /** Path tool: points with optional bezier handles (h = outgoing handle; the incoming one mirrors it). */
  path: { pane: '3d' | '2d'; p3: { p: THREE.Vector3; n: THREE.Vector3; h: THREE.Vector3 | null }[]; p2: { p: THREE.Vector2; h: THREE.Vector2 | null }[] } = { pane: '3d', p3: [], p2: [] };
  /** Selected path point, and what's being dragged. */
  private pathSel = -1;
  private pathDrag: { kind: 'point' | 'hout' | 'hin' | 'new'; idx: number; x: number; y: number; moved: boolean } | null = null;
  /** The path is painted live (the brush follows it) and finished with Enter. */
  pathLive = true;
  private pathLiveOn = false;
  private pathQueued = false;
  pathSmooth = true;
  private ctxMenu = el('div', { id: 'ctx-menu', class: 'menu-items' });
  /** Selected content effect (its settings show in Properties); 0 = the layer itself. */
  private fxSel = 0;

  constructor() {
    // Smart masks made with "Create smart mask" (kept in the settings).
    for (const m of this.settings.userMasks ?? []) if (!findSmartMask(m.id)) SMART_MASKS.push({ id: m.id, label: m.label, build: () => structuredClone(m.gen) });
    // App icon: tab / window icon, the logo in the menu bar and on the loading screen.
    { const v = document.getElementById('brand-ver'); if (v) v.textContent = 'v' + VERSION; }
    { const v = document.getElementById('splash-ver'); if (v) v.textContent = `v${VERSION}`; }
    const fav = document.createElement('link'); fav.rel = 'icon'; fav.href = iconSmall; document.head.append(fav);
    document.querySelectorAll<HTMLElement>('.logo').forEach((e) => (e.style.backgroundImage = `url(${iconSmall})`));
    document.querySelectorAll<HTMLElement>('.splash-logo').forEach((e) => (e.style.backgroundImage = `url(${iconBig})`));
    const container = document.getElementById('viewport')!;
    this.container = container;
    this.vp = new Viewport(container);
    this.gpu = new GPU(this.vp.renderer);
    if (this.settings.envYaw) this.vp.envRotation = this.settings.envYaw;
    if (this.settings.envTilt) this.vp.envTiltDeg = this.settings.envTilt;
    container.append(this.uvOverlay, this.uvSplitter, this.sel3, this.sel2, this.flyout, this.boxEl, this.adjustEl, this.designEl, this.bakeLabel);
    this.graphRunner = new GraphRunner(this.vp.renderer);
    this.designer = new Designer(this.designEl, {
      renderer: this.vp.renderer,
      applyGraph: (g, runner, mode) => this.applyGraph(g, runner, mode),
      linkedName: () => this.linkedGraphLayer()?.name ?? null,
      saveJSON: (f, d) => this.shelf.saveJSON(f, d),
      rebuildSide: () => { if (this.mode === 'design') { this.buildShelf(); this.buildProperties(); } },
    });
    document.body.append(this.ctxMenu, this.pickPreview);
    window.addEventListener('click', () => { this.ctxMenu.classList.remove('open'); this.closeFlyouts(); });
    new ResizeObserver(() => { this.layout(); this.poke(); }).observe(container);
    for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'dragover', 'drop', 'input', 'change', 'click'])
      window.addEventListener(ev, () => this.poke(), { capture: true, passive: true });
    this.vp.controls.addEventListener('change', () => this.poke());
    this.initCollapsible();
    this.buildMenus();
    this.buildToolstrip();
    this.buildSidestrip();
    this.bindInput(container);
    this.bindUVInput();
    this.setModel(builtinModel('box'), this.newFileSize());
    this.buildAll();
    this.layout();
    this.loop();
    installColorPopover();
    this.loadStarter();
    (window as any).texpaintNative?.onOpenPath?.(async (p: string) => { if (await this.confirmUnsaved('Open this project anyway?')) this.openProjectFromPath(p); });
    (window as any).texpaintNative?.onCloseRequest?.(() => { (window as any).texpaintNative.ackClose(); this.onCloseRequest(); });
    this.updateTitle();
  }

  // ================================================================ model / project

  setModel(model: LoadedModel, resolution?: number, skipBake = false) {
    this.projectPath = '';
    this.shapeMove = null; document.body.classList.remove('moving-shape'); this.showGizmo?.(false); this.closeProjGizmo?.();
    this.shelfOpen?.clear();
    const bake = this.ts?.bakeSettings;
    const hs = this.ts?.heightStrength;
    const highSettings = this.ts?.highSettings;
    const maps = this.ts?.bakeMaps ?? this.settings.bakeMaps;
    const res = resolution ?? this.ts?.size ?? 1024;
    for (const st of this.sets) st.ts.dispose();
    if (this.ts && !this.sets.some((st) => st.ts === this.ts)) this.ts.dispose();
    this.model = model;
    // One texture set per material (like Substance): its own layers, textures, UV space and baked maps.
    const setOf = model.setOf ?? model.geometries.map(() => 0);
    const ids = [...new Set(setOf)].sort((a, b) => a - b);
    this.sets = ids.map((id) => {
      const geos = model.geometries.map((_, i) => i).filter((i) => setOf[i] === id);
      const ts = new TextureSet(this.gpu, geos.map((i) => model.geometries[i]), res);
      return { name: ids.length > 1 ? (model.materials?.[id] ?? `Material ${id + 1}`) : model.name, ts, geos, visible: true };
    });
    const first = this.sets[0].ts;
    if (bake) first.bakeSettings = { ...bake };
    if (highSettings) first.highSettings = { ...highSettings };
    if (maps) first.bakeMaps = { ...first.bakeMaps, ...maps };
    for (const st of this.sets) {
      const ts = st.ts;
      ts.graphBaker = (g) => this.bakeGraph(g);
      ts.scanResolver = (r) => this.scanImages(r);
      ts.grungeResolver = (r) => this.grunges.resolve(r);
      ts.onBakeStage = (k, stage) => { if (this.ts === ts) this.onBakeStage(k, stage); };
      if (hs !== undefined) ts.heightStrength = hs;
      // Bake settings are shared by every texture set (one Baking panel for the model).
      ts.bakeSettings = first.bakeSettings; ts.highSettings = first.highSettings; ts.bakeMaps = first.bakeMaps;
      if (this.sets.length > 1) ts.occluders = model.geometries;
      // Many engine changes can happen in one go (e.g. translating a smart material): rebuild the UI once per frame.
      ts.onChange = () => {
        if (this.ts !== ts) { this.poke(); return; }
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        requestAnimationFrame(() => { this.refreshQueued = false; this.refresh(); });
      };
    }
    this.activeSet = 0;
    this.ts = first;
    this.high = null;
    this.mapThumbs.clear();
    this.vp.setModel(model.geometries, model.geometries.map((_, i) => this.sets.findIndex((st) => st.geos.includes(i))));
    this.uv.setModel(this.ts.geometries);
    this.checkUVOverlaps(model);
    this.parts = new MeshParts(this.ts.geometries);
    if (this.dropMode === 'material') this.dropMode = 'whole';
    if (this.fillMode === 'material') this.fillMode = 'island';
    if (this.sets.length > 1) setTimeout(() => toast(`${this.sets.length} materials found, so ${this.sets.length} texture sets: pick one in the Texture Set List (top right) to paint it. Each has its own layers and textures.`), 900);
    this.clearPath();
    this.lastEnd3 = null; this.lastEnd2 = null;
    this.uv.frame();
    this.bindTextures();
    this.modified = false;
    this.paintTarget = 'content';
    for (const w of model.warnings) toast(w, true);
    if (this.container.isConnected && document.getElementById('right')!.childElementCount) this.buildAll();
    if (!skipBake && this.container.isConnected) toast('Mesh maps (AO, curvature, ID…) aren\'t baked yet. Open the Baking tab (top right) and click Bake when you\'re ready.');
    this.updateBakeStatus();
  }

  // ---------------------------------------------------------------- UV overlaps

  uvOverlap: UVOverlap | null = null;
  showOverlap = false;
  /** Find overlapping UVs (right after loading, without holding up the load) and mark them dark in 2D and on the model. */
  /** Overlap check of the active texture set (each set has its own UV space). */
  private checkUVOverlaps(model: LoadedModel) {
    this.uvOverlap = null;
    this.uv.setOverlap(null);
    this.vp.setOverlap(null, false);
    const ts = this.ts, geos = ts.geometries;
    const st = this.sets[this.activeSet];
    setTimeout(() => {
      if (this.model !== model || this.ts !== ts) return;
      let o: UVOverlap;
      // Once per texture set: switching sets (e.g. while baking all of them) reuses the result.
      let fresh = false;
      if (st?.overlap && st.ts === ts) o = st.overlap;
      else {
        fresh = true;
        try { o = findUVOverlaps(geos, this.settings.lowPerf ? 256 : 512); } catch (e) { console.warn('uv overlap', e); return; }
        if (st && st.ts === ts) st.overlap = o;
      }
      this.uvOverlap = o;
      if (o.tris) {
        this.uv.setOverlap(overlapTexture(o));
        this.vp.setOverlap(overlapMesh(geos, o), this.showOverlap);
        this.uv.setOverlapVisible(this.showOverlap);
        if (fresh && model.source.kind !== 'builtin') toast(`This model has ${o.areas} overlapping UV area${o.areas === 1 ? '' : 's'} (${o.tris} triangles). Painting there also paints the other spot. Press O to see them as dark spots, then fix them in Blender.`, true);
      }
      if (this.mode === 'paint' || this.mode === 'bake') this.buildToolbar();
      this.poke();
    }, 50);
  }
  toggleOverlap(on = !this.showOverlap) {
    this.showOverlap = on;
    this.uv.setOverlapVisible(on);
    this.vp.setOverlapVisible(on);
    const o = this.uvOverlap;
    if (on) toast(!o ? 'Still checking the UVs…' : o.tris ? `UV overlaps: ${o.areas} area${o.areas === 1 ? '' : 's'}, ${o.tris} triangles (dark spots on the model and in the 2D view)` : 'No overlapping UVs on this model');
    this.buildToolbar();
    this.poke();
  }

  /** Starting layers for every texture set. */
  newDefaultLayers() {
    for (const ts of this.sets.length ? this.sets.map((st) => st.ts) : [this.ts]) {
      ts.addFillLayer('Base material', {
        color: [0.62, 0.62, 0.62], rough: 0.45, metal: 0, height: 0.5,
      }, { color: true, rough: true, metal: true, height: true }, false);
      ts.addPaintLayer('Layer 1');
      ts.clearHistory();
    }
    this.sel.clear();
  }

  /** Opening a model goes through the New project window (like Painter's). */
  async openModelFile(file: File) {
    if (!(await this.confirmUnsaved('Load a new model anyway?'))) return;
    await this.newProjectDialog(file);
  }

  /** Project-wide normal map format (New project window); affects imported normal maps and the default export. */
  normalFormat: 'gl' | 'dx' = 'gl';

  /** Painter-style New project window: mesh, template, resolution, normal format, baked maps to import. */
  async newProjectDialog(file: File | null = null) {
    const np = { ...this.settings.newProj };
    let mesh = file;
    const baked: { file: File; key: BakeKey }[] = [];
    const guessKey = (n: string): BakeKey => {
      const s = n.toLowerCase();
      return /ambient|occlusion|_ao\b|\bao\b/.test(s) ? 'ao' : /curv/.test(s) ? 'curv' : /world.?space|wsn|_ws_?normal|normal_?ws/.test(s) ? 'wsn'
        : /position|_pos\b/.test(s) ? 'pos' : /thick/.test(s) ? 'thick' : /\bid\b|_id\b|color_?id|material_?id/.test(s) ? 'id' : /height|displac/.test(s) ? 'height' : 'normal';
    };
    const KEYS: [BakeKey, string][] = [['ao', 'Ambient occlusion'], ['curv', 'Curvature'], ['normal', 'Normal'], ['wsn', 'World space normal'], ['pos', 'Position'], ['thick', 'Thickness'], ['id', 'ID'], ['height', 'Height']];
    const sizes = [512, 1024, 2048, 4096].filter((s) => !this.settings.lowPerf || s <= 1024);
    let res = this.newFileSize();
    const meshName = el('span', { class: 'np-file' }, mesh ? mesh.name : 'No mesh selected');
    const list = el('div', { class: 'np-list' });
    const drawList = () => {
      list.innerHTML = '';
      if (!baked.length) list.append(el('p', { class: 'muted' }, 'None. LocalPaint can bake them for you instead.'));
      baked.forEach((b, i) => list.append(el('div', { class: 'np-row' }, el('span', { class: 'np-file' }, b.file.name),
        select<BakeKey>(KEYS.map(([k, l]) => ({ value: k, label: l })), b.key, (v) => { b.key = v; }),
        el('button', { class: 'exp-ib', title: 'Remove', onclick: () => { baked.splice(i, 1); drawList(); } }, '×'))));
    };
    drawList();
    const autoBake = el('input', { type: 'checkbox', checked: np.autoBake }) as HTMLInputElement;
    const info = (t: string) => el('span', { class: 'np-info', title: t }, 'i');
    const row = (label: string, tip: string, ...c: (HTMLElement | null)[]) => el('div', { class: 'np-field' }, el('label', {}, label), el('div', { class: 'np-ctl' }, ...c), info(tip));
    const TEMPLATES: [string, string, string][] = [
      ['pbr', 'PBR – Metallic Roughness', 'pbr-gl'], ['roblox', 'Roblox (SurfaceAppearance)', 'roblox'], ['unity', 'Unity (URP)', 'unity-urp'],
      ['unreal', 'Unreal Engine (packed)', 'unreal'], ['godot', 'Godot 4', 'godot'], ['blender', 'Blender', 'blender'], ['empty', 'Empty (one paint layer)', 'pbr-gl'],
    ];
    if (!TEMPLATES.some(([v]) => v === np.template)) np.template = 'pbr';
    const resSel = select<number>(sizes.map((s) => ({ value: s, label: `${s} x ${s}` })), sizes.includes(res) ? res : sizes[sizes.length - 1], (v) => { res = v; });
    const tplSel = select<string>(TEMPLATES.map(([v, l]) => ({ value: v, label: l })), np.template, (v) => {
      np.template = v as typeof np.template;
      if (v === 'roblox' && res > 1024) { res = 1024; resSel.value = '1024'; }
    });
    const bakedBox = el('details', { class: 'np-sub' }, el('summary', {}, 'Import baked maps'),
      el('p', { class: 'muted' }, 'Mesh maps you already baked in Painter, Marmoset or Blender. LocalPaint guesses each one\'s type from its name.'),
      list, el('button', { onclick: async () => {
        const fs = await pickFiles('.png,.jpg,.jpeg,.tga,.webp');
        for (const f of fs) baked.push({ file: f, key: guessKey(f.name) });
        drawList();
      } }, 'Add…'));
    const adv = el('details', { class: 'np-adv' }, el('summary', {}, 'Advanced settings'),
      row('Normal map format', 'Which way the green channel of normal maps points. OpenGL: Blender, Unity, Godot, Roblox. DirectX: Unreal, 3ds Max.',
        select<string>([{ value: 'gl', label: 'OpenGL' }, { value: 'dx', label: 'DirectX' }], np.normal, (v) => { np.normal = v as 'gl' | 'dx'; })),
      bakedBox) as HTMLDetailsElement;
    adv.open = true;
    const content = el('div', { class: 'np' },
      el('div', { class: 'np-h' }, 'Basic settings'),
      row('3D mesh', 'The model to paint (FBX, OBJ, glTF / GLB).', meshName, el('button', { class: 'np-select', onclick: async () => { const f = await pickFile(MODEL_EXTS.map((e) => '.' + e).join(',')); if (f) { mesh = f; meshName.textContent = f.name; meshName.classList.remove('none'); } } }, 'Select…')),
      row('Project template', 'Starting layers and which export template the project uses.', tplSel),
      row('Document resolution (px)', 'Size of the textures you paint. You can change it later in Texture set settings.', resSel),
      el('label', { class: 'check-row np-check', title: 'Bakes ambient occlusion, curvature, world space normal, position, thickness and ID. Smart masks and generators need them.' }, autoBake, ' Bake mesh maps after importing'),
      adv);
    if (!mesh) meshName.classList.add('none');
    for (;;) {
      const r = await this.modal({ title: 'New project', text: '', icon: 'info', wide: true, content, buttons: [['Create', 'ok', 'primary'], ['Cancel', 'cancel']] });
      if (r !== 'ok') return;
      if (mesh) break;
      toast('Select a 3D mesh first', true);
    }
    np.autoBake = autoBake.checked;
    this.settings.newProj = np; saveSettings(this.settings);
    try {
      toast(`Loading ${mesh!.name}…`);
      const m = await parseModel(mesh!.name, await mesh!.arrayBuffer());
      if (m.source.kind === 'file') m.source.path = this.pathOfFile(mesh!);
      this.setModel(m, res);
      if (np.template === 'empty') { for (const st of this.sets) { st.ts.addPaintLayer('Layer 1'); st.ts.clearHistory(); } this.sel.clear(); }
      else this.newDefaultLayers();
      this.normalFormat = np.normal;
      this.exportPreset = TEMPLATES.find(([v]) => v === np.template)?.[2] ?? 'pbr-gl';
      if (np.normal === 'dx' && this.exportPreset === 'pbr-gl') this.exportPreset = 'pbr-dx';
      if (this.exp) this.exp.template = this.exportPreset;
      for (const b of baked) {
        try {
          const tex = await imageTexture(await b.file.arrayBuffer(), b.file.name);
          this.ts.importMeshMap(b.key, tex, b.key === 'normal' && np.normal === 'dx');
          tex.dispose();
        } catch (e) { console.warn(e); toast(`Couldn't use ${b.file.name}`, true); }
      }
      if (baked.length) { this.applyViews(); this.updateBakeStatus(); this.sbsMeshStamp++; }
      this.buildAll();
      toast(`Loaded ${mesh!.name}`);
      const missing = (['ao', 'curv', 'wsn', 'pos'] as BakeKey[]).filter((k) => this.sets.some((st) => !st.ts.baked.has(k)));
      if (np.autoBake && missing.length) setTimeout(() => void this.startBake(), 300);
    } catch (e: any) {
      console.error(e);
      toast(e?.message ?? 'Could not load model', true);
    }
  }

  async loadBuiltin(id: BuiltinId) {
    if (!(await this.confirmUnsaved('Start a new file anyway?'))) return;
    this.setModel(builtinModel(id), this.newFileSize());
    this.newDefaultLayers();
  }

  /** Texture size for new files (Settings; low performance mode keeps it at 1024 or below). */
  newFileSize() {
    const s = this.settings.defaultSize || 1024;
    return this.settings.lowPerf ? Math.min(s, 1024) : s;
  }

  private projectSettings() {
    return {
      brush: this.brush, brushTipPng: this.brush.tip ? this.tipPng.get(this.brush.tip) : undefined, exportPreset: this.exportPreset, normalFormat: this.normalFormat,
      heightStrength: this.ts.heightStrength, bake: this.ts.bakeSettings, high: this.ts.highSettings,
    };
  }

  /**
   * LocalPaint's own dialog (instead of the plain Windows / browser box).
   * Buttons: [label, value, style]; resolves with the clicked value ('cancel' for Esc / clicking outside).
   */
  modal(o: { title: string; text: string; icon?: 'warn' | 'info' | 'question'; buttons: [string, string, ('primary' | 'danger' | '')?][]; content?: HTMLElement; wide?: boolean }): Promise<string> {
    return new Promise((resolve) => {
      document.querySelectorAll('.lmp-modal-wrap').forEach((x) => x.remove());
      const done = (v: string) => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 140); window.removeEventListener('keydown', onKey, true); resolve(v); };
      const btns = o.buttons.map(([label, value, style]) => el('button', { class: 'lmp-btn ' + (style ?? ''), onclick: () => done(value) }, label));
      const icon = el('div', { class: 'lmp-modal-icon ' + (o.icon ?? 'question') }, o.icon === 'warn' ? '!' : o.icon === 'info' ? 'i' : '?');
      const box = el('div', { class: 'lmp-modal' + (o.wide ? ' wide' : ''), role: 'dialog' },
        el('div', { class: 'lmp-modal-head' }, el('span', { class: 'lmp-modal-logo' }), el('span', {}, 'LocalPaint')),
        el('div', { class: 'lmp-modal-body' }, icon, el('div', { class: 'grow' }, el('h3', {}, o.title), el('p', {}, o.text))),
        o.content ? el('div', { class: 'lmp-modal-content' }, o.content) : null,
        el('div', { class: 'lmp-modal-foot' }, ...btns));
      const wrap = el('div', { class: 'lmp-modal-wrap' }, box);
      (box.querySelector('.lmp-modal-logo') as HTMLElement).style.backgroundImage = `url(${iconSmall})`;
      wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done('cancel'); });
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); }
        if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('select')) { e.preventDefault(); e.stopPropagation(); (btns.find((b) => b.classList.contains('primary')) ?? btns[0]).click(); }
      };
      window.addEventListener('keydown', onKey, true);
      document.body.append(wrap);
      (btns.find((b) => b.classList.contains('primary')) ?? btns[0])?.focus();
    });
  }

  /** Ask for a name (Electron has no window.prompt). Resolves with the text, or null when cancelled. */
  async askText(title: string, text: string, def = ''): Promise<string | null> {
    const inp = el('input', { type: 'text', value: def, class: 'lmp-input', spellcheck: false }) as HTMLInputElement;
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
    const r = await this.modal({ title, text, icon: 'question', content: inp, buttons: [['OK', 'ok', 'primary'], ['Cancel', 'cancel']] });
    return r === 'ok' ? (inp.value.trim() || null) : null;
  }

  /** Unsaved work: offer Save / Don't save / Cancel. Returns true when it's OK to go on. */
  async confirmUnsaved(action: string): Promise<boolean> {
    if (!this.modified) return true;
    const r = await this.modal({
      title: `Save changes to “${this.projectName()}.lp”?`,
      text: `You have unsaved changes. ${action}`, icon: 'warn',
      buttons: [['Save', 'save', 'primary'], ["Don't save", 'discard', 'danger'], ['Cancel', 'cancel']],
    });
    if (r === 'cancel') return false;
    if (r === 'save') { await this.saveProject(false); return !this.modified; }
    return true;
  }

  /** The window is closing (desktop app): ask about unsaved work in LocalPaint's own dialog. */
  private async onCloseRequest() {
    const native = (window as any).texpaintNative;
    if (!this.modified) { native.quit(); return; }
    const r = await this.modal({
      title: 'Quit LocalPaint?',
      text: `“${this.projectName()}.lp” has unsaved changes. Save them before quitting?`, icon: 'warn',
      buttons: [['Save now', 'save', 'primary'], ['Quit without saving', 'discard', 'danger'], ['Cancel', 'cancel']],
    });
    if (r === 'save') { await this.saveProject(false); if (!this.modified) native.quit(); }
    else if (r === 'discard') native.quit();
  }

  settings: Settings = loadSettings();
  private get native(): any { return (window as any).texpaintNative; }

  // ================================================================ autosave & recovery

  private lastAutosave = Date.now();
  private autosaving = false;
  private startAutosave() {
    setInterval(() => this.autosaveTick(), 15000);
  }
  private async autosaveTick(force = false) {
    const st = this.settings;
    if (!this.native?.autosaveWrite || this.autosaving) return;
    if (!force && (!st.autosave || !this.modified || Date.now() - this.lastAutosave < st.autosaveMinutes * 60000)) return;
    if (this.ts.painting || this.ts.baking || this.pathLiveOn) return;
    this.autosaving = true;
    try {
      const blob = await serializeProject(this.projectSets(), this.model.name || this.projectName(), this.model.source, this.projectSettings(), this.activeSet);
      await this.native.autosaveWrite(this.projectName(), await blob.arrayBuffer(), this.snapshotThumb(), this.projectPath, st.autosaveKeep);
      this.lastAutosave = Date.now();
      this.flashStatus('Autosaved ✓');
    } catch (e) { console.warn('autosave', e); }
    finally { this.autosaving = false; }
  }
  /** A small picture of the 3D view (recent files and autosaves). */
  snapshotThumb(): string {
    try {
      this.vp.render();
      const src = this.vp.canvas, r = this.vp.region;
      const cv = document.createElement('canvas');
      cv.width = 200; cv.height = 125;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#1b1a20'; g.fillRect(0, 0, 200, 125);
      const dpr = src.width / Math.max(1, src.clientWidth);
      const w = r.w * dpr, h = r.h * dpr, k = Math.min(200 / w, 125 / h) * 1.15;
      g.drawImage(src, r.x * dpr, r.y * dpr, w, h, (200 - w * k) / 2, (125 - h * k) / 2, w * k, h * k);
      return cv.toDataURL('image/jpeg', 0.8);
    } catch { return ''; }
  }
  private flashStatus(text: string) {
    const e = document.getElementById('status-bake');
    if (!e || this.bakeProgress >= 0) return;
    e.textContent = text; e.classList.add('flash');
    setTimeout(() => { if (e.textContent === text) { e.textContent = ''; e.classList.remove('flash'); } }, 2500);
  }


  // ================================================================ updates

  /** The newer release on GitHub, if there is one. */
  updateInfo: { version: string; url: string; notes: string; hasUpdateFiles: boolean } | null = null;
  private static newer(a: string, b: string) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
    return false;
  }
  async checkForUpdates(manual = false) {
    const native = this.native;
    if (!native?.updateCheck) { if (manual) toast('Updates are checked in the LocalPaint app'); return; }
    if (manual) toast('Checking for updates…');
    const r = await native.updateCheck();
    if (!r || r.error) { if (manual) toast('Couldn\'t reach GitHub. Check your internet connection and try again.', true); return; }
    if (!App.newer(r.version, VERSION)) { this.updateInfo = null; this.showUpdateButton(); if (manual) toast(`You have the latest version (v${VERSION})`); return; }
    this.updateInfo = r;
    this.showUpdateButton();
    this.showUpdatePopup();
  }
  /** Purple "Update" button in the top bar while a newer version is out (stays until you update). */
  private showUpdateButton() {
    document.getElementById('update-btn')?.remove();
    const u = this.updateInfo;
    if (!u) return;
    const b = el('button', { id: 'update-btn', class: 'update-top', title: `LocalPaint v${u.version} is out (you have v${VERSION}). Click to update.`, onclick: (e: Event) => { e.stopPropagation(); this.showUpdatePopup(); } },
      el('span', { class: 'arrow' }, '↑'), `Update to v${u.version}`);
    const guide = document.getElementById('guide-btn');
    if (guide) guide.after(b); else document.getElementById('menus')?.append(b);
  }
  private async showUpdatePopup() {
    const u = this.updateInfo;
    if (!u) return;
    const notes = el('div', { class: 'update-notes' });
    // Only the "What's new" part of the release notes (the download help above it is for the web page).
    const all = u.notes.split(/\r?\n/);
    const wn = all.findIndex((x) => /what'?s new/i.test(x));
    const lines = (wn >= 0 ? all.slice(wn + 1) : all).map((x) => x.trim()).filter((x) => x && !/^#|^\*\*(new install|already have)|download/i.test(x)).slice(0, 8);
    for (const l of lines) { const p = el('p', {}); p.innerHTML = guideFmt(l.replace(/^[-*]\s*/, '')); notes.append(p); }
    const r = await this.modal({
      title: `LocalPaint v${u.version} is out`,
      text: `You have v${VERSION}. Updating downloads only the changed files (a few MB) and restarts LocalPaint. Your projects, autosaves and presets stay as they are.`,
      icon: 'info', wide: true, content: lines.length ? notes : undefined,
      buttons: [['Update now', 'update', 'primary'], ['Later', 'later']],
    });
    if (r === 'update') this.installUpdate();
  }
  private async installUpdate() {
    const u = this.updateInfo, native = this.native;
    if (!u || !native) return;
    if (!u.hasUpdateFiles) { native.openUrl(u.url); toast('Opened the download page in your browser'); return; }
    if (!(await this.confirmUnsaved('Update and restart LocalPaint?'))) return;
    const box = el('div', { class: 'lmp-modal-wrap' }, el('div', { class: 'lmp-modal' },
      el('div', { class: 'lmp-modal-body' }, el('span', { class: 'spin big' }), el('div', {}, el('h3', {}, `Updating to v${u.version}…`), el('p', {}, 'Downloading the new files. LocalPaint restarts by itself when it\'s done.')))));
    document.body.append(box);
    const res = await native.updateInstall();
    box.remove();
    if (res?.ok) { this.modified = false; toast(`Updated to v${res.version || u.version}. Restarting…`); setTimeout(() => native.relaunch(), 700); return; }
    const r = await this.modal({ title: 'The update didn\'t finish', text: `${res?.error ?? 'Something went wrong.'} Nothing was changed. You can download the new version from GitHub instead.`, icon: 'warn',
      buttons: [['Open download page', 'open', 'primary'], ['Close', 'close']] });
    if (r === 'open') native.openUrl(res?.url || u.url);
  }

  // ================================================================ Guide (F1)

  private guidePanel: HTMLElement | null = null;
  private guideQuery = '';
  private guideStack: string[] = [];

  /** Open the Guide panel (optionally on one guide). F1 toggles it. */
  openGuide(id?: string) {
    let p = this.guidePanel;
    if (!p) {
      p = this.guidePanel = el('aside', { id: 'guide' });
      p.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.guideStack.length) this.guideBack(); else this.closeGuide(); }
        if (e.key === 'F1') { e.preventDefault(); e.stopPropagation(); this.closeGuide(); }
      });
      document.body.append(p);
    }
    this.guideStack = id ? [id] : [];
    this.renderGuide();
    requestAnimationFrame(() => p!.classList.add('open'));
    document.getElementById('guide-btn')?.classList.add('on');
    if (!id) setTimeout(() => (p!.querySelector('input') as HTMLInputElement | null)?.focus(), 60);
  }
  closeGuide() {
    this.guidePanel?.classList.remove('open');
    document.getElementById('guide-btn')?.classList.remove('on');
    document.querySelectorAll('.guide-hl').forEach((x) => x.classList.remove('guide-hl'));
  }
  private get guideOpen() { return !!this.guidePanel?.classList.contains('open'); }
  private toggleGuide() { if (this.guideOpen) this.closeGuide(); else this.openGuide(); }
  private guideBack() { this.guideStack.pop(); this.renderGuide(); }
  private guideGo(id: string) { this.guideStack.push(id); this.renderGuide(); }

  private renderGuide() {
    const p = this.guidePanel!;
    p.innerHTML = '';
    const input = el('input', { type: 'search', placeholder: 'Search, e.g. how do I paint along a path', value: this.guideQuery, spellcheck: false }) as HTMLInputElement;
    const body = el('div', { class: 'guide-body' });
    const head = el('div', { class: 'guide-head' },
      el('div', { class: 'guide-title' }, el('span', { class: 'guide-ico' }, '?'), el('b', {}, 'Guide'), el('span', { class: 'grow' }),
        el('button', { class: 'guide-x', title: 'Close (Esc / F1)', onclick: () => this.closeGuide() }, '×')),
      el('div', { class: 'guide-search' }, input));
    const tips = el('div', { class: 'guide-dyk' });
    const drawTips = () => {
      tips.innerHTML = '';
      tips.append(el('div', { class: 'guide-dyk-h' }, el('span', {}, 'Did you know?'),
        el('button', { class: 'guide-dyk-more', title: 'Show other ones (they also change every hour)', onclick: () => { this.guideTipShift++; drawTips(); } }, '↻')));
      for (const t of tipsNow(3, this.guideTipShift)) tips.append(el('button', { class: 'guide-dyk-item', onclick: () => this.guideGo(t.id) }, t.text));
    };
    drawTips();
    head.append(tips);
    p.append(head, body);
    const show = () => {
      body.innerHTML = '';
      body.scrollTop = 0;
      const id = this.guideStack[this.guideStack.length - 1];
      const g = id ? guideById(id) : undefined;
      tips.style.display = g || this.guideQuery.trim() ? 'none' : '';
      if (g) this.renderGuidePage(body, g);
      else if (this.guideQuery.trim()) this.renderGuideResults(body, this.guideQuery);
      else this.renderGuideHome(body);
    };
    input.addEventListener('input', () => { this.guideQuery = input.value; this.guideStack = []; show(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const top = searchGuides(input.value, 1)[0]; if (top) this.guideGo(top.g.id); }
      if (e.key === 'Escape' && input.value && !this.guideStack.length) { e.preventDefault(); e.stopPropagation(); input.value = ''; this.guideQuery = ''; show(); }
    });
    show();
  }

  private guideTipShift = 0;

  private guideRow(g: Guide, sub = true) {
    return el('button', { class: 'guide-row', onclick: () => this.guideGo(g.id) }, el('b', {}, g.title), sub ? el('span', {}, g.sum) : null);
  }

  private renderGuideHome(body: HTMLElement) {
    const start = el('div', { class: 'guide-start' });
    for (const id of ['getting-started', 'whats-new']) {
      const g = guideById(id)!;
      start.append(el('button', { class: 'guide-card' + (id === 'getting-started' ? ' main' : ''), onclick: () => this.guideGo(id) }, el('b', {}, g.title), el('span', {}, g.sum)));
    }
    body.append(start);
    body.append(el('button', { class: 'tour-start', onclick: () => this.startTour('getting-started') },
      el('span', { class: 'play' }, '▶'), el('span', {}, el('b', {}, 'Show me around LocalPaint'), el('small', {}, 'A quick tour of the screen'))));
    body.append(el('div', { class: 'guide-try' }, 'Try: ',
      ...['make my brush smooth', 'go back after Ctrl+Z', 'rusty metal', 'export for Roblox', 'it’s laggy'].map((t) =>
        el('button', { class: 'chip', onclick: () => { this.guideQuery = t; this.renderGuide(); } }, t))));
    for (const c of CATS) {
      if (c === 'Start here') continue;
      const list = GUIDES.filter((g) => g.cat === c);
      if (!list.length) continue;
      body.append(el('h4', {}, c), ...list.map((g) => this.guideRow(g, false)));
    }
    body.append(el('h4', {}, 'About'), this.guideRow(guideById('about')!, true));
  }

  private renderGuideResults(body: HTMLElement, q: string) {
    const hits = searchGuides(q);
    if (!hits.length) {
      body.append(el('p', { class: 'note' }, 'Nothing found for that. Try different words, or pick one of these:'),
        ...['getting-started', 'paint-basics', 'layers', 'smart-materials', 'export'].map((id) => this.guideRow(guideById(id)!)));
      return;
    }
    body.append(el('div', { class: 'guide-label' }, 'Results'));
    hits.forEach((h, i) => {
      const r = this.guideRow(h.g);
      if (i === 0) {
        const acts = (h.g.show ?? []).slice(0, 2).map((s) => el('button', { class: 'lmp-btn primary small', onclick: () => this.guideShow(s) }, 'Show me: ' + s.label));
        body.append(el('div', { class: 'guide-best' }, r, acts.length ? el('div', { class: 'guide-acts' }, ...acts) : null));
      } else body.append(r);
    });
    const tourHit = hits.find((h) => TOURS[h.g.id]);
    if (tourHit) body.append(el('button', { class: 'tour-start under', onclick: () => this.startTour(tourHit.g.id) },
      el('span', { class: 'play' }, '▶'), el('span', {}, el('b', {}, `Walk me through: ${tourHit.g.title}`), el('small', {}, 'Need help doing it? LocalPaint points at each step and tells you what to click.'))));
  }

  private renderGuidePage(body: HTMLElement, g: Guide) {
    const back = el('button', { class: 'guide-back', onclick: () => this.guideBack() }, this.guideStack.length > 1 ? '← Back' : this.guideQuery.trim() ? '← Results' : '← All guides');
    body.append(back, el('div', { class: 'guide-cat' }, g.cat), el('h2', {}, g.title), el('p', { class: 'guide-sum' }, g.sum));
    if (TOURS[g.id]) body.append(el('button', { class: 'tour-start', onclick: () => this.startTour(g.id) },
      el('span', { class: 'play' }, '▶'), el('span', {}, el('b', {}, 'Walk me through it'), el('small', {}, `LocalPaint points at each step (${TOURS[g.id].length} steps)`))));
    if (g.show?.length) body.append(el('div', { class: 'guide-acts' }, ...g.show.map((s) => el('button', { class: 'lmp-btn small', onclick: () => this.guideShow(s) }, 'Show me: ' + s.label))));
    for (const b of g.body) {
      if (b.h) body.append(el('h4', {}, b.h));
      if (b.p) { const e = el('p', {}); e.innerHTML = guideFmt(b.p); body.append(e); }
      if (b.steps) {
        const ol = el('ol', { class: 'guide-steps' });
        for (const t of b.steps) { const li = el('li', {}); li.innerHTML = guideFmt(t); ol.append(li); }
        body.append(ol);
      }
      if (b.table) body.append(el('table', { class: 'guide-table' }, ...b.table.map(([a, k]) => el('tr', {}, el('td', {}, a), el('td', {}, el('span', { class: 'kbd' }, k))))));
      if (b.tips) for (const t of b.tips) { const e = el('div', { class: 'guide-tip' }); e.innerHTML = '<b>Tip:</b> ' + guideFmt(t); body.append(e); }
    }
    const rel = (g.related ?? []).map(guideById).filter(Boolean) as Guide[];
    if (rel.length) body.append(el('h4', {}, 'Related'), ...rel.map((r) => this.guideRow(r)));
  }

  /** "Show me": do the thing (switch tool, open a panel…) and point at it. */
  private guideShow(s: GuideShow) {
    const a = s.act ?? '';
    const paint = () => { if (this.mode !== 'paint') this.setMode('paint'); };
    if (a.startsWith('tool:')) { paint(); this.setTool(a.slice(5) as Tool); }
    else if (a.startsWith('mode:')) this.setMode(a.slice(5) as Mode);
    else if (a.startsWith('layout:')) this.setLayout(a.slice(7) as any);
    else if (a.startsWith('shelf:')) { paint(); this.historyOpen = false; this.shelfOpen.add('sec:' + a.slice(6)); this.shelfFilter = 'all'; this.buildShelf(); this.buildToolstrip(); }
    else if (a === 'history') { paint(); this.toggleHistory(true); }
    else if (a === 'props') { paint(); if (!BRUSH_TOOLS.includes(this.tool)) this.setTool('paint'); this.buildProperties(); }
    else if (a === 'settings') this.openSettings();
    else if (a === 'open') { if (this.native) this.openWindow('recent'); else this.openProjectDialog(); }
    else if (a === 'autosaves') this.openWindow('autosave');
    else if (a === 'export') this.openExport();
    else if (a === 'import') this.importDialog();
    else if (a === 'display') { if (!this.flyout.classList.contains('open')) this.toggleFlyout(); }
    else if (a === 'shortcuts') this.showShortcuts();
    else if (a === 'overlap') { if (!this.showOverlap) this.toggleOverlap(true); }
    else if (a === 'updates') this.checkForUpdates(true);
    if (s.hl) setTimeout(() => this.guideHighlight(s.hl!, s.text), 120);
  }
  private guideHighlight(sel: string, text?: string) {
    document.querySelectorAll('.guide-hl').forEach((x) => x.classList.remove('guide-hl'));
    const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetParent !== null || e.id === 'shelf' || e.id === 'right');
    const target = text ? all.find((e) => e.textContent?.includes(text)) ?? all[0] : all[0];
    if (!target) { toast('That part isn\'t on screen right now', true); return; }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    target.classList.add('guide-hl');
    setTimeout(() => target.classList.remove('guide-hl'), 3200);
  }


  // ================================================================ walkthrough tours

  strokeCount = 0;
  shapeMovedCount = 0;
  pathFinishCount = 0;
  private tour: { g: Guide; steps: TourStep[]; i: number; start: Record<string, number>; timer: number; off: (() => void) | null } | null = null;
  private tourEl: HTMLElement | null = null;

  /** Things a tour step can wait for. */
  private tourState(name: string): boolean {
    const t = this.tour!, ts = this.ts, sym = this.brush.symmetry;
    switch (name) {
      case 'stroke': return this.strokeCount > t.start.strokes;
      case 'smoothing': return (this.brush.smoothing ?? 0) > 0.05;
      case 'path2': return this.path.p3.length + this.path.p2.length >= 2;
      case 'pathdone': return this.pathFinishCount > t.start.paths;
      case 'sym': return !!sym && (sym.x || sym.y || sym.z);
      case 'history': return this.historyOpen;
      case 'masktarget': return this.paintTarget === 'mask' && !!ts.activeLayer?.mask;
      case 'shape': return ts.allLayers.some((l) => l.mask?.gen && [l.mask.gen, ...(l.mask.gen.fx ?? [])].some((g) => g.type === 'shape'));
      case 'shapemoved': return this.shapeMovedCount > t.start.shapes;
      case 'shapedone': return !this.shapeMove;
      case 'bakemode': return this.mode === 'bake';
      case 'baking': return ts.baking;
      case 'baked': return ts.bakedOnce && !ts.baking;
      case 'paintmode': return this.mode === 'paint';
      case 'morelayers': return ts.allLayers.length > t.start.layers;
      case 'export': return !!(document.getElementById('export-dialog') as HTMLDialogElement | null)?.open;
      case 'import': return !!document.querySelector('.imp-list');
      case 'overlap': return this.showOverlap;
      case 'menu': return !!document.querySelector('.menu.open');
    }
    return false;
  }

  /** Find a step's target: the first visible match (whose text contains `has`, if given). */
  private tourTarget(st: TourStep): HTMLElement | null {
    if (!st.at) return null;
    const list = [...document.querySelectorAll<HTMLElement>(st.at)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    return (st.has ? list.find((e) => e.textContent?.includes(st.has!)) : list[0]) ?? null;
  }

  startTour(id: string) {
    const steps = TOURS[id], g = guideById(id);
    if (!steps || !g) return;
    this.stopTour(false);
    this.closeGuide();
    if (this.mode === 'design') this.setMode('paint');
    const el2 = el('div', { id: 'tour' },
      el('div', { class: 'tour-ring' }),
      el('div', { class: 'tour-ptr' }),
      el('div', { class: 'tour-bubble' }));
    (el2.querySelector('.tour-ptr') as HTMLElement).innerHTML =
      '<svg viewBox="0 0 32 32" width="34" height="34"><path d="M6 3 L6 25 L12 19.5 L16.5 29 L20.5 27.2 L16 18 L24 18 Z" fill="#9b5cff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.append(el2);
    this.tourEl = el2;
    this.tour = { g, steps, i: -1, start: {}, timer: window.setInterval(() => this.tourTick(), 120), off: null };
    this.tourGo(0);
  }

  stopTour(reopen = true) {
    const t = this.tour;
    if (!t) return;
    clearInterval(t.timer);
    t.off?.();
    this.tour = null;
    this.tourEl?.remove();
    this.tourEl = null;
    if (reopen) this.openGuide(t.g.id);
  }

  private tourGo(i: number) {
    const t = this.tour;
    if (!t) return;
    t.off?.(); t.off = null;
    if (i >= t.steps.length) { this.tourFinish(); return; }
    i = Math.max(0, i);
    t.i = i;
    const st = t.steps[i];
    t.start = { strokes: this.strokeCount, paths: this.pathFinishCount, shapes: this.shapeMovedCount, layers: this.ts.allLayers.length };
    if (st.skip && this.tourState(st.skip)) { this.tourGo(i + 1); return; }
    if (st.act) this.guideShow({ label: '', act: st.act });
    // Clicks / right clicks / keys on the target finish the step.
    const w = st.wait ?? 'next';
    const later = () => setTimeout(() => { if (this.tour === t && t.i === i) this.tourGo(i + 1); }, 180);
    if (w === 'click' || w === 'rclick') {
      const type = w === 'click' ? 'click' : 'contextmenu';
      const h = (e: Event) => { const tg = this.tourTarget(st); if (tg && tg.contains(e.target as Node)) later(); };
      document.addEventListener(type, h, true);
      t.off = () => document.removeEventListener(type, h, true);
    } else if (w.startsWith('key:')) {
      const key = w.slice(4);
      const h = (e: KeyboardEvent) => { if (e.key === key) later(); };
      window.addEventListener('keydown', h, true);
      t.off = () => window.removeEventListener('keydown', h, true);
    }
    this.renderTourBubble();
    this.tourTick();
  }

  private renderTourBubble() {
    const t = this.tour, b = this.tourEl?.querySelector('.tour-bubble') as HTMLElement | null;
    if (!t || !b) return;
    const st = t.steps[t.i];
    const manual = (st.wait ?? 'next') === 'next';
    b.innerHTML = '';
    const txt = el('div', { class: 'tour-text' }); txt.innerHTML = guideFmt(st.t);
    b.append(
      el('div', { class: 'tour-step' }, `${t.g.title} · step ${t.i + 1} of ${t.steps.length}`),
      txt,
      el('div', { class: 'tour-wait', hidden: true }, 'Waiting for this to show up on screen…'),
      el('div', { class: 'tour-btns' },
        el('button', { class: 'tour-stop', onclick: () => this.stopTour() }, 'Stop'),
        el('span', { class: 'grow' }),
        t.i > 0 ? el('button', { onclick: () => this.tourGo(t.i - 1) }, 'Back') : null,
        el('button', { class: manual ? 'primary' : '', onclick: () => this.tourGo(t.i + 1) }, manual ? (t.i === t.steps.length - 1 ? 'Finish' : 'Next') : 'Skip step')));
  }

  private tourTick() {
    const t = this.tour, root = this.tourEl;
    if (!t || !root) return;
    const st = t.steps[t.i];
    const w = st.wait ?? 'next';
    if (w.startsWith('state:') && this.tourState(w.slice(6))) { this.tourGo(t.i + 1); return; }
    // Above an open dialog (dialogs sit on top of everything else), the tour lives inside it.
    const dlg = document.querySelector('dialog[open]');
    const host = dlg ?? document.body;
    if (root.parentElement !== host) host.append(root);
    const ring = root.querySelector('.tour-ring') as HTMLElement, ptr = root.querySelector('.tour-ptr') as HTMLElement, bub = root.querySelector('.tour-bubble') as HTMLElement;
    const target = this.tourTarget(st);
    (bub.querySelector('.tour-wait') as HTMLElement).hidden = !!target || !st.at;
    const vw = window.innerWidth, vh = window.innerHeight, bw = Math.min(330, vw - 24);
    bub.style.width = bw + 'px';
    if (!target) {
      ring.style.display = 'none'; ptr.style.display = 'none';
      Object.assign(bub.style, { left: `${(vw - bw) / 2}px`, top: `${vh - bub.offsetHeight - 60}px` });
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    ring.style.display = 'block'; ptr.style.display = 'block';
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // The pointer's tip sits on the target: the middle of small things, a bit inside big areas.
    const big = r.width > 260 || r.height > 160;
    const px = big ? r.left + r.width / 2 : r.left + r.width * 0.6;
    const py = big ? r.top + r.height / 2 : r.top + r.height * 0.7;
    Object.assign(ptr.style, { left: `${px - 6}px`, top: `${py - 3}px` });
    // The bubble goes just under the pointer (or above it when there's no room).
    const bh = bub.offsetHeight || 120;
    let bx = Math.min(Math.max(12, px - 30), vw - bw - 12);
    let by = py + 38;
    if (by + bh > vh - 12) by = Math.max(12, py - bh - 18);
    Object.assign(bub.style, { left: `${bx}px`, top: `${by}px` });
  }

  private tourFinish() {
    const t = this.tour, b = this.tourEl?.querySelector('.tour-bubble') as HTMLElement | null;
    if (!t || !b) return;
    clearInterval(t.timer);
    (this.tourEl!.querySelector('.tour-ring') as HTMLElement).style.display = 'none';
    (this.tourEl!.querySelector('.tour-ptr') as HTMLElement).style.display = 'none';
    b.innerHTML = '';
    b.append(el('div', { class: 'tour-step' }, t.g.title), el('div', { class: 'tour-text' }, 'Done! That\'s all there is to it.'),
      el('div', { class: 'tour-btns' }, el('span', { class: 'grow' }), el('button', { class: 'primary', onclick: () => this.stopTour() }, 'Close')));
    Object.assign(b.style, { left: `${(window.innerWidth - b.offsetWidth) / 2}px`, top: `${window.innerHeight - b.offsetHeight - 60}px` });
    setTimeout(() => { if (this.tour === t) this.stopTour(); }, 2600);
  }

  // ================================================================ start / open window

  /** LocalPaint's own Open window: new file, recent projects, autosaves, browse. */
  async openWindow(tab: 'recent' | 'autosave' = 'recent', crashed = false) {
    const native = this.native;
    document.querySelectorAll('.lmp-start-wrap').forEach((x) => x.remove());
    const [recent, autos] = native ? await Promise.all([native.recentList(), native.autosaveList()]) : [[], []];
    const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 140); window.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const when = (t: number) => { const d = new Date(t); const s = this.ago(t); return Date.now() - t < 86400000 ? s : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    const card = (thumb: string, title: string, sub: string, onclick: () => void, extra?: HTMLElement) =>
      el('button', { class: 'start-card', onclick }, el('div', { class: 'start-thumb', style: thumb ? { backgroundImage: `url(${thumb})` } : {} }),
        el('div', { class: 'start-meta' }, el('b', {}, title), el('span', {}, sub)), extra ?? null);
    const openAuto = async (a: { path: string; name: string }) => {
      close();
      if (!(await this.confirmUnsaved('Restore this autosave anyway?'))) return;
      await this.openProjectFromPath(a.path, undefined, true);
      this.projectPath = ''; // restored copies never overwrite the original until you save
      this.modified = true;
      this.updateTitle();
      toast(`Restored “${a.name}” from an autosave — Save to keep it`);
    };
    const pane = el('div', { class: 'start-pane' });
    const tabs = el('div', { class: 'start-tabs' });
    const show = (t: 'recent' | 'autosave') => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      pane.innerHTML = '';
      if (t === 'recent') {
        if (!recent.length) pane.append(el('p', { class: 'note' }, 'No recent projects yet. Saved .lp files show up here.'));
        for (const r of recent) pane.append(card(r.thumb, r.name, `${r.path} · ${when(r.time)}`, async () => {
          close(); if (await this.confirmUnsaved('Open this project anyway?')) this.openProjectFromPath(r.path);
        }));
      } else {
        if (crashed && autos[0]) pane.append(el('div', { class: 'start-crash' }, el('b', {}, 'LocalPaint didn\'t close properly last time.'),
          el('span', {}, ` The newest autosave is “${autos[0].name}” from ${when(autos[0].time)}.`),
          el('button', { class: 'lmp-btn primary', onclick: () => openAuto(autos[0]) }, 'Restore it')));
        if (!autos.length) pane.append(el('p', { class: 'note' }, 'No autosaves yet. LocalPaint saves a backup every few minutes while you work (Settings).'));
        for (const a of autos) pane.append(card(a.thumb, a.name, `Autosave · ${when(a.time)}`, () => openAuto(a)));
        if (native) pane.append(el('button', { class: 'link', onclick: () => native.autosaveFolder() }, 'Open the autosave folder'));
      }
    };
    for (const [t, label] of [['recent', `Recent (${recent.length})`], ['autosave', `Autosaves (${autos.length})`]] as const) {
      const b = el('button', { onclick: () => show(t) }, label); b.dataset.t = t; tabs.append(b);
    }
    tabs.append(el('span', { class: 'grow' }), el('button', { class: 'lmp-btn', onclick: async () => {
      close();
      if (native?.openProject) { if (!(await this.confirmUnsaved('Open another project anyway?'))) return; const r = await native.openProject(); if (r) await this.openProjectFromPath(r.path, r.data); }
      else { const f = await pickFile('.lp,.lmp,.tpaint'); if (f) this.openProjectFile(f); }
    } }, 'Browse…'));
    const models = el('div', { class: 'start-models' });
    for (const b of BUILTINS) {
      const it = this.shelf.items.find((x) => x.kind === 'model' && x.model === b.id);
      const th = it ? this.thumbCache.get(this.thumbKey(it)) ?? '' : '';
      models.append(card(th, b.label, 'New file', () => { close(); this.loadBuiltin(b.id); }));
    }
    models.append(card('', 'Open model…', 'FBX · OBJ · GLB', async () => { close(); const f = await pickFile('.glb,.gltf,.fbx,.obj'); if (f) this.openModelFile(f); }));
    const startBox = el('input', { type: 'checkbox', checked: this.settings.startScreen }) as HTMLInputElement;
    startBox.addEventListener('change', () => { this.settings.startScreen = startBox.checked; saveSettings(this.settings); });
    const logo = el('div', { class: 'start-logo' });
    logo.style.backgroundImage = `url(${iconBig})`;
    const box = el('div', { class: 'lmp-modal start' },
      el('div', { class: 'lmp-modal-head' }, el('span', { class: 'lmp-modal-logo', style: { backgroundImage: `url(${iconSmall})` } }), el('span', {}, 'LocalPaint'), el('span', { class: 'grow' }),
        el('button', { class: 'start-x', title: 'Close (Esc)', onclick: close }, '×')),
      el('div', { class: 'start-body' },
        el('div', { class: 'start-left' }, logo, el('h2', {}, "LocalPaint"), el('div', { class: 'start-ver' }, `v${VERSION}`),
          el('h4', {}, 'New file'), models,
          el('button', { class: 'lmp-btn guide-btn', onclick: () => { close(); this.openGuide('getting-started'); } }, 'Getting started')),
        el('div', { class: 'start-right' }, tabs, pane)),
      el('div', { class: 'start-foot' }, el('label', { class: 'check-row' }, startBox, ' Show this when LocalPaint starts')));
    const wrap = el('div', { class: 'lmp-modal-wrap lmp-start-wrap' }, box);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(wrap);
    show(crashed ? 'autosave' : tab);
  }

  // ================================================================ settings window

  applySettings() {
    const st = this.settings;
    this.ts.historyLimit = st.lowPerf ? Math.min(st.historyLimit, 15) : st.historyLimit;
    const pr = st.pixelRatio || (st.lowPerf ? 1 : Math.min(window.devicePixelRatio, 2));
    if (st.lowPerf) this.ts.bakeSettings = { ...this.ts.bakeSettings, aoRays: Math.min(this.ts.bakeSettings.aoRays ?? 64, 32), curvRays: Math.min(this.ts.bakeSettings.curvRays ?? 32, 16) };
    this.vp.renderer.setPixelRatio(pr);
    this.layout();
  }

  openSettings() {
    const st = { ...this.settings };
    const num = (label: string, key: 'autosaveMinutes' | 'autosaveKeep' | 'historyLimit', min: number, max: number, unit = '') =>
      slider(label, { min, max, step: 1, value: st[key], fmt: (v) => `${v}${unit}`, onInput: (v) => { st[key] = v; } }).el;
    const check = (label: string, key: 'autosave' | 'lowPerf' | 'startScreen' | 'checkUpdates' | 'confirmDelete', note?: string) => {
      const c = el('input', { type: 'checkbox', checked: st[key] }) as HTMLInputElement;
      c.addEventListener('change', () => { st[key] = c.checked; });
      return el('label', { class: 'check-row', title: note ?? '' }, c, ' ' + label);
    };
    const content = el('div', { class: 'settings-box' },
      el('h4', {}, 'Autosave'), check('Autosave while I work', 'autosave'), num('Every', 'autosaveMinutes', 1, 30, ' min'), num('Keep', 'autosaveKeep', 1, 20, ' copies'),
      el('h4', {}, 'New files'),
      el('div', { class: 'row' }, el('label', {}, 'Texture size'), select<number>([512, 1024, 2048, 4096].map((v) => ({ value: v, label: `${v} × ${v}` })), st.defaultSize, (v) => { st.defaultSize = v; })),
      check('Show the start screen when LocalPaint opens', 'startScreen'),
      check('Check for updates when LocalPaint starts', 'checkUpdates'),
      el('h4', {}, 'Layers'),
      check('Ask before deleting folders and paint layers', 'confirmDelete', 'Off: they\'re deleted right away. Ctrl+Z brings them back either way.'),
      el('h4', {}, 'Performance'),
      check('Low performance mode (weaker devices)', 'lowPerf', 'Sharper-but-slower things are turned down: render scale 1, smaller previews, lighter bakes, fewer undo steps'),
      el('div', { class: 'row' }, el('label', {}, 'Render scale'), select<number>([{ value: 0, label: 'Automatic' }, { value: 1, label: '1× (fastest)' }, { value: 1.5, label: '1.5×' }, { value: 2, label: '2× (sharpest)' }], st.pixelRatio, (v) => { st.pixelRatio = v; })),
      num('Undo history', 'historyLimit', 5, 100, ' steps'),
      el('p', { class: 'note' }, 'More undo steps use more memory, especially at 4K.'),
      ...(this.native?.sbsEngine ? [
        el('h4', {}, 'Substance materials (.sbsar)'),
        (() => {
          const c = el('input', { type: 'checkbox', checked: st.sbsAdobe }) as HTMLInputElement;
          c.addEventListener('change', () => { st.sbsAdobe = c.checked; });
          return el('label', { class: 'check-row' }, c, ' Use Adobe\'s engine when it\'s installed (exact look)');
        })(),
        el('p', { class: 'note' }, this.sbsExe ? `Found: ${this.sbsExe}` : 'Adobe\'s renderer (sbsrender.exe, comes with Substance 3D Designer) wasn\'t found. Without it LocalPaint uses its own version of each material.'),
        el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: async () => { await this.pickSbsEngine(); st.sbsPath = this.settings.sbsPath; st.sbsAdobe = this.settings.sbsAdobe; } }, 'Find sbsrender.exe…')),
      ] : []),
    );
    this.modal({ title: 'Settings', text: '', icon: 'info', wide: true, content, buttons: [['Save', 'ok', 'primary'], ['Cancel', 'cancel']] }).then((r) => {
      if (r !== 'ok') return;
      this.settings = st; saveSettings(st); this.applySettings(); toast('Settings saved');
      this.buildProperties();
    });
  }

  /** On a weak computer, offer low performance mode before loading everything. */
  private async checkPerformance() {
    if (this.settings.perfAsked) return;
    const w = weakComputer(this.vp.renderer.getContext());
    if (!w.weak) return;
    const r = await this.modal({
      title: 'Your device may be too weak to run LocalPaint smoothly',
      text: `LocalPaint found ${w.why.join(', ')}. Would you like to run it in low performance mode? You can change this later in File → Settings.`,
      icon: 'warn', buttons: [['Use low performance mode', 'low', 'primary'], ['Run normally', 'normal']],
    });
    this.settings.lowPerf = r === 'low';
    this.settings.perfAsked = true;
    saveSettings(this.settings);
  }

  /** Where the open project lives (desktop app), so Save overwrites it and Save as asks again. */
  projectPath = '';
  private projectName() { return this.projectPath ? this.projectPath.split(/[\\/]/).pop()!.replace(/\.(lmp|tpaint)$/i, '') : (this.model?.name || 'Untitled'); }
  updateTitle() {
    document.title = `${this.modified ? '• ' : ''}${this.projectName()}.lp — LocalPaint`;
  }

  /** Save the project as a .lp file (Ctrl+S); `saveAs` always asks where (Ctrl+Shift+S). */
  async saveProject(saveAs = false) {
    const name = this.projectName();
    const native = (window as any).texpaintNative;
    try {
      const blob = await serializeProject(this.projectSets(), this.model.name || name, this.model.source, this.projectSettings(), this.activeSet);
      if (native?.saveProject) {
        const p = await native.saveProject(name, await blob.arrayBuffer(), this.projectPath || null, saveAs);
        if (!p) return;
        this.projectPath = p;
        native.recentAdd?.(p, p.split(/[\\/]/).pop()!.replace(/\.(lp|lmp)$/i, ''), this.snapshotThumb());
        this.modified = false;
        this.updateTitle();
        toast(`Saved ${p.split(/[\\/]/).pop()}`);
        return;
      }
      const fileName = `${name}.lp`;
      const picker = (window as any).showSaveFilePicker;
      if (picker) {
        const h = await picker({
          suggestedName: fileName, id: 'lmp-project',
          types: [{ description: 'LocalPaint project', accept: { 'application/json': ['.lp'] } }],
        });
        const w = await h.createWritable();
        await w.write(blob); await w.close();
        toast(`Saved ${h.name}`);
      } else {
        downloadBlob(blob, fileName);
        toast(`Downloaded ${fileName}`);
      }
      this.modified = false;
      this.updateTitle();
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Save failed: ' + (e?.message ?? e), true);
    }
  }

  /** File → Open project (Ctrl+O). */
  async openProjectDialog() {
    const native = (window as any).texpaintNative;
    if (native?.recentList) { this.openWindow('recent'); return; }
    if (native?.openProject) {
      if (!(await this.confirmUnsaved('Open another project anyway?'))) return;
      const r = await native.openProject();
      if (r) await this.openProjectFromPath(r.path, r.data);
      return;
    }
    const f = await pickFile('.lp,.lmp,.tpaint');
    if (f) this.openProjectFile(f);
  }

  /** `autosave`: a backup copy — it never goes in the recent lists (in the app or Windows' taskbar menu). */
  async openProjectFromPath(path: string, data?: ArrayBuffer, autosave = false) {
    const native = (window as any).texpaintNative;
    try {
      checkProjectFileName(path);
      if (!data) data = (await native.readProject(path, autosave)).data as ArrayBuffer;
      await this.openProjectText(new TextDecoder().decode(data));
      this.projectPath = /\.lp$/i.test(path) ? path : '';
      this.updateTitle();
      if (this.projectPath && !autosave) setTimeout(() => native?.recentAdd?.(path, this.projectName(), this.snapshotThumb()), 800);
      toast(`Opened ${path.split(/[\\/]/).pop()}`);
    } catch (e: any) {
      this.projectOpenFailed(e);
    }
  }

  /** File → Import (Ctrl+I): models, HDRIs, Substance files, presets, textures, projects. */
  async importDialog() {
    const native = (window as any).texpaintNative;
    if (native?.importFiles) {
      const list = (await native.importFiles()) as { path: string; name: string; data: ArrayBuffer }[];
      const files = list.map((f) => { const file = new File([f.data], f.name); (file as any).__path = f.path; return file; });
      if (files.length === 1 && /\.(lmp|tpaint)$/i.test(files[0].name)) { await this.openProjectFromPath(list[0].path, list[0].data); return; }
      if (files.length) await this.dropFiles(files);
      return;
    }
    const f = await pickFile('.lp,.lmp,.tpaint,.glb,.gltf,.fbx,.obj,.hdr,.sbsar,.spsm,.spmsk,.tpsmart,.tpmat,.tptex,.tpbrush,.tpgraph,.png,.jpg,.jpeg,.webp');
    if (f) await this.openAny(f);
  }

  /** `reimport`: put this project's layers on a new version of the mesh (texture sets matched by material name). */
  async openProjectText(text: string, reimport?: LoadedModel) {
    const f = await parseProject(text);
    const model = reimport ?? (f.model.kind === 'builtin'
      ? builtinModel(f.model.id as BuiltinId)
      : await parseModel(f.model.name, fromB64(f.model.data).buffer as ArrayBuffer));
    if (!reimport && f.model.kind === 'file' && model.source.kind === 'file' && f.model.path) model.source.path = f.model.path;
    const s = (f.settings ?? {}) as any;
    if (this.ts && s.bake) this.ts.bakeSettings = { ...this.ts.bakeSettings, ...s.bake };
    if (this.ts && s.high) this.ts.highSettings = { ...this.ts.highSettings, ...s.high };
    if (this.ts && typeof s.heightStrength === 'number') this.ts.heightStrength = s.heightStrength;
    else if (this.ts && typeof s.normalStrength === 'number') this.ts.heightStrength = s.normalStrength;
    this.setModel(model, f.resolution, !!f.meshMaps);
    // Every texture set gets its own layers and baked maps back (older projects: the first set only).
    let maps = false;
    const fresh: TextureSet[] = [];
    const byName = !!reimport && this.sets.length > 1;
    for (let i = 0; i < this.sets.length; i++) {
      const st = this.sets[i];
      const d = setData(f, st.name, i, byName);
      if (!d) { if (reimport) fresh.push(st.ts); continue; }
      if (d.resolution !== st.ts.size) st.ts.setResolution(d.resolution);
      await restoreLayers(st.ts, d);
      if (await restoreMeshMaps(st.ts, d)) maps = true;
    }
    // Reimport: materials that are new in the mesh start with the usual starting layers.
    for (const ts of fresh) {
      ts.addFillLayer('Base material', { color: [0.62, 0.62, 0.62], rough: 0.45, metal: 0, height: 0.5 }, { color: true, rough: true, metal: true, height: true }, false);
      ts.addPaintLayer('Layer 1');
      ts.clearHistory();
    }
    this.reimportNew = fresh.length;
    if (this.sets.length > 1 && f.activeSet && this.sets[f.activeSet]) this.switchSet(f.activeSet);
    if (maps) { this.bindTextures(); this.updateBakeStatus(); }
    if (s.brush) {
      Object.assign(this.brush, s.brush);
      if (s.brushTipPng && this.brush.tip) {
        const cv = await imageTip(s.brushTipPng);
        this.registerTip(this.brush.tip, cv, s.brushTipPng);
      }
      this.brush.channels = { ...this.brush.channels, normal: false };
      if (!this.brush.values.emit) this.brush.values.emit = [0, 0, 0];
    }
    if (s.exportPreset) this.exportPreset = s.exportPreset;
    this.normalFormat = s.normalFormat === 'dx' ? 'dx' : 'gl';
    this.modified = false;
    this.buildAll();
  }

  private reimportNew = 0;

  /** Where a model file lives on disk (desktop app), so Reimport mesh can read it again. */
  private pathOfFile(f: File): string {
    const native = (window as any).texpaintNative;
    return (f as any).__path || native?.pathOf?.(f) || '';
  }

  /**
   * File → Reimport mesh (Substance's "reimport"): load the changed mesh (same file again, or another one) under the
   * current project. Layers stay; texture sets are matched by material name; mesh maps stay until you bake again.
   */
  async reimportMesh() {
    if (this.sets.some((st) => st.ts.baking) || this.bakingAll) { toast('Wait for the bake to finish first.', true); return; }
    const native = (window as any).texpaintNative;
    const src = this.model.source;
    const known = src.kind === 'file' ? src.path : undefined;
    let got: { name: string; data: ArrayBuffer; path: string } | null = null;
    if (known && native?.readModel) {
      const base = known.split(/[\\/]/).pop();
      const r = await this.modal({
        title: 'Reimport mesh', icon: 'question',
        text: `Load ${base} again from disk (after changing it in Blender), or pick another file? Your layers stay. Texture sets are matched by material name.`,
        buttons: [['Reload this file', 'same', 'primary'], ['Pick another file…', 'pick'], ['Cancel', 'cancel']],
      });
      if (r !== 'same' && r !== 'pick') return;
      if (r === 'same') {
        const d = await native.readModel(known);
        if (d) got = d;
        else toast(`${base} isn't there anymore. Pick the mesh file.`, true);
      }
    }
    if (!got) {
      if (native?.pickModel) got = await native.pickModel(known);
      else {
        const f = await pickFile('.glb,.gltf,.fbx,.obj');
        if (f) got = { name: f.name, data: await f.arrayBuffer(), path: this.pathOfFile(f) };
      }
    }
    if (!got) return;
    let m: LoadedModel;
    try {
      // Same placement as the current mesh, so shapes, projections and the high poly still line up.
      m = await parseModel(got.name, got.data, { xf: this.model.xf });
    } catch (e: any) { toast(`Could not read ${got.name}: ${e?.message ?? e}`, true); return; }
    if (m.source.kind === 'file') m.source.path = got.path || undefined;
    const oldSets = this.sets.map((st) => st.name);
    // Texture sets that would disappear (their material is gone or renamed): ask before dropping their layers.
    const ids = [...new Set(m.setOf ?? [0])];
    const newNames = ids.length > 1 ? ids.map((id) => m.materials?.[id] ?? `Material ${id + 1}`) : null;
    const lost = oldSets.length > 1 && newNames ? oldSets.filter((n) => !newNames.includes(n)) : oldSets.length > 1 && !newNames ? oldSets.slice(1) : [];
    if (lost.length) {
      const r = await this.modal({
        title: 'Some texture sets are missing', icon: 'warn',
        text: `The new mesh has no material called ${lost.map((n) => `“${n}”`).join(', ')}. Those texture sets and their layers would be dropped. Rename the material in Blender to keep them, or continue.`,
        buttons: [['Continue', 'ok', 'primary'], ['Cancel', 'cancel']],
      });
      if (r !== 'ok') return;
    }
    const high = this.high, useHigh = this.useHigh, path = this.projectPath, view = this.vp.camera.position.clone(), target = this.vp.controls.target.clone();
    const text = await (await serializeProject(this.projectSets(), this.model.name || this.projectName(), this.model.source, this.projectSettings(), this.activeSet)).text();
    await this.openProjectText(text, m);
    if (high) { this.high = high; this.useHigh = useHigh; }
    this.projectPath = path;
    this.vp.camera.position.copy(view); this.vp.controls.target.copy(target); this.vp.controls.update();
    this.modified = true;
    this.updateTitle();
    this.buildAll();
    const parts = [`Mesh reimported (${m.geometries.length} mesh${m.geometries.length === 1 ? '' : 'es'}${this.sets.length > 1 ? `, ${this.sets.length} texture sets` : ''}).`];
    if (this.reimportNew && this.sets.length > 1) parts.push(`${this.reimportNew} new material${this.reimportNew === 1 ? '' : 's'} got fresh layers.`);
    parts.push('Bake again (Baking, top right) to update the mesh maps.');
    toast(parts.join(' '));
  }

  private projectOpenFailed(e: any) {
    if (e?.name === 'NotProjectError') { void this.modal({ title: e.title, text: e.message, icon: 'warn', buttons: [['OK', 'ok', 'primary']] }); return; }
    console.error(e);
    toast(e?.message ?? 'Could not open project', true);
  }

  async openProjectFile(file: File) {
    try { checkProjectFileName(file.name); } catch (e) { this.projectOpenFailed(e); return; }
    if (!(await this.confirmUnsaved('Open this project anyway?'))) return;
    try {
      await this.openProjectText(await file.text());
      toast(`Opened ${file.name}`);
    } catch (e: any) {
      this.projectOpenFailed(e);
    }
  }

  async openAny(file: File) {
    try { checkProjectFileName(file.name); } catch (e) { this.projectOpenFailed(e); return; }
    const ext = file.name.split('.').pop()!.toLowerCase();
    if (MODEL_EXTS.includes(ext)) {
      if (this.mode === 'bake') return this.loadHighPoly(file);
      return this.openModelFile(file);
    }
    if (ext === 'lp' || ext === 'tpaint' || ext === 'lmp') return this.openProjectFile(file);
    if (ext === 'hdr') {
      try { await this.vp.loadHDR(file); this.buildFlyout(); toast(`Environment: ${file.name}`); }
      catch { toast('Could not read that HDR file', true); }
      return;
    }
    if (ext === 'sbsar' || ext === 'spsm' || ext === 'spmsk') { await this.translateSubstance([file]); return; }
    if (['tpsmart', 'tpmat', 'tptex', 'tpbrush', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      await this.shelf.addFiles([file]);
      this.buildShelf();
      toast(`Added ${file.name} to the assets shelf`);
      return;
    }
    toast(`Can't open .${ext} files`, true);
  }

  /** `all`: every texture set (the bake output size); otherwise just the selected one. */
  setResolution(size: number, all = false) {
    const list = all && this.sets.length > 1 ? this.sets.map((st) => st.ts) : [this.ts];
    if (list.every((ts) => ts.size === size)) return;
    for (const ts of list) if (ts.size !== size) ts.setResolution(size);
    this.bindTextures();
    this.mapThumbs.clear();
    toast(`Texture set size: ${size} × ${size} (undo history cleared). Re-bake in the Baking tab for full detail at this size.`);
    if (this.mode === 'bake') this.buildBakeDock();
  }

  bindTextures() {
    if (this.sets.length) this.sets.forEach((st, i) => this.vp.bindTextures(st.ts, i));
    else this.vp.bindTextures(this.ts);
    this.applyViews();
    this.updateMirrorLines?.();
  }

  private async loadStarter() {
    const files = STARTER.map((a) => new File(
      [a.b64 ? fromB64(a.b64) as any : a.text!], a.name,
      { type: a.b64 ? 'image/png' : 'application/json' }));
    for (const b of STARTER_BRUSHES) files.push(new File([JSON.stringify(b)], `${b.name}.tpbrush`, { type: 'application/json' }));
    this.shelf.builtins = [
      ...BUILTINS.map((b): ShelfItem => ({ kind: 'model', name: b.label, file: 'model:' + b.id, model: b.id })),
      ...SCAN_SMART.map((sm): ShelfItem => ({ kind: 'smart', name: sm.name, file: 'lib:scan-' + sm.name.toLowerCase().replace(/\W+/g, '-'), smart: sm, category: 'Realistic (scanned)' })),
      ...SCAN_SMART_MORE.map(([cat, sm]): ShelfItem => ({ kind: 'smart', name: sm.name, file: 'lib:scan-' + sm.name.toLowerCase().replace(/\W+/g, '-'), smart: sm, category: `Realistic: ${cat}` })),
      // Painter's starter smart materials, rebuilt (names that clash with library materials get “layered”).
      ...PAINTER_SMART.map(({ cat, smart }): ShelfItem => ({ kind: 'smart', name: libraryMaterials().some((m) => m.def.label.toLowerCase() === smart.name.toLowerCase()) ? `${smart.name} (layered)` : smart.name, file: 'lib:painter-' + smart.name.toLowerCase().replace(/\W+/g, '-'), smart, category: `Painter-style: ${cat}` })),
      ...libraryMaterials().map((m): ShelfItem => ({ kind: 'smart', name: m.def.label, file: 'lib:' + m.def.id, smart: m.smart, category: m.def.category, swatch: m.swatch })),
      ...SMART_MASKS.map((m): ShelfItem => ({ kind: 'mask', name: m.label, file: 'mask:' + m.id, preset: m.id })),
      ...presetGraphs().map((g): ShelfItem => ({ kind: 'graph', name: g.name, file: 'graph:' + g.name, graph: g })),
      ...ALPHA_LIBRARY.map((a): ShelfItem => ({ kind: 'alpha', name: a.label, file: 'alpha:' + a.id, tip: 'builtin:' + a.id, category: a.category })),
    ];
    await this.shelf.addFiles(files);
    await this.shelf.restore();
    this.buildShelf();
    await this.checkPerformance();
    this.applySettings();
    await this.loadCloudCatalog(false);
    await this.loadStartEnv();
    await this.preloadThumbs();
    setTimeout(() => this.loadCloudCatalog(true), 4000);
    this.startAutosave();
    const session = this.native?.sessionStart ? await this.native.sessionStart() : { crashed: false };
    if (session.crashed) this.openWindow('autosave', true);
    else if (!this.settings.welcomed) { this.settings.welcomed = true; saveSettings(this.settings); this.openGuide('getting-started'); }
    else if (this.settings.startScreen && this.native) this.openWindow('recent');
    if (this.settings.checkUpdates) setTimeout(() => this.checkForUpdates(false), 2500);
    void this.findSbsEngine().then(() => this.loadSbsLibrary());
    let grungeTimer = 0;
    this.grunges.onLoad = () => {
      // Grunges arrived: masks with Painter generators render again with the real textures — once per batch, not per file.
      clearTimeout(grungeTimer);
      grungeTimer = window.setTimeout(() => {
        this.ts.grungeVersion++;
        for (const l of this.ts.allLayers) if (l.mask?.gen && JSON.stringify(l.mask.gen).includes('"sp"')) this.ts.maskChanged(l);
        if (this.smartPrev) this.smartPrev.grungeVersion++;
      }, 600);
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'dragover', 'drop'] as const) window.addEventListener(ev, () => { this.lastInput = performance.now(); }, { passive: true, capture: true });
    void this.grunges.loadCatalog();
    this.sbsTimer = window.setInterval(() => this.sbsTick(), 120);
  }

  // ================================================================ baking

  /** Bake in the background; generators update when it finishes. */
  /** Bake every texture set (one after the other), or just the model's only one. */
  async startBake() {
    if (this.sets.length <= 1) { await this.startBakeOne(); return; }
    if (this.bakingAll) return;
    const back = this.activeSet;
    this.bakingAll = true;
    try {
      for (let i = 0; i < this.sets.length; i++) {
        this.switchSet(i);
        toast(`Baking texture set ${i + 1} of ${this.sets.length}: ${this.sets[i].name}`);
        if (!(await this.startBakeOne())) break;
      }
    } finally {
      this.bakingAll = false;
      this.switchSet(back);
      this.bindTextures();
    }
  }
  private bakingAll = false;

  private async startBakeOne(): Promise<boolean> {
    const ts = this.ts;
    ts.highGeometries = this.useHigh ? (this.high?.geometries ?? null) : null;
    if (ts.highGeometries) ts.highName = this.high!.name;
    else if (ts.bakeMaps.normal || ts.bakeMaps.height || !ts.bakedOnce) ts.highName = '';
    this.bakeProgress = 0;
    this.updateBakeStatus();
    if (this.mode === 'bake') this.buildBakeDock();
    const run = ts.bakeMeshMaps((f) => { if (this.ts === ts) { this.bakeProgress = f; this.updateBakeStatus(); } });
    this.showingBake = true;
    this.updateCage();
    this.renderBakeRun();
    if (this.mode === 'bake') { this.bakeLabel.textContent = 'Baking…'; this.bakeLabel.classList.add('on'); }
    const ok = await run;
    if (this.ts !== ts || ts.baking) return false;
    this.bakeProgress = -1;
    this.updateBakeStatus();
    this.bakeLabel.textContent = ok ? 'All maps baked ✓' : 'Bake stopped';
    setTimeout(() => this.bakeLabel.classList.remove('on'), 2500);
    if (ok) {
      this.applyViews();
      this.mapThumbs.clear();
      this.sbsMeshStamp++;
      if (ts.lastHigh && ts.highGeometries) {
        const pct = (100 * ts.lastHigh.hits) / Math.max(1, ts.lastHigh.texels);
        toast(pct > 99.5 ? `Baked from the high poly ✓ (rays hit ${pct.toFixed(1)}%)`
          : `Baked. ${(100 - pct).toFixed(1)}% of rays missed — check Ray check and raise the cage distances there.`, pct <= 99.5);
      }
    }
    if (this.mode === 'bake') this.buildBakeDock();
    this.buildRight();
    return ok;
  }

  /** A map started / finished baking: update the list, and show the finished map on the model. */
  private onBakeStage(k: BakeKey, st: 'working' | 'done') {
    const label = BAKE_ITEMS.find(([b]) => b === k)?.[1] ?? k;
    if (st === 'working') this.bakeLabel.textContent = `Baking ${label}…`;
    if (st === 'done') {
      this.mapThumbs.delete(BAKE_VIEW[k]);
      if (this.mode === 'bake') {
        this.view3 = BAKE_VIEW[k]; this.view2 = BAKE_VIEW[k]; this.bakeItem = k;
        this.applyViews(); this.buildPaneSelects(); this.buildBakeDock(); this.buildRight();
      }
      const next = BAKE_ITEMS.find(([b]) => this.ts.bakeStage[b] === 'working');
      this.bakeLabel.textContent = next ? `Baking ${next[1]}…` : `${label} ✓`;
    }
    this.bakeLabel.classList.toggle('on', this.mode === 'bake');
    this.renderBakeRun();
    this.poke(800);
  }

  private renderBakeRun() {
    const host = document.getElementById('bake-run');
    if (!host) return;
    host.innerHTML = '';
    const st = this.ts.bakeStage;
    const keys = BAKE_ITEMS.filter(([k]) => st[k]);
    for (const [k, label] of keys) {
      const s = st[k]!;
      const icon = s === 'done' ? el('span', { class: 'st' }, '✓') : s === 'working' ? el('span', { class: 'st' }, el('span', { class: 'spin' })) : el('span', { class: 'st' }, '–');
      host.append(el('div', { class: 'bake-run-row ' + s, title: s === 'done' ? 'Done' : s === 'working' ? 'Baking…' : 'Waiting' }, icon, el('span', { class: 'grow' }, label),
        el('span', { class: 'muted' }, s === 'done' ? 'done' : s === 'working' ? 'processing' : 'waiting')));
    }
  }

  private bakeLabel = el('div', { id: 'bake-label' });
  /** True while a bake runs and its maps are shown on the model (cage hidden). */
  private showingBake = false;

  private updateBakeStatus() {
    const t = this.bakeProgress >= 0
      ? `Baking… ${Math.round(this.bakeProgress * 100)}%`
      : this.ts?.bakedOnce ? `Mesh maps baked ✓ (${this.ts.baked.size} of ${BAKE_ITEMS.length})` : 'Mesh maps not baked — open the Baking tab';
    for (const id of ['bake-status', 'bp-status']) { const e = document.getElementById(id); if (e) e.textContent = t; }
    const bar = document.getElementById('bp-bar');
    if (bar) bar.style.width = `${Math.round(Math.max(0, this.bakeProgress) * 100)}%`;
    const s2 = document.getElementById('status-bake');
    if (s2) s2.textContent = this.bakeProgress >= 0 ? t : '';
  }

  async loadHighPoly(file: File) {
    try {
      toast(`Loading high poly ${file.name}…`);
      const m = await parseModel(file.name, await file.arrayBuffer(), { xf: this.model.xf, highPoly: true });
      this.setHigh(m);
    } catch (e: any) {
      console.error(e);
      toast(e?.message ?? 'Could not load the high poly', true);
    }
  }

  setHigh(m: LoadedModel | null) {
    this.high = m;
    this.useHigh = true;
    if (m) {
      const lo = new THREE.Box3(), hiB = new THREE.Box3();
      for (const g of this.model.geometries) lo.union(g.boundingBox!);
      for (const g of m.geometries) hiB.union(g.boundingBox!);
      const off = lo.getCenter(new THREE.Vector3()).distanceTo(hiB.getCenter(new THREE.Vector3()));
      const ratio = hiB.getSize(new THREE.Vector3()).length() / Math.max(1e-6, lo.getSize(new THREE.Vector3()).length());
      if (off > 0.15 || ratio < 0.7 || ratio > 1.4) {
        toast('The high poly doesn\'t line up with the low poly. Export both from the same scene, at the same position and scale.', true);
      } else toast(`High poly: ${m.name} · ${m.triangles.toLocaleString()} tris. Adjust the cage, then bake.`);
    }
    if (this.mode === 'bake') this.buildBakeDock();
    this.updateCage();
  }

  private updateCage() {
    const hs = this.ts.highSettings;
    // While baking (and right after) the cage and high poly are hidden, so the baked maps show on the model.
    const on = this.mode === 'bake' && this.useHigh && !!this.high && !this.showingBake;
    this.vp.setCage(this.ts.geometries, hs.front, hs.rear, on && this.showCage, hs.average);
    this.vp.setHighPreview(this.high?.geometries ?? null, on && this.showHigh);
  }

  setMode(m: Mode) {
    if (this.mode === m) return;
    if (this.path.p3.length || this.path.p2.length) this.finishPath();
    this.mode = m;
    if (!this.ts.baking) this.showingBake = false;
    document.getElementById('app')!.className = 'mode-' + m;
    if (m === 'bake') {
      this.stroke = null;
      this.view3 = 'material';
      this.selectBakeItem(this.bakeItem);
    } else {
      this.view2 = 'material';
      this.view3 = 'material';
      this.bakeLabel.classList.remove('on');
    }
    if (m === 'design') {
      this.stroke = null;
      if (this.split > 0.45) this.split = 0.42;
      this.setLayout('split');
      const l = this.ts.activeLayer;
      if (l?.kind === 'fill' && l.graph && this.designLinked !== l.id) { this.designLinked = l.id; this.designer.open(l.graph); }
      else this.designer.changed(false);
    }
    this.flyout.classList.remove('open');
    this.updateCage();
    this.updateMirrorLines();
    this.buildAll();
    this.applyViews();
  }

  private selectBakeItem(it: BakeItem) {
    if (!this.ts.baking && this.showingBake) { this.showingBake = false; this.updateCage(); }
    this.bakeItem = it;
    this.view2 = BAKE_VIEW[it];
    if (this.layout3 === '3d') this.setLayout('split');
    this.applyViews();
    this.buildBakeDock();
  }

  // ================================================================ views

  private viewSource(v: ViewMode, ts: TextureSet = this.ts): ViewSource | null {
    switch (v) {
      case 'material': return null;
      case 'color': case 'emit': return { tex: ts.final[v].texture, mode: 0 };
      case 'rough': case 'metal': case 'height': return { tex: ts.final[v].texture, mode: 1 };
      case 'normal': return { tex: ts.finalN.texture, mode: 0 };
      case 'ao': return { tex: ts.meshRT.texture, mode: 1 };
      case 'curv': return { tex: ts.meshRT.texture, mode: 2 };
      case 'mask': {
        const m = ts.activeLayer?.mask;
        return m ? { tex: m.rt.texture, mode: 1 } : { tex: ts.final.color.texture, mode: 0 };
      }
      case 'bnormal': return { tex: ts.bakedNRT.texture, mode: 0 };
      case 'bheight': return { tex: ts.bakedHRT.texture, mode: 1 };
      case 'rays': return { tex: ts.bakedHRT.texture, mode: 3 };
      case 'id': return { tex: ts.idRT.texture, mode: 0 };
      case 'wsn': return { tex: ts.wsnRT.texture, mode: 0 };
      case 'pos': return { tex: ts.posNRT.texture, mode: 0 };
      case 'thick': return { tex: ts.meshRT.texture, mode: 4 };
    }
  }

  applyViews() {
    if (!this.ts) return;
    this.vp.setView(this.view3, (k) => this.viewSource(this.view3, this.sets[k]?.ts ?? this.ts));
    this.uv.bind(this.viewSource(this.view2) ?? { tex: this.ts.final.color.texture, mode: 0 }, this.ts.posRT.texture);
    this.buildPaneSelects();
  }

  /** Keys 1–0 switch both views (like Substance's channel shortcuts). */
  setView(v: ViewMode) {
    if (v === 'mask' && !this.ts.activeLayer?.mask) toast('The selected layer has no mask', true);
    this.view3 = v; this.view2 = v;
    this.applyViews();
  }

  private buildPaneSelects() {
    const mk = (cur: ViewMode, set: (v: ViewMode) => void) => {
      const s = select<ViewMode>(VIEWS.map((x) => ({ value: x.v, label: x.label })), cur, set);
      s.title = 'What this view shows';
      return s;
    };
    this.sel3.innerHTML = ''; this.sel2.innerHTML = '';
    this.sel3.append(mk(this.view3, (v) => { this.view3 = v; this.applyViews(); }));
    this.sel2.append(mk(this.view2, (v) => { this.view2 = v; this.applyViews(); }));
  }

  // ================================================================ layout (3D | UV split)

  setLayout(l: Layout) {
    this.layout3 = l;
    this.layout();
    this.buildToolbar();
  }

  layout() {
    const c = this.container;
    const W = c.clientWidth, H = c.clientHeight;
    this.vp.resize(W, H);
    const gap = 3;
    const w3 = this.layout3 === 'split' ? Math.round(W * this.split) : this.layout3 === '3d' ? W : 0;
    const showUV = this.layout3 !== '3d';
    const r3: Region = { x: 0, y: 0, w: w3, h: H };
    const x2 = this.layout3 === 'split' ? w3 + gap : 0;
    const r2: Region = { x: x2, y: 0, w: showUV ? Math.max(0, W - x2) : 0, h: H };
    this.vp.setRegion(r3);
    if (!this.framedOnce && w3 > 50) { this.vp.frame(); this.framedOnce = true; }
    this.uv.region = r2;
    if (!this.uv.userMoved) this.uv.frame();
    Object.assign(this.uvOverlay.style, { display: showUV ? 'block' : 'none', left: `${r2.x}px`, width: `${r2.w}px` });
    Object.assign(this.designEl.style, { left: `${r2.x}px`, width: `${Math.max(0, r2.w)}px` });
    Object.assign(this.uvSplitter.style, { display: this.layout3 === 'split' ? 'block' : 'none', left: `${w3}px`, width: `${gap}px` });
    Object.assign(this.sel3.style, { display: w3 > 0 ? 'block' : 'none', left: `${w3 / 2}px` });
    Object.assign(this.sel2.style, { display: showUV ? 'block' : 'none', left: `${r2.x + r2.w / 2}px` });
  }

  private bindUVInput() {
    const ov = this.uvOverlay;
    const rect = () => this.vp.canvas.getBoundingClientRect();
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    ov.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.wheelAdjust(e)) return;
      const at = this.uv.toUV(e.clientX, e.clientY, rect());
      this.uv.zoomAt(Math.exp(e.deltaY * 0.0015), at);
    }, { passive: false });
    ov.addEventListener('pointerdown', (e) => {
      try { ov.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
      if (this.wantsAdjust(e)) { e.preventDefault(); this.startAdjust(e); return; }
      if (e.button === 0 && !e.altKey) {
        const uv = this.uv.toUV(e.clientX, e.clientY, rect());
        if (this.shapeMove) { toast('Drag the shape on the 3D view (left)', true); return; }
        if (this.idPick >= 0) { this.pickIdColor(uv); return; }
        if (this.tool === 'fill' && this.mode === 'paint') { this.startBox('2d', e.clientX, e.clientY); return; }
        this.setPressure(e);
        this.startUVStroke(uv, e.shiftKey);
        if (this.uvStroke) this.lazyStart(e.clientX, e.clientY);
      } else this.uvPan = { x: e.clientX, y: e.clientY };
    });
    ov.addEventListener('pointermove', (e) => {
      if (this.adjust) { this.moveAdjust(e); return; }
      const r = rect();
      this.uvHover = this.uv.toUV(e.clientX, e.clientY, r);
      if (this.tool === 'picker') this.updatePickPreview(e.clientX, e.clientY, this.uvHover);
      if (this.uvPan) {
        this.uv.pan(e.clientX - this.uvPan.x, e.clientY - this.uvPan.y);
        this.uvPan = { x: e.clientX, y: e.clientY };
      } else if (this.box) {
        this.moveBox(e.clientX, e.clientY);
      } else if (this.uvStroke) {
        const co = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined; const evs = co?.length ? co : [e];
        for (const ce of evs) {
          this.setPressure(ce);
          const q = this.lazyMove(ce.clientX, ce.clientY);
          if (q) this.continueUVStroke(this.uv.toUV(q.x, q.y, r));
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (this.adjust) { this.endAdjust(); return; }
      this.uvPan = null;
      if (this.box?.pane === '2d') this.endBox(e.ctrlKey || e.metaKey);
      if (this.uvStroke) { this.lastEnd2 = this.uvStroke.uv.clone(); this.uvStroke = null; this.ts.endStroke(); this.queueLayerThumbs(); this.strokeCount++; }
      this.lazyEnd();
    };
    ov.addEventListener('dblclick', () => { if (this.tool === 'path') this.finishPath(); });
    ov.addEventListener('pointerup', end);
    ov.addEventListener('pointercancel', end);
    ov.addEventListener('pointerleave', () => { this.uvHover = null; });

    const sp = this.uvSplitter;
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = this.container.getBoundingClientRect();
        this.split = Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width));
        this.layout();
      };
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
  }

  private get radiusUV() { return this.brush.radius * 0.5; }

  // ---------------------------------------------------------------- pen pressure & lazy mouse

  /** Pen pressure from a pointer event (mouse and touch count as full pressure). */
  private setPressure(e: PointerEvent) {
    this.ts.pressure = e.pointerType === 'pen' ? Math.max(0.01, e.pressure || 0) : 1;
    if (e.pointerType === 'pen' && !this.penSeen) { this.penSeen = true; if (this.mode === 'paint') this.buildProperties(); }
  }
  penSeen = false;
  /** Lazy mouse: where the brush is (trails the cursor on a string), in client pixels. */
  private lazyPt: { x: number; y: number } | null = null;
  private lazyLine = el('div', { id: 'lazy-line' }, el('i', { class: 'a' }), el('i', { class: 'b' }), el('span', { class: 'str' }));
  private get lazyLen() { return (this.brush.smoothing ?? 0) * 100; }
  private lazyStart(x: number, y: number) { this.lazyPt = { x, y }; this.drawLazy(x, y); }
  /** Move the string end toward the cursor; returns the new brush point, or null while it is still slack. */
  private lazyMove(x: number, y: number): { x: number; y: number } | null {
    const L = this.lazyLen;
    if (!L || !this.lazyPt) return { x, y };
    const p = this.lazyPt, dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    this.drawLazy(x, y);
    if (d <= L) return null;
    const k = (d - L) / d;
    p.x += dx * k; p.y += dy * k;
    return { x: p.x, y: p.y };
  }
  private drawLazy(x: number, y: number) {
    const ln = this.lazyLine, p = this.lazyPt;
    if (!this.lazyLen || !p) { ln.style.display = 'none'; return; }
    if (!ln.isConnected) document.body.append(ln);
    const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    ln.style.display = 'block';
    const [a, b, str] = [...ln.children] as HTMLElement[];
    Object.assign(a.style, { left: `${p.x}px`, top: `${p.y}px` });
    Object.assign(b.style, { left: `${x}px`, top: `${y}px` });
    Object.assign(str.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${d}px`, transform: `rotate(${Math.atan2(dy, dx)}rad)`, opacity: d >= this.lazyLen - 0.5 ? '1' : '.55' });
  }
  private lazyEnd() { this.lazyPt = null; this.lazyLine.style.display = 'none'; }

  /** Can the current tool paint into the selection? (doesn't start a stroke) */
  private paintable(): boolean {
    if (this.mode === 'bake') { toast('You\'re in Baking mode. Switch to Painting (top right) to paint.', true); return false; }
    const layer = this.ts.activeLayer;
    if (!layer) { toast('Add a layer first', true); return false; }
    if (this.paintTarget === 'mask') {
      if (!layer.mask) { this.paintTarget = 'content'; this.refresh(); return this.paintable(); }
    } else if (layer.kind !== 'paint') {
      toast(layer.mask
        ? `“${layer.name}” is a ${layer.kind === 'group' ? 'folder' : 'fill layer'}. Click its mask thumbnail to paint the mask, or select a paint layer.`
        : `To paint a ${layer.kind === 'group' ? 'folder' : 'fill layer'}, give it a black mask (right-click it → Add black mask) and paint the mask white.`, true);
      return false;
    }
    if (!layer.visible) toast('Painting on a hidden layer', true);
    return true;
  }

  private canPaint(): boolean {
    if (!this.paintable()) return false;
    this.brush.erase = this.tool === 'erase';
    this.brush.tool = this.tool === 'smudge' || this.tool === 'clone' || this.tool === 'blur' ? this.tool : 'paint';
    if (this.tool === 'clone' && !this.ts.cloneSource) { toast('Clone: hold V and click where to copy from first', true); return false; }
    this.ensureTip();
    if (!this.ts.beginStroke(this.brush, this.paintTarget)) {
      toast('Turn on at least one channel in Properties → Material', true);
      return false;
    }
    return true;
  }

  startUVStroke(uv: THREE.Vector2, shift = false) {
    if (this.tool === 'picker') { this.pickAt(uv); return; }
    if (this.tool === 'clone' && this.vHeld) { this.ts.setCloneSource(uv); toast('Clone source set. Now paint where you want the copy.'); this.buildProperties(); return; }
    if (this.tool === 'path') { this.addPathPoint2(uv); return; }
    if (!this.canPaint()) return;
    if (shift && this.lastEnd2) {
      // Shift+click: straight line from the end of the last stroke.
      this.ts.stampUV(this.lastEnd2, this.radiusUV);
      this.uvStroke = { uv: this.lastEnd2.clone() };
      this.continueUVStroke(uv);
    } else {
      this.ts.stampUV(uv, this.radiusUV);
      this.uvStroke = { uv };
    }
    this.modified = true;
  }

  continueUVStroke(uv: THREE.Vector2) {
    const st = this.uvStroke;
    if (!st) return;
    const step = Math.max(this.brush.spacing * this.radiusUV, 1e-5);
    const dist = uv.distanceTo(st.uv);
    if (dist < step) return;
    const n = Math.min(Math.floor(dist / step), 256);
    for (let i = 1; i <= n; i++) this.ts.stampUV(st.uv.clone().lerp(uv, i / n), this.radiusUV);
    st.uv = uv;
  }

  /** Material picker: copy the material under the cursor into the brush. */
  /** Picker: the whole material (all channels) or only the base color, like Substance's color picker. */
  pickMode: 'material' | 'color' = 'material';
  private pickAt(uv: THREE.Vector2) {
    const v = this.ts.sampleAt(uv);
    if (this.pickMode === 'color') {
      this.brush.values = { ...this.brush.values, color: v.color };
      this.brush.channels.color = true;
      toast(`Picked color ${rgbToHex(v.color)}`);
    } else {
      this.brush.values = { ...this.brush.values, ...v };
      toast(`Picked ${rgbToHex(v.color)} · rough ${v.rough.toFixed(2)} · metal ${v.metal.toFixed(2)}`);
    }
    this.pickPreview.style.display = 'none';
    this.setTool(this.pickReturn ?? 'paint');
    this.pickReturn = null;
    this.buildProperties();
  }
  /** Tool to go back to after a pick (the picker is usually a quick detour, like in Substance). */
  private pickReturn: Tool | null = null;
  /** Live swatch next to the cursor while picking. */
  private pickPreview = el('div', { id: 'pick-preview' }, el('span', { class: 'sw' }), el('span', { class: 'tx' }));
  private pickQueued = false;
  private updatePickPreview(x: number, y: number, uv: THREE.Vector2 | null | undefined) {
    if (this.tool !== 'picker' || !uv) { this.pickPreview.style.display = 'none'; return; }
    if (this.pickQueued) return;
    this.pickQueued = true;
    requestAnimationFrame(() => {
      this.pickQueued = false;
      const v = this.ts.sampleAt(uv);
      const sw = this.pickPreview.querySelector('.sw') as HTMLElement, tx = this.pickPreview.querySelector('.tx') as HTMLElement;
      sw.style.background = rgbToHex(v.color);
      tx.textContent = this.pickMode === 'color' ? rgbToHex(v.color) : `${rgbToHex(v.color)} · R ${v.rough.toFixed(2)} · M ${v.metal.toFixed(2)}`;
      Object.assign(this.pickPreview.style, { display: 'flex', left: `${x + 18}px`, top: `${y + 18}px` });
    });
  }

  // ================================================================ painting input (3D)

  private bindInput(container: HTMLElement) {
    const canvas = this.vp.canvas;
    const controls = this.vp.controls;
    // Ctrl + scroll = brush size, Ctrl + Shift + scroll = stroke opacity (caught before the camera zoom sees it).
    container.addEventListener('wheel', (e) => {
      if (e.target !== canvas) return;
      if (this.wheelAdjust(e)) { e.preventDefault(); e.stopPropagation(); }
    }, { capture: true, passive: false });
    container.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas) return;
      // Shift + right drag turns the light (sun / environment) around the model, like Substance.
      if (e.shiftKey && e.button === 2 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        controls.enabled = false;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
        this.sunDrag = { x: e.clientX, y: e.clientY, yaw0: this.vp.envYaw, tilt0: this.vp.envTilt };
        this.drawSun(e.clientX, e.clientY);
        return;
      }
      if (this.wantsAdjust(e)) {
        e.preventDefault(); e.stopPropagation();
        controls.enabled = false;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
        this.startAdjust(e);
        return;
      }
      if (this.pj && (this.pj.tc.axis || this.pj.tc.dragging)) return; // on the 3D manipulator's handles
      if (e.button === 0 && !e.altKey && this.shapeMove) {
        controls.enabled = false;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
        this.ts.checkpoint('Move shape');
        this.shapeDragging = true;
        this.moveShapeTo(e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && !e.altKey) {
        controls.enabled = false;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
        if (this.idPick >= 0) { const h = this.pick(e.clientX, e.clientY); if (h?.uv) this.pickIdColor(h.uv); else toast('Click on the model to pick an ID color', true); return; }
        if (this.tool === 'fill' && this.mode === 'paint') { this.startBox('3d', e.clientX, e.clientY); return; }
        if (this.tool === 'path') { if (!this.pathDown3(e.clientX, e.clientY, e.ctrlKey || e.metaKey)) { controls.enabled = true; } return; }
        if (this.tool === 'clone' && this.vHeld) {
          const h = this.pick(e.clientX, e.clientY);
          if (h?.uv) { this.ts.setCloneSource(h.uv); toast('Clone source set. Now paint where you want the copy.'); this.buildProperties(); }
          controls.enabled = true;
          return;
        }
        this.setPressure(e);
        this.startStroke(e.clientX, e.clientY, e.shiftKey);
        if (this.stroke) this.lazyStart(e.clientX, e.clientY);
      } else {
        controls.enabled = true;
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        controls.mouseButtons.RIGHT = e.altKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
      }
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (this.sunDrag) {
        const d = this.sunDrag;
        this.vp.envRotation = ((((d.yaw0 + (e.clientX - d.x) * 0.5) % 360) + 360) % 360);
        this.vp.envTiltDeg = d.tilt0 - (e.clientY - d.y) * 0.25;
        this.drawSun(e.clientX, e.clientY);
        this.poke();
        return;
      }
      if (this.adjust) { this.moveAdjust(e); return; }
      this.hover = { x: e.clientX, y: e.clientY };
      if (this.shapeDragging) { this.moveShapeTo(e.clientX, e.clientY); return; }
      if (this.box?.pane === '3d') { this.moveBox(e.clientX, e.clientY); return; }
      if (this.pathDrag) { this.pathMove3(e.clientX, e.clientY); return; }
      if (this.tool === 'picker') this.updatePickPreview(e.clientX, e.clientY, this.pick(e.clientX, e.clientY)?.uv);
      if (this.stroke) {
        const co = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined; const evs = co?.length ? co : [e];
        for (const ce of evs) {
          this.setPressure(ce);
          const q = this.lazyMove(ce.clientX, ce.clientY);
          if (q) this.continueStroke(q.x, q.y);
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (this.sunDrag) {
        this.sunDrag = null; controls.enabled = true; this.adjustEl.style.display = 'none';
        this.settings.envYaw = Math.round(this.vp.envYaw); this.settings.envTilt = Math.round(this.vp.envTilt); saveSettings(this.settings);
        if (this.flyout.classList.contains('open')) this.buildFlyout();
        return;
      }
      if (this.adjust) { this.endAdjust(); controls.enabled = true; return; }
      if (this.shapeDragging) { this.shapeDragging = false; controls.enabled = true; this.queueLayerThumbs(); this.shapeMovedCount++; return; }
      if (this.box?.pane === '3d') this.endBox(e.ctrlKey || e.metaKey);
      if (this.pathDrag) this.pathUp();
      if (this.stroke) { this.lastEnd3 = this.stroke.hit.point.clone(); this.stroke = null; this.ts.endStroke(); this.queueLayerThumbs(); this.strokeCount++; }
      this.lazyEnd();
      controls.enabled = true;
    };
    canvas.addEventListener('dblclick', (e) => {
      if (this.tool === 'path') { this.finishPath(); return; }
      // Double-click a part of another texture set to switch to it.
      if (this.sets.length > 1 && this.mode === 'paint') {
        const k = this.setAt(e.clientX, e.clientY);
        if (k >= 0 && k !== this.activeSet) { this.switchSet(k); toast(`Texture set: ${this.sets[k].name}`); }
      }
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.pickPreview.style.display = 'none'; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.onKey(e));
    // V held: the clone tool's "set source" key (like Substance).
    window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) this.vHeld = true; });
    window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'v') this.vHeld = false; });
    window.addEventListener('blur', () => (this.vHeld = false));
    window.addEventListener('pointermove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; if (this.pie) this.pieMove(e.clientX, e.clientY); }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Backquote' && this.pie) this.pieRelease(); });
    window.addEventListener('blur', () => this.closePie());
    window.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')));

    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    container.addEventListener('dragenter', (e) => { e.preventDefault(); if (!isFiles(e)) return; depth++; container.classList.add('dragging'); });
    container.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; if (--depth <= 0) { depth = 0; container.classList.remove('dragging'); } });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dragItem) { e.dataTransfer!.dropEffect = 'copy'; this.hoverDropTarget(e.clientX, e.clientY); }
    });
    container.addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; container.classList.remove('dragging');
      if (this.dragItem) { const items = this.dragList(this.dragItem); this.dragItem = null; this.vp.setHighlight('', null); await this.dropAssets(items, e.clientX, e.clientY); return; }
      const fl = [...(e.dataTransfer?.files ?? [])];
      // One plain image dropped on the model: project it there (like Substance). Map sets still get the import dialog.
      if (fl.length === 1 && /\.(png|jpe?g|webp|bmp|tga|tiff?)$/i.test(fl[0].name) && !splitMapName(fl[0].name.replace(/\.[^.]+$/, ''))
        && this.mode === 'paint' && this.pick(e.clientX, e.clientY)) { await this.projectImage(fl[0], e.clientX, e.clientY); return; }
      await this.dropFiles(fl);
    });
    // Files dropped anywhere else (Assets, Layers, menus…) are handled too, instead of the
    // browser opening / downloading them.
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; } });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      await this.dropFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  /** Files dropped from the computer: Substance files are translated, the rest opened / added to Assets. */
  async dropFiles(all: File[]) {
    // Report unsupported projects even in a mixed drop, before adding the other assets.
    const projects = all.filter((f) => /\.spp$/i.test(f.name));
    if (projects.length) {
      try { checkProjectFileName(projects[0].name); } catch (e) { this.projectOpenFailed(e); }
    }
    let files = all.filter((f) => !projects.includes(f));
    if (!files.length) return;
    const sub = files.filter((f) => /\.(sbsar|spsm|spmsk)$/i.test(f.name));
    if (sub.length) { await this.translateSubstance(sub); files = files.filter((f) => !sub.includes(f)); if (!files.length) return; }
    const imgs = files.filter((f) => /\.(png|jpe?g|webp|bmp|tga|tiff?)$/i.test(f.name));
    if (imgs.length && imgs.length === files.length) { await this.importImages(imgs); return; }
    if (files.length > 1) {
      await this.shelf.addFiles(files); this.buildShelf();
      toast(`Added ${files.length} files to the assets shelf`);
    } else if (files[0]) await this.openAny(files[0]);
  }

  startStroke(x: number, y: number, shift = false) {
    const hit = this.pick(x, y);
    if (!hit) return;
    this.ts.viewPos.copy(this.vp.camera.position);
    if (this.tool === 'picker') { if (hit.uv) this.pickAt(hit.uv); return; }
    if (this.tool === 'path') { this.addPathPoint3(hit); return; }
    if (this.tool === 'fill') { this.polyFillAt(hit); return; }
    if (!this.canPaint()) return;
    if (shift && this.lastEnd3) {
      // Shift+click: straight line from where the last stroke ended.
      const s = this.toScreen(this.lastEnd3);
      const start = s ? this.pick(s.x, s.y) : null;
      if (start) {
        this.ts.stamp(start.point, start.normal, start.uv);
        this.stroke = { hit: start, x: s!.x, y: s!.y };
        this.continueStroke(x, y);
        this.modified = true;
        return;
      }
    }
    this.ts.stamp(hit.point, hit.normal, hit.uv);
    this.stroke = { hit, x, y };
    this.modified = true;
  }

  /** World point → client coordinates of the 3D view (null if behind the camera). */
  private toScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.vp.camera);
    if (v.z > 1) return null;
    const r = this.vp.canvas.getBoundingClientRect(), g = this.vp.region;
    return { x: r.left + g.x + (v.x * 0.5 + 0.5) * g.w, y: r.top + g.y + (-v.y * 0.5 + 0.5) * g.h };
  }

  // ================================================================ texture sets (one per material)

  private projectSets() { return this.sets.length ? this.sets.map((st) => ({ name: st.name, ts: st.ts })) : [{ name: this.model.name, ts: this.ts }]; }

  /** Every texture set of the model; `this.ts` is the active one. */
  sets: { name: string; ts: TextureSet; geos: number[]; visible: boolean; overlap?: UVOverlap }[] = [];
  activeSet = 0;

  /**
   * Ray pick for painting: only the active texture set can be painted (other sets still block the ray, like in
   * Substance). `mesh` comes back as the index in the active set.
   */
  pick(x: number, y: number): Hit | null {
    const h = this.vp.pick(x, y);
    if (!h || this.sets.length <= 1 || h.mesh === undefined || h.mesh < 0) return h;
    const local = this.sets[this.activeSet].geos.indexOf(h.mesh);
    return local < 0 ? null : { ...h, mesh: local };
  }

  /** Texture set under the cursor (any set). */
  private setAt(x: number, y: number): number {
    const h = this.vp.pick(x, y);
    return h && h.mesh !== undefined && h.mesh >= 0 ? this.vp.setOfMesh(h.mesh) : -1;
  }

  /** Make another texture set the one you paint and see in the Layers panel. */
  switchSet(i: number) {
    if (i === this.activeSet || !this.sets[i]) return;
    this.shapeMove = null; document.body.classList.remove('moving-shape'); this.showGizmo?.(false); this.closeProjGizmo?.();
    this.clearPath();
    this.activeSet = i;
    this.ts = this.sets[i].ts;
    this.fxSel = 0; this.sel = new Set(); this.paintTarget = 'content';
    this.lastEnd3 = null; this.lastEnd2 = null;
    this.uv.setModel(this.ts.geometries);
    this.uv.frame();
    this.parts = new MeshParts(this.ts.geometries);
    this.checkUVOverlaps(this.model);
    this.mapThumbs.clear();
    this.applyViews();
    this.buildAll();
    this.updateBakeStatus();
    this.updateTitle?.();
  }

  private toggleSetVisible(i: number) {
    const st = this.sets[i];
    if (!st) return;
    st.visible = !st.visible;
    this.vp.setSetVisible(i, st.visible);
    this.buildRight();
    this.poke();
  }

  // ================================================================ polygon fill + drop on mesh

  private partAt(hit: Hit | null, mode: PartMode): Part | null {
    if (!hit || hit.mesh === undefined || hit.mesh < 0 || hit.face === undefined) return null;
    return this.parts.pick(mode, hit.mesh, hit.face);
  }

  polyFillAt(hit: Hit) {
    const part = this.partAt(hit, this.fillMode);
    if (part) this.fillParts([part]);
  }

  /**
   * Polygon fill: paint layers get the brush material; fill layers and folders get their
   * mask filled white (a black mask is added first, like Substance). `erase` fills black.
   */
  fillParts(parts: Part[], erase = false) {
    if (!parts.length) return;
    if (this.mode === 'bake') { toast('Switch to Painting mode to fill.', true); return; }
    const ts = this.ts;
    const layer = ts.activeLayer;
    if (!layer) { toast('Add a layer first', true); return; }
    const tris = parts.flatMap(partTris);
    const n = tris.reduce((a, p) => a + p.tris.length, 0);
    if (layer.kind !== 'paint' || this.paintTarget === 'mask') {
      const added = !layer.mask;
      ts.batchSync(added ? 'Black mask + fill' : 'Fill mask', () => {
        if (!layer.mask) ts.addMask(layer, { base: 'black', gen: null });
        ts.activeId = layer.id;
        ts.polyFill({ ...this.brush, erase }, 'mask', tris);
      });
      this.paintTarget = 'mask';
      if (added) toast(`Added a black mask to “${layer.name}” and filled ${n.toLocaleString()} triangle${n === 1 ? '' : 's'} white. Ctrl+drag fills black.`);
      this.modified = true;
      this.refresh();
      return;
    }
    if (!this.paintable()) return;
    const ok = ts.polyFill({ ...this.brush, erase: erase || this.tool === 'erase' }, this.paintTarget, tris);
    if (!ok) { toast('Turn on at least one channel in Properties → Material', true); return; }
    this.modified = true;
  }

  // ---------------------------------------------------------------- Ctrl + drag brush adjust

  /** Ctrl + scroll = size, Ctrl + Shift + scroll = stroke opacity, Ctrl + right drag = hardness,
   *  Ctrl + left drag = flow (←→) / rotation (↑↓) like Substance. */
  private canAdjust() {
    return this.mode === 'paint' && (BRUSH_TOOLS.includes(this.tool) || this.tool === 'path');
  }

  private wantsAdjust(e: PointerEvent) {
    return (e.ctrlKey || e.metaKey) && !e.altKey && (e.button === 0 || e.button === 2) && this.canAdjust();
  }

  private adjustHide = 0;

  /** Handles Ctrl (+ Shift) + mouse wheel. Returns true when it used the event. */
  private wheelAdjust(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !this.canAdjust() || this.adjust) return false;
    // Windows turns Shift + wheel into a sideways scroll, so read whichever axis moved.
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return true;
    const up = d < 0;
    const b = this.brush;
    if (e.shiftKey) {
      const o = Math.round((b.opacity ?? 1) * 100);
      const n = Math.min(100, Math.max(1, up ? Math.floor(o / 5) * 5 + 5 : Math.ceil(o / 5) * 5 - 5));
      this.setBrush('opacity', n / 100);
    } else {
      const sz = Math.round(b.radius * 200);
      const step = Math.max(1, Math.round(sz * 0.08));
      this.setBrush('radius', Math.min(100, Math.max(1, sz + (up ? step : -step))) / 200);
    }
    // The label only; painting and hover carry on normally while it shows.
    this.drawAdjust({ x: e.clientX, y: e.clientY, mode: e.shiftKey ? 'opacity' : 'size' });
    clearTimeout(this.adjustHide);
    this.adjustHide = window.setTimeout(() => { if (!this.adjust) this.adjustEl.style.display = 'none'; }, 900);
    this.poke();
    return true;
  }

  private startAdjust(e: PointerEvent) {
    const b = this.brush;
    clearTimeout(this.adjustHide);
    this.adjust = { x: e.clientX, y: e.clientY, mode: e.button === 2 ? 'hard' : 'angle', r0: b.radius, h0: b.hardness, f0: b.flow, a0: b.angle ?? 0 };
    this.drawAdjust();
  }

  private moveAdjust(e: PointerEvent) {
    const a = this.adjust;
    if (!a) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    if (a.mode === 'hard') {
      // Right or up = harder, left or down = softer.
      this.setBrush('hardness', Math.min(1, Math.max(0, a.h0 + (dx - dy) * 0.004)));
    } else if (a.mode === 'angle') {
      // Like Substance: horizontal = flow, vertical = rotation.
      this.setBrush('flow', Math.min(1, Math.max(0.01, a.f0 + dx * 0.004)));
      this.brush.angle = (((a.a0 - dy * 0.75) % 360) + 360) % 360;
    } else return;
    this.drawAdjust();
  }

  private endAdjust() {
    const a = this.adjust;
    this.adjust = null;
    this.adjustEl.style.display = 'none';
    if (a?.mode === 'angle') this.buildProperties();
  }

  /** Little label + tip preview next to the cursor while adjusting. */
  /** Which low poly meshes find a high poly mesh with the same name (shown under "Matching by mesh name"). */
  private nameMatchInfo(): HTMLElement | null {
    const bs = this.ts.bakeSettings;
    const low = this.ts.geometries.map((g) => g.name);
    if (low.length < 2 && !this.high) return el('p', { class: 'note' }, 'This model is a single mesh, so matching by name changes nothing.');
    const rules = { low: bs.lowSuffix ?? '_low', high: bs.highSuffix ?? '_high', ignoreBf: bs.bfSuffix ?? '_ignorebf' };
    const show = (n: string) => n || '(no name)';
    if (!this.high || !this.useHigh) return el('p', { class: 'note' }, `${low.length} low poly meshes: ${low.slice(0, 6).map(show).join(', ')}${low.length > 6 ? '…' : ''}.`);
    const hk = new Set(this.high.geometries.map((g) => meshKey(g.name, rules)));
    const miss = low.filter((n) => !hk.has(meshKey(n, rules)));
    const ok = low.length - miss.length;
    return el('p', { class: 'note' + (miss.length && (bs.matchBy ?? 'always') === 'name' ? ' warn' : '') },
      `${ok} of ${low.length} low poly meshes have a high poly mesh with the same name.` + (miss.length ? ` No match: ${miss.slice(0, 5).map(show).join(', ')}${miss.length > 5 ? '…' : ''}.` : ''));
  }

  /** Remember the ticked bake maps for the next project and the next time LocalPaint opens. */
  private saveBakeMaps() { this.settings.bakeMaps = { ...this.ts.bakeMaps }; saveSettings(this.settings); }

  private vHeld = false;
  private sunDrag: { x: number; y: number; yaw0: number; tilt0: number } | null = null;
  private drawSun(x: number, y: number) {
    const host = this.container.getBoundingClientRect();
    this.adjustEl.innerHTML = '';
    this.adjustEl.append(el('span', {}, `Light ${Math.round(this.vp.envYaw)}° · height ${Math.round(this.vp.envTilt)}°`), el('span', { class: 'muted' }, '←→ turn · ↑↓ height'));
    Object.assign(this.adjustEl.style, { display: 'flex', left: `${x - host.left + 18}px`, top: `${y - host.top + 18}px` });
  }

  private drawAdjust(a: { x: number; y: number; mode: 'hard' | 'angle' | 'size' | 'opacity' } | null = this.adjust) {
    if (!a) return;
    const b = this.brush;
    const host = this.container.getBoundingClientRect();
    const n = 72;
    const cv = el('canvas', { width: n, height: n }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    const tip = b.tip ?? 'round';
    const src = tip === 'round' || tip === 'square' ? tipPreview(tip, undefined, b.hardness) : this.tipCanvases.get(tip);
    const r = 8 + Math.min(1, b.radius * 6) * 26;
    g.save(); g.translate(n / 2, n / 2); g.rotate(-((b.angle ?? 0) * Math.PI) / 180);
    g.globalAlpha = Math.max(0.15, b.flow);
    if (src) g.drawImage(src, -r, -r, r * 2, r * 2);
    g.restore();
    const txt = a.mode === 'size' ? `Size ${Math.round(b.radius * 200)}`
      : a.mode === 'opacity' ? `Stroke opacity ${Math.round((b.opacity ?? 1) * 100)}`
      : a.mode === 'hard' ? `Hardness ${Math.round(b.hardness * 100)}`
      : `Flow ${Math.round(b.flow * 100)} · Rotation ${Math.round(b.angle ?? 0)}°${tip === 'round' ? ' (round tip: pick a shaped tip to see rotation)' : ''}`;
    this.adjustEl.innerHTML = '';
    this.adjustEl.append(cv, el('span', {}, txt), el('span', { class: 'muted' }, ({ size: 'Ctrl + scroll', opacity: 'Ctrl + Shift + scroll', hard: 'drag right/up = harder', angle: '←→ flow · ↑↓ rotation' } as const)[a.mode]));
    Object.assign(this.adjustEl.style, { display: 'flex', left: `${a.x - host.left + 18}px`, top: `${a.y - host.top + 18}px` });
  }

  // ---------------------------------------------------------------- box selection (polygon fill)

  private startBox(pane: '3d' | '2d', x: number, y: number) {
    this.box = { pane, x0: x, y0: y, x1: x, y1: y, moved: false, parts: [], queued: false };
  }

  private moveBox(x: number, y: number) {
    const b = this.box;
    if (!b) return;
    b.x1 = x; b.y1 = y;
    if (!b.moved && Math.hypot(x - b.x0, y - b.y0) > 5) b.moved = true;
    if (!b.moved) return;
    const host = this.container.getBoundingClientRect();
    Object.assign(this.boxEl.style, {
      display: 'block', left: `${Math.min(b.x0, x) - host.left}px`, top: `${Math.min(b.y0, y) - host.top}px`,
      width: `${Math.abs(x - b.x0)}px`, height: `${Math.abs(y - b.y0)}px`,
    });
    if (b.queued) return;
    b.queued = true;
    requestAnimationFrame(() => {
      if (this.box !== b) return;
      b.queued = false;
      b.parts = this.boxParts(b);
      this.showSelection(b.parts);
    });
  }

  private showSelection(parts: Part[]) {
    if (parts.length) {
      const key = 'box:' + parts.map((p) => p.key).join('|');
      this.vp.setHighlight(key, () => this.parts.highlightMany(parts), 0xff3b30);
      this.uv.setSelection(this.parts.highlightMany(parts, true));
    } else { this.vp.setHighlight('', null); this.uv.setSelection(null); }
  }

  /** Regions touched by the box: in 3D, front-facing triangles whose centre is inside it; in 2D, triangles with a corner or centre inside. */
  private boxParts(b: NonNullable<App['box']>): Part[] {
    const geos = this.ts.geometries;
    if (b.pane === '2d') {
      const r = this.vp.canvas.getBoundingClientRect();
      const a = this.uv.toUV(b.x0, b.y0, r), c = this.uv.toUV(b.x1, b.y1, r);
      const u0 = Math.min(a.x, c.x), u1 = Math.max(a.x, c.x), v0 = Math.min(a.y, c.y), v1 = Math.max(a.y, c.y);
      const inside = (u: number, v: number) => u >= u0 && u <= u1 && v >= v0 && v <= v1;
      return this.parts.select(this.fillMode, (gi, t) => {
        const g = geos[gi], uv = g.attributes.uv, idx = g.index;
        if (!uv) return false;
        let su = 0, sv = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          const u = uv.getX(v), w = uv.getY(v);
          if (inside(u, w)) return true;
          su += u; sv += w;
        }
        return inside(su / 3, sv / 3);
      });
    }
    const r = this.vp.canvas.getBoundingClientRect(), reg = this.vp.region;
    const nx = (x: number) => ((x - r.left - reg.x) / reg.w) * 2 - 1, ny = (y: number) => -(((y - r.top - reg.y) / reg.h) * 2 - 1);
    const x0 = Math.min(nx(b.x0), nx(b.x1)), x1 = Math.max(nx(b.x0), nx(b.x1)), y0 = Math.min(ny(b.y0), ny(b.y1)), y1 = Math.max(ny(b.y0), ny(b.y1));
    const cam = this.vp.camera;
    cam.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const cp = cam.position;
    return this.parts.select(this.fillMode, (gi, t) => {
      const g = geos[gi], pos = g.attributes.position, idx = g.index;
      let cx = 0, cy = 0, cz = 0;
      const vs: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
        vs.push(px, py, pz);
        cx += px / 3; cy += py / 3; cz += pz / 3;
      }
      // front facing?
      const ax = vs[3] - vs[0], ay = vs[4] - vs[1], az = vs[5] - vs[2], bx = vs[6] - vs[0], by = vs[7] - vs[1], bz = vs[8] - vs[2];
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      if (fx * (cx - cp.x) + fy * (cy - cp.y) + fz * (cz - cp.z) > 0) return false;
      const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
      if (w <= 0) return false;
      const sx = (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w, sy = (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w;
      return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    });
  }

  private endBox(erase: boolean) {
    const b = this.box;
    if (!b) return;
    this.box = null;
    this.boxEl.style.display = 'none';
    if (b.moved) {
      const parts = this.boxParts(b);
      this.showSelection([]);
      if (!parts.length) { toast('Nothing inside the box', true); return; }
      this.fillParts(parts, erase);
      return;
    }
    this.showSelection([]);
    // A click: fill the region under the cursor.
    if (b.pane === '3d') { const hit = this.pick(b.x0, b.y0); if (hit) { const part = this.partAt(hit, this.fillMode); if (part) this.fillParts([part], erase); } return; }
    const part = this.partAtUV(this.uv.toUV(b.x0, b.y0, this.vp.canvas.getBoundingClientRect()));
    if (part) this.fillParts([part], erase);
  }

  private partAtUV(uv: THREE.Vector2): Part | null {
    for (let gi = 0; gi < this.ts.geometries.length; gi++) {
      const t = this.parts.triAtUV(gi, uv.x, uv.y);
      if (t >= 0) return this.parts.pick(this.fillMode, gi, t);
    }
    return null;
  }

  /** ID color selection mask: sample the ID map under the click. */
  private pickIdColor(uv: THREE.Vector2) {
    const layer = this.ts.allLayers.find((l) => l.id === this.idPick);
    this.idPick = -1;
    document.body.classList.remove('picking-id');
    const g = layer?.mask?.gen;
    if (!layer || !g || g.type !== 'id') return;
    if (!this.ts.baked.has('id')) { toast('Bake the ID map first (Baking tab → ID).', true); return; }
    const c = this.ts.sampleTex(this.ts.idRT.texture, uv);
    this.ts.checkpoint('Pick ID color');
    g.colors = [...(g.colors ?? []), c].slice(-8);
    this.ts.maskChanged(layer);
    this.modified = true;
    this.buildProperties();
    toast(`ID color ${rgbToHex(c)} added to the mask`);
  }

  private hoverDropTarget(x: number, y: number) {
    const part = this.dropMode === 'whole' ? null : this.partAt(this.pick(x, y), this.dropMode);
    if (part) this.vp.setHighlight(part.key, () => this.parts.highlightGeometry(part));
    else this.vp.setHighlight('', null);
  }

  /** Drop an asset on the 3D/2D view: new fill layer (or folder); with a part mode, masked to that part. */
  async dropAsset(it: ShelfItem, x: number, y: number) { return this.dropAssets([it], x, y); }

  /** Several assets (Ctrl-click picked on the shelf) dropped at once: one undo step. */
  async dropAssets(items: ShelfItem[], x: number, y: number) {
    items = await this.resolveCloud(items);
    if (this.mode === 'bake') this.setMode('paint');
    const usable = items.filter((it) => it.kind !== 'unsupported' && it.kind !== 'brush' && it.kind !== 'alpha' && it.kind !== 'mask' && it.kind !== 'env' && it.kind !== 'model');
    if (!usable.length) { if (items[0]) this.applyShelfItem(items[0]); return; }
    const hit = this.pick(x, y);
    const part = this.dropMode === 'whole' ? null : this.partAt(hit, this.dropMode);
    const label = usable.length > 1 ? `Drop ${usable.length} assets` : `Drop “${usable[0].name}”`;
    let added = 0;
    await this.ts.batch(label, async () => {
      for (const it of usable) {
        const layer = await this.addAssetLayer(it);
        if (!layer) continue;
        added++;
        if (part) {
          this.ts.addMask(layer, { base: 'black', gen: null });
          this.ts.activeId = layer.id;
          this.ts.polyFill({ ...this.brush, erase: false }, 'mask', partTris(part));
        }
      }
    });
    if (!added) return;
    if (part) {
      this.paintTarget = 'mask';
      const what = this.dropMode === 'material'
        ? `material “${materialName(this.ts.geometries[part.geo], +(part.key.split(':')[1] ?? 0))}”`
        : `this ${PART_LABEL[this.dropMode as PartMode].toLowerCase()}`;
      toast(`${usable.length > 1 ? usable.length + ' assets' : '“' + usable[0].name + '”'} applied to ${what}. Paint the mask white/black to adjust.`);
    } else toast(usable.length > 1 ? `Added ${added} assets` : `Added “${usable[0].name}”`);
    this.clearShelfPick();
    this.modified = true;
    this.refresh();
  }

  /** What a drag carries: every picked asset if the dragged one is picked, else just it. */
  private dragList(it: ShelfItem): ShelfItem[] {
    const many = this.dragMany;
    this.dragMany = null;
    return many && many.includes(it) ? many : [it];
  }

  /** Add several assets above the active layer as one undo step. */
  async addAssets(items: ShelfItem[]) {
    items = await this.resolveCloud(items);
    if (this.mode === 'bake') this.setMode('paint');
    const usable = items.filter((it) => it.kind !== 'unsupported' && it.kind !== 'brush' && it.kind !== 'alpha' && it.kind !== 'mask' && it.kind !== 'env' && it.kind !== 'model');
    if (!usable.length) { const b = items.find((it) => it.kind === 'brush' || it.kind === 'alpha' || it.kind === 'mask' || it.kind === 'env' || it.kind === 'model'); if (b) this.applyShelfItem(b); return; }
    let n = 0;
    await this.ts.batch(`Add ${usable.length} assets`, async () => { for (const it of usable) if (await this.addAssetLayer(it)) n++; });
    this.paintTarget = 'content';
    this.modified = true;
    this.clearShelfPick();
    this.refresh();
    toast(`Added ${n} asset${n === 1 ? '' : 's'}`);
  }

  private clearShelfPick() {
    if (!this.shelfPick.size) return;
    this.shelfPick.clear();
    document.querySelectorAll('.tile.picked').forEach((t) => t.classList.remove('picked'));
    this.updatePickBar();
  }

  private updatePickBar() {
    const bar = this.pickBar;
    if (!bar) return;
    bar.innerHTML = '';
    const n = this.shelfPick.size;
    bar.classList.toggle('on', n > 0);
    if (!n) return;
    bar.append(
      el('span', { class: 'grow' }, `${n} selected`),
      el('button', { class: 'primary', onclick: () => this.addAssets([...this.shelfPick]) }, 'Add all'),
      el('button', { onclick: () => this.clearShelfPick() }, 'Clear'),
    );
  }

  /** Create the layer (or folder) for an asset above the active layer. */
  private async addAssetLayer(it: ShelfItem, parent?: GroupLayer): Promise<Layer | null> {
    if (it.kind === 'smart') return applySmartMaterial(this.ts, it.smart, parent);
    if (it.kind === 'graph') {
      const g = it.graph as GraphJSON;
      const images = await this.bakeGraph(g);
      const enabled = {} as Record<Ch, boolean>;
      for (const ch of CHANNELS) enabled[ch] = !!images[ch];
      const fl = this.ts.addFillLayer(g.name, undefined, enabled, !parent, images, 1, parent);
      fl.graph = structuredClone(g);
      return fl;
    }
    if (it.kind === 'material') {
      return this.ts.addFillLayer(it.name, structuredClone(it.preset.values), { ...it.preset.enabled, normal: false }, !parent, undefined, 1, parent);
    }
    if (it.kind === 'textures') {
      const images = await this.textureImages(it);
      const enabled = {} as Record<Ch, boolean>;
      for (const ch of CHANNELS) enabled[ch] = !!images[ch];
      // A scan without a metal map is a non-metal: say so, instead of letting the layer below show through.
      if (it.file?.startsWith('scan:') && images.color) enabled.metal = true;
      if (!Object.keys(images).length) { toast('No usable maps in that set', true); return null; }
      return this.applyTexSettings(this.ts.addFillLayer(it.name, undefined, enabled, !parent, images, it.tiling ?? 1, parent), it);
    }
    return null;
  }

  // ================================================================ path (vector) painting
  // Like Substance's path tool: click to add points (drag while clicking to pull bezier handles), drag
  // points and handles to edit, and the brush follows the curve live. Enter finishes, Esc cancels.

  private addPathPoint3(hit: Hit) {
    if (this.path.pane !== '3d' && this.path.p2.length) this.finishPath();
    this.path.pane = '3d';
    this.path.p3.push({ p: hit.point.clone(), n: hit.normal.clone(), h: null });
    this.pathSel = this.path.p3.length - 1;
    this.pathChanged();
  }

  private addPathPoint2(uv: THREE.Vector2) {
    if (this.path.pane !== '2d' && this.path.p3.length) this.finishPath();
    this.path.pane = '2d';
    this.path.p2.push({ p: uv.clone(), h: null });
    this.pathSel = this.path.p2.length - 1;
    this.pathChanged();
  }

  /** Remove the path without painting it (a live stroke is undone). */
  clearPath() {
    if (this.pathLiveOn) { this.ts.cancelStroke(); this.pathLiveOn = false; }
    this.path = { pane: '3d', p3: [], p2: [] };
    this.pathSel = -1;
    this.updatePathOverlay();
  }

  /** Automatic (smooth) tangent at point i when it has no handle of its own. */
  private autoHandle3(i: number): THREE.Vector3 {
    const P = this.path.p3;
    if (!this.pathSmooth || P.length < 2) return new THREE.Vector3();
    const a = P[Math.max(0, i - 1)].p, b = P[Math.min(P.length - 1, i + 1)].p;
    return b.clone().sub(a).multiplyScalar(i === 0 || i === P.length - 1 ? 1 / 3 : 1 / 6);
  }
  private handle3(i: number) { return this.path.p3[i].h ?? this.autoHandle3(i); }

  private pathCurve3(): THREE.Vector3[] {
    const P = this.path.p3;
    if (P.length < 2) return P.map((x) => x.p.clone());
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const c = new THREE.CubicBezierCurve3(P[i].p, P[i].p.clone().add(this.handle3(i)), P[i + 1].p.clone().sub(this.handle3(i + 1)), P[i + 1].p);
      const pts = c.getPoints(32);
      if (i > 0) pts.shift();
      out.push(...pts);
    }
    return out;
  }

  private autoHandle2(i: number): THREE.Vector2 {
    const P = this.path.p2;
    if (!this.pathSmooth || P.length < 2) return new THREE.Vector2();
    const a = P[Math.max(0, i - 1)].p, b = P[Math.min(P.length - 1, i + 1)].p;
    return b.clone().sub(a).multiplyScalar(i === 0 || i === P.length - 1 ? 1 / 3 : 1 / 6);
  }
  private handle2(i: number) { return this.path.p2[i].h ?? this.autoHandle2(i); }

  private pathCurve2(): THREE.Vector2[] {
    const P = this.path.p2;
    if (P.length < 2) return P.map((x) => x.p.clone());
    const out: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const c = new THREE.CubicBezierCurve(P[i].p, P[i].p.clone().add(this.handle2(i)), P[i + 1].p.clone().sub(this.handle2(i + 1)), P[i + 1].p);
      const pts = c.getPoints(32);
      if (i > 0) pts.shift();
      out.push(...pts);
    }
    return out;
  }

  private updatePathOverlay() {
    const lift = (v: THREE.Vector3, n: THREE.Vector3) => v.clone().addScaledVector(n, 0.004);
    const P = this.path.p3;
    const handles: [THREE.Vector3, THREE.Vector3][] = [];
    if (this.path.pane === '3d') P.forEach((x, i) => {
      if (!x.h && i !== this.pathSel) return;
      const h = this.handle3(i);
      if (h.lengthSq() < 1e-12) return;
      const p = lift(x.p, x.n);
      handles.push([p, p.clone().add(h)], [p, p.clone().sub(h)]);
    });
    const sel = this.path.pane === '3d' && P[this.pathSel] ? lift(P[this.pathSel].p, P[this.pathSel].n) : null;
    this.vp.setPath(P.map((x) => lift(x.p, x.n)), this.path.pane === '3d' ? this.pathCurve3().map((v) => v) : [], handles, sel);
    this.uv.setPath(this.path.p2.map((x) => x.p), this.path.pane === '2d' ? this.pathCurve2() : []);
    if (this.tool === 'path') this.buildToolbar();
    this.poke();
  }

  /** The path changed: redraw it and repaint the live stroke (once per frame). */
  private pathChanged() {
    this.updatePathOverlay();
    if (!this.pathLive || this.pathQueued) return;
    this.pathQueued = true;
    requestAnimationFrame(() => { this.pathQueued = false; this.paintPathLive(); });
  }

  /** Stamp the brush along the path into the open stroke (from scratch each time). */
  private stampPath() {
    if (this.path.pane === '2d') {
      const curve = this.pathCurve2();
      const step = Math.max(this.brush.spacing * this.radiusUV, 1e-5);
      let prev = curve[0];
      this.ts.stampUV(prev, this.radiusUV);
      for (let i = 1; i < curve.length; i++) {
        const d = curve[i].distanceTo(prev);
        const k = Math.max(1, Math.ceil(d / step));
        for (let j = 1; j <= k; j++) this.ts.stampUV(prev.clone().lerp(curve[i], j / k), this.radiusUV);
        prev = curve[i];
      }
      this.lastEnd2 = prev.clone();
    } else {
      const curve = this.pathCurve3();
      const step = Math.max(this.brush.spacing * this.brush.radius, 1e-4);
      let prev = curve[0];
      this.ts.viewPos.copy(this.vp.camera.position);
      const s0 = this.snapToSurface(prev); if (s0) this.ts.stamp(s0.point, s0.normal);
      for (let i = 1; i < curve.length; i++) {
        const d = curve[i].distanceTo(prev);
        const k = Math.max(1, Math.ceil(d / step));
        for (let j = 1; j <= k; j++) {
          const s1 = this.snapToSurface(prev.clone().lerp(curve[i], j / k));
          if (s1) this.ts.stamp(s1.point, s1.normal);
        }
        prev = curve[i];
      }
      this.lastEnd3 = prev.clone();
    }
  }

  private paintPathLive() {
    const n = this.path.pane === '3d' ? this.path.p3.length : this.path.p2.length;
    if (n < 2) { if (this.pathLiveOn) { this.ts.cancelStroke(); this.pathLiveOn = false; } return; }
    if (!this.pathLiveOn) {
      if (!this.paintable()) return;
      this.brush.erase = false;
      this.ensureTip();
      if (!this.ts.beginStroke(this.brush, this.paintTarget)) return;
      this.pathLiveOn = true;
    } else this.ts.restartStroke();
    this.stampPath();
    this.ts.flushStroke();
    this.modified = true;
    this.poke();
  }

  /** Finish the path: the painted stroke becomes one undo step (Enter / double-click). */
  finishPath() {
    this.pathFinishCount++;
    const n = this.path.pane === '3d' ? this.path.p3.length : this.path.p2.length;
    if (n >= 2) {
      if (!this.pathLiveOn) {
        if (!this.canPaint()) return;
        this.pathLiveOn = true;
      } else this.ts.restartStroke();
      this.stampPath();
      this.ts.endStroke();
      this.pathLiveOn = false;
      this.modified = true;
      toast('Path painted (Ctrl+Z to undo)');
    } else if (this.pathLiveOn) { this.ts.cancelStroke(); this.pathLiveOn = false; }
    this.path = { pane: '3d', p3: [], p2: [] };
    this.pathSel = -1;
    this.updatePathOverlay();
  }
  applyPath() { this.finishPath(); }

  /** Path tool mouse down in the 3D view. Returns true when it handled the click. */
  private pathDown3(x: number, y: number, ctrl: boolean): boolean {
    const P = this.path.p3;
    const near = (p: THREE.Vector3) => { const s = this.toScreen(p); return s ? Math.hypot(s.x - x, s.y - y) : Infinity; };
    // Handles of the selected / handled points first, then points.
    let best: { kind: 'point' | 'hout' | 'hin'; idx: number; d: number } | null = null;
    if (this.path.pane === '3d') P.forEach((pt, i) => {
      const dp = near(pt.p);
      if (dp < 9 && (!best || dp < best.d)) best = { kind: 'point', idx: i, d: dp };
      if (pt.h || i === this.pathSel) {
        const h = this.handle3(i);
        if (h.lengthSq() > 1e-12) {
          const a = near(pt.p.clone().add(h)), b = near(pt.p.clone().sub(h));
          if (a < 8 && (!best || a < best.d)) best = { kind: 'hout', idx: i, d: a };
          if (b < 8 && (!best || b < best.d)) best = { kind: 'hin', idx: i, d: b };
        }
      }
    });
    const b = best as { kind: 'point' | 'hout' | 'hin'; idx: number; d: number } | null;
    if (b) {
      this.pathSel = b.idx;
      if (ctrl && b.kind === 'point') { P[b.idx].h = null; this.pathChanged(); return true; }
      this.pathDrag = { kind: b.kind, idx: b.idx, x, y, moved: false };
      this.updatePathOverlay();
      return true;
    }
    const hit = this.pick(x, y);
    if (!hit) return false;
    this.addPathPoint3(hit);
    this.pathDrag = { kind: 'new', idx: this.path.p3.length - 1, x, y, moved: false };
    return true;
  }

  private pathMove3(x: number, y: number) {
    const d = this.pathDrag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
    d.moved = true;
    const pt = this.path.p3[d.idx];
    if (!pt) return;
    if (d.kind === 'point') {
      const hit = this.pick(x, y);
      if (hit) { pt.p.copy(hit.point); pt.n.copy(hit.normal); }
    } else {
      // Handles live in the surface's tangent plane at the point.
      const ray = this.vp.rayAt(x, y);
      if (!ray) return;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(pt.n, pt.p);
      const q = ray.intersectPlane(plane, new THREE.Vector3());
      if (!q) return;
      const v = q.sub(pt.p);
      pt.h = d.kind === 'hin' ? v.negate() : v;
    }
    this.pathChanged();
  }

  private pathUp() { this.pathDrag = null; }

  /** Delete the selected point (Delete / Backspace). */
  private deletePathPoint() {
    const list = this.path.pane === '3d' ? this.path.p3 : this.path.p2;
    if (!list.length) return;
    const i = this.pathSel >= 0 && this.pathSel < list.length ? this.pathSel : list.length - 1;
    list.splice(i, 1);
    this.pathSel = Math.min(i, list.length - 1);
    this.pathChanged();
  }

  /** Nearest point on the model (for path samples between clicked points). */
  private snapToSurface(p: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    let best: any = null, bestG: THREE.BufferGeometry | null = null;
    for (const g of this.ts.geometries) {
      const hit = (g as any).boundsTree?.closestPointToPoint(p, {});
      if (hit && (!best || hit.distance < best.distance)) { best = { ...hit, point: hit.point.clone() }; bestG = g; }
    }
    if (!best || !bestG) return null;
    const idx = bestG.index, pos = bestG.attributes.position, nrm = bestG.attributes.normal;
    const f = best.faceIndex;
    const ia = idx ? idx.getX(f * 3) : f * 3, ib = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, ic = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
    const a = new THREE.Vector3().fromBufferAttribute(pos, ia), b = new THREE.Vector3().fromBufferAttribute(pos, ib), c = new THREE.Vector3().fromBufferAttribute(pos, ic);
    const bc = new THREE.Triangle(a, b, c).getBarycoord(best.point, new THREE.Vector3()) ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
    const n = new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, ia), bc.x)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, ib), bc.y)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, ic), bc.z).normalize();
    return { point: best.point, normal: n };
  }

  continueStroke(x: number, y: number) {
    const st = this.stroke;
    if (!st) return;
    this.ts.viewPos.copy(this.vp.camera.position);
    const hit = this.pick(x, y);
    if (!hit) { st.x = x; st.y = y; return; }
    const step = Math.max(this.brush.spacing * this.brush.radius, 1e-4);
    const dist = hit.point.distanceTo(st.hit.point);
    if (dist < step) return;
    const n = Math.min(Math.floor(dist / step), 96);
    let last: Hit | null = null;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const h = i === n ? hit : this.pick(st.x + (x - st.x) * t, st.y + (y - st.y) * t);
      if (h) { this.ts.stamp(h.point, h.normal, h.uv); last = h; }
    }
    if (last) { st.hit = last; st.x = x; st.y = y; }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const k = e.key.toLowerCase();
    // Ctrl+Z / Ctrl+Y in a number field (opacity…) is the app's undo, not the field's.
    if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'number' && (e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
      e.preventDefault(); (t as HTMLInputElement).blur();
      if (k === 'y' || e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (t && (t.tagName === 'INPUT' && ['text', 'search', 'number'].includes((t as HTMLInputElement).type))) return;
    if (this.pie && e.key === 'Escape') { e.preventDefault(); this.closePie(); return; }
    if (this.pj && !e.ctrlKey && !e.metaKey && !e.altKey && (k === 'w' || k === 'e' || k === 'r')) {
      e.preventDefault();
      this.pj.tc.setMode(k === 'w' ? 'translate' : k === 'e' ? 'rotate' : 'scale');
      this.buildToolbar();
      return;
    }
    if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat && !this.pie) this.openPie();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'g' && this.mode === 'paint') { e.preventDefault(); this.groupLayers(this.selection()); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && this.mode === 'paint') { e.preventDefault(); this.duplicateLayers(this.selection()); return; }
    // Layer clipboard (Substance's shortcuts). Ctrl+C with text selected in a panel copies the text as usual.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && this.mode === 'paint' && ['c', 'x', 'v', 'm'].includes(k) && !window.getSelection()?.toString()) {
      e.preventDefault();
      const act = this.ts.activeLayer;
      if (e.altKey) { if (k === 'c' && act) this.copyMask(act); else if (k === 'v') this.pasteMask(this.selection()); return; }
      if (k === 'c') this.copyLayers(this.selection());
      else if (k === 'x') this.cutLayers(this.selection());
      else if (k === 'v') this.pasteLayers();
      else this.flattenLayers(this.selection());
      return;
    }
    if (k === 'delete' && this.mode === 'paint' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.deleteLayers(this.selection()); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.saveProject(e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); this.openProjectDialog(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'i') { e.preventDefault(); this.importDialog(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'e') { e.preventDefault(); this.openExport(); return; }
    if (k === 'f1') { e.preventDefault(); this.toggleGuide(); return; }
    if (k === 'f4' && !e.altKey) { e.preventDefault(); this.setLayout('split'); return; }
    if (k === 'f2') { e.preventDefault(); this.setLayout('3d'); return; }
    if (k === 'f3') { e.preventDefault(); this.setLayout('2d'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === '[' || k === ']') {
      const size = this.brush.radius * 200;
      const ns = k === ']' ? Math.min(100, size * 1.15 + 0.5) : Math.max(1, size / 1.15 - 0.5);
      this.setBrush('radius', ns / 200);
    } else if (k === '{' || k === '}') {
      this.setBrush('hardness', Math.min(1, Math.max(0, this.brush.hardness + (k === '}' ? 0.1 : -0.1))));
    } else if (k === 'e') this.setTool(this.tool === 'erase' ? 'paint' : 'erase');
    else if (k === 'b') this.setTool('paint');
    else if (k === 'u' && !e.ctrlKey && !e.metaKey) this.setTool('smudge');
    else if (k === 'c' && !e.ctrlKey && !e.metaKey) this.setTool('clone');
    else if (k === 'r' && !e.ctrlKey && !e.metaKey) this.setTool('blur');
    else if (k === 'p') { if (this.tool === 'picker') { this.setTool(this.pickReturn ?? 'paint'); this.pickReturn = null; } else { this.pickReturn = this.tool === 'erase' || this.tool === 'path' || this.tool === 'fill' ? this.tool : 'paint'; this.setTool('picker'); } }
    else if (k === 'g') this.setTool('fill');
    else if (k === 'l') this.setTool('path');
    else if (k === 'h' && !e.ctrlKey && !e.metaKey) this.toggleHistory();
    else if (k === 'x' && !e.ctrlKey && !e.metaKey) {
      const sym = (this.brush.symmetry ??= { x: false, y: false, z: false });
      sym.x = !sym.x; this.updateMirrorLines(); this.buildToolbar(); if (this.mode === 'paint') this.buildProperties();
      toast(`X symmetry ${sym.x ? 'on' : 'off'}`);
    }
    else if (k === 'enter' && this.tool === 'path') this.finishPath();
    else if ((k === 'backspace' || k === 'delete') && this.tool === 'path') this.deletePathPoint();
    else if (k === 'f') { if (this.uvHover) this.uv.frame(); else this.vp.frame(); }
    else if (k === 'w') { this.uv.setWire(!this.uv.showWire); this.buildToolbar(); }
    else if (k === 'o') this.toggleOverlap();
    else if (k === 'escape') {
      if (this.guideOpen) this.closeGuide();
      else if (this.shapeMove) { this.shapeMove = null; document.body.classList.remove('moving-shape'); this.showGizmo(false); this.closeProjGizmo(); this.buildToolbar(); this.buildProperties(); }
      else if (this.tool === 'path' && (this.path.p3.length || this.path.p2.length)) this.clearPath();
      else if (this.flyout.classList.contains('open')) this.flyout.classList.remove('open');
      else if (this.mode === 'bake') this.setMode('paint');
    }
    else if (k === 'm') { if (this.ts.activeLayer?.mask) this.setPaintTarget(this.paintTarget === 'mask' ? 'content' : 'mask'); }
    else if ('1234567890'.includes(k)) {
      const i = k === '0' ? 9 : +k - 1;
      if (VIEWS[i]) this.setView(VIEWS[i].v);
    }
  }

  // ================================================================ loop

  /** Render on demand: keep drawing while something happens, then idle (1 frame a second). */
  private activeUntil = 0;
  private lastRender = 0;
  poke(ms = 500) { this.activeUntil = Math.max(this.activeUntil, performance.now() + ms); }
  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const othersBusy = this.sets.length > 1 && this.sets.some((st) => st.ts !== this.ts && st.ts.busy);
    if (!this.ts.busy && !othersBusy && !this.ts.baking && now > this.activeUntil && now - this.lastRender < 1000) return;
    this.lastRender = now;
    this.ts.flushStroke();
    this.ts.compositeDirty();
    // The other texture sets show on the model too, so they need their layers drawn as well (not just the selected one).
    if (this.sets.length > 1) for (const st of this.sets) if (st.ts !== this.ts) st.ts.compositeDirty();
    let hit: Hit | null = null;
    if (this.hover && this.mode === 'paint' && !(this.vp.controls.enabled && this.isDraggingCamera())) {
      hit = this.pick(this.hover.x, this.hover.y);
    }
    const brushCursor = BRUSH_TOOLS.includes(this.tool);
    this.vp.showCursor(brushCursor || this.tool === 'path' ? hit : null, this.tool === 'path' ? this.brush.radius * 0.5 : this.brush.radius);
    if (this.box) { /* box selection draws its own highlight */ }
    else if (this.tool === 'fill' && !this.dragItem && this.mode === 'paint') {
      let part = this.partAt(hit, this.fillMode);
      if (!part && this.uvHover && this.layout3 !== '3d') {
        const k = `${this.fillMode}:${this.uvHover.x.toFixed(4)},${this.uvHover.y.toFixed(4)}`;
        if (k !== this.uvHoverKey) { this.uvHoverKey = k; this.uvHoverPart = this.partAtUV(this.uvHover); }
        part = this.uvHoverPart;
      } else this.uvHoverKey = '';
      if (part) { this.vp.setHighlight(part.key, () => this.parts.highlightGeometry(part!)); if (this.uvSelKey !== part.key) { this.uvSelKey = part.key; this.uv.setSelection(this.parts.highlightMany([part], true)); } }
      else { this.vp.setHighlight('', null); if (this.uvSelKey) { this.uvSelKey = ''; this.uv.setSelection(null); } }
    } else if (!this.dragItem) { this.vp.setHighlight('', null); if (this.uvSelKey) { this.uvSelKey = ''; this.uv.setSelection(null); } }
    this.vp.render();
    if (this.layout3 !== '3d') {
      if (this.mode === 'paint' && brushCursor && this.uvHover && !this.uvPan) this.uv.setCursor({ kind: 'uv', uv: this.uvHover, radius: this.radiusUV });
      else if (hit && brushCursor) this.uv.setCursor({ kind: 'sphere', center: hit.point, radius: this.brush.radius });
      else this.uv.setCursor(null);
      this.uv.updateCamera();
      this.vp.renderRegion(this.uv.scene, this.uv.camera, this.uv.region);
    }
  };
  private isDraggingCamera() { return (this.vp.controls as any).state !== undefined && (this.vp.controls as any).state !== -1; }

  // ================================================================ tools + brush

  setTool(t: Tool) {
    this.tool = t;
    this.brush.erase = t === 'erase';
    this.vp.canvas.style.cursor = t === 'picker' || t === 'fill' || t === 'path' ? 'crosshair' : '';
    if (t !== 'picker') this.pickPreview.style.display = 'none';
    this.updateMirrorLines?.();
    if (t !== 'path' && (this.path.p3.length || this.path.p2.length)) this.finishPath();
    this.buildToolstrip();
    this.buildToolbar();
    this.buildProperties();
  }

  setPaintTarget(t: PaintTarget) {
    this.paintTarget = t;
    if (t === 'mask') toast('Painting the mask: Paint = white (show), Erase = black (hide). M switches back.');
    this.refresh();
  }

  private setBrush(key: 'radius' | 'flow' | 'hardness' | 'spacing' | 'opacity', v: number) {
    this.brush[key] = v;
    const live = (this.brushSync.get(key) ?? []).filter((x) => x.el.isConnected);
    this.brushSync.set(key, live);
    for (const x of live) x.set(key === 'radius' ? Math.round(v * 200) : v);
    this.drawBrushPreview();
  }

  /** X / Y / Z mirror-painting toggles (shortcut: X toggles X symmetry, like Substance). */
  /** Show where the mirror planes cut the model (red lines) while a painting tool with symmetry is active. */
  updateMirrorLines() {
    const sym = this.brush.symmetry;
    const show = this.mode === 'paint' && !!sym && (sym.x || sym.y || sym.z) && (this.tool === 'paint' || this.tool === 'erase' || this.tool === 'path');
    if (!show) { this.vp.setMirrorLines(null); return; }
    const c = this.ts.symmetryCenter(this.brush);
    const parts: Float32Array[] = [];
    for (const a of ['x', 'y', 'z'] as const) if (sym![a]) parts.push(this.ts.mirrorLines(a, c[a]));
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    this.vp.setMirrorLines(all);
    this.poke();
  }

  /** Mirror plane position sliders (one per active axis). */
  private symmetryOffsets(): HTMLElement[] {
    const sym = this.brush.symmetry;
    if (!sym || !(sym.x || sym.y || sym.z)) return [];
    const off = (this.brush.symOffset ??= { x: 0, y: 0, z: 0 });
    const out: HTMLElement[] = [];
    for (const a of ['x', 'y', 'z'] as const) {
      if (!sym[a]) continue;
      out.push(slider(`${a.toUpperCase()} position`, { min: -1, max: 1, step: 0.005, value: off[a], fmt: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { off[a] = v; this.updateMirrorLines(); } }).el);
    }
    out.push(el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => { off.x = off.y = off.z = 0; this.updateMirrorLines(); this.buildProperties(); } }, 'Centre the mirror planes')));
    return out;
  }

  private symmetryButtons(): HTMLElement {
    const sym = (this.brush.symmetry ??= { x: false, y: false, z: false });
    const box = el('div', { class: 'seg sym-seg', title: 'Mirror painting across the model (red line = mirror plane; move it in Properties → Brush)' });
    for (const a of ['x', 'y', 'z'] as const) {
      const b = el('button', { class: sym[a] ? 'on' : '', onclick: () => { sym[a] = !sym[a]; this.updateMirrorLines(); this.buildToolbar(); if (this.mode === 'paint') this.buildProperties(); } }, a.toUpperCase());
      box.append(b);
    }
    return el('span', { class: 'inline sym-wrap' }, el('span', { class: 'tb-note' }, 'Sym'), box);
  }

  private brushSlider(label: string, key: 'radius' | 'flow' | 'hardness' | 'spacing' | 'opacity', inline = false) {
    const conf = {
      opacity: { min: 0.01, max: 1, step: 0.01, value: this.brush.opacity ?? 1, fmt: (v: number) => Math.round(v * 100).toString() },
      radius: { min: 1, max: 100, step: 1, value: Math.round(this.brush.radius * 200), fmt: (v: number) => v.toFixed(0) },
      flow: { min: 0.01, max: 1, step: 0.01, value: this.brush.flow, fmt: (v: number) => Math.round(v * 100).toString() },
      hardness: { min: 0, max: 1, step: 0.01, value: this.brush.hardness, fmt: (v: number) => Math.round(v * 100).toString() },
      spacing: { min: 0.03, max: 3, step: 0.01, value: this.brush.spacing, fmt: (v: number) => Math.round(v * 100).toString() },
    }[key];
    const s = slider(label, { ...conf, onInput: (v) => this.setBrush(key, key === 'radius' ? v / 200 : v) });
    if (!this.brushSync.has(key)) this.brushSync.set(key, []);
    this.brushSync.get(key)!.push({ el: s.el, set: s.set });
    if (inline) s.el.classList.add('inline-slider');
    return s.el;
  }

  /** Lazy mouse (Substance calls it "Lazy mouse"; Photoshop "Smoothing"). */
  private smoothingSlider(inline = false) {
    const s = slider('Smoothing', { min: 0, max: 1, step: 0.01, value: this.brush.smoothing ?? 0, fmt: (v) => v ? Math.round(v * 100).toString() : 'off',
      onInput: (v) => { this.brush.smoothing = v; for (const o of this.brushSync.get('smoothing' as any) ?? []) if (o.el !== s.el) o.set(v); } });
    s.el.title = 'Lazy mouse: the brush trails the cursor on a string, so lines come out smooth and steady';
    if (!this.brushSync.has('smoothing' as any)) this.brushSync.set('smoothing' as any, []);
    this.brushSync.get('smoothing' as any)!.push({ el: s.el, set: s.set });
    if (inline) s.el.classList.add('inline-slider');
    return s.el;
  }
  private pressureRow() {
    const tog = (key: 'pressureSize' | 'pressureFlow', label: string) => el('button', { class: this.brush[key] ? 'on' : '', title: `Pen pressure changes the ${label.toLowerCase()} (graphics tablets; a mouse is always full pressure)`,
      onclick: () => { this.brush[key] = !this.brush[key]; this.buildProperties(); } }, label);
    return el('div', { class: 'row' }, el('label', {}, 'Pen pressure'), el('div', { class: 'seg' }, tog('pressureSize', 'Size'), tog('pressureFlow', 'Flow')));
  }

  // ---------------------------------------------------------------- brush tips and presets

  private registerTip(id: string, cv: HTMLCanvasElement, png?: string) {
    this.tipCanvases.set(id, cv);
    this.tipUrls.delete(id);
    if (png) this.tipPng.set(id, png);
    this.ts.setTip(id, tipTexture(cv));
  }

  /** Make sure the brush's tip is loaded into the current texture set (falls back to round). */
  private ensureTip() {
    const t = this.brush.tip ?? 'round';
    if (t === 'round' || t === 'square' || this.ts.hasTip(t)) return;
    let cv = this.tipCanvases.get(t);
    if (!cv && t.startsWith('builtin:')) cv = builtinTip(t.slice(8));
    if (cv) this.registerTip(t, cv);
    else this.brush.tip = 'round';
  }

  private async brushTipCanvas(it: Extract<ShelfItem, { kind: 'brush' }>): Promise<HTMLCanvasElement> {
    const t = it.brush.tip;
    if (t.startsWith('builtin:')) return this.tipCanvases.get(t) ?? builtinTipThumb(t.slice(8), 96);
    if (t === 'image') return imageTip(it.tipFile ?? it.brush.tipPng!);
    return tipPreview(t);
  }

  /** Set the brush tip: 'round', 'square', 'builtin:<id>' or a picture. */
  async setTip(tip: string, image?: Blob | string, name = 'custom') {
    let id = tip;
    if (tip === 'image' && image) {
      const cv = await imageTip(image);
      id = 'img:' + name;
      this.registerTip(id, cv, cv.toDataURL());
    } else if (tip.startsWith('builtin:') && !this.tipCanvases.has(tip)) this.registerTip(tip, builtinTip(tip.slice(8)));
    this.brush.tip = id;
    this.ensureTip();
  }

  async applyBrushPreset(bp: BrushPreset, tipFile?: File) {
    try {
      await this.setTip(bp.tip, tipFile ?? bp.tipPng, bp.name);
    } catch (e: any) { toast('Could not load that brush tip: ' + (e?.message ?? e), true); return; }
    const d: BrushSettings = { radius: this.brush.radius, hardness: 0.5, flow: 1, spacing: 0.12, angle: 0, angleJitter: 0, followStroke: false, sizeJitter: 0, scatter: 0, flowJitter: 0, hueJitter: 0, satJitter: 0, valJitter: 0, opacity: 1 };
    Object.assign(this.brush, d, bp.settings);
    if (!BRUSH_TOOLS.includes(this.tool)) this.setTool('paint');
    this.buildToolbar();
    this.buildProperties();
    toast(`Brush: ${bp.name}`);
  }

  private async importTip() {
    const f = await pickFile('.png,.jpg,.jpeg,.webp');
    if (!f) return;
    try {
      await this.setTip('image', f, f.name.replace(/\.[^.]+$/, ''));
      if (!BRUSH_TOOLS.includes(this.tool)) this.setTool('paint');
      this.buildProperties();
      toast(`Brush tip: ${f.name} (white / opaque = paint)`);
    } catch (e: any) { toast(e?.message ?? 'Could not read that image', true); }
  }

  private async saveBrushPreset() {
    const name = await this.askText('Save brush preset', 'Name for the new brush preset:', 'My brush');
    if (!name) return;
    const b = this.brush;
    const t = b.tip ?? 'round';
    const bp: BrushPreset = {
      format: 'texpaint-brush', version: 1, name,
      tip: t.startsWith('img:') ? 'image' : t, tipPng: t.startsWith('img:') ? this.tipPng.get(t) : undefined,
      settings: { radius: b.radius, hardness: b.hardness, flow: b.flow, spacing: b.spacing, angle: b.angle ?? 0, angleJitter: b.angleJitter ?? 0, followStroke: !!b.followStroke, sizeJitter: b.sizeJitter ?? 0, scatter: b.scatter ?? 0,
        flowJitter: b.flowJitter ?? 0, hueJitter: b.hueJitter ?? 0, satJitter: b.satJitter ?? 0, valJitter: b.valJitter ?? 0, opacity: b.opacity ?? 1 },
    };
    try {
      const msg = await this.shelf.saveJSON(`${name.replace(/[^\w\- ]+/g, '_').trim() || 'brush'}.tpbrush`, bp);
      toast(msg);
      this.buildShelf();
    } catch (e: any) { toast('Could not save the brush: ' + e?.message, true); }
  }

  /** Brush tip picker + dynamics (Properties → Brush). */
  private brushTipProps(): HTMLElement[] {
    const b = this.brush;
    const cur = b.tip ?? 'round';
    const tips: [string, string][] = [['round', 'Round'], ['square', 'Square'], ...BUILTIN_TIPS.map((t): [string, string] => ['builtin:' + t.id, t.label])];
    if (cur.startsWith('img:')) tips.push([cur, cur.slice(4)]);
    const row = el('div', { class: 'tip-row' });
    for (const [id, label] of tips) {
      const key = id === 'round' || id === 'square' ? `${id}:${b.hardness.toFixed(2)}` : id;
      let url = this.tipUrls.get(key);
      if (!url) {
        let cv = id === 'round' || id === 'square' ? tipPreview(id, undefined, b.hardness) : this.tipCanvases.get(id);
        if (!cv && id.startsWith('builtin:')) cv = builtinTipThumb(id.slice(8));
        url = cv!.toDataURL();
        this.tipUrls.set(key, url);
      }
      const img = el('img', { src: url, alt: label }) as HTMLImageElement;
      row.append(el('button', { class: 'tip-btn' + (cur === id ? ' on' : ''), title: label, onclick: async () => { await this.setTip(id); this.buildProperties(); } }, img));
    }
    const num = (label: string, key: 'angle' | 'angleJitter' | 'sizeJitter' | 'scatter' | 'flowJitter' | 'hueJitter' | 'satJitter' | 'valJitter', min: number, max: number, step: number, fmt: (v: number) => string) =>
      slider(label, { min, max, step, value: (b[key] as number) ?? 0, fmt, onInput: (v) => { b[key] = v; this.drawBrushPreview(); } }).el;
    const follow = el('input', { type: 'checkbox', checked: !!b.followStroke }) as HTMLInputElement;
    follow.addEventListener('change', () => { b.followStroke = follow.checked; this.drawBrushPreview(); });
    const shaped = cur !== 'round';
    return [
      row,
      el('div', { class: 'row' },
        el('button', { class: 'grow', onclick: () => this.importTip(), title: 'Any picture: white (or opaque) parts paint. Also: put PNGs in a "brushes" folder inside your presets folder.' }, 'Import tip…'),
        el('button', { class: 'grow', onclick: () => this.saveBrushPreset(), title: 'Save size, flow, tip and dynamics as a .tpbrush preset' }, 'Save brush…')),
      el('div', { class: 'group-sub' + (shaped ? '' : ' dim') },
        num('Angle', 'angle', 0, 360, 1, (v) => `${v.toFixed(0)}°`),
        el('label', { class: 'check-row' }, follow, ' Follow stroke direction'),
      ),
      num('Angle jitter', 'angleJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      num('Size jitter', 'sizeJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      num('Scatter', 'scatter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      num('Flow jitter', 'flowJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      el('h5', {}, 'Colour variation (per stroke)'),
      num('Hue', 'hueJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      num('Saturation', 'satJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      num('Value', 'valJitter', 0, 1, 0.01, (v) => Math.round(v * 100).toString()),
      el('p', { class: 'note' }, 'Every stroke picks a slightly different colour around the brush colour — handy for hand-painted looks, freckles, rust or leaves.'),
    ];
  }

  /** Little stroke drawing with the current size / hardness / flow. */
  private drawBrushPreview() {
    const c = this.brushPreview;
    if (!c || !c.isConnected) return;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const r = 4 + Math.min(1, this.brush.radius * 6) * 20;
    const hard = this.brush.hardness;
    const step = Math.max(1, this.brush.spacing * r);
    ctx.globalCompositeOperation = 'lighter';
    const path = (t: number) => [W * (0.14 + 0.72 * t), H * (0.5 + 0.28 * Math.sin(t * Math.PI * 2.6))];
    let prev = path(0), acc = 0;
    for (let t = 0; t <= 1; t += 0.002) {
      const p = path(t);
      acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      if (acc < step) continue;
      acc = 0;
      const b = this.brush;
      const tipC = b.tip && b.tip !== 'round' ? (b.tip === 'square' ? tipPreview('square') : this.tipCanvases.get(b.tip)) : null;
      const rr = r * (b.sizeJitter ? 1 - b.sizeJitter * Math.random() * 0.9 : 1);
      const sc = (b.scatter ?? 0) * rr;
      const px = p[0] + (Math.random() * 2 - 1) * sc, py = p[1] + (Math.random() * 2 - 1) * sc;
      if (tipC) {
        const dir = Math.atan2(Math.cos(t * Math.PI * 2.6) * 0.28 * 2.6 * Math.PI * H, 0.72 * W);
        let ang = ((b.angle ?? 0) * Math.PI) / 180 + (b.followStroke ? dir : 0) + (b.angleJitter ? (Math.random() * 2 - 1) * Math.PI * b.angleJitter : 0);
        ctx.save(); ctx.translate(px, py); ctx.rotate(-ang); ang = 0;
        ctx.globalAlpha = 0.85 * b.flow;
        ctx.drawImage(tipC, -rr, -rr, rr * 2, rr * 2);
        ctx.restore();
        continue;
      }
      const g = ctx.createRadialGradient(px, py, rr * hard * 0.98, px, py, rr);
      const a = 0.25 * this.brush.flow;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private async updateMatPreview() {
    if (!this.matPreview) return;
    const b = this.brush;
    const key = 'brush:' + JSON.stringify([b.values, b.channels]);
    const img = this.matPreview;
    const url = await this.thumbs.material(key, b.values, b.channels);
    if (img.isConnected) img.src = url;
  }

  // ================================================================ build: menus, strips, toolbar

  private buildAll() {
    this.buildToolstrip();
    this.buildToolbar();
    this.buildShelf();
    this.buildRight();
    this.buildModeTabs();
    this.buildStatus();
    this.buildPaneSelects();
  }

  private buildMenus() {
    const host = document.getElementById('menus')!;
    host.innerHTML = '';
    type Item = [string, () => void, string?] | '-';
    const menu = (name: string, items: () => Item[]) => {
      const m = el('div', { class: 'menu' });
      const list = el('div', { class: 'menu-items' });
      const btn = el('button', { class: 'menu-btn', onclick: (e: Event) => {
        e.stopPropagation();
        const open = m.classList.contains('open');
        document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
        if (!open) {
          list.innerHTML = '';
          for (const it of items()) {
            if (it === '-') { list.append(el('hr')); continue; }
            list.append(el('button', { onclick: () => { m.classList.remove('open'); it[1](); } },
              el('span', {}, it[0]), it[2] ? el('span', { class: 'kbd' }, it[2]) : null));
          }
          m.classList.add('open');
        }
      } }, name);
      btn.addEventListener('mouseenter', () => { if (document.querySelector('.menu.open') && !m.classList.contains('open')) btn.click(); });
      m.append(btn, list);
      return m;
    };
    host.append(
      menu('File', () => [
        ['Open model…', async () => { const f = await pickFile('.glb,.gltf,.fbx,.obj'); if (f) this.openModelFile(f); }],
        ['Reimport mesh…', () => this.reimportMesh()],
        '-',
        ['Open project…', () => this.openProjectDialog(), 'Ctrl+O'],
        ...(this.native ? [['Recent & autosaves…', () => this.openWindow('recent')] as Item] : []),
        ['Save', () => this.saveProject(false), 'Ctrl+S'],
        ['Save as…', () => this.saveProject(true), 'Ctrl+Shift+S'],
        ['Import…', () => this.importDialog(), 'Ctrl+I'],
        '-',
        ['Export textures…', () => this.openExport(), 'Ctrl+Shift+E'],
        ['Export mesh…', () => this.exportMeshDialog()],
        '-',
        ['Settings…', () => this.openSettings()],
        ['Check for updates…', () => this.checkForUpdates(true)],
      ]),
      menu('Edit', () => [
        ['Undo', () => this.undo(), 'Ctrl+Z'],
        ['Redo', () => this.redo(), 'Ctrl+Y'],
      ]),
      menu('Mode', () => [
        ['Painting', () => this.setMode('paint')],
        ['Baking', () => this.setMode('bake')],
        ['Material Designer (node graphs, Shader Maker)', () => this.setMode('design')],
      ]),
      menu('Viewport', () => [
        ['3D / 2D', () => this.setLayout('split'), 'F4'],
        ['3D only', () => this.setLayout('3d'), 'F2'],
        ['2D only', () => this.setLayout('2d'), 'F3'],
        '-',
        ['Frame model', () => this.vp.frame(), 'F'],
        ['Fit texture in 2D view', () => this.uv.frame()],
        ['UV wireframe on/off', () => { this.uv.setWire(!this.uv.showWire); this.buildToolbar(); }, 'W'],
        ['UV overlaps on/off', () => this.toggleOverlap(), 'O'],
        '-',
        ['Display settings…', () => this.toggleFlyout()],
      ]),
    );
    host.append(el('button', { id: 'guide-btn', class: 'guide-top' + (this.guideOpen ? ' on' : ''), title: 'Guide (F1): how-tos with search, Getting started, What\'s new',
      onclick: (e: Event) => { e.stopPropagation(); this.toggleGuide(); } }, el('span', { class: 'q' }, '?'), 'Guide'));
  }

  private showShortcuts() {
    const dlg = document.getElementById('export-dialog') as HTMLDialogElement;
    dlg.innerHTML = '';
    dlg.className = '';
    const rows: [string, string][] = [
      ['Paint / Erase / Picker', 'B / E / P'], ['Smudge / Clone / Blur', 'U / C / R'], ['Clone source', 'Hold V + click'], ['Brush size / hardness', '[ ]  /  { }'],
      ['Orbit / Pan / Zoom', 'RMB or Alt+LMB / MMB / Wheel'], ['Move the light (sun)', 'Shift + right-drag'], ['Frame model (or 2D view)', 'F'],
      ['Guide', 'F1'], ['Layouts 3D / 2D / 3D+2D', 'F2 / F3 / F4'], ['History panel', 'H'], ['Straight line', 'Shift+click'], ['Path tool / polygon fill', 'L / G'], ['X symmetry', 'X'], ['Views (both panes)', '1 – 9, 0'], ['Camera views (front, top, left…)', 'Hold ~'],
      ['Paint the layer mask', 'M'], ['UV wireframe', 'W'], ['UV overlaps (dark spots)', 'O'], ['Brush size', 'Ctrl + scroll'], ['Brush hardness', 'Ctrl + right-drag'], ['Stroke opacity', 'Ctrl + Shift + scroll'], ['Brush flow / rotation', 'Ctrl + left-drag ←→ / ↑↓'], ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Cut / copy / paste layers', 'Ctrl+X / Ctrl+C / Ctrl+V'], ['Copy / paste mask', 'Ctrl+Alt+C / Ctrl+Alt+V'], ['Flatten layer or folder', 'Ctrl+M'], ['Select several layers / assets', 'Ctrl+click · Shift+click'], ['Group / duplicate / delete selected layers', 'Ctrl+G / Ctrl+D / Delete'],
      ['Save / Save as / Open / Import', 'Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+I'], ['Export textures', 'Ctrl+Shift+E'], ['Projection: move / rotate / scale', 'W / E / R (while editing a projection)'], ['Snap while dragging the manipulator', 'Shift'], ['Leave Baking mode / close panel', 'Esc'],
    ];
    dlg.append(el('header', {}, 'Keyboard shortcuts'),
      el('div', { class: 'body' }, ...rows.map(([a, b]) => el('div', { class: 'row' }, el('label', { style: { flexBasis: '220px' } }, a), el('span', { class: 'kbd' }, b)))),
      el('footer', {}, el('button', { class: 'primary', onclick: () => dlg.close() }, 'Close')));
    dlg.showModal();
  }

  private buildModeTabs() {
    const host = document.getElementById('mode-tabs')!;
    host.innerHTML = '';
    const tab = (m: Mode, label: string) => el('button', { class: this.mode === m ? 'on' : '', onclick: () => this.setMode(m) }, label);
    host.append(tab('paint', 'Painting'), tab('bake', 'Baking'), tab('design', 'Material Designer'));
  }

  private buildToolstrip() {
    const host = document.getElementById('toolstrip')!;
    host.innerHTML = '';
    const t = (tool: Tool, svg: string, title: string) => icon(svg, title, () => this.setTool(tool), this.tool === tool ? 'on' : '');
    const layer = this.ts?.activeLayer;
    const maskBtn = icon(I.mask, layer?.mask ? 'Paint the layer mask (M)' : 'Select a layer with a mask to paint it',
      () => { if (layer?.mask) this.setPaintTarget(this.paintTarget === 'mask' ? 'content' : 'mask'); },
      this.paintTarget === 'mask' ? 'on' : '');
    if (!layer?.mask) maskBtn.disabled = true;
    host.append(
      t('paint', I.paint, 'Paint (B) — Shift+click draws a straight line'), t('erase', I.erase, 'Eraser (E)'),
      t('smudge', I.smudge, 'Smudge (U) — drags the paint along with the brush, like a finger in wet paint'),
      t('clone', I.clone, 'Clone (C) — hold V and click to set where to copy from, then paint to copy it'),
      t('blur', I.blur, 'Blur (R) — softens the paint under the brush'),
      t('fill', I.polyfill, 'Polygon fill (G) — click a triangle / UV island / mesh part to fill it'),
      t('path', I.path, 'Path / bezier (L) — click to add points, click-drag to pull handles; the brush follows the curve live. Enter finishes'),
      t('picker', I.picker, 'Picker (P) — click the model to pick its material (or only its color) into the brush; P again goes back'),
      el('div', { class: 'strip-sep' }), maskBtn,
      el('div', { class: 'strip-sep' }),
      icon(I.history, 'History (H) — every recent change; click one to go back to it', () => this.toggleHistory(), this.historyOpen ? 'on' : ''),
    );
  }

  private buildSidestrip() {
    const host = document.getElementById('sidestrip')!;
    host.innerHTML = '';
    host.append(
      icon(I.export, 'Export textures (Ctrl+Shift+E)', () => this.openExport(), 'accent'),
      icon(I.tsSettings, 'Texture set settings', () => { this.layersTab = 'settings'; this.setMode('paint'); this.buildRight(); }),
      icon(I.display, 'Display settings (lighting, tone map)', () => this.toggleFlyout()),
      icon(I.bake, 'Bake mesh maps (Baking mode)', () => this.setMode(this.mode === 'bake' ? 'paint' : 'bake')),
      el('span', { class: 'grow' }),
      icon(I.help, 'Guide (F1)', () => this.toggleGuide()),
    );
  }

  /** Tool settings bar: settings scroll sideways when they don't fit; the view buttons on the right always stay visible. */
  private buildToolbar() {
    this.buildToolbarInner();
    const host = document.getElementById('toolbar')!;
    const right = host.querySelector(':scope > .tb-right');
    const scroll = el('div', { class: 'tb-scroll' });
    for (const c of [...host.children]) if (c !== right) scroll.append(c);
    host.prepend(scroll);
    scroll.addEventListener('wheel', (e) => {
      if (scroll.scrollWidth <= scroll.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      scroll.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  private buildToolbarInner() {
    const host = document.getElementById('toolbar')!;
    host.innerHTML = '';
    const right = el('div', { class: 'tb-right' },
      icon(I.split, '3D / 2D (F4)', () => this.setLayout('split'), this.layout3 === 'split' ? 'on' : ''),
      icon(I.cube, '3D only (F2)', () => this.setLayout('3d'), this.layout3 === '3d' ? 'on' : ''),
      icon(I.square, '2D only (F3)', () => this.setLayout('2d'), this.layout3 === '2d' ? 'on' : ''),
      el('div', { class: 'strip-sep v' }),
      icon(I.wire, 'UV wireframe in the 2D view (W)', () => { this.uv.setWire(!this.uv.showWire); this.buildToolbar(); }, this.uv.showWire ? 'on' : ''),
      (() => { const b = icon(I.overlap, 'UV overlaps (O): dark spots on the model and in the 2D view where UVs overlap', () => this.toggleOverlap(), this.showOverlap ? 'on' : '');
        if (this.uvOverlap?.tris) { b.classList.add('warn-dot'); b.title += ` · ${this.uvOverlap.areas} found`; } return b; })(),
      icon(I.frame, 'Frame model (F)', () => { this.vp.frame(); this.uv.frame(); }),
    );
    if (this.mode === 'design') {
      host.append(el('div', { class: 'tb-title' }, 'Material Designer'),
        el('span', { class: 'tb-note' }, 'Build a tileable material from nodes on the right; it drives a fill layer live on the model.'),
        el('button', { class: 'tb-back', onclick: () => this.setMode('paint') }, '← Back to painting'),
        right);
      return;
    }
    if (this.mode === 'bake') {
      host.append(el('div', { class: 'tb-title' }, 'Baking mode'),
        el('span', { class: 'tb-note' }, 'Pick the maps on the left, set up the high poly and cage, then click Bake selected textures.'),
        el('button', { class: 'tb-back', onclick: () => this.setMode('paint') }, '← Back to painting'),
        right);
      return;
    }
    if (this.shapeMove?.fill && this.pj) {
      const pj = this.pj;
      const mode = (m: 'translate' | 'rotate' | 'scale', label: string, key: string) => el('button', { class: pj.tc.mode === m ? 'on' : '', title: `${label} (${key})`, onclick: () => { pj.tc.setMode(m); this.buildToolbar(); } }, `${label} (${key})`);
      host.append(el('div', { class: 'tb-title' }, 'Projection'),
        el('div', { class: 'seg tb-seg' }, mode('translate', 'Move', 'W'), mode('rotate', 'Rotate', 'E'), mode('scale', 'Scale', 'R')),
        el('div', { class: 'seg tb-seg' },
          el('button', { class: pj.tc.space === 'local' ? 'on' : '', title: 'Axes follow the projection', onclick: () => { pj.tc.setSpace('local'); this.buildToolbar(); } }, 'Local'),
          el('button', { class: pj.tc.space === 'world' ? 'on' : '', title: 'Axes follow the scene', onclick: () => { pj.tc.setSpace('world'); this.buildToolbar(); } }, 'World')),
        el('button', { title: 'Back to facing the camera in the middle of the view, default size', onclick: () => this.resetProjection() }, 'Reset'),
        el('span', { class: 'tb-note' }, 'Shift snaps · drag on the model to stick it to the surface'),
        el('button', { class: 'primary', onclick: () => this.toggleShapeMove(this.shapeMove!.layer, this.shapeMove!.g, true) }, 'Done (Esc)'), right);
      return;
    }
    if (this.shapeMove) {
      host.append(el('div', { class: 'tb-title' }, 'Move shape'),
        el('span', { class: 'tb-note' }, `Drag on the 3D view to move the shape on “${this.shapeMove.layer.name}”. Size, stretch and rotation are in Properties.`),
        el('button', { class: 'primary', onclick: () => this.toggleShapeMove(this.shapeMove!.layer, this.shapeMove!.g) }, 'Done (Esc)'), right);
      return;
    }
    const title = { paint: 'Paint', erase: 'Eraser', picker: 'Material picker', fill: 'Polygon fill', path: 'Path' }[this.tool];
    host.append(el('div', { class: 'tb-title' }, title));
    if (this.tool === 'picker') {
      host.append(el('div', { class: 'seg tb-seg' },
        el('button', { class: this.pickMode === 'material' ? 'on' : '', title: 'Copy every channel (color, roughness, metallic, height, emissive)', onclick: () => { this.pickMode = 'material'; this.buildToolbar(); } }, 'Material'),
        el('button', { class: this.pickMode === 'color' ? 'on' : '', title: 'Copy only the base color', onclick: () => { this.pickMode = 'color'; this.buildToolbar(); } }, 'Color only')),
        el('span', { class: 'tb-note' }, 'Click the model (or the 2D view) to pick what\'s under the cursor into the brush. P switches to the picker and back.'));
    } else if (this.tool === 'fill') {
      const modes: PartMode[] = ['tri', 'island', 'part', 'object', 'material'];
      host.append(el('div', { class: 'seg tb-seg' }, ...modes.map((m) => el('button', { class: this.fillMode === m ? 'on' : '', onclick: () => { this.fillMode = m; this.buildToolbar(); } }, PART_LABEL[m]))),
        el('span', { class: 'tb-note' }, this.paintTarget === 'mask' ? 'Fills the mask: click = white (show), with Eraser on = black.' : 'Fills the paint layer with the brush material. Select a mask to fill the mask instead.'));
      if (this.paintTarget === 'mask') host.append(el('span', { class: 'tb-chip' }, 'Filling MASK'));
    } else if (this.tool === 'path') {
      const n = this.path.pane === '3d' ? this.path.p3.length : this.path.p2.length;
      const smooth = el('input', { type: 'checkbox', checked: this.pathSmooth }) as HTMLInputElement;
      smooth.addEventListener('change', () => { this.pathSmooth = smooth.checked; this.updatePathOverlay(); });
      const live = el('input', { type: 'checkbox', checked: this.pathLive }) as HTMLInputElement;
      live.addEventListener('change', () => { this.pathLive = live.checked; if (!this.pathLive && this.pathLiveOn) { this.ts.cancelStroke(); this.pathLiveOn = false; } else this.pathChanged(); });
      host.append(
        this.brushSlider('Size', 'radius', true),
        this.brushSlider('Flow', 'flow', true),
        this.brushSlider('Hardness', 'hardness', true),
        el('label', { class: 'inline', title: 'Automatic smooth handles on points you haven\'t pulled' }, smooth, ' Smooth'),
        el('label', { class: 'inline', title: 'The brush follows the path while you edit it' }, live, ' Live'),
        el('button', { class: 'primary', disabled: n < 2, onclick: () => this.finishPath() }, 'Finish (Enter)'),
        el('button', { disabled: !n, onclick: () => this.clearPath() }, 'Cancel (Esc)'),
        el('span', { class: 'tb-note' }, n
          ? `${n} point${n > 1 ? 's' : ''} · drag points or handles to edit · Ctrl+click a point resets its handles · Delete removes the selected point`
          : 'Click on the model to add points; click-drag to pull bezier handles'),
      );
      if (this.paintTarget === 'mask') host.append(el('span', { class: 'tb-chip' }, 'Painting MASK'));
    } else {
      host.append(
        this.brushSlider('Size', 'radius', true),
        this.brushSlider('Flow', 'flow', true),
        this.brushSlider('Stroke opacity', 'opacity', true),
        this.brushSlider('Hardness', 'hardness', true),
        this.smoothingSlider(true),
        this.symmetryButtons(),
      );
      if (this.paintTarget === 'mask') host.append(el('span', { class: 'tb-chip' }, 'Painting MASK'));
    }
    host.append(right);
  }

  private buildStatus() {
    const m = this.model;
    document.getElementById('status-model')!.textContent =
      `${m.name} · ${m.triangles.toLocaleString()} tris · ${this.ts.size}×${this.ts.size}`;
    document.getElementById('status-hints')!.textContent = this.mode === 'bake'
      ? 'Baking mode · RMB orbit · MMB pan · Wheel zoom · Esc back to painting'
      : 'LMB paint · RMB / Alt+LMB orbit · MMB pan · Wheel zoom · [ ] size · B/E/P tools · F2/F3/F4 layout · 1–0 views · hold ~ camera views · M mask · F1 Guide';
  }

  // ================================================================ display settings flyout

  private toggleFlyout() {
    const open = !this.flyout.classList.contains('open');
    this.flyout.classList.toggle('open', open);
    if (open) this.buildFlyout();
  }

  private buildFlyout() {
    const f = this.flyout;
    if (!f.classList.contains('open')) return;
    f.innerHTML = '';
    const vp = this.vp;
    f.append(dock(el('span', {}, 'Display settings', el('span', { class: 'grow' }), icon(I.close, 'Close', () => f.classList.remove('open'))),
      el('div', { class: 'dock-body' },
        group('Environment',
          el('div', { class: 'row' }, el('label', {}, 'Lighting'),
            (() => {
              const hdrs = this.shelf.items.filter((x) => x.kind === 'env');
              const cur = this.settings.envName && hdrs.some((x) => x.name === this.settings.envName) ? 'env:' + this.settings.envName : vp.envName !== 'Studio' ? 'hdr' : vp.studioKind;
              const nice = (n: string) => n.replace(/_\d+k$/i, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              return select<string>([
                ...hdrs.map((x) => ({ value: 'env:' + x.name, label: 'Photo: ' + nice(x.name) + (x.name === 'studio_small_09_1k' ? ' (default)' : '') })),
                ...Viewport.ENVIRONMENTS.map((n) => ({ value: n, label: n })),
                { value: 'soft', label: 'Flat (true color)' },
                { value: 'room', label: 'Bright room' },
                ...(cur === 'hdr' ? [{ value: 'hdr', label: vp.envName }] : []),
              ], cur, (v) => {
                if (v.startsWith('env:')) { const it = hdrs.find((x) => x.name === v.slice(4)); if (it) this.applyShelfItem(it); return; }
                if (v !== 'hdr') { vp.setStudioEnv(v); vp.applyBackground(); this.settings.envName = ''; saveSettings(this.settings); this.buildFlyout(); }
              });
            })()),
          el('div', { class: 'row' }, el('label', {}, ''),
            el('button', { class: 'grow', onclick: async () => { const file = await pickFile('.hdr'); if (file) this.openAny(file); } }, 'Load .hdr environment…')),
          slider('Rotation', { min: 0, max: 360, step: 1, value: Math.round(vp.envYaw), fmt: (v) => `${v}°`, onInput: (v) => { vp.envRotation = v; this.settings.envYaw = v; saveSettings(this.settings); } }).el,
          slider('Light height', { min: -60, max: 60, step: 1, value: Math.round(vp.envTilt), fmt: (v) => `${v}°`, onInput: (v) => { vp.envTiltDeg = v; this.settings.envTilt = v; saveSettings(this.settings); } }).el,
          el('p', { class: 'note' }, 'Tip: hold Shift and right-drag in the 3D view to move the light.'),
          el('div', { class: 'row' }, el('label', {}, ''),
            el('button', { class: 'grow', title: 'Put the light back where it starts (rotation 0°, height 0°, exposure 1)', onclick: () => {
              vp.envRotation = 0; vp.envTiltDeg = 0; vp.exposure = 1;
              this.settings.envYaw = 0; this.settings.envTilt = 0; saveSettings(this.settings);
              this.poke(); this.buildFlyout(); toast('Lighting reset');
            } }, 'Reset lighting')),
          el('div', { class: 'row' }, el('label', {}, 'Background'),
            select([{ value: 'env', label: 'Blurred environment' }, { value: 'solid', label: 'Solid dark gray' }], vp.bgMode, (v) => { vp.bgMode = v as any; vp.applyBackground(); })),
        ),
        group('Camera & color',
          el('div', { class: 'row' }, el('label', {}, 'Tone map'),
            select<ToneMap>([
              { value: 'neutral', label: 'Neutral (true color)' }, { value: 'aces', label: 'ACES Filmic' },
              { value: 'agx', label: 'AgX' }, { value: 'none', label: 'None (linear)' },
            ], vp.toneMap, (v) => vp.setToneMap(v))),
          slider('Exposure', { min: 0.2, max: 3, step: 0.01, value: vp.renderer.toneMappingExposure, onInput: (v) => (vp.exposure = v) }).el,
          slider('Field of view', { min: 15, max: 80, step: 1, value: vp.camera.fov, fmt: (v) => `${v}°`, onInput: (v) => { vp.camera.fov = v; vp.camera.updateProjectionMatrix(); } }).el,
        ),
        group('Shading',
          slider('Height bump', { min: 0, max: 30, step: 0.5, value: this.ts.heightStrength, fmt: (v) => v.toFixed(1), onInput: (v) => this.ts.setHeightStrength(v) }).el,
          slider('AO shading', { min: 0, max: 1, step: 0.01, value: vp.litMat.aoMapIntensity, onInput: (v) => (vp.aoStrength = v) }).el,
          slider('Glow', { min: 0, max: 10, step: 0.1, value: vp.litMat.emissiveIntensity, fmt: (v) => v.toFixed(1), onInput: (v) => (vp.emissiveStrength = v) }).el,
        ),
      )));
  }

  // ================================================================ left: assets shelf / baking dock

  buildShelf() {
    const host = document.getElementById('shelf')!;
    if (this.mode === 'bake') { this.buildBakeDock(); return; }
    if (this.historyOpen && this.mode === 'paint') { this.buildHistory(host); return; }
    if (this.mode === 'design') {
      host.innerHTML = '';
      const inner = el('div', { class: 'dz-left-host' });
      host.append(dock(el('span', {}, this.designer.tab === 'shader' ? 'Shader Maker' : 'Material Designer'), inner, 'grow'));
      this.designer.buildLeft(inner);
      return;
    }
    host.innerHTML = '';
    const sh = this.shelf;
    const search = el('input', { type: 'search', placeholder: 'Search assets', value: this.shelfSearch }) as HTMLInputElement;
    search.addEventListener('input', () => { this.shelfSearch = search.value; this.fillShelfGrid(grid); });
    const chip = (f: ShelfFilter, label: string) => el('button', { class: 'chip' + (this.shelfFilter === f ? ' on' : ''), onclick: () => { this.shelfFilter = f; this.buildShelf(); } }, label);
    const grid = el('div', { class: 'shelf-grid' });
    let folder: HTMLElement;
    if (sh.state === 'ready') folder = el('span', { class: 'folder-name', title: sh.folderName }, sh.folderName);
    else if (sh.state === 'needs-permission') folder = el('button', { class: 'link', onclick: async () => { if (await sh.reconnect()) this.buildShelf(); } }, `Reconnect “${sh.folderName}”`);
    else if (sh.state === 'unsupported') folder = el('span', { class: 'folder-name' }, 'Drop files here to add them');
    else folder = el('button', { class: 'link', onclick: async () => {
      try { if (await sh.link()) { this.buildShelf(); toast(`Assets folder: ${sh.folderName}`); } } catch (e: any) { toast('Could not open folder: ' + e?.message, true); }
    } }, 'Link folder…');
    const body = el('div', { class: 'dock-body shelf-body' },
      el('div', { class: 'shelf-search' }, el('span', { class: 'si' }), search),
      el('div', { class: 'chips' }, chip('all', 'All'), chip('model', 'Models'), chip('smart', 'Smart materials'), chip('cloud', 'Scanned'), chip('material', 'Materials'), chip('textures', 'Textures'), chip('mask', 'Smart masks'), chip('brush', 'Brushes'), chip('alpha', 'Alphas'), chip('graph', 'Graphs'), chip('env', 'Environments'), chip('unsupported', 'Substance')),
      el('div', { class: 'row drop-row', title: 'What dragging an asset onto the model fills' }, el('label', {}, 'Drop onto'),
        select<DropMode>([{ value: 'whole', label: 'Whole model' }, { value: 'object', label: 'Object (separate mesh)' },
          { value: 'material', label: 'Material (of the part you drop on)' }, { value: 'part', label: 'Mesh part' }, { value: 'island', label: 'UV island' }, { value: 'tri', label: 'Triangle' }],
        this.dropMode, (v) => (this.dropMode = v))),
      (this.pickBar = el('div', { class: 'pick-bar' })),
      grid,
    );
    (body.querySelector('.si') as HTMLElement).innerHTML = I.search;
    const foot = el('div', { class: 'dock-foot' },
      isDesktopApp
        ? icon(I.folder, 'Open the presets folder (next to LocalPaint.exe) — put materials, textures, brushes and HDRIs there, then Rescan', () => { openNativePresets(); })
        : icon(I.folder, sh.state === 'ready' ? 'Choose another folder' : 'Link a presets folder (e.g. D:\\LocalPaint\\presets)', async () => { try { if (await sh.link()) this.buildShelf(); } catch (e: any) { toast(e?.message ?? 'Could not open folder', true); } }),
      icon(I.refresh, 'Rescan the folder', async () => { await sh.scan(); this.buildShelf(); toast('Assets refreshed'); }),
      el('span', { class: 'grow' }, folder),
      icon(I.save, 'Save the brush material (or selected fill layer) as a material preset', () => this.saveMaterialPreset()),
      icon(I.smart, 'Save every fill layer + mask as a smart material', () => this.saveSmartMaterial()),
    );
    host.append(dock(el('span', {}, 'Assets'), body, 'grow'), foot);
    this.fillShelfGrid(grid);
    this.updatePickBar();
  }

  /** Which shelf section an asset belongs to (one-layer library materials count as materials). */
  private shelfGroup(it: ShelfItem): Exclude<ShelfFilter, 'all'> {
    if (it.kind === 'smart') return it.category && it.smart.layers.length === 1 ? 'material' : 'smart';
    return it.kind as Exclude<ShelfFilter, 'all'>;
  }
  private static SHELF_SECTIONS: [Exclude<ShelfFilter, 'all'>, string][] = [
    ['model', 'Models'], ['smart', 'Smart materials'], ['cloud', 'Scanned materials'], ['material', 'Materials'], ['textures', 'Textures'], ['mask', 'Smart masks'],
    ['brush', 'Brushes'], ['alpha', 'Alphas'], ['graph', 'Graphs'], ['env', 'Environments'], ['unsupported', 'Substance materials'],
  ];
  /** Sections opened in this session; every section starts closed (a new file closes them again). */
  private shelfOpen = new Set<string>();

  private fillShelfGrid(grid: HTMLElement) {
    grid.innerHTML = '';
    const q = this.shelfSearch.trim().toLowerCase();
    const items = this.shelf.items.filter((it) =>
      (this.shelfFilter === 'all' || this.shelfGroup(it) === this.shelfFilter)
      && (!q || it.name.toLowerCase().includes(q) || (it.kind === 'cloud' && (it.cat.toLowerCase().includes(q) || it.tags.some((t) => t.toLowerCase().includes(q))))));
    if (!items.length) { grid.append(el('p', { class: 'note', style: { gridColumn: '1 / -1' } }, q ? 'Nothing matches.' : 'No assets of this kind yet.')); return; }
    // Sections (and sub-sections by category, e.g. Metal / Wood), each collapsible.
    // Top sections start closed; sub-sections (Metal, Wood…) start open. Picking one filter or searching opens them.
    const header = (key: string, label: string, n: number, sub = false) => {
      const opened = this.shelfOpen.has(key);
      const closed = !q && (sub ? opened : this.shelfFilter === 'all' && !opened);
      const h = el('button', { class: 'shelf-sec' + (sub ? ' sub' : '') + (closed ? ' closed' : ''), onclick: () => {
        if (this.shelfOpen.has(key)) this.shelfOpen.delete(key); else this.shelfOpen.add(key);
        this.fillShelfGrid(grid);
      } }, el('span', { class: 'caret' }, closed ? '▸' : '▾'), el('span', { class: 'grow' }, label), el('span', { class: 'muted' }, String(n)));
      grid.append(h);
      return !closed;
    };
    for (const [g, label] of App.SHELF_SECTIONS) {
      const list = items.filter((it) => this.shelfGroup(it) === g);
      if (!list.length) continue;
      if (!header('sec:' + g, label, list.length)) continue;
      const catOf = (it: ShelfItem) => (it.kind === 'smart' && it.category) || (it.kind === 'cloud' && it.cat) || (it.kind === 'alpha' && it.category) || (it.kind === 'brush' && brushCategory(it.brush, true)) || (it.kind === 'unsupported' && (it.cat ?? 'Your files')) || '';
      const cats = [...new Set(list.map(catOf))];
      if (cats.length > 1) {
        for (const c of cats) {
          const sub = list.filter((it) => catOf(it) === c);
          if (!header(`sec:${g}:${c}`, c || 'Basic', sub.length, true)) continue;
          for (const it of sub) grid.append(this.shelfTile(it));
        }
      } else for (const it of list) grid.append(this.shelfTile(it));
    }
  }

  /** Make a thumbnail only when its tile scrolls into view (keeps startup and scrolling smooth). */
  private thumbIO?: IntersectionObserver;
  private thumbJobs = new WeakMap<Element, () => void>();
  private lazyThumb(img: HTMLElement, job: () => void) {
    this.thumbIO ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const j = this.thumbJobs.get(e.target);
        this.thumbIO!.unobserve(e.target);
        this.thumbJobs.delete(e.target);
        j?.();
      }
    }, { rootMargin: '200px' });
    this.thumbJobs.set(img, job);
    this.thumbIO.observe(img);
  }

  /** The job that makes an asset's thumbnail (null = no thumbnail). */
  private thumbJob(it: ShelfItem): (() => Promise<string>) | null {
    if (it.kind === 'material') return () => this.thumbs.material('m:' + it.file, it.preset.values, it.preset.enabled);
    // Realistic smart materials: previews rendered ahead of time, so the shelf needs no downloads.
    if (it.kind === 'smart' && /^lib:(scan|painter)-/.test(it.file) && (SCAN_PREVIEWS as Record<string, string>)[it.name]) {
      const u = (SCAN_PREVIEWS as Record<string, string>)[it.name];
      return () => Promise.resolve(u);
    }
    // Built-in Basic smart materials (unchanged from how they ship): previews rendered ahead of time too.
    if (it.kind === 'smart' && !/^lib:/.test(it.file ?? '')) {
      const u = (SCAN_PREVIEWS as Record<string, string>)['starter:' + this.hashOf(it.smart)];
      if (u) return () => Promise.resolve(u);
    }
    if (it.kind === 'smart') {
      const fills = it.smart.layers.filter((l) => l.kind === 'fill') as any[];
      const main = fills[Math.min(1, fills.length - 1)];
      const base = it.smart.layers[0] as any;
      if (it.category && base?.kind === 'fill' && base.procs && !base.mask && it.smart.layers.length === 1) return () => this.thumbs.procMaterial('s:' + it.file, base.values, base.procs, base.enabled);
      if (main || it.smart.layers.length) return () => this.smartThumb('s:' + it.file, it.smart);
      return null;
    }
    if (it.kind === 'model') return () => this.thumbs.model('model:' + it.model, builtinModel(it.model as BuiltinId).geometries);
    if (it.kind === 'env') return () => this.hdrThumb(it);
    if (it.kind === 'graph') return () => this.graphThumb(it.graph);
    if (it.kind === 'mask' && (SCAN_PREVIEWS as Record<string, string>)['mask:' + it.preset]) {
      const u = (SCAN_PREVIEWS as Record<string, string>)['mask:' + it.preset];
      return () => Promise.resolve(u);
    }
    if (it.kind === 'mask') {
      // Smart masks on the Painter-style generators: shown for real (white where the mask is) on the preview shape.
      const sm = (() => { try { return smartMask(it.preset); } catch { return null; } })();
      if (sm && [sm, ...(sm.fx ?? [])].some((e) => e.type === 'painter')) {
        const smart: import('./engine/Project').SmartMaterial = { format: 'texpaint-smart', version: 1, name: it.name, layers: [
          { kind: 'fill', name: 'Off', visible: true, opacity: 1, blend: 'normal', values: { color: [0.06, 0.05, 0.08], rough: 0.7, metal: 0, height: 0.5, emit: [0, 0, 0] }, enabled: { color: true, rough: true, metal: true, height: false, emit: false, normal: false }, tiling: 1 },
          { kind: 'fill', name: 'On', visible: true, opacity: 1, blend: 'normal', values: { color: [0.92, 0.88, 1], rough: 0.5, metal: 0, height: 0.5, emit: [0, 0, 0] }, enabled: { color: true, rough: true, metal: true, height: false, emit: false, normal: false }, tiling: 1, mask: { base: 'black', gen: sm } },
        ] as any };
        return () => this.smartThumb('k:' + it.preset, smart);
      }
      return () => this.thumbs.smartMask(it.preset);
    }
    if (it.kind === 'textures') return () => this.thumbs.textures('t:' + it.name, it.files as any);
    if (it.kind === 'brush') return () => this.brushTipCanvas(it).then((cv) => cv.toDataURL());
    if (it.kind === 'alpha') return () => Promise.resolve(builtinTipThumb(it.tip.slice(8), 96).toDataURL());
    if (it.kind === 'cloud') return () => Promise.resolve(it.thumb);
    if (it.kind === 'unsupported' && it.src && /\.sbsar$/i.test(it.file)) return () => this.sbsShelfIcon(it);
    return null;
  }
  private thumbKey(it: ShelfItem) {
    if (it.kind === 'smart') return `${it.kind}:${it.file}:${it.name}:${this.hashOf(it.smart)}`;
    return `${it.kind}:${it.file}:${it.name}`;
  }
  private hashes = new WeakMap<object, string>();
  /** Short content hash, so a changed smart material gets a new preview. */
  private hashOf(o: object): string {
    let h = this.hashes.get(o);
    if (h) return h;
    const s = JSON.stringify(o);
    let a = 0x811c9dc5;
    for (let i = 0; i < s.length; i += s.length > 200000 ? 7 : 1) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    h = (a >>> 0).toString(36) + s.length.toString(36);
    this.hashes.set(o, h);
    return h;
  }
  /** Built-in assets never change, so their thumbnails are kept between sessions. */
  private thumbPersist(it: ShelfItem) { return /^(lib|mask|graph|model):/.test(it.file ?? '') || it.kind === 'smart' || (it.kind === 'unsupported' && /\.sbsar$/i.test(it.file)) || (it.kind === 'brush' && !it.tipFile && it.brush.tip.startsWith('builtin:')); }
  private thumbCache = new Map<string, string>();
  private thumbWaits = new Map<string, Promise<string | null>>();
  thumbOf(it: ShelfItem): Promise<string | null> {
    const key = this.thumbKey(it);
    const c = this.thumbCache.get(key);
    if (c) return Promise.resolve(c);
    let w = this.thumbWaits.get(key);
    if (w) return w;
    const job = this.thumbJob(it);
    if (!job) return Promise.resolve(null);
    w = job().then((u) => {
      this.thumbCache.set(key, u);
      const k2 = it.kind === 'smart' ? 's:' + it.file : it.kind === 'mask' ? 'k:' + it.preset : '';
      if (this.thumbPersist(it) && !this.noPersist.has(k2)) saveThumb(key, u);
      return u;
    }).catch(() => null).finally(() => this.thumbWaits.delete(key));
    this.thumbWaits.set(key, w);
    return w;
  }

  /** Loading screen: make every shelf thumbnail before showing the app, so opening the shelf never stutters. */
  private async preloadThumbs() {
    const splash = document.getElementById('splash');
    const bar = document.getElementById('splash-bar');
    const txt = document.getElementById('splash-text');
    const t0 = performance.now();
    const step = async (label: string, pct: number, f: () => void | Promise<void>) => {
      if (txt) txt.textContent = label;
      if (bar) bar.style.width = `${pct}%`;
      await new Promise((r) => setTimeout(r, 16));
      try { await f(); } catch (e) { console.warn(label, e); }
    };
    await step('Compiling painting shaders…', 4, () => this.ts.warmup());
    await step('Compiling viewport shaders…', 8, () => this.vp.warmup());
    await step('Compiling mask generators…', 10, () => this.ts.warmupPainter(SP_KINDS));
    await step('Compiling Material Designer nodes…', 12, () => { this.designer.runner.warmup(); this.graphRunner.warmup(); });
    await step('Preparing Material Designer…', 16, () => this.designer.changed(false));
    await step('Preparing bake previews…', 19, async () => {
      for (const v of ['bnormal', 'wsn', 'id', 'ao', 'curv', 'pos', 'thick', 'bheight', 'rays'] as ViewMode[]) if (!this.mapThumbs.has(v)) this.mapThumbs.set(v, await this.mapThumb(v));
    });
    const saved = await loadThumbs();
    for (const [k, v] of saved) this.thumbCache.set(k, v);
    // Previews that need a scan which isn't downloaded yet are left for later (the shelf makes them when shown),
    // so the loading screen never waits on the internet.
    const needsDownload = (it: ShelfItem) => {
      if (it.kind !== 'smart') return false;
      const files: string[] = [];
      const walk = (ls: any[]) => { for (const l of ls) { if (l?.scan?.file) files.push(l.scan.file); if (l?.children) walk(l.children); } };
      walk(it.smart.layers);
      return files.some((f) => !this.cloudItems.some((c) => c.kind === 'cloud' && c.file === f && c.downloaded));
    };
    // Smart material / smart mask previews that aren't shipped ready-made are slow to make (they run the whole layer
    // stack), so they're made in the background after loading, when the shelf shows them.
    const slow = (it: ShelfItem) => (it.kind === 'smart' || it.kind === 'mask')
      && !(SCAN_PREVIEWS as Record<string, string>)[it.kind === 'mask' ? 'mask:' + it.preset : it.name]
      && !(it.kind === 'smart' && (SCAN_PREVIEWS as Record<string, string>)['starter:' + this.hashOf(it.smart)]);
    const items = this.shelf.items.filter((it) => this.thumbJob(it) && !this.thumbCache.has(this.thumbKey(it)) && !needsDownload(it) && !slow(it));
    let n = 0, last = performance.now();
    const pctOf = (k: number) => 20 + Math.round((k / Math.max(1, items.length)) * 80);
    if (items.length && txt) txt.textContent = saved.size ? `Loading new assets… 0 / ${items.length}` : `Preparing materials (first start only)… 0 / ${items.length}`;
    for (const it of items) {
      // One slow preview never holds up loading: after a few seconds it carries on in the background.
      await Promise.race([this.thumbOf(it), new Promise((r) => setTimeout(r, 6000))]);
      n++;
      if (performance.now() - last > 40) {
        if (bar) bar.style.width = `${pctOf(n)}%`;
        if (txt) txt.textContent = `${saved.size ? 'Loading new assets' : 'Preparing materials (first start only)'}… ${n} / ${items.length} · ${it.name}`;
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    if (bar) bar.style.width = '100%';
    await flushThumbs();
    (window as any).__thumbStats = { saved: saved.size, made: items.length, ms: Math.round(performance.now() - t0), boot: Math.round(t0) };
    if (splash) { splash.classList.add('done'); setTimeout(() => splash.remove(), 400); }
    this.buildShelf();
  }

  private shelfTile(it: ShelfItem) {
    const img = el('img', { class: 'sphere', alt: '' }) as HTMLImageElement;
    let tip = it.name;
    let badge: string | null = null;
    const cached = this.thumbCache.get(this.thumbKey(it));
    if (cached) img.src = cached;
    else if (this.thumbJob(it)) this.lazyThumb(img, () => this.thumbOf(it).then((u) => { if (u) img.src = u; }));
    if (it.kind === 'material') {
      tip += ' — material: click to load into the brush (or the selected fill layer)';
    } else if (it.kind === 'smart') {
      badge = it.smart.layers.length > 1 ? 'SMART' : it.category ? 'LIB' : 'SMART';
      tip += it.smart.layers.length > 1 ? ` — smart material (${it.smart.layers.length} layers with smart masks${it.category ? ', ' + it.category : ''}). Click to add above the selected layer`
        : ` — procedural material${it.category ? ' (' + it.category + ')' : ''}. Click to add as a fill layer`;
    } else if (it.kind === 'model') {
      badge = 'MODEL';
      tip += ' — starter model: click to start a new file with it (or File → Open model… for your own)';
    } else if (it.kind === 'env') {
      badge = 'HDRI';
      img.classList.add('env');
      tip += ' — HDR environment: click to light the scene with it';
    } else if (it.kind === 'graph') {
      badge = 'GRAPH';
      img.classList.add('tip');
      tip += ' — Material Designer graph: click to open it, or drag it onto the model to add it as a fill layer';
    } else if (it.kind === 'mask') {
      img.classList.add('tip');
      badge = 'MASK';
      tip += ' — smart mask: click to put it on the selected layer (or drag it onto a layer)';
    } else if (it.kind === 'textures') {
      tip += ` — texture set (${Object.keys(it.files).join(', ')}). Click to add as a fill layer`;
    } else if (it.kind === 'brush') {
      img.classList.add('tip');
      badge = 'BRUSH';
      tip += ' — brush preset: click to use it';
    } else if (it.kind === 'alpha') {
      img.classList.add('tip');
      tip += ` — alpha (${it.category}): click to use it as the brush tip. Your brush size and other settings stay the same`;
    } else if (it.kind === 'cloud') {
      badge = it.downloaded ? 'SCAN' : `↓ ${(it.size / 1e6).toFixed(0)} MB`;
      tip += ` — scanned material (${it.cat}; ${it.maps.join(', ')}). ${it.downloaded ? 'Saved on this PC.' : 'Downloads the first time you use it.'} Click to add as a fill layer`;
    } else {
      img.classList.add('adobe');
      badge = it.file.split('.').pop()!.toUpperCase();
      if (/\.sbsar$/i.test(it.file)) { badge = 'SBSAR'; img.classList.remove('adobe'); }
      tip = /\.sbsar$/i.test(it.file) ? `${it.file} — ${it.reason}. Click (or drag onto the model) to add it as a layer with all its settings`
        : /\.spsm$/i.test(it.file) ? `${it.file} — ${it.reason}. Click (or drag onto the model) to translate it into an LocalPaint smart material` : `${it.file} — ${it.reason}. Can't be translated`;
    }
    const tile = el('button', {
      class: 'tile' + (it.kind === 'unsupported' ? ' unsupported' : '') + (this.shelfPick.has(it) ? ' picked' : ''),
      title: tip + ' · or drag it onto the model / a layer · Ctrl+click to pick several',
      onclick: (e: MouseEvent) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (it.kind === 'unsupported' || it.kind === 'brush' || it.kind === 'alpha' || it.kind === 'mask' || it.kind === 'env' || it.kind === 'model') return;
          if (this.shelfPick.has(it)) this.shelfPick.delete(it); else this.shelfPick.add(it);
          tile.classList.toggle('picked', this.shelfPick.has(it));
          this.updatePickBar();
          return;
        }
        this.clearShelfPick();
        this.applyShelfItem(it);
      },
    }, img, el('span', { class: 'tile-name' }, it.name));
    tile.draggable = true;
    img.draggable = false;
    tile.addEventListener('dragstart', (e) => {
      this.dragItem = it;
      this.dragMany = this.shelfPick.has(it) && this.shelfPick.size > 1 ? [...this.shelfPick] : null;
      e.dataTransfer!.effectAllowed = 'copy';
      e.dataTransfer!.setData('text/plain', it.name);
      if (img.src) e.dataTransfer!.setDragImage(img, 32, 32);
    });
    tile.addEventListener('dragend', () => { this.dragItem = null; this.dragMany = null; this.vp.setHighlight('', null); });
    if (badge) tile.append(el('span', { class: 'tile-badge' }, badge));
    return tile;
  }

  /** Light the 3D view with a real HDR photo (like Substance's panorama) instead of the flat built-in studio. */
  private async loadStartEnv() {
    const want = this.settings.envName;
    if (!want) return;
    const it = this.shelf.items.find((x) => x.kind === 'env' && x.name === want);
    if (it?.kind !== 'env') return;
    try { await this.vp.loadHDR(await it.src()); this.vp.applyBackground(); } catch (e) { console.warn('env', e); }
  }

  // ---------------------------------------------------------------- Substance materials on this PC

  /** The .sbsar materials of the user's Substance Painter (starter assets + their assets folder) on the shelf. */
  async loadSbsLibrary() {
    const native = this.native;
    if (!native?.sbsLibrary) return;
    let list: { name: string; path: string; size: number; source: string }[] = [];
    try { list = await native.sbsLibrary(); } catch { return; }
    if (!list?.length) return;
    const have = new Set(this.shelf.items.filter((it) => it.kind === 'unsupported').map((it) => it.file.toLowerCase()));
    const items: ShelfItem[] = list.filter((m) => !have.has((m.name + '.sbsar').toLowerCase())).map((m) => ({
      kind: 'unsupported', name: m.name, file: m.name + '.sbsar', reason: `Substance material from ${m.source}`, cat: m.source,
      src: async () => {
        const b = await native.sbsRead(m.path);
        if (!b) throw new Error(`Couldn't read ${m.path}`);
        return new File([b], m.name + '.sbsar');
      },
    }));
    this.shelf.items = [...this.shelf.items, ...items];
    if (document.getElementById('shelf')?.childElementCount) this.buildShelf();
  }
  private sbsIconQueue: Promise<unknown> = Promise.resolve();
  /** Shelf picture of an .sbsar: the icon stored inside it (one at a time, they can be big). */
  private sbsShelfIcon(it: ShelfItem): Promise<string> {
    const job = this.sbsIconQueue.then(async () => {
      if (it.kind !== 'unsupported' || !it.src) return '';
      const f = await it.src();
      const pkg = await readSbsPackage(new Uint8Array(await f.arrayBuffer()), f.name);
      if (!pkg.icon) return '';
      const blob = new Blob([pkg.icon as BlobPart], { type: 'image/png' });
      return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(blob); });
    });
    this.sbsIconQueue = job.catch(() => '');
    return job;
  }

  // ---------------------------------------------------------------- scanned materials (download on first use)

  private cloudItems: ShelfItem[] = [];
  /** Load the scanned-materials catalog (cached / bundled first; online refresh later) into the shelf. */
  async loadCloudCatalog(online: boolean) {
    const native = this.native;
    if (!native?.cloudCatalog) return;
    let cat: any = null;
    try { cat = await native.cloudCatalog(online); } catch { return; }
    if (!cat?.materials?.length) return;
    this.cloudItems = cat.materials.map((m: any) => ({ kind: 'cloud', name: m.name, file: m.file, cat: m.cat, thumb: m.thumb, size: m.size, tags: m.tags ?? [], maps: m.maps ?? [], downloaded: !!m.downloaded, source: m.source }));
    this.shelf.items = [...this.shelf.items.filter((it) => it.kind !== 'cloud'), ...this.cloudItems];
    if (document.getElementById('shelf')?.childElementCount) this.buildShelf();
  }
  private cloudCache = new Map<string, ShelfItem>();
  /** A scanned material as a texture set (downloads it the first time). */
  async cloudTextures(it: ShelfItem): Promise<ShelfItem | null> {
    if (it.kind !== 'cloud') return it;
    const hit = this.cloudCache.get(it.file);
    if (hit) return hit;
    const native = this.native;
    if (!native?.cloudGet) { toast('Scanned materials download in the LocalPaint app', true); return null; }
    if (!it.downloaded) toast(`Downloading “${it.name}” (${(it.size / 1e6).toFixed(1)} MB)…`);
    const r = await native.cloudGet({ file: it.file, name: it.name, cat: it.cat });
    if (!r?.ok) { toast(`Couldn't download “${it.name}”: ${r?.error ?? 'no connection'}. Check your internet connection and try again.`, true); return null; }
    const files: Partial<Record<MapSlot, File>> = {};
    for (const f of r.files as { name: string; path: string }[]) {
      const sp = splitMapName(f.name.replace(/\.[^.]+$/, ''));
      if (!sp || files[sp.slot]) continue;
      files[sp.slot] = new File([await native.readPreset(f.path)], f.name, { type: 'image/jpeg' });
    }
    if (!it.downloaded) { it.downloaded = true; this.buildShelf(); toast(`“${it.name}” downloaded and saved for next time`); }
    const t: ShelfItem = { kind: 'textures', name: it.name, files, normalDX: false, thumb: it.thumb, file: 'scan:' + it.file };
    this.cloudCache.set(it.file, t);
    return t;
  }
  /** A texture set's maps as fill images. */
  private async textureImages(it: ShelfItem): Promise<Partial<Record<Ch, FillImage>>> {
    const images: Partial<Record<Ch, FillImage>> = {};
    if (it.kind !== 'textures') return images;
    for (const ch of CHANNELS) {
      const f = it.files[ch];
      if (!f) continue;
      const bytes = await f.arrayBuffer();
      images[ch] = { name: f.name, bytes, tex: await imageTexture(bytes, f.name), flipG: ch === 'normal' && !!it.normalDX };
    }
    return images;
  }
  /** Maps of a scanned material for smart materials built from scans (downloads it the first time). */
  /** For previews: a scan only if it's already on this computer (previews never start downloads). */
  async scanImagesIfDownloaded(ref: ScanRef): Promise<Partial<Record<Ch, FillImage>>> {
    const c = this.cloudItems.find((x) => x.kind === 'cloud' && x.file === ref.file);
    if (!this.cloudCache.has(ref.file) && !(c && c.kind === 'cloud' && c.downloaded)) { this.previewMissedScan = true; throw new Error('scan not downloaded'); }
    return this.scanImages(ref);
  }
  async scanImages(ref: ScanRef): Promise<Partial<Record<Ch, FillImage>>> {
    const it: ShelfItem = this.cloudItems.find((c) => c.kind === 'cloud' && c.file === ref.file)
      ?? { kind: 'cloud', name: ref.name, file: ref.file, cat: ref.cat, thumb: '', size: 0, tags: [], maps: [] };
    const t = await this.cloudTextures(it);
    if (!t) throw new Error('scan not available');
    return this.textureImages(t);
  }

  private async resolveCloud(items: ShelfItem[]): Promise<ShelfItem[]> {
    if (!items.some((it) => it.kind === 'cloud')) return items;
    const out: ShelfItem[] = [];
    for (const it of items) { const t = await this.cloudTextures(it); if (t) out.push(t); }
    return out;
  }

  async applyShelfItem(it: ShelfItem) {
    if (it.kind === 'cloud') { const t = await this.cloudTextures(it); if (t) await this.applyShelfItem(t); return; }
    if (this.mode === 'bake') this.setMode('paint');
    if (it.kind === 'brush') { await this.applyBrushPreset(it.brush, it.tipFile); return; }
    if (it.kind === 'alpha') {
      await this.setTip(it.tip, undefined, it.name);
      if (!BRUSH_TOOLS.includes(this.tool)) this.setTool('paint');
      this.buildToolbar(); this.buildProperties();
      toast(`Alpha: ${it.name}`);
      return;
    }
    if (it.kind === 'mask') { this.applySmartMaskTo(this.ts.activeLayer, it.preset); return; }
    if (it.kind === 'model') { this.loadBuiltin(it.model as BuiltinId); return; }
    if (it.kind === 'env') {
      try { await this.vp.loadHDR(await it.src()); this.vp.applyBackground(); this.buildFlyout(); toast(`Environment: ${it.name}`); this.settings.envName = it.name; saveSettings(this.settings); } catch { toast('Could not read that HDR file', true); }
      return;
    }
    if (it.kind === 'graph') { this.setMode('design'); await this.designer.open(it.graph); this.designLinked = -1; this.buildProperties(); toast(`Opened graph “${it.name}” — click Add as fill layer to use it`); return; }
    if (it.kind === 'unsupported') {
      if (/\.(sbsar|spsm|spmsk)$/i.test(it.file) && it.src) { await this.translateSubstance([await it.src()]); return; }
      toast(`${it.reason} can't be translated (only .sbsar materials and .spsm smart materials can).`, true);
      return;
    }
    if (it.kind === 'smart') {
      await this.ts.batch(`Add “${it.name}”`, () => applySmartMaterial(this.ts, it.smart));
      this.paintTarget = 'content';
      this.modified = true;
      this.refresh();
      toast(`Added smart material “${it.name}” (${it.smart.layers.length} layers)`);
      return;
    }
    if (it.kind === 'material') {
      const layer = this.ts.activeLayer;
      const p = it.preset;
      if (layer?.kind === 'fill' && !Object.keys(layer.images ?? {}).length) {
        this.ts.checkpoint(`Apply “${it.name}”`);
        layer.values = structuredClone(p.values);
        layer.enabled = { ...layer.enabled, ...p.enabled, normal: layer.enabled.normal };
        this.ts.layerChanged();
        this.modified = true;
        toast(`Applied “${it.name}” to ${layer.name}`);
      } else {
        this.brush.values = structuredClone(p.values);
        this.brush.channels = { ...p.enabled, normal: false };
        this.buildProperties();
        toast(`Brush material: ${it.name}`);
      }
      return;
    }
    try {
      const images: Partial<Record<Ch, FillImage>> = {};
      const enabled = {} as Record<Ch, boolean>;
      for (const ch of CHANNELS) {
        const f = it.files[ch];
        enabled[ch] = !!f;
        if (!f) continue;
        const bytes = await f.arrayBuffer();
        images[ch] = { name: f.name, bytes, tex: await imageTexture(bytes, f.name), flipG: ch === 'normal' && !!it.normalDX };
      }
      if (!Object.keys(images).length) { toast('No usable maps in that set', true); return; }
      this.applyTexSettings(this.ts.addFillLayer(it.name, undefined, enabled, true, images, it.tiling ?? 1), it);
      this.paintTarget = 'content';
      this.modified = true;
      toast(`Added “${it.name}” as a fill layer`);
    } catch (e: any) {
      console.error(e);
      toast('Could not load those images: ' + (e?.message ?? e), true);
    }
  }

  // ---------------------------------------------------------------- Substance materials (.sbsar / .spsm)

  /**
   * Translate Substance files right here: the archive and its description are read in the browser,
   * pictures stored inside become maps, and the rest is approximated from its name and sliders.
   */
  async translateSubstance(files: File[]) {
    if (this.mode === 'bake') this.setMode('paint');
    for (const f of files) {
      toast(`Reading ${f.name}…`);
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (/\.spmsk$/i.test(f.name)) {
          // A Painter smart mask: its generators and grunges with the same settings, on LocalPaint's Painter-style generators.
          const { name, gen, skipped } = await translateSpmsk(bytes, f.name);
          const id = 'user_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          if (!findSmartMask(id)) {
            SMART_MASKS.push({ id, label: name, build: () => structuredClone(gen) });
            this.shelf.items = [...this.shelf.items, { kind: 'mask', name, file: 'mask:' + id, preset: id }];
            this.buildShelf();
          }
          this.applySmartMaskTo(this.ts.activeLayer, id);
          toast(`Smart mask “${name}” added to Smart masks and put on the selected layer.${skipped.length ? ' Not carried over: ' + skipped.join(', ') + '.' : ''}`);
          continue;
        }
        if (/\.spsm$/i.test(f.name)) {
          const { root, skipped } = await translateSpsm(bytes, f.name);
          let count = 0;
          await this.ts.batch(`Translate ${f.name}`, async () => {
            const top = await this.buildSp(root, undefined, () => count++);
            if (top) this.ts.activeId = top.id;
          });
          toast(`Translated smart material “${root.name}”: ${count} layer${count === 1 ? '' : 's'} with their masks.${skipped.length ? ' Not carried over: ' + skipped.slice(0, 4).join('; ') + (skipped.length > 4 ? '…' : '') + '.' : ''} Bake mesh maps (Baking tab) so the edge/dirt masks show.`);
        } else {
          let fl: FillLayer | null = null;
          await this.ts.batch(`Add ${f.name}`, async () => { fl = await this.addSbsLayer(bytes, f.name); });
          const info = fl ? this.sbsInfo.get(fl) : undefined;
          toast(info?.engine === 'adobe' ? `Added “${(fl as FillLayer | null)?.name}” — rendered by Adobe's engine ✓`
            : info?.engine === 'lmp' ? `Added “${(fl as FillLayer | null)?.name}” with all its settings ✓`
              : `Added “${(fl as FillLayer | null)?.name}”. Its settings are in Properties (LocalPaint approximation: Adobe's engine isn't installed).`, info?.engine === 'approx');
        }
        this.paintTarget = 'content';
        this.modified = true;
        this.refresh();
      } catch (e: any) {
        console.error(e);
        const m = String(e?.message ?? e);
        toast(/^LocalPaint couldn't/.test(m) ? m + ' (Guide → Help: errors)'
          : e instanceof RangeError || /outside the bounds/i.test(m) ? `LocalPaint couldn't read ${f.name}: part of it is stored in a way LocalPaint doesn't understand yet (often a paid Substance material packed inside). (Guide → Help: errors)`
          : `Couldn't translate ${f.name}: ${m}`, true);
      }
    }
  }

  // ---------------------------------------------------------------- Substance material mode (.sbsar)
  //
  // A dropped .sbsar becomes a fill layer that keeps the material's own parameters (presets, seed,
  // groups, colors, toggles, image inputs) like Painter's "Substance material mode". What the images
  // show comes from Adobe's own renderer when it's installed (exact), else LocalPaint's version of the graph.

  /** Adobe's renderer (sbsrender.exe): undefined = not looked for yet, null = not on this PC. */
  private sbsExe: string | null | undefined;
  private sbsRunner?: SbsNativeRunner;
  private sbsTargets = new WeakMap<FillLayer, Partial<Record<Ch, THREE.WebGLRenderTarget>>>();
  /** What each layer's images currently show. */
  private sbsDone = new WeakMap<FillLayer, string>();
  private sbsBusy = new WeakMap<FillLayer, { want: string; since: number; running: boolean }>();
  private sbsInfo = new WeakMap<FillLayer, { engine: 'adobe' | 'lmp' | 'approx'; error?: string; rendering?: boolean; ms?: number }>();
  /** Materials Adobe's renderer couldn't run (they use LocalPaint's version for the rest of the session). */
  private sbsAdobeFailed = new Set<string>();
  private sbsMeshStamp = 0;
  private sbsTsIds = new WeakMap<TextureSet, string>();
  private sbsOpenGroups = new Set<string>();
  private sbsTimer = 0;

  async findSbsEngine(): Promise<string | null> {
    if (!this.native?.sbsEngine) return (this.sbsExe = null);
    try { const r = await this.native.sbsEngine(this.settings.sbsPath || undefined); this.sbsExe = r?.path ?? null; } catch { this.sbsExe = null; }
    return this.sbsExe ?? null;
  }
  private adobeFor(st: SbsState) { return !!this.sbsExe && this.settings.sbsAdobe && !this.sbsAdobeFailed.has(st.key); }
  private sbsUsesMesh(st: SbsState) { return Object.values(st.feeds).some((f) => f !== 'none'); }
  private sbsKeyOf(fl: FillLayer) {
    const st = fl.sbs!;
    return `${stateKey(st)}#${this.sbsUsesMesh(st) ? this.sbsMeshStamp : 0}#${this.adobeFor(st) ? 'a' : 'n'}`;
  }

  /** Add a dropped / picked .sbsar as a Substance-mode fill layer. */
  async addSbsLayer(bytes: Uint8Array, file: string, parent?: GroupLayer): Promise<FillLayer> {
    const { key, pkg } = await registerSbs(bytes, file);
    const g = pkg.graphs[0];
    const st = newSbsState(key, pkg, g, Math.min(this.ts.size, 2048));
    if (this.sbsExe === undefined) await this.findSbsEngine();
    const enabled = Object.fromEntries(CHANNELS.map((c) => [c, false])) as Record<Ch, boolean>;
    const fl = this.ts.addFillLayer(g.label, undefined, enabled, !parent, undefined, 1, parent);
    fl.sbs = st;
    // Tiling materials (no mesh inputs) are projected from 3 sides, so UV seams don't show.
    if (!this.sbsUsesMesh(st)) { fl.xf = { ...DEFAULT_XF, proj: 'tri' }; fl.tiling = 2; }
    if (g.description) fl.note = g.description.split('\n')[0].slice(0, 300);
    await this.renderSbs(fl, this.sbsKeyOf(fl));
    this.ts.layerChanged();
    return fl;
  }

  /** Re-render Substance layers whose values, inputs or engine changed (runs a few times a second). */
  private sbsTick() {
    if (!this.ts) return;
    const now = performance.now();
    for (const l of this.ts.allLayers) {
      if (l.kind !== 'fill' || !l.sbs || !SBS_FILES.has(l.sbs.key)) continue;
      const key = this.sbsKeyOf(l);
      if (!this.sbsDone.has(l)) {
        const loaded = SBS_LOADED.get(l);
        if (loaded && loaded === stateKey(l.sbs)) { this.sbsDone.set(l, key); continue; }
      }
      if (this.sbsDone.get(l) === key) continue;
      const b = this.sbsBusy.get(l);
      if (b?.running) continue;
      if (!b || b.want !== key) {
        this.sbsBusy.set(l, { want: key, since: now, running: false });
        if (!this.adobeFor(l.sbs)) void this.renderSbs(l, key); // LocalPaint's version is instant
        continue;
      }
      if (now - b.since > 380) void this.renderSbs(l, key);
    }
  }

  private async renderSbs(fl: FillLayer, key: string) {
    const st = fl.sbs!;
    const g = graphOf(st);
    if (!g) return;
    const busy = { want: key, since: 0, running: true };
    this.sbsBusy.set(fl, busy);
    const info = this.sbsInfo.get(fl) ?? { engine: 'lmp' as const };
    this.sbsInfo.set(fl, info);
    const t0 = performance.now();
    const sk = stateKey(st);
    try {
      let images: Partial<Record<Ch, FillImage>> | null = null;
      if (this.adobeFor(st)) {
        info.rendering = true; this.sbsInfoUI(fl);
        const snap = structuredClone(st);
        const r = await this.adobeRender(snap, g);
        info.rendering = false;
        if (r.images) { images = r.images; info.engine = 'adobe'; info.error = undefined; }
        else {
          info.error = r.error;
          this.sbsAdobeFailed.add(st.key);
          console.warn('sbsrender', r.error);
          toast(`Adobe's engine couldn't render “${g.label}”, so LocalPaint's own version is used. Details in Properties.`, true);
        }
      }
      if (!images) { images = this.nativeSbs(fl, st, g); info.engine = nativeFor(g) ? 'lmp' : 'approx'; }
      if (!this.ts.allLayers.includes(fl)) { for (const im of Object.values(images)) if (im && !im.rt) im.tex.dispose(); return; }
      this.setSbsImages(fl, images, g);
      this.sbsDone.set(fl, stateKey(st) === sk ? this.sbsKeyOf(fl) : key);
      info.ms = performance.now() - t0;
    } catch (e: any) {
      console.error(e);
      info.error = String(e?.message ?? e);
    } finally {
      busy.running = false;
      info.rendering = false;
      this.sbsInfoUI(fl);
    }
  }

  private nativeSbs(fl: FillLayer, st: SbsState, g: SbsGraph): Partial<Record<Ch, FillImage>> {
    this.sbsRunner ??= new SbsNativeRunner(this.gpu);
    const targets = this.sbsTargets.get(fl) ?? {};
    this.sbsTargets.set(fl, targets);
    const rts = this.sbsRunner.render(this.ts, g, st, targets);
    const wanted = new Set(Object.values(st.map).filter(Boolean) as Ch[]);
    const out: Partial<Record<Ch, FillImage>> = {};
    for (const [ch, rt] of Object.entries(rts) as [Ch, THREE.WebGLRenderTarget][]) {
      if (wanted.size && !wanted.has(ch)) continue;
      const prev = fl.images?.[ch];
      out[ch] = prev?.rt === rt ? prev : { name: 'sbs:' + ch, bytes: new ArrayBuffer(0), tex: rt.texture, rt };
    }
    return out;
  }

  private async adobeRender(st: SbsState, g: SbsGraph): Promise<{ images?: Partial<Record<Ch, FillImage>>; error?: string }> {
    const native = this.native;
    const ent = SBS_FILES.get(st.key)!;
    const size = 1 << st.res;
    const values: [string, string][] = [];
    for (const p of g.params) if (p.type !== 5 && p.type !== 6 && st.values[p.id]?.length) values.push([p.id, cliValue(p, st.values[p.id])]);
    values.push(['$outputsize', `${st.res},${st.res}`], ['$randomseed', String(Math.round(st.seed))]);
    if (g.system.includes('$normalformat')) values.push(['$normalformat', '1']);
    let tsId = this.sbsTsIds.get(this.ts);
    if (!tsId) { tsId = Math.random().toString(36).slice(2, 10); this.sbsTsIds.set(this.ts, tsId); }
    const meshSize = Math.min(this.ts.size, size);
    const entries: [string, string][] = [];
    const feedOfName = new Map<string, SbsFeed>();
    for (const p of g.params) {
      if (p.type !== 5) continue;
      const f = st.feeds[p.id];
      if (!f || f === 'none' || !this.ts.baked.has(f as BakeKey)) continue;
      const n = `${tsId}-${f}-${this.sbsMeshStamp}-${meshSize}`;
      entries.push([p.id, n]);
      feedOfName.set(n, f);
    }
    const req: any = { exe: this.sbsExe, key: st.key, graph: SBS_FILES.get(st.key)!.pkg.graphs.length > 1 ? g.url : undefined, values, entries };
    let r: any;
    try {
      r = await native.sbsRender(req);
      if (r?.need) {
        if (r.need.sbsar) req.sbsar = ent.bytes;
        if (r.need.meshes) {
          req.meshes = [];
          for (const n of r.need.meshes as string[]) {
            const px = this.ts.meshMapPixels(feedOfName.get(n) as BakeKey, meshSize);
            if (px) req.meshes.push([n, new Uint8Array(await (await pixelsToPng(px, meshSize)).arrayBuffer())]);
          }
        }
        r = await native.sbsRender(req);
      }
    } catch (e: any) { return { error: String(e?.message ?? e) }; }
    if (!r?.files?.length) return { error: r?.error || (r?.need ? 'LocalPaint couldn\'t hand the material to Adobe\'s engine.' : 'Adobe\'s engine gave no pictures back.') };
    const images: Partial<Record<Ch, FillImage>> = {};
    for (const f of r.files as { name: string; data: Uint8Array }[]) {
      const id = f.name.replace(/\.[^.]+$/, '');
      const o = g.outputs.find((x) => x.id === id) ?? g.outputs.find((x) => id.endsWith('_' + x.id) || id.endsWith(x.id));
      if (!o) continue;
      const ch = st.map[o.id];
      if (!ch || images[ch]) continue;
      const bytes = new Uint8Array(f.data).slice().buffer;
      images[ch] = { name: 'sbs:' + ch, bytes, tex: await imageTexture(bytes, f.name), flipG: ch === 'normal' && !g.system.includes('$normalformat') };
    }
    if (!Object.keys(images).length) return { error: 'None of the material\'s outputs go to a channel (see Channels).' };
    return { images };
  }

  private setSbsImages(fl: FillLayer, images: Partial<Record<Ch, FillImage>>, g: SbsGraph) {
    const old = fl.images ?? {};
    const keep = new Set(Object.values(images));
    for (const im of Object.values(old)) if (im && !keep.has(im) && !im.rt && im.name.startsWith('sbs:')) im.tex.dispose();
    fl.images = images;
    for (const ch of CHANNELS) fl.enabled[ch] = !!images[ch];
    const glossOut = g.outputs.find((o) => fl.sbs!.map[o.id] === 'rough' && isGlossy(o));
    if (glossOut) fl.adj = { ...(fl.adj ?? structuredClone(DEFAULT_ADJ)), roughInv: true };
    this.ts.markDirty();
    this.updateLayerRow(fl);
    this.queueLayerThumbs();
  }

  /** Refresh just the status line of the open Substance panel. */
  private sbsInfoUI(fl: FillLayer) {
    const box = document.getElementById('sbs-status');
    if (!box || box.dataset.layer !== String(fl.id)) return;
    box.replaceWith(this.sbsStatusEl(fl));
  }
  private sbsStatusEl(fl: FillLayer): HTMLElement {
    const info = this.sbsInfo.get(fl);
    const st = fl.sbs!;
    const box = el('div', { id: 'sbs-status', class: 'sbs-status' });
    box.dataset.layer = String(fl.id);
    const engine = info?.rendering ? 'Rendering with Adobe\'s engine…'
      : info?.engine === 'adobe' ? 'Adobe\'s engine — exact, like in Painter'
        : info?.engine === 'lmp' ? 'LocalPaint\'s version of this material'
          : SBS_LOADED.get(fl) && !info ? 'Saved render (from when the project was saved)' : 'LocalPaint approximation';
    box.append(el('span', { class: 'sbs-badge ' + (info?.engine ?? 'saved') + (info?.rendering ? ' busy' : '') }, engine));
    if (info?.ms && !info.rendering) box.append(el('span', { class: 'muted' }, ` ${info.ms < 1000 ? Math.round(info.ms) + ' ms' : (info.ms / 1000).toFixed(1) + ' s'}`));
    if (info?.error) {
      box.append(el('p', { class: 'note warn' }, 'Adobe\'s engine said: ' + info.error.split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 400)),
        el('button', { onclick: () => { this.sbsAdobeFailed.delete(st.key); info.error = undefined; this.sbsDone.delete(fl); this.buildProperties(); } }, 'Try Adobe\'s engine again'));
    } else if (info?.engine === 'approx' || (info?.engine === 'lmp' && !this.sbsExe)) {
      box.append(el('p', { class: 'note' }, info.engine === 'approx'
        ? 'This material\'s graph is compiled for Adobe\'s engine. LocalPaint sorts its sliders into base color, wear, dirt, roughness and scale so they still do something, but it won\'t look exactly like Painter.'
        : 'LocalPaint has its own version of this material, so every slider works.'));
    }
    if (this.sbsExe === null && this.native?.sbsPick) {
      box.append(el('p', { class: 'note' }, 'For the exact look of any Substance material, LocalPaint can use Adobe\'s renderer from Substance 3D Designer. It wasn\'t found on this PC.'),
        el('button', { onclick: () => this.pickSbsEngine() }, 'Find sbsrender.exe…'));
    } else if (this.sbsExe && !this.settings.sbsAdobe) {
      box.append(el('p', { class: 'note' }, 'Adobe\'s engine is installed but turned off in Settings.'));
    }
    if (this.sbsUsesMesh(st)) {
      const g = graphOf(st);
      const missing = [...new Set(g?.params.filter((p) => p.type === 5 && st.feeds[p.id] !== 'none' && !this.ts.baked.has(st.feeds[p.id] as BakeKey)).map((p) => FEED_LABEL[st.feeds[p.id]]))];
      if (missing.length) box.append(el('p', { class: 'note warn' }, `Uses mesh maps that aren't baked yet (${missing.join(', ')}).`),
        el('button', { class: 'primary', onclick: () => this.setMode('bake') }, 'Go to Baking'));
    }
    return box;
  }

  async pickSbsEngine() {
    const r = await this.native?.sbsPick?.();
    if (!r) return;
    if (r.error) { toast(r.error, true); return; }
    this.settings.sbsPath = r.path; this.settings.sbsAdobe = true; saveSettings(this.settings);
    this.sbsAdobeFailed.clear();
    await this.findSbsEngine();
    toast(this.sbsExe ? 'Adobe\'s engine will render Substance materials now ✓' : 'That didn\'t work', !this.sbsExe);
    this.buildProperties();
  }

  private sbsIcons = new Map<string, string>();
  private sbsIconUrl(key: string): string {
    let u = this.sbsIcons.get(key);
    if (u !== undefined) return u;
    const ic = SBS_FILES.get(key)?.pkg.icon;
    u = ic ? URL.createObjectURL(new Blob([ic as BlobPart], { type: 'image/png' })) : '';
    this.sbsIcons.set(key, u);
    return u;
  }

  /** Painter-style properties of a Substance-mode fill layer. */
  private sbsProps(fl: FillLayer): HTMLElement[] {
    const st = fl.sbs!;
    const ent = SBS_FILES.get(st.key);
    if (!ent) return [group('Substance material', el('p', { class: 'note warn' }, `The material file (${st.file}) isn't loaded.`))];
    const g = graphOf(st)!;
    const pre = (k: string) => this.ts.checkpoint(`Edit ${fl.name}`, `sbs:${fl.id}:${k}`);
    const touched = () => { this.modified = true; };
    const icon = this.sbsIconUrl(st.key);
    const head = el('div', { class: 'sbs-head' },
      icon ? el('img', { src: icon, alt: '' }) : el('div', { class: 'sbs-noicon' }, 'S'),
      el('div', { class: 'grow' }, el('b', {}, g.label), el('div', { class: 'muted' }, st.file + (g.author ? ' · ' + g.author : ''))));
    const top = group('Substance material', head, this.sbsStatusEl(fl),
      ent.pkg.graphs.length > 1 ? el('div', { class: 'row' }, el('label', {}, 'Graph'), select<string>(ent.pkg.graphs.map((x) => ({ value: x.url, label: x.label })), st.graph, (v) => {
        const ng = ent.pkg.graphs.find((x) => x.url === v)!;
        pre('graph'); fl.sbs = { ...newSbsState(st.key, ent.pkg, ng, 1 << st.res), seed: st.seed }; fl.name = ng.label; touched(); this.ts.layerChanged(); this.buildProperties();
      })) : null);

    // ---- parameters
    const rows: { p: SbsParam; row: HTMLElement }[] = [];
    const updVis = () => { for (const r of rows) r.row.style.display = visible(r.p.visibleIf, st.values) ? '' : 'none'; };
    const set = (p: SbsParam, v: number[]) => { pre(p.id); st.values[p.id] = v; st.preset = undefined; touched(); updVis(); };
    const control = (p: SbsParam): HTMLElement | null => {
      const v = st.values[p.id] ?? [...p.def];
      const lo = (i: number) => p.min?.[i] ?? p.min?.[0] ?? 0;
      const hi = (i: number) => p.max?.[i] ?? p.max?.[0] ?? Math.max(1, Math.abs(p.def[i] ?? 0) * 2);
      const isInt = p.type === 4 || p.type >= 8;
      if (p.widget === 'toggle' || (isInt && p.labels)) {
        const c = el('input', { type: 'checkbox', checked: (v[0] ?? 0) > 0.5 }) as HTMLInputElement;
        c.addEventListener('change', () => set(p, [c.checked ? 1 : 0]));
        return el('label', { class: 'check-row', title: p.description ?? p.id }, c, ' ' + p.label);
      }
      if (p.widget === 'combo' && p.items?.length) {
        return el('div', { class: 'row', title: p.description ?? p.id }, el('label', {}, p.label),
          select<number>(p.items.map((it) => ({ value: it.value, label: it.label })), Math.round(v[0] ?? p.items[0].value), (x) => set(p, [x])));
      }
      if (p.widget === 'color') {
        const rgb = [v[0] ?? 0, v[1] ?? v[0] ?? 0, v[2] ?? v[0] ?? 0] as [number, number, number];
        const input = el('input', { type: 'color', value: rgbToHex(rgb) }) as HTMLInputElement;
        const out = [...v];
        input.addEventListener('input', () => { const c = hexToRgb(input.value); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; set(p, [...out]); });
        const row = el('div', { class: 'row', title: p.description ?? p.id }, el('label', {}, p.label), input);
        if (p.type === 3) {
          const a = slider('Opacity', { min: 0, max: 1, step: 0.01, value: v[3] ?? 1, onInput: (x) => { out[3] = x; set(p, [...out]); } }).el;
          a.classList.add('sbs-sub');
          return el('div', {}, row, a);
        }
        return row;
      }
      if (p.widget === 'slider' || p.widget === 'angle' || p.widget === 'position') {
        const n = Math.max(1, v.length);
        const comp = ['X', 'Y', 'Z', 'W'];
        const parts: HTMLElement[] = [];
        const out = [...v];
        for (let i = 0; i < n; i++) {
          const angle = p.widget === 'angle';
          const min = angle && p.min === undefined ? 0 : lo(i), max = angle && p.max === undefined ? 1 : hi(i);
          const step = p.step ?? (isInt ? 1 : (max - min) / 200);
          const s = slider(n > 1 ? `${p.label} ${comp[i]}` : p.label, {
            min, max, step, value: out[i] ?? 0,
            fmt: angle ? (x) => `${Math.round(x * 360)}°` : isInt ? (x) => String(Math.round(x)) : (x) => (Math.abs(max - min) > 20 ? x.toFixed(1) : x.toFixed(2)),
            onInput: (x) => { out[i] = isInt ? Math.round(x) : x; set(p, [...out]); },
          }).el;
          s.title = p.description ?? p.id;
          parts.push(s);
        }
        return parts.length === 1 ? parts[0] : el('div', {}, ...parts);
      }
      return null;
    };
    const presetSel = select<string>([{ value: '', label: 'Select and apply' }, ...g.presets.map((x) => ({ value: x.label, label: x.label }))], st.preset ?? '', (v) => {
      const ps = g.presets.find((x) => x.label === v);
      if (!ps) return;
      pre('preset:' + Math.random());
      for (const [id, val] of Object.entries(ps.values)) if (id in st.values) st.values[id] = [...val];
      st.preset = ps.label; touched(); this.buildProperties();
      toast(`Preset: ${ps.label}`);
    });
    const seedIn = el('input', { type: 'number', value: String(st.seed), min: '0', max: '9999', step: '1', class: 'sbs-seed' }) as HTMLInputElement;
    seedIn.addEventListener('change', () => { pre('seed'); st.seed = Math.max(0, Math.round(+seedIn.value || 0)); touched(); });
    const params = group('Parameters',
      g.presets.length ? el('div', { class: 'row' }, el('label', {}, 'Preset'), presetSel) : null,
      el('div', { class: 'row' }, el('label', {}, 'Seed'), el('button', { class: 'grow', onclick: () => { pre('seed'); st.seed = Math.floor(Math.random() * 10000); seedIn.value = String(st.seed); touched(); } }, 'Random'), seedIn));
    const groups = new Map<string, SbsParam[]>();
    for (const p of g.params) {
      if (p.type === 5 || p.type === 6) continue;
      const k = p.group || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const many = groups.size > 2;
    for (const [name, list] of groups) {
      const body: HTMLElement[] = [];
      for (const p of list) { const c = control(p); if (c) { rows.push({ p, row: c }); body.push(c); } }
      if (!body.length) continue;
      if (!name) { params.append(...body); continue; }
      const gk = `${g.url}|${name}`;
      const d = el('details', { class: 'sbs-grp' }, el('summary', {}, name.replace(/\//g, ' › ')), ...body) as HTMLDetailsElement;
      d.open = !many || this.sbsOpenGroups.has(gk);
      d.addEventListener('toggle', () => { if (d.open) this.sbsOpenGroups.add(gk); else this.sbsOpenGroups.delete(gk); });
      params.append(d);
    }
    params.append(el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => {
      pre('defaults:' + Math.random());
      for (const p of g.params) if (p.type !== 5 && p.type !== 6) st.values[p.id] = [...p.def];
      st.preset = undefined; touched(); this.buildProperties();
    } }, 'Restore defaults')));
    updVis();

    // ---- image inputs and channels
    const imgParams = g.params.filter((p) => p.type === 5);
    const feeds = Object.keys(FEED_LABEL) as SbsFeed[];
    const inputs = imgParams.length ? group('Image inputs',
      ...imgParams.map((p) => el('div', { class: 'row', title: p.id }, el('label', {}, p.label),
        select<SbsFeed>(feeds.map((f) => ({ value: f, label: FEED_LABEL[f] + (f !== 'none' && !this.ts.baked.has(f as BakeKey) ? ' (not baked)' : '') })), st.feeds[p.id] ?? 'none', (v) => { pre('feed:' + p.id); st.feeds[p.id] = v; touched(); }))),
      el('p', { class: 'note' }, 'Like Painter, mesh map inputs are filled from your baked maps automatically.')) : null;
    const chOpts: { value: string; label: string }[] = [{ value: '', label: 'Not used' }, ...CHANNELS.map((c) => ({ value: c, label: CH_LABEL[c] }))];
    const channels = group('Channels',
      ...g.outputs.map((o) => el('div', { class: 'row', title: `${o.id}${o.usage ? ' (' + o.usage + ')' : ''}` }, el('label', {}, o.label),
        select<string>(chOpts, st.map[o.id] ?? '', (v) => { pre('map:' + o.id); st.map[o.id] = v as Ch | ''; touched(); }))),
      el('div', { class: 'row' }, el('label', {}, 'Resolution'), select<number>([8, 9, 10, 11, 12].map((r) => ({ value: r, label: `${1 << r} × ${1 << r}` })), st.res, (v) => { pre('res'); st.res = v; touched(); })));
    return [top, params, ...(inputs ? [inputs] : []), channels];
  }

  /** Rebuild a translated Substance layer stack. */
  private async buildSp(n: SpNode, parent: GroupLayer | undefined, counted: () => void): Promise<Layer | null> {
    const ts = this.ts;
    let layer: Layer;
    if (n.kind === 'group') {
      const g = ts.addGroup(n.name, !parent, parent);
      for (const c of n.children) await this.buildSp(c, g, counted);
      layer = g;
    } else {
      const images: Partial<Record<Ch, FillImage>> = {};
      for (const [ch, f] of Object.entries(n.maps) as [Ch, File][]) {
        const bytes = await f.arrayBuffer();
        images[ch] = { name: f.name, bytes, tex: await imageTexture(bytes, f.name) };
        n.enabled[ch] = true;
      }
      const fl = ts.addFillLayer(n.name, structuredClone(n.values), { ...n.enabled }, !parent, Object.keys(images).length ? images : undefined, 1, parent);
      fl.note = n.note;
      if (n.tri && Object.keys(images).length) fl.xf = { ...DEFAULT_XF, proj: 'tri' };
      if (n.glossInv && images.rough) fl.adj = { ...structuredClone(DEFAULT_ADJ), roughInv: true };
      layer = fl;
      counted();
    }
    layer.visible = n.visible;
    layer.opacity = n.opacity;
    layer.blend = n.blend;
    if (n.mask) {
      ts.addMask(layer, { base: n.mask.base, gen: n.mask.gen });
      if (n.mask.image) {
        try {
          const tex = await imageTexture(await n.mask.image.arrayBuffer(), n.mask.image.name);
          ts.maskFromImage(layer, tex, n.mask.amount ?? 0.5, n.mask.contrast ?? 0.5, !!n.mask.invert);
          tex.dispose();
        } catch { /* keep the plain black mask */ }
      }
    }
    return layer;
  }

  private async addTranslated(tr: Translation, parent?: GroupLayer): Promise<Layer> {
    if (!tr.exact && !parent) {
      // Procedural material: a small look-alike stack (base + variation + glow) instead of one flat color.
      const ts = this.ts;
      const g = ts.addGroup(tr.name);
      const base = await this.addTranslated({ ...tr, exact: true, glow: undefined }, g);
      base.name = 'Base';
      const dark = tr.values.color.map((c) => c * 0.55) as [number, number, number];
      const vari = ts.addFillLayer('Variation', { ...structuredClone(tr.values), color: dark, rough: Math.min(1, tr.values.rough + 0.12), height: 0.4 },
        { color: true, rough: true, metal: false, height: true, emit: false, normal: false }, false, undefined, 1, g);
      const vg = defaultGen('noise'); vg.amount = 0.45; vg.contrast = 0.45; vg.noiseScale = 5;
      ts.addMask(vari, { base: 'black', gen: vg });
      vari.note = tr.note;
      if (tr.glow) {
        const glow = ts.addFillLayer('Glow', { color: tr.glow, rough: 0.35, metal: 0, height: 0.35, emit: tr.glow },
          { color: true, rough: true, metal: false, height: true, emit: true, normal: false }, false, undefined, 1, g);
        const gg = defaultGen('noise'); gg.amount = 0.32; gg.contrast = 0.85; gg.noiseScale = 4;
        ts.addMask(glow, { base: 'black', gen: gg });
        glow.note = tr.note;
      }
      ts.activeId = g.id;
      return g;
    }
    const images: Partial<Record<Ch, FillImage>> = {};
    for (const [ch, f] of Object.entries(tr.maps) as [Ch, File][]) {
      const bytes = await f.arrayBuffer();
      images[ch] = { name: f.name, bytes, tex: await imageTexture(bytes, f.name), flipG: ch === 'normal' && tr.normalDX };
      tr.enabled[ch] = true;
    }
    const fl = this.ts.addFillLayer(tr.name, structuredClone(tr.values), { ...tr.enabled }, !parent, Object.keys(images).length ? images : undefined, 1, parent);
    fl.note = tr.note;
    if (tr.maps.rough && (tr.glossy || /gloss|smooth/i.test(tr.maps.rough.name))) fl.adj = { ...structuredClone(DEFAULT_ADJ), roughInv: true };
    return fl;
  }

  /** Placement / adjustments stored in a .tptex material. */
  private applyTexSettings(fl: FillLayer, it: ShelfItem): FillLayer {
    if (it.kind !== 'textures') return fl;
    if (it.xf) fl.xf = { ...DEFAULT_XF, ...it.xf };
    if (it.adj) fl.adj = { ...structuredClone(DEFAULT_ADJ), ...structuredClone(it.adj) };
    return fl;
  }

  /** Save an image fill layer (maps + placement + adjustments) as one .tptex file. */
  private async saveTexMaterial(fill: FillLayer) {
    const name = await this.askText('Save material', 'Saves its images, placement and adjustments in one .tptex file.', fill.name);
    if (!name) return;
    const maps: Record<string, { name: string; data: string }> = {};
    for (const [ch, img] of Object.entries(fill.images ?? {}) as [Ch, FillImage][]) maps[ch] = { name: img.name, data: toB64(new Uint8Array(img.bytes)) };
    const doc = {
      format: 'texpaint-texmat', version: 1, name, normalDX: !!fill.images?.normal?.flipG, tiling: fill.tiling,
      xf: fill.xf, adj: fill.adj, maps,
    };
    try { toast(await this.shelf.saveJSON(`${name.replace(/[^\w\- ]+/g, '_').trim() || 'material'}.tptex`, doc)); this.buildShelf(); }
    catch (e: any) { toast('Could not save material: ' + e?.message, true); }
  }

  async saveMaterialPreset() {
    const layer = this.ts.activeLayer;
    if (layer?.kind === 'fill' && Object.keys(layer.images ?? {}).length) return this.saveTexMaterial(layer);
    const fromFill = layer?.kind === 'fill' && !Object.keys(layer.images ?? {}).length ? layer : null;
    const name = await this.askText('Save material preset', 'Name for the material preset:', fromFill ? fromFill.name : 'My material');
    if (!name) return;
    const p: MaterialPreset = {
      format: 'texpaint-material', version: 1, name,
      values: structuredClone(fromFill ? fromFill.values : this.brush.values),
      enabled: { ...(fromFill ? fromFill.enabled : this.brush.channels), normal: false },
    };
    try { toast(await this.shelf.saveJSON(`${name.replace(/[^\w\- ]+/g, '_').trim() || 'material'}.tpmat`, p)); this.buildShelf(); }
    catch (e: any) { toast('Could not save preset: ' + e?.message, true); }
  }

  async saveSmartMaterial() {
    const name = await this.askText('Save smart material', 'Saves every fill layer and its mask (or the selected folder).', 'My smart material');
    if (!name) return;
    try {
      const { smart, skipped } = await makeSmartMaterial(this.ts, name);
      if (!smart.layers.length) { toast('No fill layers to save. Smart materials are made of fill layers + masks.', true); return; }
      const msg = await this.shelf.saveJSON(`${name.replace(/[^\w\- ]+/g, '_').trim() || 'smart'}.tpsmart`, smart);
      toast(skipped ? `${msg} · ${skipped} paint layer(s) skipped (hand painting is model-specific)` : msg);
      this.buildShelf();
    } catch (e: any) { toast('Could not save smart material: ' + e?.message, true); }
  }

  /** Baking mode: map list + parameters (left dock). */
  buildBakeDock() {
    const host = document.getElementById('shelf')!;
    if (this.mode !== 'bake') return;
    host.innerHTML = '';
    const ts = this.ts;
    const maps = ts.bakeMaps;
    const item = (it: BakeItem, label: string, key?: BakeKey) => {
      const row = el('div', { class: 'bake-item' + (this.bakeItem === it ? ' on' : ''), onclick: () => this.selectBakeItem(it) });
      if (key) {
        const box = el('input', { type: 'checkbox', checked: maps[key], title: 'Bake this map (unticked maps keep their last result)' }) as HTMLInputElement;
        box.addEventListener('click', (e) => e.stopPropagation());
        box.addEventListener('change', () => { maps[key] = box.checked; this.saveBakeMaps(); this.buildBakeDock(); });
        row.append(box);
      } else row.append(el('span', { class: 'bake-dot' }));
      row.append(el('span', { class: 'grow' }, label));
      if (key) row.append(el('span', { class: 'bake-state' + (ts.baked.has(key) ? ' ok' : ''), title: ts.baked.has(key) ? 'Baked' : 'Not baked yet' }, ts.baked.has(key) ? '✓' : '–'));
      return row;
    };
    const all = BAKE_ITEMS.every(([k]) => maps[k]);
    const allBox = el('input', { type: 'checkbox', checked: all, title: 'Tick / untick every map' }) as HTMLInputElement;
    allBox.addEventListener('change', () => { for (const [k] of BAKE_ITEMS) maps[k] = allBox.checked; this.saveBakeMaps(); this.buildBakeDock(); });
    const list = el('div', { class: 'bake-list' },
      item('common', 'Common parameters'),
      el('label', { class: 'bake-all' }, allBox, ' All maps'),
      ...BAKE_ITEMS.map(([k, label]) => item(k, label, k)),
    );
    const params = el('div', { class: 'dock-body bake-params' }, ...this.bakeParams(this.bakeItem));
    const res = ts.lastHigh && ts.highGeometries ? (100 * ts.lastHigh.hits) / Math.max(1, ts.lastHigh.texels) : null;
    const foot = el('div', { class: 'bake-foot' },
      el('div', { id: 'bake-run', class: 'bake-run' }),
      el('div', { class: 'bp-progress' }, el('div', { id: 'bp-bar' })),
      el('p', { id: 'bp-status', class: 'bp-result' }, ''),
      res !== null ? el('p', { class: 'bp-result' + (res < 99.5 ? ' warn' : '') }, `Last bake: rays hit ${res.toFixed(1)}% of the surface`) : null,
      el('div', { class: 'row' }, el('label', {}, 'Output size'),
        select<number>(RESOLUTIONS.map((r) => ({ value: r, label: RES_LABEL(r) })), ts.size, (v) => this.setResolution(v))),
      el('button', { class: 'primary big', disabled: ts.baking || !BAKE_ITEMS.some(([k]) => maps[k]), onclick: () => this.startBake() },
        ts.baking ? 'Baking…' : `Bake selected textures (${BAKE_ITEMS.filter(([k]) => maps[k]).length})`),
      el('button', { class: 'big', onclick: () => this.setMode('paint') }, 'Return to painting mode'),
    );
    const title = this.bakeItem === 'common' ? 'Common parameters' : BAKE_ITEMS.find(([k]) => k === this.bakeItem)![1];
    host.append(dock(el('span', {}, 'Mesh map bakers'), el('div', { class: 'dock-body' }, list), 'bake-maps'),
      dock(el('span', {}, title), params, 'grow'),
      foot);
    this.updateBakeStatus();
    this.renderBakeRun();
  }

  private bakeParams(it: BakeItem): HTMLElement[] {
    const ts = this.ts;
    const hs = ts.highSettings;
    const bs = ts.bakeSettings;
    const cage = () => this.updateCage();
    const pick = <T extends string>(label: string, opts: [T, string][], value: T, set: (v: T) => void, title = '') =>
      el('div', { class: 'row', title }, el('label', {}, label), select<T>(opts.map(([v, l]) => ({ value: v, label: l })), value, (v) => { set(v); this.buildBakeDock(); }));
    const text = (label: string, value: string, set: (v: string) => void, title = '') => {
      const i = el('input', { type: 'text', value, spellcheck: false, class: 'grow' }) as HTMLInputElement;
      i.addEventListener('change', () => { set(i.value.trim()); this.buildBakeDock(); });
      return el('div', { class: 'row', title }, el('label', {}, label), i);
    };
    const selfOpts: ['always' | 'name', string][] = [['always', 'Always'], ['name', 'Only same mesh name']];
    const restore = (keys: string[], th = false) => el('div', { class: 'row' }, el('button', { class: 'grow', onclick: () => {
      for (const k of keys) delete (bs as any)[k];
      if (th) { const d = { ...DEFAULT_THICK }; for (const k of Object.keys(ts.thickSettings)) delete (ts.thickSettings as any)[k]; Object.assign(ts.thickSettings, d); }
      this.buildBakeDock(); toast('Restored the defaults');
    } }, 'Restore defaults'));
    if (it === 'common') {
      const high = this.high;
      const demo = demoHighPoly(this.model);
      const useLow = el('input', { type: 'checkbox', checked: !this.useHigh || !high }) as HTMLInputElement;
      useLow.disabled = !high;
      useLow.addEventListener('change', () => { this.useHigh = !useLow.checked; this.buildBakeDock(); cage(); });
      const showCage = el('input', { type: 'checkbox', checked: this.showCage }) as HTMLInputElement;
      showCage.addEventListener('change', () => { this.showCage = showCage.checked; cage(); });
      const showHigh = el('input', { type: 'checkbox', checked: this.showHigh, disabled: !high }) as HTMLInputElement;
      showHigh.addEventListener('change', () => { this.showHigh = showHigh.checked; cage(); });
      const avg = el('input', { type: 'checkbox', checked: hs.average }) as HTMLInputElement;
      avg.addEventListener('change', () => { hs.average = avg.checked; cage(); });
      const cageOn = !!high && this.useHigh;
      return [
        group('Output',
          el('div', { class: 'row' }, el('label', {}, 'Output size'),
            select<number>(RESOLUTIONS.map((r) => ({ value: r, label: RES_LABEL(r) })), ts.size, (v) => this.setResolution(v, true))),
          el('p', { class: 'note' }, `The size the maps are baked at (and the texture set size${this.sets.length > 1 ? ', for every texture set' : ''}). 4K takes longer: bake at 1K or 2K while setting up, then 4K for the final.`),
          el('p', { class: 'note' }, 'Nothing bakes automatically: tick the maps you want on the left, then click Bake.'),
          (() => {
            const cb = el('input', { type: 'checkbox', checked: bs.gpuRays !== false }) as HTMLInputElement;
            cb.addEventListener('change', () => { bs.gpuRays = cb.checked; });
            return el('label', { class: 'check-row', title: 'Ambient occlusion, curvature and thickness rays run on the graphics card, like Substance. Turn it off only if a bake comes out wrong on your card.' },
              cb, ' Bake on the graphics card (GPU, much faster)');
          })(),
        ),
        group('High definition meshes',
          high
            ? el('div', { class: 'bp-file' }, el('span', { class: 'name', title: high.name }, high.name), el('span', { class: 'tris' }, `${high.triangles.toLocaleString()} tris`))
            : el('div', { class: 'bp-file' }, el('span', { class: 'name muted' }, ts.highName ? `Last bake used: ${ts.highName}` : 'No high poly loaded')),
          el('div', { class: 'row' },
            el('button', { class: 'grow', onclick: async () => { const f = await pickFile('.glb,.gltf,.fbx,.obj'); if (f) this.loadHighPoly(f); } }, 'Load high poly…'),
            demo && !high ? el('button', { title: 'A detailed sci-fi version of the rounded box, to try it out', onclick: () => this.setHigh(demoHighPoly(this.model)) }, 'Demo') : null,
            high ? el('button', { onclick: () => this.setHigh(null) }, 'Remove') : null,
          ),
          el('label', { class: 'check-row', title: 'High → low baking is optional: with this ticked (or no high poly loaded), maps are baked from the low poly itself' }, useLow, ' Use low poly mesh as high poly'),
          el('label', { class: 'check-row' }, showHigh, ' Show high poly in the 3D view'),
          el('p', { class: 'note' }, 'Export high and low from the same scene so they line up. The high poly doesn\'t need UVs.'),
        ),
        group('Matching by mesh name',
          pick<'always' | 'name'>('Match', [['always', 'Always'], ['name', 'By mesh name']], bs.matchBy ?? 'always', (v) => (bs.matchBy = v),
            'Always: every high poly mesh can project onto every low poly mesh. By mesh name: Helmet_low only takes detail from Helmet_high'),
          text('Low poly suffix', bs.lowSuffix ?? '_low', (v) => (bs.lowSuffix = v || '_low')),
          text('High poly suffix', bs.highSuffix ?? '_high', (v) => (bs.highSuffix = v || '_high')),
          text('Ignore backface suffix', bs.bfSuffix ?? '_ignorebf', (v) => (bs.bfSuffix = v || '_ignorebf'), 'Meshes with this in their name ignore back faces when AO\'s Ignore backface is set to By mesh name'),
          this.nameMatchInfo(),
          el('p', { class: 'note' }, 'Name the meshes in your 3D app like Body_low / Body_high, Helmet_low / Helmet_high. Stops parts that sit close together from baking onto each other. AO, curvature and thickness have their own "Only same mesh name" option.'),
        ),
        el('div', { class: 'group' + (cageOn ? '' : ' dim') },
          el('h4', {}, 'Ray distance (cage)'),
          slider('Max frontal', { min: 0.001, max: 0.25, step: 0.001, value: hs.front, fmt: (v) => v.toFixed(3), onInput: (v) => { hs.front = v; cage(); } }).el,
          slider('Max rear', { min: 0.001, max: 0.25, step: 0.001, value: hs.rear, fmt: (v) => v.toFixed(3), onInput: (v) => { hs.rear = v; cage(); } }).el,
          el('div', { class: 'bp-legend' },
            el('span', {}, el('i', { class: 'swatch-dot', style: { background: '#3b82f6' } }), 'Blue = frontal'),
            el('span', {}, el('i', { class: 'swatch-dot', style: { background: '#ef4444' } }), 'Red = rear')),
          el('label', { class: 'check-row' }, showCage, ' Show cage'),
          el('label', { class: 'check-row', title: 'Rays follow normals averaged across hard edges, so the cage doesn\'t split open' }, avg, ' Average normals'),
          (() => { const c = el('input', { type: 'checkbox', checked: !!hs.ignoreBack }) as HTMLInputElement; c.addEventListener('change', () => (hs.ignoreBack = c.checked));
            return el('label', { class: 'check-row', title: 'Rays skip high poly faces they hit from behind (needs normals pointing outwards)' }, c, ' Ignore backface'); })(),
          el('p', { class: 'note' }, 'All the high poly detail should sit between the blue and red shells. The 2D view shows the Ray check: red where rays missed — raise the distances there.'),
        ),
      ];
    }
    const fromHigh = this.high && this.useHigh ? 'from the high poly' : 'from the low poly (no high poly in use)';
    if (it === 'normal') return [group('Normal',
      el('p', { class: 'note' }, 'Tangent-space normal map from the high poly (OpenGL, Y+). It becomes the base of the final normal; height and normal layers stack on top. The Unreal export converts it to DirectX.'),
      el('p', { class: 'note' }, this.high && this.useHigh ? '' : 'With no high poly this map is flat.'),
    )];
    if (it === 'height') return [group('Height',
      el('p', { class: 'note' }, 'Distance between the high and low surface (0.5 = on the low poly). The range is ± the larger cage distance.'),
    )];
    if (it === 'wsn') return [group('World space normal',
      el('p', { class: 'note' }, `Surface direction in model space (RGB = XYZ), ${fromHigh}. Used for direction-based effects like dust and snow.`),
    )];
    if (it === 'pos') {
      const pm = bs.posMode ?? 'all', pn = bs.posNorm ?? 'bbox';
      return [group('Position',
        pick<'all' | 'x' | 'y' | 'z'>('Mode', [['all', 'All axes (RGB = XYZ)'], ['x', 'Single axis: X'], ['y', 'Single axis: Y'], ['z', 'Single axis: Z']], pm, (v) => (bs.posMode = v)),
        pick<'bbox' | 'bsphere' | 'none'>('Normalization', [['bbox', 'Bounding box'], ['bsphere', 'Bounding sphere'], ['none', 'None']], pn, (v) => (bs.posNorm = v),
          'Bounding box stretches each axis to fill 0–1. Bounding sphere keeps the same scale on every axis. None keeps the raw position'),
        el('p', { class: 'note' }, `Position on the model, ${fromHigh}. Used for gradients and the Position generator. Bounding box (the default) makes each axis go from black to white across the model.`),
        restore(['posMode', 'posNorm']),
      )];
    }
    if (it === 'id') {
      const srcs = (Object.keys(ID_SOURCE_LABEL) as IdSource[]).filter((k) =>
        k !== 'vertex' || (this.high && this.useHigh ? this.high.geometries : this.ts.geometries).some((g) => g.attributes.color));
      return [group('ID',
        el('div', { class: 'row' }, el('label', {}, 'Color source'),
          select<IdSource>(srcs.map((k) => ({ value: k, label: ID_SOURCE_LABEL[k] })), srcs.includes(ts.idSource) ? ts.idSource : 'auto', (v) => { ts.idSource = v; this.buildBakeDock(); })),
        el('p', { class: 'note' }, `Gives every ${ts.idSource === 'auto' ? 'material (or, with one material, object / mesh part / UV island)' : ts.idSource === 'island' ? 'UV island' : ts.idSource === 'object' ? 'object' : ts.idSource === 'material' ? 'material' : ts.idSource === 'vertex' ? 'vertex color region' : 'separate mesh part'} its own flat color, ${fromHigh}. Then use Mask → Smart mask: ID color selection to put a material on one color. Optional: untick it if you don't need it.`),
      )];
    }
    if (it === 'thick') {
      const th = ts.thickSettings;
      return [group('Thickness',
        slider('Rays', { min: 8, max: 96, step: 4, value: th.rays, fmt: (v) => v.toFixed(0), onInput: (v) => (th.rays = v) }).el,
        slider('Min occluder distance', { min: 0.00001, max: 0.01, step: 0.00001, value: th.minDist ?? 0.00001, fmt: (v) => v.toFixed(5), onInput: (v) => (th.minDist = v) }).el,
        slider('Max distance', { min: 0.02, max: 1, step: 0.01, value: th.maxDist, fmt: (v) => v.toFixed(2), onInput: (v) => (th.maxDist = v) }).el,
        slider('Spread angle', { min: 10, max: 180, step: 1, value: th.spread ?? 180, fmt: (v) => `${v.toFixed(0)}°`, onInput: (v) => (th.spread = v) }).el,
        pick<'cosine' | 'uniform'>('Distribution', [['cosine', 'Cosine'], ['uniform', 'Uniform']], th.dist ?? 'cosine', (v) => (th.dist = v)),
        pick<'always' | 'name'>('Self occlusion', selfOpts, th.self ?? 'always', (v) => (th.self = v), 'Only same mesh name: a part is only thick or thin by its own geometry, not the meshes next to it'),
        el('p', { class: 'note' }, 'White = thick, black = thin (like Substance). Distances are fractions of the bounding box. Normalised relative to the thinnest and thickest point. Used by the Thickness smart mask (e.g. light through thin parts).'),
        restore([], true),
      )];
    }
    const method = () => el('div', { class: 'row' }, el('label', {}, 'Method'),
      select<string>([{ value: 'rays', label: 'Ray traced (like Substance)' }, { value: 'gpu', label: 'Fast preview (GPU)' }], bs.method ?? 'rays', (v) => { bs.method = v as any; this.buildBakeDock(); }));
    const traced = (bs.method ?? 'rays') !== 'gpu';
    if (it === 'ao') return [group('Ambient occlusion',
      method(),
      ...(traced ? [
        slider('Secondary rays', { min: 8, max: 256, step: 8, value: bs.aoRays ?? 64, fmt: (v) => v.toFixed(0), onInput: (v) => (bs.aoRays = v) }).el,
        slider('Max occluder distance', { min: 0.005, max: 1, step: 0.005, value: bs.aoMax ?? 0.1, fmt: (v) => v.toFixed(3), onInput: (v) => (bs.aoMax = v) }).el,
        slider('Spread angle', { min: 10, max: 180, step: 1, value: bs.aoSpread ?? 180, fmt: (v) => `${v.toFixed(0)}°`, onInput: (v) => (bs.aoSpread = v) }).el,
        el('div', { class: 'row' }, el('label', {}, 'Distribution'),
          select<string>([{ value: 'cosine', label: 'Cosine' }, { value: 'uniform', label: 'Uniform' }], bs.aoDist ?? 'cosine', (v) => (bs.aoDist = v as any))),
        el('div', { class: 'row' }, el('label', {}, 'Attenuation'),
          select<string>([{ value: 'none', label: 'None' }, { value: 'linear', label: 'Linear' }, { value: 'smooth', label: 'Smooth' }], bs.aoAtten ?? 'linear', (v) => (bs.aoAtten = v as any))),
        pick<'never' | 'always' | 'name'>('Ignore backface', [['never', 'Never'], ['always', 'Always'], ['name', 'By mesh name']], bs.aoBack ?? 'never', (v) => (bs.aoBack = v),
          'Rays pass through faces they hit from behind. By mesh name: only on meshes whose name has the ignore backface suffix (_ignorebf)'),
        pick<'always' | 'name'>('Self occlusion', selfOpts, bs.aoSelf ?? 'always', (v) => (bs.aoSelf = v),
          'Only same mesh name: a part is only darkened by itself (and its matching high poly), not by the parts next to it'),
        (() => { const c = el('input', { type: 'checkbox', checked: !!bs.aoGround }) as HTMLInputElement; c.addEventListener('change', () => { bs.aoGround = c.checked; this.buildBakeDock(); }); return el('label', { class: 'check-row' }, c, ' Ground plane'); })(),
        el('div', { class: bs.aoGround ? '' : 'dim' }, slider('Ground plane offset', { min: -0.5, max: 0.5, step: 0.005, value: bs.aoGroundOffset ?? 0, fmt: (v) => v.toFixed(3), onInput: (v) => (bs.aoGroundOffset = v) }).el),
        el('p', { class: 'note' }, 'Same parameters and defaults as Substance Painter\'s Ambient Occlusion baker: 64 rays, max occluder distance 0.1 of the bounding box, 180° spread, cosine distribution, linear attenuation.'),
        restore(['aoRays', 'aoMax', 'aoMin', 'aoSpread', 'aoDist', 'aoAtten', 'aoGround', 'aoGroundOffset', 'aoSelf', 'aoBack']),
      ] : [
        el('div', { class: 'row' }, el('label', {}, 'Quality'),
          select<number>(BAKE_QUALITY, BAKE_QUALITY.some((q) => q.value === bs.samples) ? bs.samples : 96, (v) => (bs.samples = v))),
      ]),
      slider('Viewport AO', { min: 0, max: 1, step: 0.01, value: this.vp.litMat.aoMapIntensity, onInput: (v) => (this.vp.aoStrength = v) }).el,
      el('p', { class: 'note' }, 'Used by the Dirt and AO smart masks, the viewport shading and the exported AO / ORM maps.'),
    )];
    return [group('Curvature',
      method(),
      ...(traced ? [
        slider('Secondary rays', { min: 8, max: 128, step: 4, value: bs.curvRays ?? 32, fmt: (v) => v.toFixed(0), onInput: (v) => (bs.curvRays = v) }).el,
        slider('Sampling radius', { min: 0.001, max: 0.05, step: 0.0005, value: bs.curvRadius ?? 0.005, fmt: (v) => v.toFixed(4), onInput: (v) => (bs.curvRadius = v) }).el,
        slider('Contrast', { min: 0.25, max: 4, step: 0.05, value: bs.curvStrength, fmt: (v) => v.toFixed(2), onInput: (v) => (bs.curvStrength = v) }).el,
        pick<'always' | 'name'>('Self intersection', selfOpts, bs.curvSelf ?? 'always', (v) => (bs.curvSelf = v),
          'Only same mesh name: edges only come from the part itself, not from where it touches other parts'),
        el('p', { class: 'note' }, 'Like Substance\'s Curvature baker: rays sample the geometry within the sampling radius (relative to the bounding box), then the result is tonemapped automatically. Convex edges white, cavities black, flat 50% gray. Bigger radius = wider edges.'),
        restore(['curvRays', 'curvRadius', 'curvSelf']),
      ] : [
        slider('Edge width', { min: 0.004, max: 0.06, step: 0.001, value: bs.edgeWidth, fmt: (v) => v.toFixed(3), onInput: (v) => (bs.edgeWidth = v) }).el,
        slider('Strength', { min: 0.5, max: 4, step: 0.05, value: bs.curvStrength, fmt: (v) => v.toFixed(2), onInput: (v) => (bs.curvStrength = v) }).el,
      ]),
      el('p', { class: 'note' }, 'Drives the Edge wear and Dirt smart masks.'),
    )];
  }

  // ================================================================ right: texture set list, layers, properties

  buildRight() {
    const host = document.getElementById('right')!;
    host.innerHTML = '';
    const ts = this.ts;
    const sets = this.sets.length ? this.sets : [{ name: this.model.name, ts, geos: [], visible: true }];
    const rows = sets.map((st, i) => {
      const eye = el('button', { class: 'ts-eye', title: st.visible ? 'Hide this texture set on the model' : 'Show this texture set', onclick: (e: Event) => { e.stopPropagation(); this.toggleSetVisible(i); } });
      eye.innerHTML = st.visible ? I.eye : I.eyeOff;
      return el('div', {
        class: 'ts-row' + (i === this.activeSet ? ' on' : '') + (st.visible ? '' : ' hidden'),
        title: sets.length > 1 ? 'Click to paint this texture set (its own layers and textures). Double-click a part of the model to jump to its set.' : '',
        onclick: () => this.switchSet(i),
      }, eye, el('span', { class: 'name' }, st.name), el('span', { class: 'muted' }, `${st.ts.size}×${st.ts.size}`), el('span', { class: 'muted' }, 'PBR metal/rough'));
    });
    const tsList = dock(el('span', {}, sets.length > 1 ? `Texture set list (${sets.length})` : 'Texture set list'),
      el('div', { class: 'dock-body tight ts-rows' }, ...rows), 'ts-list');
    if (this.mode === 'bake') {
      host.append(tsList, dock(el('span', {}, 'Baked mesh maps'), el('div', { class: 'dock-body' }, this.mapGrid(),
        el('p', { class: 'note' }, 'Click a map to show it in the 2D view.')), 'grow'));
      return;
    }
    const tabs = el('div', { class: 'dock-tabs' },
      el('button', { class: this.layersTab === 'layers' ? 'on' : '', onclick: () => { this.layersTab = 'layers'; this.buildRight(); } }, 'Layers'),
      el('button', { class: this.layersTab === 'settings' ? 'on' : '', onclick: () => { this.layersTab = 'settings'; this.buildRight(); } }, 'Texture set settings'));
    const layersDock = el('section', { class: 'dock layers-dock' }, tabs,
      this.layersTab === 'layers' ? this.layersBody() : this.settingsBody());
    const propsDock = el('section', { class: 'dock props-dock' });
    host.append(tsList, layersDock, propsDock);
    this.buildProperties();
  }

  private mapGrid() {
    const grid = el('div', { class: 'map-grid' });
    const maps: [ViewMode, string][] = [['bnormal', 'Normal'], ['wsn', 'World normal'], ['id', 'ID'], ['ao', 'AO'], ['curv', 'Curvature'],
      ['pos', 'Position'], ['thick', 'Thickness'], ['bheight', 'Height'], ['rays', 'Ray check']];
    for (const [v, label] of maps) {
      const img = el('img', { alt: label }) as HTMLImageElement;
      const cached = this.mapThumbs.get(v);
      if (cached) img.src = cached;
      else this.mapThumb(v).then((u) => { this.mapThumbs.set(v, u); img.src = u; });
      grid.append(el('button', { class: 'map-tile' + (this.view2 === v ? ' on' : ''), onclick: () => {
        this.view2 = v; if (this.layout3 === '3d') this.setLayout('split'); this.applyViews(); this.buildRight();
      } }, img, el('span', {}, label)));
    }
    return grid;
  }

  private async mapThumb(v: ViewMode) {
    return 'data:image/png;base64,' + await this.viewForTest(v, 96);
  }

  private layersBody() {
    const ts = this.ts;
    const active = ts.activeLayer;
    this.syncSel();
    const maskMenu = el('div', { class: 'menu mask-menu' });
    const mm = el('div', { class: 'menu-items' });
    const addMask = (base: 'white' | 'black', gen: GenType | null) => {
      if (!active) return;
      maskMenu.classList.remove('open');
      this.addMaskTo(active, base, gen);
    };
    mm.append(
      el('button', { onclick: () => addMask('white', null) }, 'Add white mask'),
      el('button', { onclick: () => addMask('black', null) }, 'Add black mask'),
      el('hr'),
      el('div', { class: 'menu-label' }, 'Smart mask presets'),
      ...SMART_MASKS.map((p) => el('button', { onclick: () => { maskMenu.classList.remove('open'); this.applySmartMaskTo(active, p.id); } }, p.label)),
      el('hr'),
      el('div', { class: 'menu-label' }, 'Single generator'),
      ...GEN_TYPES.map((t) => el('button', { onclick: () => addMask('black', t) }, `Smart mask: ${GEN_LABEL[t]}`)),
      ...(active?.mask ? [el('hr'), el('button', { onclick: () => { ts.removeMask(active); this.paintTarget = 'content'; this.modified = true; maskMenu.classList.remove('open'); } }, 'Remove mask')] : []),
    );
    const mBtn = icon(I.addMask, 'Add a mask (white, black or smart mask)', () => {});
    mBtn.onclick = (e) => { e.stopPropagation(); const o = maskMenu.classList.contains('open'); document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')); if (!o) maskMenu.classList.add('open'); };
    if (!active) mBtn.disabled = true;
    maskMenu.append(mBtn, mm);
    // Add effect (Substance's first layer-toolbar button): goes on the selected layer's content, or its mask if that's selected.
    const fxMenu = el('div', { class: 'menu fx-menu' });
    const fxAdd = (fn: () => void) => () => { fxMenu.classList.remove('open'); fn(); };
    const onMask = !!active?.mask && this.paintTarget === 'mask';
    const fxItems = el('div', { class: 'menu-items' },
      el('button', { onclick: fxAdd(() => active && (onMask ? this.addGenerator(active, { ...defaultGen('painter'), sp: spDefaults('dirt') }, true) : this.addFx(active, { ...defaultFx('generator'), gen: null }))) }, onMask ? 'Add generator (mask)' : 'Add generator'),
      el('button', { onclick: fxAdd(() => active && this.addPaintEffect(active)) }, 'Add paint'),
      el('button', { disabled: onMask, onclick: fxAdd(() => active && this.addFx(active, defaultFx('fill'))) }, 'Add fill'),
      el('button', { disabled: onMask, onclick: fxAdd(() => active && this.addFx(active, defaultFx('levels'))) }, 'Add levels'),
      el('button', { disabled: onMask, onclick: fxAdd(() => active && this.addFx(active, defaultFx('filter'))) }, 'Add filter'),
      el('button', { onclick: fxAdd(() => active && this.addMaskTo(active, 'black', 'id')) }, 'Add color selection'),
      el('button', { onclick: fxAdd(() => active && this.toggleAnchor(active)) }, active?.anchor ? 'Remove anchor point' : 'Add anchor point'));
    const fxBtn = icon(I.addMask, 'Add effect: generator, paint, fill, levels, filter…', () => {});
    fxBtn.classList.add('fx-btn'); fxBtn.textContent = 'fx';
    fxBtn.onclick = (e) => { e.stopPropagation(); const o = fxMenu.classList.contains('open'); document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')); if (!o) fxMenu.classList.add('open'); };
    if (!active || active.kind === 'group') fxBtn.disabled = true;
    fxMenu.append(fxBtn, fxItems);
    const tools = el('div', { class: 'layer-toolbar' },
      fxMenu,
      icon(I.layerPaint, 'Add paint layer', () => { this.paintTarget = 'content'; ts.addPaintLayer(); this.modified = true; }),
      icon(I.layerFill, 'Add fill layer', () => { this.paintTarget = 'content'; ts.addFillLayer(); this.modified = true; }),
      icon(I.folder2, 'Add folder', () => { this.paintTarget = 'content'; ts.addGroup(); this.modified = true; }),
      maskMenu,
      el('span', { class: 'grow' }),
      icon(I.up, 'Move up', () => active && ts.moveLayer(active.id, 1)),
      icon(I.down, 'Move down', () => active && ts.moveLayer(active.id, -1)),
      icon(I.trash, 'Delete layer (Delete) — all selected layers', () => this.deleteLayers(this.selection())),
    );
    const list = el('div', { class: 'layer-list' });
    this.layerRowEls.clear();
    this.rowOrder = [];
    const add = (layers: Layer[], depth: number) => {
      for (const l of [...layers].reverse()) {
        this.rowOrder.push(l.id);
        list.append(this.layerRow(l, depth));
        if (l.kind !== 'group') for (const f of [...(l.fx ?? [])].reverse()) list.append(this.fxRow(l, f, depth));
        if (l.kind === 'group' && l.open) add(l.children, depth + 1);
      }
    };
    add(ts.layers, 0);
    // Dropping an asset on empty space adds it at the top.
    list.addEventListener('dragover', (e) => { if (this.dragItem) e.preventDefault(); });
    list.addEventListener('drop', async (e) => {
      if (!this.dragItem || (e.target as HTMLElement).closest('.layer')) return;
      e.preventDefault();
      const items = this.dragList(this.dragItem); this.dragItem = null;
      this.ts.activeId = this.ts.layers[this.ts.layers.length - 1]?.id ?? -1;
      await this.addAssets(items);
    });
    return el('div', { class: 'dock-body layers-body' }, tools, list);
  }

  /** Substance-style: add a mask; a black mask means "paint white to reveal". */
  // ---------------------------------------------------------------- Shape generator: place and move

  /** The Shape generator being moved (dragging on the 3D view places it). */
  shapeMove: { layer: Layer; g: GenSettings; fill?: boolean } | null = null;
  /** Something the gizmo moves changed: a Shape mask, or a fill layer's planar projection. */
  private shapeChanged(sm: { layer: Layer; fill?: boolean }) { if (sm.fill) this.ts.markDirty(); else this.ts.maskChanged(sm.layer); }
  private shapeDragging = false;
  private shapeQueued: { x: number; y: number } | null = null;
  /** A planar projection facing the camera, at the middle of the 3D view (or at a point on the model). */
  private placeProjectionAtView(fill: FillLayer, at?: THREE.Vector3) {
    const r = this.vp.canvas.getBoundingClientRect(), v = this.vp.region;
    const p = at ?? this.pick(r.left + v.x + v.w / 2, r.top + v.y + v.h / 2)?.point;
    const xf = (fill.xf ??= { ...DEFAULT_XF });
    const cam = this.vp.camera.position.clone();
    const target = p ?? this.vp.controls.target.clone();
    xf.shapeAt = target.toArray() as [number, number, number];
    xf.shapeNormal = cam.sub(target).normalize().toArray() as [number, number, number];
    xf.shapeSize ??= 0.3; xf.shapeRot ??= 0;
    const img = fill.images?.color?.tex.image as { width?: number; height?: number } | undefined;
    xf.shapeAspect ??= img?.width && img?.height ? img.width / img.height : 1;
  }

  /** Substance-style: an image dropped on the model becomes a fill layer projected onto it where it was dropped. */
  async projectImage(f: File, x: number, y: number) {
    const hit = this.pick(x, y);
    const bytes = await f.arrayBuffer();
    let tex: THREE.Texture;
    try { tex = await imageTexture(bytes, f.name); } catch { toast(`Could not read the image ${f.name}`, true); return; }
    const name = f.name.replace(/\.[^.]+$/, '');
    const enabled: Partial<Record<Ch, boolean>> = { color: true };
    let layer!: FillLayer;
    await this.ts.batch(`Project ${f.name}`, () => {
      layer = this.ts.addFillLayer(name, undefined, enabled, true, { color: { name: f.name, bytes, tex } }, 1);
      layer.xf = { ...DEFAULT_XF, proj: 'planar', hideBack: true, useAlpha: true };
      this.placeProjectionAtView(layer, hit?.point);
    });
    this.ts.markAll();
    this.paintTarget = 'content';
    this.modified = true;
    this.refresh();
    this.shapeMove = null;
    this.toggleShapeMove(layer, layer.xf as unknown as GenSettings, true);
  }

  // ---------------------------------------------------------------- Planar projection: 3D manipulator (like Substance)
  private pj: { tc: TransformControls; obj: THREE.Object3D; helper: THREE.Object3D; layer: FillLayer; snap: (e: KeyboardEvent) => void } | null = null;

  private openProjGizmo(layer: FillLayer) {
    this.closeProjGizmo();
    const obj = new THREE.Object3D();
    // The projection box: the image's rectangle plus a line showing which way it projects.
    const pts = [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, -0.5, 0],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5],
      [-0.5, -0.5, 0], [-0.5, -0.5, 0.5], [0.5, -0.5, 0], [0.5, -0.5, 0.5], [0.5, 0.5, 0], [0.5, 0.5, 0.5], [-0.5, 0.5, 0], [-0.5, 0.5, 0.5],
      [0, 0, 0.5], [0, 0, -0.5]].map((p) => new THREE.Vector3(...p));
    const box = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xb794ff, depthTest: false, transparent: true, opacity: 0.85 }));
    box.renderOrder = 998;
    obj.add(box);
    this.vp.scene.add(obj);
    const tc = new TransformControls(this.vp.camera, this.vp.canvas);
    tc.setSpace('local');
    tc.setSize(0.85);
    tc.attach(obj);
    const helper = tc.getHelper();
    this.vp.scene.add(helper);
    tc.addEventListener('change', () => this.poke());
    tc.addEventListener('dragging-changed', (ev) => {
      const on = !!(ev as unknown as { value: boolean }).value;
      this.vp.controls.enabled = !on;
      if (on) this.ts.checkpoint('Move projection');
      else { this.queueLayerThumbs(); this.buildProperties(); }
    });
    tc.addEventListener('objectChange', () => { this.projFromObj(); this.ts.markDirty(); this.modified = true; this.poke(); });
    // Shift: move / rotate / scale in steps (like Substance's manipulator settings).
    const snap = (e: KeyboardEvent) => {
      const rad = this.ts.shapeFrame(layer.xf as unknown as GenSettings).rad;
      tc.setTranslationSnap(e.shiftKey ? rad * 0.05 : null);
      tc.setRotationSnap(e.shiftKey ? THREE.MathUtils.degToRad(15) : null);
      tc.setScaleSnap(e.shiftKey ? 0.1 : null);
    };
    window.addEventListener('keydown', snap); window.addEventListener('keyup', snap);
    this.pj = { tc, obj, helper, layer, snap };
    this.projToObj();
    this.buildToolbar();
    this.poke();
  }

  private closeProjGizmo() {
    const pj = this.pj;
    if (!pj) return;
    window.removeEventListener('keydown', pj.snap); window.removeEventListener('keyup', pj.snap);
    pj.tc.detach(); pj.tc.dispose();
    this.vp.scene.remove(pj.obj); this.vp.scene.remove(pj.helper);
    pj.obj.traverse((o) => { const m = o as THREE.LineSegments; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.pj = null;
    this.vp.controls.enabled = true;
    this.poke();
  }

  /** Projection settings → the manipulated object (position, orientation, size). */
  private projToObj() {
    const pj = this.pj;
    if (!pj) return;
    const f = this.ts.shapeFrame(pj.layer.xf as unknown as GenSettings);
    pj.obj.position.copy(f.at);
    pj.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.u, f.v, f.n));
    pj.obj.scale.set(2 * f.hx, 2 * f.hy, 2 * Math.max(f.hx, f.hy));
  }

  /** The manipulated object → projection settings. */
  private projFromObj() {
    const pj = this.pj;
    if (!pj) return;
    const xf = (pj.layer.xf ??= { ...DEFAULT_XF });
    const q = pj.obj.quaternion;
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q), n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u0 = new THREE.Vector3().crossVectors(ref, n).normalize(), v0 = new THREE.Vector3().crossVectors(n, u0);
    const rad = this.ts.shapeFrame(xf as unknown as GenSettings).rad;
    const sx = Math.max(1e-4, Math.abs(pj.obj.scale.x)), sy = Math.max(1e-4, Math.abs(pj.obj.scale.y));
    xf.shapeAt = pj.obj.position.toArray() as [number, number, number];
    xf.shapeNormal = n.toArray() as [number, number, number];
    xf.shapeRot = THREE.MathUtils.radToDeg(Math.atan2(u.dot(v0), u.dot(u0)));
    xf.shapeSize = sy / 2 / rad;
    xf.shapeAspect = sx / sy;
  }

  private resetProjection() {
    const pj = this.pj;
    if (!pj) return;
    this.ts.checkpoint('Reset projection');
    const xf = pj.layer.xf!;
    delete xf.shapeAt; xf.shapeSize = 0.3; xf.shapeRot = 0; delete xf.shapeAspect;
    this.placeProjectionAtView(pj.layer);
    this.projToObj();
    this.ts.markDirty(); this.modified = true; this.poke(); this.buildProperties();
  }

  /** Put a new shape where the middle of the 3D view hits the model. */
  private placeShapeAtView(g: GenSettings) {
    const r = this.vp.canvas.getBoundingClientRect(), v = this.vp.region;
    const hit = this.pick(r.left + v.x + v.w / 2, r.top + v.y + v.h / 2);
    if (hit) { g.shapeAt = hit.point.toArray() as [number, number, number]; g.shapeNormal = hit.normal.clone().normalize().toArray() as [number, number, number]; }
  }
  // Handles in the 3D view: middle = move, ring knob = rotate, square = resize (like Substance's projection gizmo).
  private gizmo: HTMLElement | null = null;
  private gizmoRaf = 0;
  private showGizmo(on: boolean) {
    cancelAnimationFrame(this.gizmoRaf);
    if (!on) { this.gizmo?.remove(); this.gizmo = null; return; }
    if (!this.gizmo) {
      const gz = el('div', { id: 'shape-gizmo' },
        el('div', { class: 'gz-ring' }), el('div', { class: 'gz-move', title: 'Drag to move the shape' }),
        el('div', { class: 'gz-rot', title: 'Drag to turn the shape' }), el('div', { class: 'gz-scale', title: 'Drag to resize the shape' }));
      document.body.append(gz);
      this.gizmo = gz;
      const drag = (cls: string, kind: 'move' | 'rot' | 'scale') => gz.querySelector(cls)!.addEventListener('pointerdown', (ev) => {
        const e = ev as PointerEvent, sm = this.shapeMove;
        if (!sm) return;
        e.preventDefault(); e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        this.ts.checkpoint(sm.fill ? (kind === 'move' ? 'Move projection' : kind === 'rot' ? 'Rotate projection' : 'Resize projection') : kind === 'move' ? 'Move shape' : kind === 'rot' ? 'Rotate shape' : 'Resize shape');
        const st = this.gizmoState();
        if (!st) return;
        const a0 = Math.atan2(e.clientY - st.cy, e.clientX - st.cx), d0 = Math.hypot(e.clientX - st.cx, e.clientY - st.cy) || 1;
        const rot0 = sm.g.shapeRot ?? 0, size0 = sm.g.shapeSize ?? 0.2;
        const move = (mv: PointerEvent) => {
          if (kind === 'move') { this.moveShapeTo(mv.clientX, mv.clientY); return; }
          if (kind === 'rot') {
            const a = Math.atan2(mv.clientY - st.cy, mv.clientX - st.cx);
            let r = rot0 + ((a - a0) * 180) / Math.PI * st.flip;
            r = ((r + 540) % 360) - 180;
            sm.g.shapeRot = Math.round(r);
          } else sm.g.shapeSize = Math.min(sm.fill ? 4 : 1.5, Math.max(0.01, size0 * (Math.hypot(mv.clientX - st.cx, mv.clientY - st.cy) / d0)));
          this.shapeChanged(sm); this.modified = true; this.poke();
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.queueLayerThumbs(); this.buildProperties(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      drag('.gz-move', 'move'); drag('.gz-rot', 'rot'); drag('.gz-scale', 'scale');
    }
    const tick = () => {
      const st = this.gizmoState(), gz = this.gizmo;
      if (!gz) return;
      if (!st) gz.style.display = 'none';
      else {
        gz.style.display = 'block';
        const r = Math.max(18, st.r);
        Object.assign((gz.querySelector('.gz-ring') as HTMLElement).style, { left: `${st.cx - r}px`, top: `${st.cy - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
        Object.assign((gz.querySelector('.gz-move') as HTMLElement).style, { left: `${st.cx}px`, top: `${st.cy}px` });
        const ra = st.angle - Math.PI / 2;
        Object.assign((gz.querySelector('.gz-rot') as HTMLElement).style, { left: `${st.cx + Math.cos(ra) * r}px`, top: `${st.cy + Math.sin(ra) * r}px` });
        Object.assign((gz.querySelector('.gz-scale') as HTMLElement).style, { left: `${st.cx + r * 0.7071}px`, top: `${st.cy + r * 0.7071}px` });
      }
      this.gizmoRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  /** Where the shape is on screen: centre, radius, the angle of its "up" and whether the view mirrors it. */
  private gizmoState(): { cx: number; cy: number; r: number; angle: number; flip: number } | null {
    const sm = this.shapeMove;
    if (!sm || sm.g.shapeProj === 'uv' || this.layout3 === '2d') return null;
    const f = this.ts.shapeFrame(sm.g);
    const c = this.toScreen(f.at);
    const pu = this.toScreen(f.at.clone().addScaledVector(f.u, f.hx));
    const pv = this.toScreen(f.at.clone().addScaledVector(f.v, f.hy));
    if (!c || !pu || !pv) return null;
    const ux = pu.x - c.x, uy = pu.y - c.y, vx = pv.x - c.x, vy = pv.y - c.y;
    return { cx: c.x, cy: c.y, r: Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy)), angle: Math.atan2(vy, vx) + Math.PI / 2, flip: ux * vy - uy * vx > 0 ? -1 : 1 };
  }

  toggleShapeMove(layer: Layer, g: GenSettings, fill = false) {
    this.shapeMove = this.shapeMove?.g === g ? null : { layer, g, fill };
    document.body.classList.toggle('moving-shape', !!this.shapeMove);
    // Projected images get Substance's 3D manipulator (move / rotate / scale per axis); shapes keep the on-screen handles.
    this.showGizmo(!!this.shapeMove && !fill);
    if (this.shapeMove && fill) this.openProjGizmo(layer as FillLayer); else this.closeProjGizmo();
    if (this.shapeMove) toast(fill ? 'Drag the arrows to move, the rings to rotate, the cubes to stretch (W / E / R switch). Drag on the model to stick it to the surface. Shift snaps. Esc when done.' : 'Drag on the model to move the shape. Esc when done.');
    this.buildToolbar(); this.buildProperties();
  }
  private moveShapeTo(x: number, y: number) {
    this.shapeQueued = { x, y };
    requestAnimationFrame(() => {
      const q = this.shapeQueued, sm = this.shapeMove;
      if (!q || !sm) return;
      this.shapeQueued = null;
      const hit = this.pick(q.x, q.y);
      if (!hit) return;
      sm.g.shapeAt = hit.point.toArray() as [number, number, number];
      sm.g.shapeNormal = hit.normal.clone().normalize().toArray() as [number, number, number];
      this.shapeChanged(sm);
      if (sm.fill && this.pj) this.projToObj();
      this.modified = true;
      this.poke();
    });
  }

  /** Anchor point (Substance): this layer's height details become usable as micro details by generators. */
  toggleAnchor(l: Layer) {
    const ts = this.ts;
    ts.checkpoint(l.anchor ? 'Remove anchor point' : 'Add anchor point');
    l.anchor = !l.anchor;
    // Anchor names must be unique, generators find them by name.
    if (l.anchor && ts.allLayers.some((x) => x !== l && x.anchor && x.name === l.name)) l.name = `${l.name} ${l.id}`;
    ts.markAll();
    this.modified = true;
    this.refresh();
    if (l.anchor) toast(`“${l.name}” is an anchor point. On another layer's Edge wear / Dirt / Curvature generator, set "Micro details" to it.`);
  }
  /** Make a (shape-masked) fill layer a height detail: pressed in or sticking out, and an anchor point. */
  makeHeightDetail(l: Layer, dir: 'in' | 'out') {
    if (l.kind !== 'fill') return;
    const ts = this.ts;
    ts.checkpoint('Height detail');
    for (const ch of Object.keys(l.enabled) as Ch[]) l.enabled[ch] = ch === 'height';
    l.values.height = dir === 'in' ? 0.38 : 0.62;
    if (!l.anchor) { l.anchor = true; if (ts.allLayers.some((x) => x !== l && x.anchor && x.name === l.name)) l.name = `${l.name} ${l.id}`; }
    ts.markAll();
    this.modified = true;
    this.refresh();
    toast(`“${l.name}” now ${dir === 'in' ? 'presses into' : 'sticks out of'} the surface and is an anchor point. Give another layer an Edge wear or Dirt mask and pick it under "Micro details".`);
  }

  addMaskTo(layer: Layer, base: 'white' | 'black', gen: GenType | null) {
    const g = gen ? defaultGen(gen) : null;
    if (g?.type === 'shape') this.placeShapeAtView(g);
    this.ts.addMask(layer, { base, gen: g });
    this.ts.activeId = layer.id;
    if (g?.type === 'shape' && layer.mask?.gen) { this.shapeMove = { layer, g: layer.mask.gen }; document.body.classList.add('moving-shape'); this.showGizmo(true); toast('Shape added. Drag on the model to move it, then press Esc (or Done) when it\'s where you want it.'); }
    this.paintTarget = 'mask';
    this.modified = true;
    if (base === 'black' && !gen) {
      if (this.tool !== 'paint' && this.tool !== 'fill' && this.tool !== 'path') this.setTool('paint');
      toast(`Black mask on “${layer.name}”: paint on the model to reveal it (Erase hides again). Polygon fill (G) fills whole parts.`);
    }
    this.refresh();
  }

  // ================================================================ Material Designer links

  private linkedGraphLayer(): FillLayer | null {
    const l = this.ts.allLayers.find((x) => x.id === this.designLinked);
    return l?.kind === 'fill' ? l : null;
  }

  private async hdrThumb(it: Extract<ShelfItem, { kind: 'env' }>): Promise<string> {
    const key = 'hdr:' + it.file;
    const c = this.hdrThumbs.get(key);
    if (c) return c;
    const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
    const url = URL.createObjectURL(await it.src());
    try {
      const tex: any = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(url);
      const { data, width, height } = tex.image as { data: Float32Array; width: number; height: number };
      const W = 112, H = 112, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d')!, img = ctx.createImageData(W, H);
      const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        // centre half of the panorama (horizon band)
        const sx = Math.floor(((x / W) * 0.5 + 0.25) * width), sy = Math.floor(((y / H) * 0.6 + 0.15) * height);
        const o = (sy * width + sx) * 4, d = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) img.data[d + k] = Math.round(Math.pow(aces(data[o + k] * 0.8), 1 / 2.2) * 255);
        img.data[d + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      tex.dispose();
      const u = cv.toDataURL();
      this.hdrThumbs.set(key, u);
      return u;
    } finally { URL.revokeObjectURL(url); }
  }
  private hdrThumbs = new Map<string, string>();

  private graphThumbs = new Map<string, string>();
  private async graphThumb(g: GraphJSON): Promise<string> {
    const key = g.name + ':' + JSON.stringify(g).length;
    const c = this.graphThumbs.get(key);
    if (c) return c;
    const r = this.graphRunner;
    for (const cc of g.custom ?? []) r.setCustom(cc);
    await r.run({ ...g, size: 128 });
    const outs = r.outputs(g);
    const cv = document.createElement('canvas'); cv.width = cv.height = 112;
    const id = outs.color ?? Object.values(outs)[0];
    if (id != null) r.preview(id, cv);
    const u = cv.toDataURL();
    this.graphThumbs.set(key, u);
    return u;
  }

  /** Render a graph into fresh fill images (opening projects / duplicating layers). */
  private async bakeGraph(g: GraphJSON): Promise<Partial<Record<Ch, FillImage>>> {
    const r = this.graphRunner;
    for (const c of g.custom ?? []) r.setCustom(c);
    await r.run(g);
    const out: Partial<Record<Ch, FillImage>> = {};
    for (const [ch, id] of Object.entries(r.outputs(g)) as [Ch, number][]) {
      const rt = r.copyOut(id, g.size);
      if (rt) out[ch] = { name: 'graph:' + ch, bytes: new ArrayBuffer(0), tex: rt.texture, rt };
    }
    return out;
  }

  /** Designer → fill layer: a new layer, or refresh the linked one in place. */
  private async applyGraph(g: GraphJSON, runner: GraphRunner, mode: 'new' | 'linked'): Promise<string | null> {
    const outs = runner.outputs(g);
    if (!Object.keys(outs).length) { toast('The graph has no Output nodes yet', true); return null; }
    let layer = mode === 'linked' ? this.linkedGraphLayer() : null;
    if (mode === 'linked' && !layer) return null;
    const copy = (id: number, prev?: FillImage): FillImage | null => {
      if (prev?.rt && prev.rt.width === g.size) {
        // Same size: re-render into the layer's own texture (live updates don't pile up textures).
        runner.copyInto(id, prev.rt);
        return prev;
      }
      const rt = runner.copyOut(id, g.size);
      return rt ? { name: prev?.name ?? 'graph', bytes: new ArrayBuffer(0), tex: rt.texture, rt } : null;
    };
    if (!layer) {
      const enabled: Partial<Record<Ch, boolean>> = {};
      const images: Partial<Record<Ch, FillImage>> = {};
      for (const [ch, id] of Object.entries(outs) as [Ch, number][]) {
        const im = copy(id);
        if (im) { im.name = 'graph:' + ch; images[ch] = im; enabled[ch] = true; }
      }
      for (const ch of CHANNELS) enabled[ch] ??= false;
      layer = this.ts.addFillLayer(g.name, undefined, enabled, true, images, 1);
      layer.graph = structuredClone(g);
      this.designLinked = layer.id;
      this.modified = true;
      this.ts.layerChanged();
      this.buildRight();
      return layer.name;
    }
    const imgs = (layer.images ??= {});
    for (const ch of OUTPUT_CHANNELS as readonly Ch[]) {
      const id = outs[ch as keyof typeof outs];
      const prev = imgs[ch];
      if (id == null) { if (prev?.name.startsWith('graph:')) { delete imgs[ch]; layer.enabled[ch] = false; } continue; }
      const im = copy(id, prev?.name.startsWith('graph:') ? prev : undefined);
      if (im) { im.name = 'graph:' + ch; imgs[ch] = im; layer.enabled[ch] = true; }
    }
    layer.graph = structuredClone(g);
    this.modified = true;
    this.ts.markDirty();
    this.updateLayerRow(layer);
    return layer.name;
  }

  /** Open a fill layer's graph in the Designer (and link them). */
  editInDesigner(l: FillLayer) {
    if (!l.graph) return;
    this.designLinked = l.id;
    this.ts.activeId = l.id;
    this.setMode('design');
    this.designer.open(l.graph);
  }

  /** Procedural channels of a fill layer (library materials): pattern, scale, seed, range. */
  private procProps(l: FillLayer): HTMLElement[] {
    const procs = l.procs;
    if (!procs || !Object.keys(procs).length) return [];
    const ts = this.ts;
    const live = () => { ts.markDirty(); this.modified = true; this.updateLayerRow(l); };
    const pre = (k: string) => ts.checkpoint('Edit procedural', `proc:${l.id}:${k}`);
    const box = group('Procedural channels', el('p', { class: 'note' }, 'These channels come from a pattern on the model (no textures). Each value goes from Low to High across the pattern.'));
    for (const [ch, p] of Object.entries(procs) as [Ch, NonNullable<typeof procs[Ch]>][]) {
      const color = ch === 'color' || ch === 'emit';
      const ps = select<string>(PATTERNS.map((x) => ({ value: x, label: PATTERN_LABEL[x] })), p.pattern, (v) => { pre(ch + 'pat'); p.pattern = v as PatternType; live(); });
      const lohi = (key: 'low' | 'high', label: string) => {
        if (color) {
          const inp = el('input', { type: 'color', value: rgbToHex(p[key]) }) as HTMLInputElement;
          inp.addEventListener('input', () => { pre(ch + key); p[key] = hexToRgb(inp.value); live(); });
          return el('div', { class: 'row' }, el('label', {}, label), inp);
        }
        return slider(label, { min: 0, max: 1, step: 0.005, value: p[key][0], onInput: (v) => { pre(ch + key); p[key] = [v, v, v]; live(); } }).el;
      };
      const off = el('button', { class: 'link', onclick: () => { pre('rm:' + Math.random()); delete procs[ch]; live(); this.buildProperties(); } }, 'Use a flat value instead');
      box.append(el('h5', {}, CH_LABEL[ch]), el('div', { class: 'row' }, el('label', {}, 'Pattern'), ps),
        slider('Scale', { min: 0.25, max: 100, step: 0.25, value: p.scale, fmt: (v) => v.toFixed(2), onInput: (v) => { pre(ch + 'scale'); p.scale = v; live(); } }).el,
        slider('Contrast', { min: 0, max: 3, step: 0.01, value: p.contrast, onInput: (v) => { pre(ch + 'con'); p.contrast = v; live(); } }).el,
        lohi('low', 'Low'), lohi('high', 'High'),
        el('div', { class: 'row' }, el('button', { class: 'grow', onclick: () => { pre(ch + 'seed:' + Math.random()); p.seed = Math.round(Math.random() * 1000); live(); } }, 'New seed'), off));
    }
    return [box];
  }

  // ================================================================ image import (Substance-style)

  /**
   * Images dropped / imported: choose what each one is (base color, normal, height, roughness, metallic,
   * emissive, a mask, a brush tip, or just add it to the shelf), then put them on a new or the selected fill layer.
   */
  async importImages(files: File[]) {
    type Use = Ch | 'normalDX' | 'mask' | 'tip' | 'shelf' | 'skip';
    const USES: [Use, string][] = [['color', 'Base color'], ['rough', 'Roughness'], ['metal', 'Metallic'], ['height', 'Height'],
      ['normal', 'Normal (OpenGL)'], ['normalDX', 'Normal (DirectX)'], ['emit', 'Emissive'], ['mask', 'Mask of the selected layer'],
      ['tip', 'Brush tip (alpha)'], ['shelf', 'Add to Assets shelf only'], ['skip', 'Skip']];
    const guess = (name: string): Use => {
      const sp = splitMapName(name.replace(/\.[^.]+$/, ''));
      if (!sp) return 'color';
      if (sp.slot === 'normal') return sp.dx ? 'normalDX' : 'normal';
      if ((CHANNELS as string[]).includes(sp.slot)) return sp.slot as Ch;
      return 'skip'; // AO and other maps TexPaint has no channel for
    };
    const rows = files.map((f) => ({ f, use: guess(f.name), url: URL.createObjectURL(f) }));
    // A picture without a map suffix is base color only if nothing else already is.
    rows.forEach((r) => {
      const named = !!splitMapName(r.f.name.replace(/\.[^.]+$/, ''));
      if (!named && rows.some((o) => o !== r && o.use === 'color' && !!splitMapName(o.f.name.replace(/\.[^.]+$/, '')))) r.use = 'shelf';
    });
    const active = this.ts.activeLayer;
    const canSel = active?.kind === 'fill' && !active.graph;
    let target = 'new' as 'new' | 'sel';
    const list = el('div', { class: 'imp-list' });
    for (const r of rows) {
      const sel = select<string>(USES.map(([v, l]) => ({ value: v, label: l })), r.use, (v) => { r.use = v as Use; });
      list.append(el('div', { class: 'imp-row' }, el('img', { src: r.url, alt: '' }), el('span', { class: 'imp-name', title: r.f.name }, r.f.name), sel));
    }
    const tNew = el('button', { class: 'on', onclick: () => { target = 'new'; tNew.classList.add('on'); tSel.classList.remove('on'); } }, 'New fill layer');
    const tSel = el('button', { disabled: !canSel, title: canSel ? '' : 'Select a fill layer first', onclick: () => { target = 'sel'; tSel.classList.add('on'); tNew.classList.remove('on'); } },
      canSel ? `Selected: ${active!.name}` : 'Selected fill layer');
    const content = el('div', {}, list, el('div', { class: 'row imp-target' }, el('label', {}, 'Put maps on'), el('div', { class: 'seg grow' }, tNew, tSel)));
    const r = await this.modal({
      title: files.length > 1 ? `Import ${files.length} images` : `Import “${files[0].name}”`,
      text: 'Choose what each image is. Names like _BaseColor, _Normal, _Roughness or _Height are recognised automatically.',
      icon: 'info', wide: true, content, buttons: [['Import', 'ok', 'primary'], ['Cancel', 'cancel']],
    });
    rows.forEach((x) => URL.revokeObjectURL(x.url));
    if (r !== 'ok') return;
    const chans = rows.filter((x) => (CHANNELS as string[]).includes(x.use) || x.use === 'normalDX');
    const seen = new Set<string>();
    for (const x of chans) { const k = x.use === 'normalDX' ? 'normal' : x.use; if (seen.has(k)) toast(`Two images were set to ${CH_LABEL[k as Ch]}; the last one is used`, true); seen.add(k); }
    const shelf = rows.filter((x) => x.use === 'shelf').map((x) => x.f);
    if (shelf.length) { await this.shelf.addFiles(shelf); this.buildShelf(); }
    for (const x of rows.filter((q) => q.use === 'tip')) { await this.setTip('image', x.f, x.f.name.replace(/\.[^.]+$/, '')); this.setTool('paint'); toast(`Brush tip: ${x.f.name}`); }
    const maskRow = rows.find((x) => x.use === 'mask');
    if (maskRow) {
      const layer = this.ts.activeLayer;
      if (!layer) toast('Select a layer to put the mask on', true);
      else {
        const bytes = await maskRow.f.arrayBuffer();
        const tex = await imageTexture(bytes, maskRow.f.name);
        await this.ts.batch(`Mask from ${maskRow.f.name}`, () => {
          if (!layer.mask) this.ts.addMask(layer, { base: 'black', gen: null });
          this.ts.maskFromImage(layer, tex, 0.5, 0.5, false);
        });
        this.paintTarget = 'mask';
        toast(`Mask from ${maskRow.f.name} on “${layer.name}”`);
      }
    }
    if (chans.length) {
      const images: Partial<Record<Ch, FillImage>> = {};
      for (const x of chans) {
        const ch: Ch = x.use === 'normalDX' ? 'normal' : (x.use as Ch);
        const bytes = await x.f.arrayBuffer();
        images[ch] = { name: x.f.name, bytes, tex: await imageTexture(bytes, x.f.name), flipG: x.use === 'normalDX' };
      }
      if (target === 'sel' && canSel) {
        const fl = active as FillLayer;
        this.ts.checkpoint(`Images on ${fl.name}`);
        fl.images = { ...(fl.images ?? {}), ...images };
        for (const ch of Object.keys(images) as Ch[]) fl.enabled[ch] = true;
        this.ts.layerChanged();
      } else {
        const enabled = {} as Record<Ch, boolean>;
        for (const ch of CHANNELS) enabled[ch] = !!images[ch];
        const base = splitMapName(chans[0].f.name.replace(/\.[^.]+$/, ''))?.set || chans[0].f.name.replace(/\.[^.]+$/, '');
        this.ts.addFillLayer(base, undefined, enabled, true, images, 1);
      }
      this.paintTarget = 'content';
      toast(`${chans.length} map${chans.length > 1 ? 's' : ''} on ${target === 'sel' && canSel ? '“' + active!.name + '”' : 'a new fill layer'}`);
    }
    this.modified = true;
    this.refresh();
  }

  /** Load / replace one channel's image on a fill layer. */
  private async setFillChannelImage(fl: FillLayer, ch: Ch, file?: File) {
    const f = file ?? await pickFile('image/*');
    if (!f) return;
    const bytes = await f.arrayBuffer();
    this.ts.checkpoint(`Image on ${fl.name}`);
    const dx = ch === 'normal' && /(normaldx|directx|_dx\b|nordx)/i.test(f.name);
    fl.images = { ...(fl.images ?? {}), [ch]: { name: f.name, bytes, tex: await imageTexture(bytes, f.name), flipG: dx } };
    fl.enabled[ch] = true;
    this.ts.layerChanged();
    this.modified = true;
    this.buildProperties();
  }
  private removeFillChannelImage(fl: FillLayer, ch: Ch) {
    if (!fl.images?.[ch]) return;
    this.ts.checkpoint(`Remove image from ${fl.name}`);
    const imgs = { ...fl.images };
    delete imgs[ch];
    fl.images = imgs;
    if (ch === 'normal') fl.enabled.normal = false;
    this.ts.layerChanged();
    this.modified = true;
    this.buildProperties();
  }

  // ================================================================ History panel

  historyOpen = false;
  private historyTimer = 0;
  private historyShown = -1;
  toggleHistory(open = !this.historyOpen) {
    this.historyOpen = open;
    if (open && this.mode !== 'paint') this.setMode('paint');
    clearInterval(this.historyTimer);
    if (open) this.historyTimer = window.setInterval(() => { if (this.historyOpen) this.buildHistory(); }, 1000);
    this.buildToolstrip();
    this.buildShelf();
  }

  private ago(t: number) {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
  }

  /** The undo history as a list (newest at the top). Click a row to jump there; undone steps stay (greyed) until you do something new. */
  private buildHistory(host = document.getElementById('shelf')!) {
    if (!this.historyOpen || this.mode !== 'paint') return;
    const list = this.ts.historyList();
    const pos = this.ts.historyPos;
    const key = list.map((h) => h.label + h.done).join('|') + pos + Math.floor(Date.now() / 10000);
    if (key === this.historyShownKey && host.querySelector('.hist-list')) {
      host.querySelectorAll<HTMLElement>('.hist-time').forEach((e) => { const t = +(e.dataset.t ?? 0); e.textContent = this.ago(t); });
      return;
    }
    this.historyShownKey = key;
    host.innerHTML = '';
    const rows = el('div', { class: 'hist-list' });
    const kindIcon = (k: string) => k === 'stroke' ? '🖌' : '◆';
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      const current = i === pos - 1;
      rows.append(el('button', {
        class: 'hist-row' + (h.done ? '' : ' undone') + (current ? ' current' : ''),
        title: h.done ? (current ? 'You are here' : 'Go back to right after this step') : 'Undone — click to bring it back',
        onclick: () => { this.ts.jumpTo(i + 1); this.modified = true; this.refresh(); this.buildHistory(); },
      }, el('span', { class: 'hist-ico' }, kindIcon(h.kind)), el('span', { class: 'hist-label' }, h.label),
        el('span', { class: 'hist-time', 'data-t': String(h.t) }, this.ago(h.t))));
    }
    rows.append(el('button', {
      class: 'hist-row original' + (pos === 0 ? ' current' : ''), title: 'How the file was before these steps',
      onclick: () => { this.ts.jumpTo(0); this.modified = true; this.refresh(); this.buildHistory(); },
    }, el('span', { class: 'hist-ico' }, '⟲'), el('span', { class: 'hist-label' }, 'Original'), el('span', { class: 'hist-time' }, '')));
    const body = el('div', { class: 'dock-body hist-body' },
      el('p', { class: 'note' }, `Your last ${this.ts.historyLimit} changes. Click one to go back to it; pressed Ctrl+Z by accident? Click the top row. Undone steps stay greyed until you do something new.`),
      list.length ? rows : el('p', { class: 'note' }, 'Nothing yet — paint or change something and it shows up here.'),
    );
    const foot = el('div', { class: 'dock-foot' },
      icon(I.undo, 'Undo (Ctrl+Z)', () => { this.undo(); this.buildHistory(); }),
      icon(I.redo, 'Redo (Ctrl+Y)', () => { this.redo(); this.buildHistory(); }),
      el('span', { class: 'grow' }),
      el('button', { class: 'link', onclick: () => this.toggleHistory(false) }, 'Back to Assets'));
    host.append(dock(el('span', {}, 'History'), body, 'grow'), foot);
    rows.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
  private historyShownKey = '';

  /** Put smart mask preset `id` on a layer (replaces its generator stack; painted mask strokes stay). */
  applySmartMaskTo(layer: Layer | null | undefined, id: string) {
    if (!layer) { toast('Select a layer first, then pick a smart mask', true); return; }
    const p = findSmartMask(id);
    if (!p) return;
    const gen = smartMask(id);
    if (layer.mask) {
      this.ts.checkpoint(`Smart mask “${p.label}”`);
      layer.mask.gen = gen;
      this.ts.maskChanged(layer);
    } else this.ts.addMask(layer, { base: 'black', gen });
    this.ts.activeId = layer.id;
    this.paintTarget = 'mask';
    this.modified = true;
    const need = new Set<string>();
    for (const g of [gen, ...(gen.fx ?? [])]) {
      if (g.type === 'edge' || g.type === 'curvature' || g.type === 'dirt') need.add('curv');
      if (g.type === 'ao' || g.type === 'dirt') need.add('ao');
      if (g.type === 'thick') need.add('thick');
    }
    const missing = [...need].filter((k) => !this.ts.baked.has(k as BakeKey));
    toast(`Smart mask “${p.label}” on “${layer.name}”` + (missing.length ? ` — bake ${missing.map((k) => BAKE_ITEMS.find(([b]) => b === k)?.[1] ?? k).join(' + ')} in the Baking tab for it to show fully` : ''));
    this.refresh();
  }

  deleteLayer(l: Layer) { this.deleteLayers([l]); }

  /** Selected layers (outermost only: a folder's children go with it), bottom to top. */
  selection(): Layer[] {
    this.syncSel();
    const all = this.ts.allLayers;
    const picked = all.filter((l) => this.sel.has(l.id));
    return picked.filter((l) => !picked.some((g) => g !== l && g.kind === 'group' && this.ts.isInside(l.id, g.id)));
  }

  private syncSel() {
    const ids = new Set(this.ts.allLayers.map((l) => l.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
    const a = this.ts.activeId;
    if (a >= 0 && ids.has(a) && !this.sel.has(a)) this.sel = new Set([a]);
  }

  /** Click a layer row: plain = select, Ctrl = add / remove, Shift = range. */
  private clickLayer(l: Layer, e: MouseEvent, target?: PaintTarget) {
    const ts = this.ts;
    this.syncSel();
    if (this.fxSel && (e.ctrlKey || e.metaKey || e.shiftKey)) this.fxSel = 0;
    if (e.ctrlKey || e.metaKey) {
      if (this.sel.has(l.id) && this.sel.size > 1) {
        this.sel.delete(l.id);
        if (ts.activeId === l.id) ts.activeId = [...this.sel].pop()!;
      } else { this.sel.add(l.id); ts.activeId = l.id; }
      this.paintTarget = 'content';
      this.refresh();
      return;
    }
    if (e.shiftKey && ts.activeLayer) {
      const a = this.rowOrder.indexOf(ts.activeId), b = this.rowOrder.indexOf(l.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.sel = new Set(this.rowOrder.slice(lo, hi + 1));
        this.paintTarget = 'content';
        this.refresh();
        return;
      }
    }
    const was = this.sel.size;
    this.sel = new Set([l.id]);
    const t = target ?? (this.paintTarget === 'mask' && l.id === ts.activeId ? 'mask' : 'content');
    if (was > 1) { ts.activeId = l.id; this.paintTarget = t; this.refresh(); }
    else this.selectLayer(l, t);
  }

  /** The layers an edit on row `l` applies to: the whole selection if `l` is in it. */
  private targetsFor(l: Layer): Layer[] {
    return this.sel.has(l.id) && this.sel.size > 1 ? this.selection() : [l];
  }

  async deleteLayers(list: Layer[]) {
    if (!list.length) return;
    const risky = list.some((l) => l.kind === 'paint' || l.kind === 'group');
    if (this.settings.confirmDelete && (list.length > 1 || risky)) {
      const r = await this.modal({
        title: list.length > 1 ? `Delete ${list.length} layers?` : `Delete “${list[0].name}”?`,
        text: list.length === 1 && list[0].kind === 'group' ? 'The folder and everything in it will be removed. Ctrl+Z brings it back.' : 'Ctrl+Z brings it back.',
        icon: 'warn', buttons: [['Delete', 'ok', 'danger'], ['Cancel', 'cancel']],
      });
      if (r !== 'ok') return;
    }
    this.paintTarget = 'content';
    this.ts.batchSync(list.length > 1 ? `Delete ${list.length} layers` : 'Delete layer', () => { for (const l of list) this.ts.removeLayer(l.id); });
    this.sel.clear();
    this.modified = true;
    this.refresh();
  }

  // ---------------------------------------------------------------- view pie (Blender's ~ menu)

  private mouseX = 0;
  private mouseY = 0;
  private pie: { root: HTMLElement; x: number; y: number; t0: number; pick: number; moved: boolean } | null = null;
  private static PIE: { label: string; key: string; dir: [number, number, number] | null; ang: number }[] = [
    { label: 'Top', key: 'top', dir: [0, 1, 0], ang: -90 },
    { label: 'Front', key: 'front', dir: [0, 0, 1], ang: -45 },
    { label: 'Right', key: 'right', dir: [1, 0, 0], ang: 0 },
    { label: '3/4 view', key: 'persp', dir: [1, 0.55, 1.3], ang: 45 },
    { label: 'Bottom', key: 'bottom', dir: [0, -1, 0], ang: 90 },
    { label: 'Frame model', key: 'frame', dir: null, ang: 135 },
    { label: 'Left', key: 'left', dir: [-1, 0, 0], ang: 180 },
    { label: 'Back', key: 'back', dir: [0, 0, -1], ang: -135 },
  ];

  /** Hold ~ (the key left of 1): a ring of views around the mouse, like Blender. Move toward one and let go. */
  private openPie() {
    const vpEl = this.vp.renderer.domElement.getBoundingClientRect();
    const inside = this.mouseX >= vpEl.left && this.mouseX <= vpEl.right && this.mouseY >= vpEl.top && this.mouseY <= vpEl.bottom;
    const x = inside ? this.mouseX : vpEl.left + vpEl.width / 2, y = inside ? this.mouseY : vpEl.top + vpEl.height / 2;
    const root = el('div', { class: 'view-pie', style: { left: `${x}px`, top: `${y}px` } });
    root.append(el('div', { class: 'pie-center' }), el('div', { class: 'pie-title' }, 'View'));
    App.PIE.forEach((p, i) => {
      const r = 118, a = (p.ang * Math.PI) / 180;
      const b = el('button', { class: 'pie-item', style: { left: `${Math.cos(a) * r}px`, top: `${Math.sin(a) * r}px` }, onclick: (e: MouseEvent) => { e.stopPropagation(); this.pieApply(i); } }, p.label);
      b.dataset.i = String(i);
      root.append(b);
    });
    document.body.append(root);
    this.pie = { root, x, y, t0: performance.now(), pick: -1, moved: false };
    root.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).classList.contains('view-pie') || (e.target as HTMLElement).classList.contains('pie-center')) { e.stopPropagation(); this.closePie(); } });
  }
  private pieMove(mx: number, my: number) {
    const p = this.pie!;
    const dx = mx - p.x, dy = my - p.y;
    const d = Math.hypot(dx, dy);
    let pick = -1;
    if (d > 28) {
      p.moved = true;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      let best = 999;
      App.PIE.forEach((it, i) => { const diff = Math.abs(((ang - it.ang + 540) % 360) - 180); if (diff < best) { best = diff; pick = i; } });
    }
    p.pick = pick;
    p.root.querySelectorAll('.pie-item').forEach((b) => b.classList.toggle('on', +(b as HTMLElement).dataset.i! === pick));
    const c = p.root.querySelector('.pie-center') as HTMLElement;
    c.style.setProperty('--a', `${Math.atan2(dy, dx)}rad`);
    c.classList.toggle('aim', pick >= 0);
  }
  /** Let go of ~: pick what the mouse points at. A quick tap leaves the ring open to click. */
  private pieRelease() {
    const p = this.pie!;
    if (p.pick >= 0) this.pieApply(p.pick);
    else if (performance.now() - p.t0 > 350 || p.moved) this.closePie();
  }
  private pieApply(i: number) {
    const it = App.PIE[i];
    this.closePie();
    if (!it.dir) this.vp.viewFrom(this.vp.camera.position.clone().sub(this.vp.controls.target));
    else this.vp.viewFrom(new THREE.Vector3(...it.dir));
    toast(`View: ${it.label}`);
  }
  private closePie() {
    this.pie?.root.remove();
    this.pie = null;
  }

  /** Put layers in a new folder (Ctrl+G). */
  groupLayers(list: Layer[]) {
    if (!list.length) return;
    const ts = this.ts;
    const g = ts.batchSync(list.length > 1 ? `Group ${list.length} layers` : 'Put in a new folder', () => {
      ts.activeId = list[list.length - 1].id;
      const g = ts.addGroup(list.length === 1 ? list[0].name + ' folder' : undefined);
      for (const l of list) ts.moveLayerTo(l.id, g.id, 'inside');
      return g;
    });
    ts.activeId = g.id;
    this.sel = new Set([g.id]);
    this.paintTarget = 'content';
    this.modified = true;
    this.refresh();
  }

  /** Duplicate layers (Ctrl+D), each copy right above its original. */
  private duplicating = false;
  async duplicateLayers(list: Layer[]) {
    if (!list.length || this.duplicating) return;
    this.duplicating = true;
    try { await this.duplicateNow(list); } finally { this.duplicating = false; }
  }

  private async duplicateNow(list: Layer[]) {
    const ts = this.ts;
    const copies: number[] = [];
    await ts.batch(list.length > 1 ? `Duplicate ${list.length} layers` : 'Duplicate layer', async () => {
      for (const l of list) {
        const json = await serializeLayer(ts, l, true);
        if (!json) continue;
        ts.activeId = l.id;
        const c = await restoreLayer(ts, json, ts.size, true);
        c.name = l.name + ' copy';
        copies.push(c.id);
      }
    });
    if (!copies.length) return;
    ts.activeId = copies[copies.length - 1];
    this.sel = new Set(copies);
    this.paintTarget = 'content';
    this.modified = true;
    ts.layerChanged();
    toast(`Duplicated ${copies.length} layer${copies.length === 1 ? '' : 's'}`);
  }

  undo() {
    if (this.pathLiveOn) { this.clearPath(); return; }
    const label = this.ts.undo();
    if (label) { this.modified = true; toast(`Undo: ${label}`); this.queueLayerThumbs(); } else toast('Nothing to undo');
  }

  redo() {
    const label = this.ts.redo();
    if (label) { this.modified = true; toast(`Redo: ${label}`); this.queueLayerThumbs(); } else toast('Nothing to redo');
  }

  /** Right-click menu on a layer, laid out like Substance Painter's. */
  private layerMenu(l: Layer, x: number, y: number) {
    const ts = this.ts;
    const m = this.ctxMenu;
    m.innerHTML = '';
    this.closeFlyouts();
    const close = () => { m.classList.remove('open'); this.closeFlyouts(); };
    const item = (label: string, keys: string, fn: () => void, disabled = false) => el('button', {
      disabled, onclick: (e: Event) => { e.stopPropagation(); close(); fn(); }, onmouseenter: () => this.closeFlyouts(),
    }, el('span', {}, label), el('span', { class: 'ctx-key' }, keys));
    const sub = (label: string, build: () => HTMLElement[], disabled = false) => {
      const b = el('button', { class: 'ctx-has-sub', disabled, onclick: (e: Event) => { e.stopPropagation(); open(); } }, el('span', {}, label), el('span', { class: 'ctx-key' }, '▸'));
      const open = () => {
        this.closeFlyouts();
        const fly = el('div', { class: 'menu-items ctx-fly' }, ...build());
        document.body.append(fly);
        this.flyouts.push(fly);
        const r = b.getBoundingClientRect(), fr = fly.getBoundingClientRect();
        const left = r.right + fr.width + 4 > innerWidth ? r.left - fr.width - 2 : r.right + 2;
        fly.style.left = `${Math.max(4, left)}px`;
        fly.style.top = `${Math.max(4, Math.min(r.top - 4, innerHeight - fr.height - 8))}px`;
      };
      b.addEventListener('mouseenter', open);
      return b;
    };
    const flyItem = (label: string, fn: () => void, on = false) => el('button', { class: on ? 'on' : '', onclick: (e: Event) => { e.stopPropagation(); close(); fn(); } }, el('span', {}, label), el('span', { class: 'ctx-key' }, on ? '✓' : ''));
    const hr = () => el('hr');
    const list = this.sel.has(l.id) && this.sel.size > 1 ? this.selection() : [l];
    const many = list.length > 1;
    const solo = many ? null : l;
    const mk = solo?.mask;
    const isGroup = l.kind === 'group';
    const onMask = this.paintTarget === 'mask' && !!mk && ts.activeId === l.id;
    if (many) m.append(el('div', { class: 'ctx-title muted' }, `${list.length} layers selected`));
    m.append(
      // masks
      item('Add white mask', '', () => this.addMaskTo(l, 'white', null), many),
      item('Add black mask', '', () => this.addMaskTo(l, 'black', null), many),
      item('Add bitmap mask…', '', () => this.addBitmapMask(l), many),
      item('Add mask with color selection', '', () => this.addMaskTo(l, 'black', 'id'), many),
      sub('Add smart mask', () => SMART_MASKS.map((p) => flyItem(p.label, () => this.applySmartMaskTo(l, p.id)))),
      hr(),
      item(mk?.off ? 'Turn mask on' : 'Toggle mask (turn off)', '', () => this.maskFlag(l, 'off'), !mk),
      item('Invert mask background', '', () => this.maskFlag(l, 'base'), !mk),
      item(mk?.inv ? 'Un-invert mask' : 'Invert mask', '', () => this.maskFlag(l, 'inv'), !mk),
      item('Clear mask', '', () => this.clearMask(l), !mk),
      item('Remove mask', '', () => { ts.removeMask(l); this.paintTarget = 'content'; this.modified = true; this.refresh(); }, !mk),
      hr(),
      item('Create smart mask…', '', () => this.createSmartMask(l), !mk?.gen),
      item('Create smart material…', '', () => this.createSmartMaterialFrom(list)),
      item('Flatten layer', 'Ctrl+M', () => this.flattenLayers(list)),
      item('Export mask to file', '', () => this.exportMask(l, 'file'), !mk),
      item('Export mask to clipboard', '', () => this.exportMask(l, 'clip'), !mk),
      item('Export channels to files', '', () => this.exportChannels(l), many),
      hr(),
      item('Cut layer(s)', 'Ctrl+X', () => this.cutLayers(list)),
      item('Copy layer(s)', 'Ctrl+C', () => this.copyLayers(list)),
      item('Paste layer(s)', 'Ctrl+V', () => this.pasteLayers(), !this.layerClip),
      item('Duplicate layer(s)', 'Ctrl+D', () => this.duplicateLayers(list)),
      item('Remove layer(s)', 'Del', () => this.deleteLayers(list)),
      item('Group layer(s)', 'Ctrl+G', () => this.groupLayers(list)),
      el('div', { class: 'ctx-tags' }, ...TAG_COLORS.map((c, k) => el('button', {
        class: 'ctx-tag' + (k === 0 ? ' none' : '') + (list.every((x) => (x.tag ?? 0) === k) ? ' on' : ''), title: k === 0 ? 'No colour' : 'Colour tag',
        style: c ? { background: c } : {}, onclick: (e: Event) => { e.stopPropagation(); close(); this.setTag(list, k); },
      }))),
      hr(),
      item('Copy mask', 'Ctrl+Alt+C', () => this.copyMask(l), !mk),
      item('Paste into mask', 'Ctrl+Alt+V', () => this.pasteMask(list), !this.maskClip),
      sub('Blending options', () => (Object.keys(BLEND_LABEL) as BlendMode[]).map((b) => flyItem(BLEND_LABEL[b], () => this.setBlend(list, b), list.every((x) => x.blend === b)))),
      hr(),
      sub(onMask ? 'Add generator (mask)' : 'Add generator', () => this.genChoices().map(([label, mkGen]) => flyItem(label, () => this.addGenerator(l, mkGen(), onMask))), many || (isGroup && !onMask)),
      item(onMask ? 'Add paint (mask)' : 'Add paint', '', () => this.addPaintEffect(l), many),
      item('Add fill', '', () => this.addFx(l, defaultFx('fill')), many || isGroup),
      item('Add levels', '', () => this.addFx(l, defaultFx('levels')), many || isGroup),
      sub('Add filter', () => FILTER_TYPES.map((f) => flyItem(FILTERS[f].label, () => this.addFx(l, defaultFx('filter', { filter: f })))), many || isGroup),
      item('Add color selection', '', () => onMask || !mk ? this.addMaskTo(l, 'black', 'id') : this.addGenerator(l, defaultGen('id'), true), many),
      item(l.anchor ? 'Remove anchor point' : 'Add anchor point', '', () => this.toggleAnchor(l), many),
      hr(),
      item('Rename', 'Double-click', () => { this.renaming = l.id; this.refresh(); }, many),
      item(list.every((x) => x.visible) ? 'Hide' : 'Show', '', () => {
        ts.checkpoint('Visibility'); const v = !list.every((x) => x.visible); list.forEach((x) => (x.visible = v)); ts.layerChanged(); this.modified = true;
      }),
      item('New folder above', '', () => { ts.activeId = l.id; ts.addGroup(); this.modified = true; }),
    );
    void solo;
    m.classList.add('open');
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 8))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 8))}px`;
  }
  private flyouts: HTMLElement[] = [];
  private closeFlyouts() { this.flyouts.forEach((f) => f.remove()); this.flyouts = []; }

  // ---------------------------------------------------------------- layer actions (right-click menu, shortcuts)

  /** Generators to add, Painter-style ones first. */
  private genChoices(): [string, () => GenSettings][] {
    return [
      ...SP_KINDS.map((k): [string, () => GenSettings] => [SP_DEFS[k].label, () => ({ ...defaultGen('painter'), sp: spDefaults(k) })]),
      ...GEN_TYPES.filter((t) => t !== 'painter' && t !== 'id').map((t): [string, () => GenSettings] => [this.classicGenLabel(t), () => defaultGen(t)]),
    ];
  }
  /** LocalPaint's own generators; "(simple)" where a Painter-style one has the same name. */
  private classicGenLabel(t: GenType) {
    const n = GEN_LABEL[t];
    return SP_KINDS.some((k) => SP_DEFS[k].label.toLowerCase() === n.toLowerCase()) ? `${n} (simple)` : n;
  }
  private genName(g: GenSettings) { return g.type === 'painter' && g.sp ? SP_DEFS[g.sp.kind].label : this.classicGenLabel(g.type); }

  /** Add a content effect on top of the layer's effects and show its settings. */
  addFx(l: Layer, f: LayerFx) {
    if (l.kind === 'group') { toast('Effects go on paint and fill layers (not folders).', true); return; }
    this.ts.checkpoint(`Add ${FX_KIND_LABEL[f.kind].toLowerCase()}`);
    l.fx = [...(l.fx ?? []), f];
    this.ts.activeId = l.id; this.sel = new Set([l.id]);
    this.paintTarget = 'content';
    this.fxSel = f.id;
    this.ts.markDirty(); this.modified = true;
    this.refresh();
  }
  /** Generator on the mask (when the mask is selected) or on the content. */
  private addGenerator(l: Layer, g: GenSettings, onMask: boolean) {
    if (onMask && l.mask) {
      this.ts.checkpoint('Add generator');
      if (!l.mask.gen) l.mask.gen = g;
      else l.mask.gen.fx = [...(l.mask.gen.fx ?? []), { ...g, blend: 'multiply', opacity: 1, on: true }];
      if (g.type === 'shape') this.placeShapeAtView(g);
      this.ts.maskChanged(l); this.modified = true;
      this.ts.activeId = l.id; this.paintTarget = 'mask'; this.fxSel = 0;
      this.refresh();
      return;
    }
    this.addFx(l, defaultFx('generator', { gen: g }));
  }
  /** "Add paint": paint on the layer's mask (adds a black one first if needed) with the brush. */
  private addPaintEffect(l: Layer) {
    if (l.kind === 'paint' && !(this.paintTarget === 'mask' && l.mask)) {
      this.selectLayer(l, 'content'); this.setTool('paint'); toast('Paint layer selected: paint on it with the brush (B).'); return;
    }
    if (!l.mask) this.addMaskTo(l, 'black', null);
    this.fxSel = 0;
    this.selectLayer(l, 'mask');
    this.setTool('paint');
    toast('Painting the mask: white shows the layer, black hides it (hold X-key colours with the brush colour).');
  }
  private removeFx(l: Layer, f: LayerFx) {
    this.ts.checkpoint('Remove effect');
    l.fx = (l.fx ?? []).filter((x) => x.id !== f.id);
    if (!l.fx.length) delete l.fx;
    if (this.fxSel === f.id) this.fxSel = 0;
    this.ts.markDirty(); this.modified = true; this.refresh();
  }
  private moveFx(l: Layer, f: LayerFx, dir: 1 | -1) {
    const a = l.fx ?? [], i = a.findIndex((x) => x.id === f.id), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    this.ts.checkpoint('Move effect');
    [a[i], a[j]] = [a[j], a[i]];
    this.ts.markDirty(); this.modified = true; this.refresh();
  }

  private maskFlag(l: Layer, what: 'off' | 'inv' | 'base') {
    const mk = l.mask;
    if (!mk) return;
    this.ts.checkpoint(what === 'off' ? 'Toggle mask' : what === 'inv' ? 'Invert mask' : 'Invert mask background');
    if (what === 'off') mk.off = !mk.off;
    else if (what === 'inv') mk.inv = !mk.inv;
    else mk.base = mk.base === 'white' ? 'black' : 'white';
    this.ts.maskChanged(l); this.modified = true; this.refresh();
  }
  /** Fresh mask with the same background (undo brings the old one back). */
  private clearMask(l: Layer) {
    const mk = l.mask;
    if (!mk) return;
    this.ts.batchSync('Clear mask', () => { const base = mk.base; this.ts.removeMask(l); this.ts.addMask(l, { base, gen: null }); });
    this.modified = true; this.refresh();
  }
  private async addBitmapMask(l: Layer) {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const tex = await imageTexture(await f.arrayBuffer(), f.name);
      this.ts.batchSync('Add bitmap mask', () => { if (l.mask) this.ts.removeMask(l); this.ts.addMask(l, { base: 'black', gen: null }); });
      this.ts.maskFromImage(l, tex, 0.5, 0);
      tex.dispose();
      this.ts.activeId = l.id; this.paintTarget = 'mask'; this.fxSel = 0; this.modified = true;
      toast(`Mask from ${f.name}: white shows the layer, black hides it.`);
      this.refresh();
    } catch (e: any) { toast('Could not read that picture: ' + (e?.message ?? e), true); }
  }

  private layerClip: LayerJSON[] | null = null;
  async copyLayers(list: Layer[], quiet = false) {
    if (!list.length) return;
    const out: LayerJSON[] = [];
    for (const l of list) { const j = await serializeLayer(this.ts, l, true); if (j) out.push(j); }
    this.layerClip = out;
    if (!quiet) toast(`Copied ${out.length} layer${out.length === 1 ? '' : 's'} (Ctrl+V to paste)`);
  }
  async cutLayers(list: Layer[]) {
    if (!list.length) return;
    await this.copyLayers(list, true);
    this.deleteLayers(list);
    toast(`Cut ${list.length} layer${list.length === 1 ? '' : 's'} (Ctrl+V to paste)`);
  }
  async pasteLayers() {
    const clip = this.layerClip;
    if (!clip?.length) { toast('Nothing copied yet: right-click a layer > Copy layer(s), or Ctrl+C', true); return; }
    const ts = this.ts;
    const made: number[] = [];
    await ts.batch(clip.length > 1 ? `Paste ${clip.length} layers` : 'Paste layer', async () => {
      for (const j of clip) { const l = await restoreLayer(ts, j, ts.size, true); made.push(l.id); }
    });
    if (!made.length) return;
    ts.activeId = made[made.length - 1];
    this.sel = new Set(made);
    this.paintTarget = 'content'; this.fxSel = 0;
    this.modified = true;
    ts.layerChanged();
    toast(`Pasted ${made.length} layer${made.length === 1 ? '' : 's'}`);
  }

  private maskClip: { base: 'white' | 'black'; gen: GenSettings | null; paint: Uint8Array | null; size: number; off?: boolean; inv?: boolean } | null = null;
  private copyMask(l: Layer) {
    const mk = l.mask;
    if (!mk) { toast('This layer has no mask to copy', true); return; }
    this.maskClip = { base: mk.base, gen: mk.gen ? structuredClone(mk.gen) : null, paint: mk.painted ? this.ts.readRT(mk.paintRT) : null, size: this.ts.size, off: mk.off, inv: mk.inv };
    toast('Mask copied (right-click another layer > Paste into mask)');
  }
  private pasteMask(list: Layer[]) {
    const c = this.maskClip;
    if (!c) { toast('Copy a mask first (right-click a layer > Copy mask)', true); return; }
    const ts = this.ts;
    ts.batchSync('Paste into mask', () => {
      for (const l of list) {
        if (l.mask) ts.removeMask(l);
        ts.addMask(l, { base: c.base, gen: c.gen ? structuredClone(c.gen) : null });
        l.mask!.off = c.off; l.mask!.inv = c.inv;
      }
    });
    for (const l of list) {
      if (c.paint && c.size === ts.size) { ts.writeRT(l.mask!.paintRT, c.paint, c.size); l.mask!.painted = true; }
      ts.maskChanged(l);
    }
    if (c.paint && c.size !== ts.size) toast('The painted part of the mask was made at another texture size, so only its generators were pasted.', true);
    this.modified = true; this.refresh();
  }

  private setTag(list: Layer[], k: number) {
    this.ts.checkpoint('Colour tag');
    for (const l of list) { if (k) l.tag = k; else delete l.tag; }
    this.modified = true; this.refresh();
  }
  private setBlend(list: Layer[], b: BlendMode) {
    this.ts.checkpoint('Blend mode');
    for (const l of list) l.blend = b;
    this.ts.markDirty(); this.modified = true; this.refresh();
  }

  /** Ctrl+M: bake layers (effects, mask, opacity) or folders into single paint layers. */
  flattenLayers(list: Layer[]) {
    if (!list.length) return;
    const ts = this.ts;
    const made = ts.batchSync(list.length > 1 ? `Flatten ${list.length} layers` : 'Flatten layer', () => list.map((l) => ts.flattenLayer(l)).filter((x) => !!x));
    if (!made.length) return;
    ts.activeId = made[made.length - 1]!.id;
    this.sel = new Set(made.map((x) => x!.id));
    this.paintTarget = 'content'; this.fxSel = 0;
    this.modified = true;
    ts.layerChanged();
    toast(`Flattened into ${made.length} paint layer${made.length === 1 ? '' : 's'}`);
  }

  private async exportMask(l: Layer, to: 'file' | 'clip') {
    const px = this.ts.maskPixels(l);
    if (!px) return;
    const blob = await pixelsToPng(px, this.ts.size);
    const name = `${l.name.replace(/[^\w\- ]+/g, '_')}_mask.png`;
    if (to === 'clip') {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Mask copied to the clipboard as a picture'); }
      catch { toast('The clipboard refused the picture. Use Export mask to file instead.', true); }
      return;
    }
    try { toast(await saveFiles([{ name, blob }])); } catch (e: any) { if (e?.name !== 'AbortError') toast('Could not save: ' + (e?.message ?? e), true); }
  }
  private async exportChannels(l: Layer) {
    const files: { name: string; blob: Blob }[] = [];
    const base = l.name.replace(/[^\w\- ]+/g, '_');
    for (const ch of CHANNELS) {
      const px = this.ts.layerChannelPixels(l, ch);
      let any = false;
      for (let i = 3; i < px.length; i += 4 * 97) if (px[i] > 0) { any = true; break; }
      if (any) files.push({ name: `${base}_${CH_LABEL[ch].replace(/\s+/g, '')}.png`, blob: await pixelsToPng(px, this.ts.size) });
    }
    if (!files.length) { toast('This layer doesn\'t paint anything yet', true); return; }
    try { toast(await saveFiles(files)); } catch (e: any) { if (e?.name !== 'AbortError') toast('Could not save: ' + (e?.message ?? e), true); }
  }

  private async createSmartMask(l: Layer) {
    const g = l.mask?.gen;
    if (!g) { toast('Smart masks save the mask\'s generators. This mask is only painted, so there\'s nothing to save.', true); return; }
    const name = await this.askText('Create smart mask', 'Saves this mask\'s generators to Smart masks on the shelf.', `${l.name} mask`);
    if (!name) return;
    const id = 'user_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);
    const gen = structuredClone(g);
    SMART_MASKS.push({ id, label: name, build: () => structuredClone(gen) });
    this.shelf.items = [...this.shelf.items, { kind: 'mask', name, file: 'mask:' + id, preset: id }];
    this.settings.userMasks = [...(this.settings.userMasks ?? []), { id, label: name, gen }];
    saveSettings(this.settings);
    this.buildShelf();
    toast(`Smart mask “${name}” saved to the shelf (Smart masks)`);
  }
  private async createSmartMaterialFrom(list: Layer[]) {
    const name = await this.askText('Create smart material', 'Saves the selected layers (fill layers, folders and their masks) as a smart material on the shelf.', list.length === 1 ? list[0].name : 'My smart material');
    if (!name) return;
    const src = list.length === 1 && list[0].kind === 'group' ? list[0].children : list;
    const layers: LayerJSON[] = [];
    let skipped = 0;
    for (const l of src) { const j = await serializeLayer(this.ts, l, false); if (j) layers.push(j); else skipped++; }
    if (!layers.length) { toast('Nothing to save: smart materials are made of fill layers and masks (hand painting is model-specific).', true); return; }
    try {
      const msg = await this.shelf.saveJSON(`${name.replace(/[^\w\- ]+/g, '_').trim() || 'smart'}.tpsmart`, { format: 'texpaint-smart', version: 1, name, layers });
      toast(skipped ? `${msg} · ${skipped} paint layer(s) skipped` : msg);
      this.buildShelf();
    } catch (e: any) { toast('Could not save smart material: ' + e?.message, true); }
  }

  /** One effect's row under its layer in the Layers panel. */
  private fxRow(l: Layer, f: LayerFx, depth: number) {
    const ts = this.ts;
    const sel = this.fxSel === f.id && ts.activeId === l.id;
    const eye = el('button', { class: 'eye' + (f.on ? ' on' : ''), title: 'Turn this effect on / off', onclick: (e: Event) => {
      e.stopPropagation(); ts.checkpoint(f.on ? 'Hide effect' : 'Show effect'); f.on = !f.on; ts.markDirty(); this.modified = true; this.refresh();
    } });
    eye.innerHTML = f.on ? I.eye : I.eyeOff;
    const blend = select<string>(FX_BLENDS.map((b) => ({ value: b, label: FX_BLEND_LABEL[b].split(' ')[0] })), f.blend, (v) => {
      ts.checkpoint('Effect blend'); f.blend = v as LayerFx['blend']; ts.markDirty(); this.modified = true;
    });
    blend.classList.add('mini'); blend.title = 'How it mixes with the content below it';
    blend.addEventListener('click', (e) => e.stopPropagation());
    const op = el('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(f.opacity * 100), class: 'mini-num', title: 'Opacity %' }) as HTMLInputElement;
    op.addEventListener('click', (e) => e.stopPropagation());
    const applyOp = () => { ts.checkpoint('Effect opacity', 'fxop:' + f.id); f.opacity = Math.min(1, Math.max(0, (+op.value || 0) / 100)); ts.markDirty(); this.modified = true; this.poke(); };
    op.addEventListener('input', applyOp);
    scrubNumber(op, 0, 100, applyOp);
    const x = el('button', { class: 'fx-x', title: 'Remove this effect', onclick: (e: Event) => { e.stopPropagation(); this.removeFx(l, f); } }, '×');
    const row = el('div', {
      class: 'layer fx-row' + (sel ? ' active' : '') + (f.on ? '' : ' off'),
      title: 'Click to edit · right-click for more',
      onclick: () => { this.fxSel = f.id; ts.activeId = l.id; this.sel = new Set([l.id]); this.paintTarget = 'content'; this.refresh(); },
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        const m = this.ctxMenu; m.innerHTML = ''; this.closeFlyouts();
        const it = (label: string, fn: () => void, dis = false) => el('button', { disabled: dis, onclick: () => { m.classList.remove('open'); fn(); } }, label);
        const i = (l.fx ?? []).indexOf(f);
        m.append(it('Move up', () => this.moveFx(l, f, 1), i >= (l.fx ?? []).length - 1), it('Move down', () => this.moveFx(l, f, -1), i <= 0),
          it(f.on ? 'Turn off' : 'Turn on', () => eye.click()), el('hr'), it('Remove effect', () => this.removeFx(l, f)));
        m.classList.add('open');
        m.style.left = `${Math.min(e.clientX, innerWidth - 250)}px`; m.style.top = `${Math.min(e.clientY, innerHeight - 160)}px`;
      },
    }, eye, el('span', { class: 'fx-ico' }, FX_ICON[f.kind]), el('span', { class: 'name' }, fxTitle(f, (g) => this.genName(g))), el('div', { class: 'layer-ctl' }, blend, op), x);
    row.style.paddingLeft = `${30 + depth * 18}px`;
    return row;
  }

  /** Properties of the selected content effect. */
  private fxProps(l: Layer, f: LayerFx): HTMLElement[] {
    const ts = this.ts;
    const pre = (k: string) => ts.checkpoint('Edit effect', `fx:${f.id}:${k}`);
    const live = () => { ts.markDirty(); this.modified = true; this.poke(); };
    const relist = () => { live(); this.buildProperties(); this.buildRight(); };
    const out: HTMLElement[] = [];
    const chips = el('div', { class: 'fx-chans' }, ...FX_CHANS.map(([ch, label]) => {
      const on = f.chans ? !!f.chans[ch] : ch !== 'normal';
      return el('button', { class: on ? 'on' : '', title: `Apply to ${CH_LABEL[ch]}`, onclick: () => {
        pre('chans' + Math.random());
        const cur: Partial<Record<Ch, boolean>> = f.chans ?? Object.fromEntries(CHANNELS.map((c) => [c, c !== 'normal']));
        cur[ch] = !on; f.chans = cur; relist();
      } }, label);
    }));
    const head = group(`${FX_KIND_LABEL[f.kind]} · ${l.name}`, chips,
      el('div', { class: 'row' }, el('label', {}, 'Blend'), select<string>(FX_BLENDS.map((b) => ({ value: b, label: FX_BLEND_LABEL[b] })), f.blend, (v) => { pre('blend'); f.blend = v as LayerFx['blend']; live(); this.buildRight(); })),
      slider('Opacity', { min: 0, max: 1, step: 0.01, value: f.opacity, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { pre('op'); f.opacity = v; live(); } }).el);
    out.push(head);
    const colour = (label: string, get: () => [number, number, number], set: (c: [number, number, number]) => void) => {
      const c = el('input', { type: 'color', value: rgbToHex(get()) }) as HTMLInputElement;
      c.addEventListener('input', () => { pre('col'); set(hexToRgb(c.value) as [number, number, number]); live(); });
      return el('div', { class: 'row' }, el('label', {}, label), c);
    };
    if (f.kind === 'filter') {
      const g = group('Filter', select<string>([{ value: '', label: 'Pick a filter…' }, ...FILTER_TYPES.map((t) => ({ value: t, label: FILTERS[t].label }))], f.filter ?? '', (v) => {
        pre('type'); f.filter = (v || null) as FilterType | null; f.p = f.filter ? FILTERS[f.filter].params.map((d) => d.def) : []; relist();
      }));
      if (f.filter) {
        const d = FILTERS[f.filter];
        g.append(el('p', { class: 'note' }, d.desc));
        d.params.forEach((q, k) => g.append(slider(q.label, { min: q.min, max: q.max, step: q.step, value: f.p?.[k] ?? q.def, fmt: q.fmt, onInput: (v) => { pre('p' + k); (f.p ??= [])[k] = v; live(); } }).el));
        if (f.filter === 'tint' || f.filter === 'gradmap') g.append(colour('Colour', () => f.color ?? [1, 1, 1], (c) => (f.color = c)));
      } else g.append(el('p', { class: 'note' }, 'Empty filter: pick one above (blur, sharpen, HSL, levels-style contrast, posterize…).'));
      out.push(g);
    } else if (f.kind === 'generator') {
      const choices = this.genChoices();
      const cur = f.gen ? this.genName(f.gen) : '';
      const g = group('Generator', select<string>([{ value: '', label: 'Pick a generator…' }, ...choices.map(([label]) => ({ value: label, label }))], cur, (v) => {
        pre('type'); const c = choices.find(([label]) => label === v); f.gen = c ? c[1]() : null; if (f.gen?.type === 'shape') this.placeShapeAtView(f.gen); relist();
      }));
      if (f.gen) {
        g.append(...this.genControls(f.gen, pre, live, 'fxg', l), colour('Colour', () => f.color ?? [1, 1, 1], (c) => (f.color = c)),
          el('p', { class: 'note' }, 'Gives a grey result (times the colour) mixed into the layer with the blend mode above: Multiply darkens where it\'s black, Screen lightens where it\'s white.'));
        out.push(g);
        if (f.gen.type !== 'pattern' && f.gen.type !== 'shape' && f.gen.type !== 'painter') out.push(group('Grunge breakup', ...this.noiseControls(f.gen, pre, live, 'fxg')));
      } else { g.append(el('p', { class: 'note' }, 'Empty generator: pick one above (Dirt, Metal edge wear, Light, Position, Curvature…).')); out.push(g); }
    } else if (f.kind === 'levels') {
      const v = (f.lv ??= [0, 1, 1, 0, 1]);
      const names = ['Input black', 'Input white', 'Gamma', 'Output black', 'Output white'];
      out.push(group('Levels', ...names.map((n, k) => slider(n, { min: k === 2 ? 0.1 : 0, max: k === 2 ? 4 : 1, step: 0.01, value: v[k], fmt: (x) => x.toFixed(2), onInput: (x) => { pre('lv' + k); v[k] = x; live(); } }).el),
        el('p', { class: 'note' }, 'Remaps the values: pull Input black up for darker darks, Output white down to cap the brightest value.')));
    } else {
      out.push(group('Fill', colour('Colour', () => f.color ?? [0.5, 0.5, 0.5], (c) => (f.color = c)),
        slider('Value (grey channels)', { min: 0, max: 1, step: 0.01, value: f.value ?? 0.5, fmt: (x) => x.toFixed(2), onInput: (x) => { pre('val'); f.value = x; live(); } }).el,
        el('p', { class: 'note' }, 'A flat colour (colour channels) or value (roughness, metal, height) laid over the content.')));
    }
    const i = (l.fx ?? []).indexOf(f);
    out.push(el('div', { class: 'row' },
      el('button', { disabled: i >= (l.fx ?? []).length - 1, onclick: () => this.moveFx(l, f, 1) }, 'Move up'),
      el('button', { disabled: i <= 0, onclick: () => this.moveFx(l, f, -1) }, 'Move down'),
      el('button', { class: 'grow', onclick: () => { this.fxSel = 0; this.refresh(); } }, 'Back to layer'),
      el('button', { class: 'danger', onclick: () => this.removeFx(l, f) }, 'Remove')));
    return out;
  }

  private settingsBody() {
    const ts = this.ts;
    return el('div', { class: 'dock-body' },
      group('Texture set',
        el('div', { class: 'row' }, el('label', {}, 'Size'),
          select<number>(RESOLUTIONS.map((r) => ({ value: r, label: `${r} × ${r}` })), ts.size, (v) => this.setResolution(v))),
        el('div', { class: 'row' }, el('label', {}, 'Normal format'), el('span', {}, 'OpenGL (Y+)')),
        slider('Height bump', { min: 0, max: 30, step: 0.5, value: ts.heightStrength, fmt: (v) => v.toFixed(1), onInput: (v) => ts.setHeightStrength(v) }).el,
      ),
      group('Mesh maps',
        el('p', { id: 'bake-status', class: 'bp-result' }, ''),
        this.mapGrid(),
        el('div', { class: 'row' }, el('button', { class: 'grow primary', onclick: () => this.setMode('bake') }, 'Bake mesh maps…')),
      ),
    );
  }

  // ---------------------------------------------------------------- layer thumbnails (real contents)

  private lthumbCache = new Map<string, ImageData>();
  private lthumbEls = new Map<string, { cv: HTMLCanvasElement; l: Layer; what: 'content' | 'mask' }>();
  private lthumbTimer = 0;
  private static LT = 40;
  private layerThumbCanvas(host: HTMLElement, l: Layer, what: 'content' | 'mask') {
    const n = App.LT;
    const cv = el('canvas', { width: n, height: n, class: 'lthumb' }) as HTMLCanvasElement;
    host.innerHTML = '';
    host.classList.add('has-lthumb');
    host.append(cv);
    const key = `${l.id}:${what}`;
    const cached = this.lthumbCache.get(key);
    if (cached) cv.getContext('2d')!.putImageData(cached, 0, 0);
    this.lthumbEls.set(key, { cv, l, what });
    this.queueLayerThumbs();
  }
  /** Re-draw the layer thumbnails a moment after things settle (strokes, fills, undo…). */
  queueLayerThumbs(ms = 220) {
    clearTimeout(this.lthumbTimer);
    this.lthumbTimer = window.setTimeout(() => {
      if (this.ts.painting || this.ts.baking) { this.queueLayerThumbs(400); return; }
      this.updateLayerThumbs();
    }, ms);
  }
  private updateLayerThumbs() {
    const n = App.LT;
    for (const [key, { cv, l, what }] of this.lthumbEls) {
      if (!cv.isConnected) { this.lthumbEls.delete(key); continue; }
      const r = this.ts.layerThumb(l, what, n);
      if (!r) continue;
      const img = new ImageData(n, n);
      const d = img.data, px = r.px;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const s = ((n - 1 - y) * n + x) * 4, o = (y * n + x) * 4;
        const chk = ((x >> 2) + (y >> 2)) & 1 ? 58 : 40; // checkerboard where the layer is empty
        if (r.gray) { const v = px[s]; d[o] = d[o + 1] = d[o + 2] = v; }
        else {
          const a = px[s + 3] / 255;
          for (let c = 0; c < 3; c++) d[o + c] = Math.round(px[s + c] * a + chk * (1 - a));
        }
        d[o + 3] = 255;
      }
      cv.getContext('2d')!.putImageData(img, 0, 0);
      this.lthumbCache.set(key, img);
    }
  }

  private selectLayer(l: Layer, target: PaintTarget) {
    const changed = this.ts.activeId !== l.id || this.paintTarget !== target || this.fxSel !== 0;
    this.fxSel = 0;
    this.ts.activeId = l.id;
    this.paintTarget = target;
    if (changed) this.refresh();
  }

  private layerRow(l: Layer, depth = 0) {
    const ts = this.ts;
    const isActive = l.id === ts.activeId;
    const eye = el('button', { class: 'eye' + (l.visible ? ' on' : ''), title: 'Show / hide', onclick: (e: Event) => {
      e.stopPropagation();
      const v = !l.visible;
      ts.checkpoint(v ? 'Show layer' : 'Hide layer');
      for (const t of this.targetsFor(l)) t.visible = v;
      l.visible = v;
      ts.layerChanged(); this.modified = true;
    } });
    eye.innerHTML = l.visible ? I.eye : I.eyeOff;
    const kind = el('span', { class: 'thumb' + (l.kind === 'fill' ? ' fill' : '') + (isActive && this.paintTarget === 'content' ? ' sel' : ''),
      title: (l.kind === 'fill' ? 'Fill layer' : 'Paint layer') + ' — click to edit its content',
      onclick: (e: MouseEvent) => { e.stopPropagation(); this.clickLayer(l, e, 'content'); } });
    if (l.kind === 'fill' && l.images && Object.keys(l.images).length) { kind.classList.remove('fill'); kind.classList.add('img'); kind.textContent = 'IMG'; }
    else if (l.kind === 'fill') kind.style.setProperty('--swatch', rgbToHex(l.values.color));
    else if (l.kind === 'group') { kind.classList.add('folder'); kind.innerHTML = I.folder; }
    else this.layerThumbCanvas(kind, l, 'content');
    const caret = l.kind === 'group'
      ? el('button', { class: 'caret', title: l.open ? 'Collapse' : 'Expand', onclick: (e: Event) => { e.stopPropagation(); l.open = !l.open; this.refresh(); } })
      : el('span', { class: 'caret' });
    if (l.kind === 'group') caret.innerHTML = l.open ? I.caretD : I.caretR;
    const chip = l.mask ? el('span', {
      class: 'thumb mask' + (isActive && this.paintTarget === 'mask' ? ' sel' : ''),
      title: `Mask${l.mask.gen ? ' · ' + GEN_LABEL[l.mask.gen.type] : ''} — click to edit / paint the mask`,
      onclick: (e: MouseEvent) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.shiftKey) this.clickLayer(l, e); else { this.sel = new Set([l.id]); this.selectLayer(l, 'mask'); } },
    }) : null;
    if (chip) this.layerThumbCanvas(chip, l, 'mask');
    const name = el('span', { class: 'name' });
    if (this.renaming === l.id) {
      const inp = el('input', { type: 'text', value: l.name }) as HTMLInputElement;
      const done = () => {
        if (this.renaming !== l.id) return;
        const nv = inp.value.trim();
        if (nv && nv !== l.name) { ts.checkpoint('Rename'); l.name = nv; this.modified = true; }
        this.renaming = -1; this.refresh();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { this.renaming = -1; this.refresh(); } });
      inp.addEventListener('blur', done);
      inp.addEventListener('click', (e) => e.stopPropagation());
      name.append(inp);
      setTimeout(() => { inp.focus(); inp.select(); });
    } else {
      name.textContent = l.name;
      if (l.anchor) name.append(el('span', { class: 'anchor-badge', title: 'Anchor point: generators on other layers can use this layer\'s height details (Micro details)' }, '⚓'));
    }
    const blend = select<BlendMode>((Object.keys(BLEND_LABEL) as BlendMode[]).map((b) => ({ value: b, label: BLEND_LABEL[b].split(' ')[0] })), l.blend, (v) => {
      ts.checkpoint('Blend mode');
      const ts2 = this.targetsFor(l);
      for (const t of ts2) t.blend = v;
      l.blend = v;
      ts.markDirty(); this.modified = true;
      if (ts2.length > 1) this.refresh();
    });
    blend.classList.add('mini');
    blend.title = 'Blend mode';
    blend.addEventListener('click', (e) => e.stopPropagation());
    const op = el('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(l.opacity * 100), class: 'mini-num', title: 'Opacity %' }) as HTMLInputElement;
    op.addEventListener('click', (e) => e.stopPropagation());
    const applyOp = () => {
      const targets = this.targetsFor(l);
      ts.checkpoint('Opacity', 'opacity:' + targets.map((t) => t.id).join(','));
      const v = Math.min(1, Math.max(0, (+op.value || 0) / 100));
      for (const t of targets) { t.opacity = v; const r = this.layerRowEls.get(t.id); if (r && r !== this.layerRowEls.get(l.id)) r.op.value = String(Math.round(v * 100)); }
      l.opacity = v;
      ts.markDirty(); this.modified = true; this.poke();
    };
    op.addEventListener('input', applyOp);
    scrubNumber(op, 0, 100, applyOp);
    const row = el('div', {
      class: 'layer' + (isActive ? ' active' : '') + (!isActive && this.sel.has(l.id) ? ' selected' : '') + (l.kind === 'group' ? ' group' : ''),
      title: 'Ctrl+click / Shift+click to select several · double-click to rename · right-click for masks, effects, copy / paste and more · drag to reorder',
      draggable: this.renaming !== l.id,
      onclick: (e: MouseEvent) => this.clickLayer(l, e),
      ondblclick: () => { this.renaming = l.id; this.refresh(); },
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.sel.has(l.id)) { this.sel = new Set([l.id]); this.selectLayer(l, 'content'); }
        this.layerMenu(l, e.clientX, e.clientY);
      },
    }, eye, caret, kind, chip, name, el('div', { class: 'layer-ctl' }, blend, op));
    row.style.paddingLeft = `${8 + depth * 18}px`;
    if (l.tag && TAG_COLORS[l.tag]) row.style.boxShadow = `inset 3px 0 0 ${TAG_COLORS[l.tag]}`;
    if (chip && l.mask?.off) { chip.classList.add('off'); chip.title = 'Mask turned off — right-click the layer > Turn mask on'; }
    if (chip && l.mask?.inv) chip.classList.add('inv');
    // drag to reorder / into folders
    const zone = (e: DragEvent): 'above' | 'below' | 'inside' => {
      const r = row.getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      if (l.kind === 'group' && f > 0.28 && f < 0.72) return 'inside';
      return f < 0.5 ? 'above' : 'below'; // rows are listed top = highest, so "above" = on top of it
    };
    const clearMarks = () => row.classList.remove('drop-above', 'drop-below', 'drop-inside');
    row.addEventListener('dragstart', (e) => {
      this.dragLayer = l.id;
      this.dragLayers = this.sel.has(l.id) && this.sel.size > 1 ? this.selection().map((x) => x.id) : [l.id];
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', l.name);
    });
    row.addEventListener('dragend', () => { this.dragLayer = -1; this.dragLayers = []; });
    row.addEventListener('dragover', (e) => {
      if (this.dragLayer < 0 && !this.dragItem) return;
      e.preventDefault();
      clearMarks();
      if (this.dragItem) row.classList.add((this.dragItem.kind === 'material' && l.kind === 'fill') || this.dragItem.kind === 'mask' ? 'drop-inside' : 'drop-above');
      else row.classList.add('drop-' + zone(e));
    });
    row.addEventListener('dragleave', clearMarks);
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearMarks();
      if (this.dragItem) {
        const items = this.dragList(this.dragItem); this.dragItem = null;
        const it = items[0];
        if (it.kind === 'mask') { this.applySmartMaskTo(l, it.preset); return; }
        if (items.length === 1 && it.kind === 'material' && l.kind === 'fill' && !Object.keys(l.images ?? {}).length) {
          ts.checkpoint(`Apply “${it.name}”`);
          l.values = structuredClone(it.preset.values);
          l.enabled = { ...l.enabled, ...it.preset.enabled, normal: l.enabled.normal };
          ts.activeId = l.id; ts.layerChanged(); this.modified = true;
          toast(`Applied “${it.name}” to ${l.name}`);
        } else {
          ts.activeId = l.id;
          await this.addAssets(items);
        }
        return;
      }
      if (this.dragLayer >= 0) {
        const ids = this.dragLayers.length ? this.dragLayers : [this.dragLayer];
        this.dragLayer = -1; this.dragLayers = [];
        ts.moveLayersTo(ids, l.id, zone(e));
        this.modified = true;
      }
    });
    this.layerRowEls.set(l.id, { kind, op });
    return row;
  }

  private updateLayerRow(l: Layer) {
    const r = this.layerRowEls.get(l.id);
    if (!r) return;
    if (l.kind === 'fill' && !Object.keys(l.images ?? {}).length) r.kind.style.setProperty('--swatch', rgbToHex(l.values.color));
  }

  /** Properties dock: Paint / Fill / Mask depending on the selection (like Substance). */
  buildProperties() {
    const host = document.querySelector('#right .props-dock') as HTMLElement | null;
    if (!host) return;
    host.innerHTML = '';
    if (this.mode === 'design') {
      const inner = el('div', {});
      host.append(el('div', { class: 'dock-head' }, this.designer.tab === 'shader' ? 'Shader preview' : 'Node'), inner);
      this.designer.buildRight(inner);
      return;
    }
    const layer = this.ts.activeLayer;
    let title = 'Properties';
    const body = el('div', { class: 'dock-body' });
    const fxNow = layer && this.fxSel ? layer.fx?.find((f) => f.id === this.fxSel) : undefined;
    if (layer && this.fxSel && !fxNow) this.fxSel = 0;
    if (layer && fxNow) {
      title = `Properties — ${FX_KIND_LABEL[fxNow.kind].toLowerCase()}`;
      body.append(...this.fxProps(layer, fxNow));
    } else if (layer && this.paintTarget === 'mask' && layer.mask) {
      title = 'Properties — mask';
      body.append(...this.maskProps(layer));
    } else if (layer?.kind === 'group') {
      title = 'Properties — folder';
      body.append(group(`Folder · ${layer.name}`,
        el('p', { class: 'note' }, `${layer.children.length} layer${layer.children.length === 1 ? '' : 's'} inside. A folder's mask, opacity and blend mode apply to everything in it — e.g. drop a smart material, add a black mask to its folder, then paint white to put the material only where you paint.`),
        layer.mask
          ? el('button', { class: 'grow', onclick: () => this.selectLayer(layer, 'mask') }, 'Edit folder mask')
          : el('div', { class: 'seg' },
            el('button', { class: 'primary', onclick: () => this.addMaskTo(layer, 'black', null) }, 'Add black mask & paint'),
            el('button', { onclick: () => this.addMaskTo(layer, 'white', null) }, 'White mask')),
      ));
    } else if (layer?.kind === 'fill') {
      title = 'Properties — fill';
      if ((layer as FillLayer).note) body.append(group('Source', el('p', { class: 'note' }, (layer as FillLayer).note!)));
      const fl = layer as FillLayer;
      if (fl.sbs) {
        title = 'Properties — Substance material';
        body.innerHTML = '';
        body.append(...this.sbsProps(fl), ...this.fillSettings(fl));
      } else {
        if (fl.graph) body.append(group('Material Designer', el('p', { class: 'note' }, `Driven by the node graph “${fl.graph.name}”.`),
          el('button', { class: 'primary', onclick: () => this.editInDesigner(fl) }, 'Edit graph in Material Designer')));
        body.append(this.materialProps(fl), ...this.procProps(fl), ...this.fillSettings(fl));
      }
      if (layer.mask) body.append(group('Mask', el('p', { class: 'note' }, `This layer has a mask${layer.mask.gen ? ' (' + GEN_LABEL[layer.mask.gen.type] + ')' : ''}.`),
        el('button', { onclick: () => this.selectLayer(layer, 'mask') }, 'Edit mask')));
      else body.append(group('Mask', el('p', { class: 'note' }, 'Paint this material only where you want it: add a black mask, then paint white.'),
        el('div', { class: 'seg' },
          el('button', { class: 'primary', onclick: () => this.addMaskTo(layer, 'black', null) }, 'Add black mask & paint'),
          el('button', { onclick: () => this.addMaskTo(layer, 'white', null) }, 'White mask'))));
    } else {
      title = this.tool === 'picker' ? 'Properties — picker' : this.tool === 'smudge' ? 'Properties — smudge' : this.tool === 'clone' ? 'Properties — clone' : this.tool === 'blur' ? 'Properties — blur' : 'Properties — paint';
      this.brushPreview = el('canvas', { width: 220, height: 110, class: 'brush-prev' }) as HTMLCanvasElement;
      this.matPreview = el('img', { class: 'mat-prev', alt: '' }) as HTMLImageElement;
      body.append(
        el('div', { class: 'prop-preview' }, this.brushPreview, this.matPreview),
        group('Brush',
          this.brushSlider('Size', 'radius'), this.brushSlider('Flow', 'flow'), this.brushSlider('Stroke opacity', 'opacity'),
          this.brushSlider('Hardness', 'hardness'), this.brushSlider('Spacing', 'spacing'),
          this.smoothingSlider(), this.pressureRow(),
          slider('Backface culling', { min: 0, max: 180, step: 1, value: this.brush.cullAngle ?? 90, fmt: (v) => (v >= 180 ? 'Off' : `${v}°`),
            onInput: (v) => (this.brush.cullAngle = v) }).el,
          el('div', { class: 'row' }, el('label', {}, 'Symmetry'), this.symmetryButtons()),
          ...this.symmetryOffsets(),
          el('p', { class: 'note' }, 'Flow builds up with every stamp (low = see-through, layers up as you go over an area); Stroke opacity is the most one stroke can cover. Backface culling stops the brush painting surface that faces away from you by more than that angle (90° like Substance; slide to the end to turn it off). Smoothing (lazy mouse) makes the brush trail the cursor for steady lines. Pen pressure works with drawing tablets. Symmetry mirrors strokes across the model\'s centre (X, Y, Z).')),
        this.tool === 'smudge' || this.tool === 'clone' || this.tool === 'blur' ? group(this.tool === 'smudge' ? 'Smudge' : this.tool === 'clone' ? 'Clone' : 'Blur', el('p', { class: 'note' },
          this.tool === 'smudge' ? 'Drags the paint that\'s already on the layer along with the brush. Flow is the strength. Works on the channels ticked under Material.'
          : this.tool === 'clone' ? `Hold V and click where to copy from, then paint somewhere else: the copy follows the brush at the same offset. ${this.ts.cloneSource ? 'Source is set.' : 'No source set yet.'} Copies the channels ticked under Material.`
          : 'Softens the paint under the brush. Flow is the strength; a bigger brush blurs more. Works on the channels ticked under Material.')) : '',
        group('Brush tip', ...this.brushTipProps()),
        this.materialProps(null),
      );
    }
    host.append(el('div', { class: 'dock-head' }, title), body);
    host.ondragover = (e) => { if (this.dragItem?.kind === 'material') e.preventDefault(); };
    host.ondrop = (e) => {
      const it = this.dragItem;
      if (it?.kind !== 'material') return;
      e.preventDefault(); this.dragItem = null;
      const layer = this.ts.activeLayer;
      if (layer?.kind === 'fill' && this.paintTarget === 'content' && !Object.keys(layer.images ?? {}).length) {
        this.ts.checkpoint(`Apply “${it.name}”`);
        layer.values = structuredClone(it.preset.values); layer.enabled = { ...layer.enabled, ...it.preset.enabled, normal: layer.enabled.normal };
        this.ts.layerChanged();
      } else { this.brush.values = structuredClone(it.preset.values); this.brush.channels = { ...it.preset.enabled, normal: false }; this.buildProperties(); }
      toast(`Material: ${it.name}`);
    };
    this.drawBrushPreview();
    this.updateMatPreview();
  }

  /** Material channels: the brush (fill = null) or a fill layer. */
  private materialProps(fill: FillLayer | null) {
    const values: ChannelValues = fill ? fill.values : this.brush.values;
    const enabled: Record<Ch, boolean> = fill ? fill.enabled : this.brush.channels;
    // Only the edited channel is recomposited, so colour and slider edits show on the next frame.
    const changed = (ch?: Ch) => {
      if (fill) { this.ts.markDirty(ch ? [ch] : undefined); this.modified = true; this.updateLayerRow(fill); }
      else this.updateMatPreview();
    };
    /** Record an undo step before a fill-layer edit (slider drags merge into one). */
    const pre = (k: string) => { if (fill) this.ts.checkpoint(`Edit ${fill.name}`, `fill:${fill.id}:${k}`); };
    const checkRow = (ch: Ch, label: string, control: HTMLElement) => {
      const box = el('input', { type: 'checkbox', checked: enabled[ch] }) as HTMLInputElement;
      const row = el('div', { class: 'slider check' }, box, el('label', {}, label), control, el('span', { class: 'val' }, ''));
      const sync = () => { (control as HTMLInputElement).disabled = !box.checked; row.classList.toggle('dim', !box.checked); };
      box.addEventListener('change', () => { pre('on:' + ch); enabled[ch] = box.checked; sync(); changed(ch); });
      sync();
      return row;
    };
    const imageRow = (ch: Ch, label: string, img: FillImage) => {
      const row = checkRow(ch, label, el('span', { class: 'img-name', title: img.name }, '🖼 ' + img.name));
      if (fill && !img.name.startsWith('graph:')) row.append(
        el('button', { class: 'img-btn', title: 'Replace the image', onclick: () => this.setFillChannelImage(fill, ch) }, '⟳'),
        el('button', { class: 'img-btn', title: 'Remove the image (use a value)', onclick: () => this.removeFillChannelImage(fill, ch) }, '×'));
      return row;
    };
    /** Fill layers: an image button on every channel row, and image files can be dropped on the row. */
    const withImage = (ch: Ch, row: HTMLElement) => {
      if (!fill || fill.images?.[ch]) return row;
      row.append(el('button', { class: 'img-btn', title: `Use an image for ${CH_LABEL[ch]} (or drop one here)`, onclick: () => this.setFillChannelImage(fill, ch) }, '🖼'));
      row.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); row.classList.add('drop-on'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-on'));
      row.addEventListener('drop', (e) => {
        const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.(png|jpe?g|webp|bmp)$/i.test(x.name));
        row.classList.remove('drop-on');
        if (!f) return;
        e.preventDefault(); e.stopPropagation();
        this.setFillChannelImage(fill, ch, f);
      });
      return row;
    };
    const colorRow = (ch: 'color' | 'emit', label: string) => {
      const img = fill?.images?.[ch];
      if (img) return imageRow(ch, label, img);
      const input = el('input', { type: 'color', value: rgbToHex(values[ch]) }) as HTMLInputElement;
      input.addEventListener('input', () => { pre(ch); values[ch] = hexToRgb(input.value); changed(ch); });
      return withImage(ch, checkRow(ch, label, input));
    };
    const scalar = (ch: 'rough' | 'metal' | 'height', label: string) => {
      const img = fill?.images?.[ch];
      if (img) return imageRow(ch, label, img);
      return withImage(ch, slider(label, {
        min: 0, max: 1, step: 0.01, value: values[ch], onInput: (v) => { pre(ch); values[ch] = v; changed(ch); },
        check: { value: enabled[ch], onChange: (v) => { pre('on:' + ch); enabled[ch] = v; changed(ch); } },
      }).el);
    };
    const hasImages = !!fill && Object.keys(fill.images ?? {}).length > 0;
    const nimg = fill?.images?.normal;
    return group(fill ? `Material · ${fill.name}` : 'Material',
      !fill && this.paintTarget === 'mask' ? el('p', { class: 'note warn' }, 'Painting the mask: the brush paints white (Paint) or black (Erase).') : null,
      colorRow('color', 'Color'),
      scalar('rough', 'Rough'), scalar('metal', 'Metal'), scalar('height', 'Height'),
      colorRow('emit', 'Emissive'),
      nimg ? imageRow('normal', 'Normal', nimg) : fill ? el('div', { class: 'row' }, el('label', {}, 'Normal'), el('button', { class: 'grow', onclick: () => this.setFillChannelImage(fill, 'normal') }, 'Load normal map…')) : null,
      el('p', { class: 'note' }, fill
        ? (hasImages ? 'Image fill from a texture set. Placement and adjustments are below.' : 'Covers the whole model (or only its mask). Tick the channels it affects.')
        : 'Ticked channels are painted. Height 0.5 is flat; higher raises, lower carves. Emissive glows (black = none).'),
    );
  }

  /** Substance-style fill settings for image materials: projection, UV transform, per-channel adjustments. */
  private fillSettings(fill: FillLayer): HTMLElement[] {
    const imgs = fill.images ?? {};
    if (!Object.keys(imgs).length) return [];
    const ts = this.ts;
    const pre = (k: string) => ts.checkpoint(`Edit ${fill.name}`, `fillx:${fill.id}:${k}`);
    const live = () => { ts.markDirty(); this.modified = true; };
    const xf = () => (fill.xf ??= { ...DEFAULT_XF });
    const adj = () => (fill.adj ??= structuredClone(DEFAULT_ADJ));
    const x = fill.xf ?? DEFAULT_XF, a = fill.adj ?? DEFAULT_ADJ;
    const sx = (label: string, key: 'rot' | 'offU' | 'offV' | 'sharp', min: number, max: number, step: number, fmt?: (v: number) => string) =>
      slider(label, { min, max, step, value: x[key], fmt, onInput: (v) => { pre(key); xf()[key] = v; live(); } }).el;
    type NumKey = { [K in keyof FillAdjust]: FillAdjust[K] extends number ? K : never }[keyof FillAdjust];
    const sa = (label: string, key: NumKey, min: number, max: number, step: number, fmt?: (v: number) => string) =>
      slider(label, { min, max, step, value: a[key], fmt, onInput: (v) => { pre(key); adj()[key] = v; live(); } }).el;
    const proj = (p: 'uv' | 'tri' | 'planar', label: string) => el('button', { class: x.proj === p ? 'on' : '', onclick: () => {
      if (x.proj === p) return; pre('proj'); xf().proj = p;
      if (p === 'planar' && !fill.xf!.shapeAt) this.placeProjectionAtView(fill);
      live(); this.buildProperties();
    } }, label);
    const pck = (label: string, on: boolean, set: (v: boolean) => void, title = '') => {
      const c = el('input', { type: 'checkbox', checked: on }) as HTMLInputElement;
      c.addEventListener('change', () => { pre('pj'); set(c.checked); live(); });
      return el('label', { class: 'check-row', title }, c, ' ' + label);
    };
    const moving = this.shapeMove?.g === (fill.xf as unknown as GenSettings);
    const planarRows = x.proj === 'planar' ? [
      el('div', { class: 'row' }, el('button', { class: 'grow' + (moving ? ' on' : ''), onclick: () => this.toggleShapeMove(fill, xf() as unknown as GenSettings, true) },
        moving ? 'Done (Esc)' : 'Edit in the viewport (move / rotate / scale)')),
      slider('Size', { min: 0.02, max: 4, step: 0.01, value: x.shapeSize ?? 0.3, fmt: (v) => v.toFixed(2), onInput: (v) => { pre('pjsize'); xf().shapeSize = v; live(); this.projToObj(); } }).el,
      slider('Width / height', { min: 0.1, max: 10, step: 0.01, value: x.shapeAspect ?? 1, fmt: (v) => v.toFixed(2), onInput: (v) => { pre('pjasp'); xf().shapeAspect = v; live(); this.projToObj(); } }).el,
      slider('Turn', { min: -180, max: 180, step: 1, value: x.shapeRot ?? 0, fmt: (v) => `${v.toFixed(0)}°`, onInput: (v) => { pre('pjrot'); xf().shapeRot = v; live(); this.projToObj(); } }).el,
      pck('Hide on back faces', x.hideBack !== false, (v) => (xf().hideBack = v), 'Don\'t project onto surface facing away from the image (the back of the model)'),
      pck('Repeat outside the box', !!x.tile, (v) => (xf().tile = v)),
    ] : [];
    const placement = group('Projection',
      el('div', { class: 'row' }, el('label', {}, 'Mode'), el('div', { class: 'seg grow' }, proj('uv', 'UV'), proj('tri', 'Tri-planar'), proj('planar', 'Planar'))),
      ...planarRows,
      imgs.color ? pck('Use the image\'s transparency', x.useAlpha !== false, (v) => (xf().useAlpha = v), 'Transparent parts of the base color image show the layers below, on every channel') : null,
      slider('Scale', { min: 0.25, max: 64, step: 0.25, value: fill.tiling, fmt: (v) => `${v}×`, onInput: (v) => { pre('tiling'); fill.tiling = v; live(); } }).el,
      sx('Rotation', 'rot', 0, 360, 1, (v) => `${v.toFixed(0)}°`),
      x.proj !== 'tri' ? sx('Offset U', 'offU', -1, 1, 0.005, (v) => v.toFixed(3)) : null,
      x.proj !== 'tri' ? sx('Offset V', 'offV', -1, 1, 0.005, (v) => v.toFixed(3)) : null,
      x.proj === 'tri' ? sx('Blend sharpness', 'sharp', 1, 24, 0.5, (v) => v.toFixed(1)) : null,
      el('p', { class: 'note' }, x.proj === 'tri'
        ? 'Tri-planar projects the material from 3 sides in 3D, so there are no visible UV seams and the scale is the same everywhere — like Substance\'s tri-planar fill.'
        : x.proj === 'planar' ? 'Planar projects the image flat onto the model, like a sticker or a projector (Substance\'s planar projection). Move, turn and resize it with the handles on the model. Scale repeats the image inside the box.'
        : 'Uses the model\'s UVs. Switch to Tri-planar if seams or stretching show, or Planar to place an image like a sticker.'),
    );
    const tint = el('input', { type: 'color', value: rgbToHex(a.tint) }) as HTMLInputElement;
    tint.addEventListener('input', () => { pre('tint'); adj().tint = hexToRgb(tint.value); live(); });
    const inv = el('input', { type: 'checkbox', checked: a.roughInv }) as HTMLInputElement;
    inv.addEventListener('change', () => { pre('roughInv'); adj().roughInv = inv.checked; live(); });
    const pct = (v: number) => Math.round(v * 100).toString();
    const adjust = group('Adjustments',
      imgs.color ? el('h5', {}, 'Base color') : null,
      imgs.color ? sa('Hue', 'hue', -0.5, 0.5, 0.005, (v) => `${Math.round(v * 360)}°`) : null,
      imgs.color ? sa('Saturation', 'sat', 0, 2, 0.01, pct) : null,
      imgs.color ? sa('Brightness', 'bright', 0, 2, 0.01, pct) : null,
      imgs.color ? sa('Contrast', 'contrast', 0, 2, 0.01, pct) : null,
      imgs.color ? el('div', { class: 'row' }, el('label', {}, 'Tint'), tint) : null,
      imgs.rough ? el('h5', {}, 'Roughness') : null,
      imgs.rough ? sa('Min', 'roughMin', 0, 1, 0.01, pct) : null,
      imgs.rough ? sa('Max', 'roughMax', 0, 1, 0.01, pct) : null,
      imgs.rough ? el('label', { class: 'check-row', title: 'Use a glossiness map as roughness' }, inv, ' Invert (gloss → rough)') : null,
      imgs.metal ? el('h5', {}, 'Metallic') : null,
      imgs.metal ? sa('Min', 'metalMin', 0, 1, 0.01, pct) : null,
      imgs.metal ? sa('Max', 'metalMax', 0, 1, 0.01, pct) : null,
      imgs.height ? el('h5', {}, 'Height') : null,
      imgs.height ? sa('Intensity', 'heightScale', -2, 4, 0.01, (v) => v.toFixed(2)) : null,
      imgs.height ? sa('Offset', 'heightOff', -0.5, 0.5, 0.005, (v) => v.toFixed(3)) : null,
      imgs.normal ? el('h5', {}, 'Normal') : null,
      imgs.normal ? sa('Strength', 'normalStr', 0, 3, 0.01, (v) => v.toFixed(2)) : null,
      imgs.emit ? el('h5', {}, 'Emissive') : null,
      imgs.emit ? sa('Intensity', 'emitInt', 0, 10, 0.05, (v) => v.toFixed(2)) : null,
      el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => {
        pre('reset:' + Math.random()); fill.adj = structuredClone(DEFAULT_ADJ); fill.xf = { ...DEFAULT_XF }; fill.tiling = 1; live(); this.buildProperties();
      } }, 'Reset placement & adjustments')),
    );
    return [placement, adjust];
  }

  /** Controls of one generator (the mask's main one or a stacked effect). */
  private genControls(g: GenSettings, pre: (k: string) => void, live: () => void, kp: string, layer?: Layer): HTMLElement[] {
    const out: HTMLElement[] = [];
    const sl = (label: string, key: 'amount' | 'contrast', min: number, max: number, step: number) =>
      slider(label, { min, max, step, value: g[key], onInput: (v) => { pre(kp + key); g[key] = v; live(); } }).el;
    if (g.type === 'painter') return this.spControls(g, pre, live, kp);
    if (g.type === 'shape') {
      const ss = select<string>(SHAPE_KINDS.map((k) => ({ value: k, label: SHAPE_LABEL[k] })), g.shape ?? 'circle', (v) => { pre(kp + 'shape'); g.shape = v as ShapeKind; live(); });
      const moving = !!layer && this.shapeMove?.g === g;
      const inv = el('input', { type: 'checkbox', checked: g.invert }) as HTMLInputElement;
      inv.addEventListener('change', () => { pre(kp + 'invert'); g.invert = inv.checked; live(); });
      const uvMode = g.shapeProj === 'uv';
      const projSeg = el('div', { class: 'seg grow' },
        el('button', { class: uvMode ? '' : 'on', title: 'One shape placed on the model like a sticker (move it with the handles)', onclick: () => { if (!uvMode) return; pre(kp + 'proj'); g.shapeProj = 'decal'; live(); this.buildProperties(); } }, 'On the model'),
        el('button', { class: uvMode ? 'on' : '', title: 'The shape repeats over the UVs with tiling (Substance\'s default)', onclick: () => { if (uvMode) return; pre(kp + 'proj'); g.shapeProj = 'uv'; g.shapeTile ??= 4; if (this.shapeMove?.g === g) this.toggleShapeMove(layer!, g); live(); this.buildProperties(); } }, 'UV (tiling)'));
      out.push(el('div', { class: 'row' }, el('label', {}, 'Shape'), ss),
        el('div', { class: 'row' }, el('label', {}, 'Projection'), projSeg),
        ...(uvMode ? [
          slider('Tiling', { min: 1, max: 32, step: 1, value: g.shapeTile ?? 4, fmt: (v) => `${v} × ${v}`, onInput: (v) => { pre(kp + 'tile'); g.shapeTile = v; live(); } }).el,
          slider('Offset U', { min: -0.5, max: 0.5, step: 0.005, value: g.shapeOff?.[0] ?? 0, fmt: (v) => v.toFixed(2), onInput: (v) => { pre(kp + 'offu'); g.shapeOff = [v, g.shapeOff?.[1] ?? 0]; live(); } }).el,
          slider('Offset V', { min: -0.5, max: 0.5, step: 0.005, value: g.shapeOff?.[1] ?? 0, fmt: (v) => v.toFixed(2), onInput: (v) => { pre(kp + 'offv'); g.shapeOff = [g.shapeOff?.[0] ?? 0, v]; live(); } }).el,
        ] : [layer ? el('div', { class: 'row' }, el('button', { class: 'grow' + (moving ? ' primary' : ''), onclick: () => this.toggleShapeMove(layer, g) },
          moving ? 'Done (Esc)' : 'Move / rotate / scale on the model')) : el('span', {})]),
        slider('Size', { min: 0.01, max: 1.5, step: 0.005, value: g.shapeSize ?? 0.2, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { pre(kp + 'size'); g.shapeSize = v; live(); } }).el,
        slider('Stretch', { min: 0.2, max: 5, step: 0.01, value: g.shapeAspect ?? 1, fmt: (v) => v.toFixed(2), onInput: (v) => { pre(kp + 'aspect'); g.shapeAspect = v; live(); } }).el,
        slider('Rotation', { min: -180, max: 180, step: 1, value: g.shapeRot ?? 0, fmt: (v) => Math.round(v) + '°', onInput: (v) => { pre(kp + 'rot'); g.shapeRot = v; live(); } }).el,
        sl('Hard edge', 'contrast', 0, 1, 0.01),
        el('label', { class: 'check-row' }, inv, ' Invert (hide inside the shape)'),
        layer?.kind === 'fill' ? el('div', { class: 'row' }, el('label', {}, 'Height detail'), el('div', { class: 'seg grow' },
          el('button', { title: 'Make this layer press the shape into the surface (height only) and make it an anchor point', onclick: () => this.makeHeightDetail(layer, 'in') }, 'Press in'),
          el('button', { title: 'Make this layer raise the shape out of the surface (height only) and make it an anchor point', onclick: () => this.makeHeightDetail(layer, 'out') }, 'Stick out'))) : el('span', {}),
        el('p', { class: 'note' }, uvMode ? 'The shape repeats over the UVs, like Substance\'s Shape fill. Use Tiling for how many, Size for how big each one is.'
          : 'The shape sits on the model like a sticker. Click "Move / rotate / scale" and use the handles in the 3D view: drag the middle to move it, the ring to turn it, the square to resize it.'));
      return out;
    }
    if (g.type === 'pattern') {
      const ps = select<string>(PATTERNS.map((p) => ({ value: p, label: PATTERN_LABEL[p] })), g.pattern ?? 'grunge', (v) => { pre(kp + 'pat'); g.pattern = v as PatternType; live(); });
      out.push(el('div', { class: 'row' }, el('label', {}, 'Pattern'), ps),
        slider('Scale', { min: 0.25, max: 60, step: 0.25, value: g.scale ?? 3, fmt: (v) => v.toFixed(2), onInput: (v) => { pre(kp + 'scale'); g.scale = v; live(); } }).el,
        sl('Balance', 'amount', 0, 1, 0.01), sl('Contrast', 'contrast', 0, 1, 0.01),
        el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => { pre(kp + 'seed:' + Math.random()); g.seed = Math.round(Math.random() * 1000); live(); } }, 'New random seed')));
    } else out.push(sl(g.type === 'gradient' ? 'Position' : 'Amount', 'amount', 0, 1, 0.01), sl('Contrast', 'contrast', 0, 1, 0.01));
    if (g.type === 'gradient' || g.type === 'dust') {
      const axes: Axis[] = ['x', 'y', 'z'];
      const btns: HTMLButtonElement[] = axes.map((a) => el('button', { onclick: () => { pre(kp + 'axis'); g.axis = a; live(); btns.forEach((x, i) => x.classList.toggle('on', axes[i] === a)); } }, a.toUpperCase()));
      btns.forEach((x, i) => x.classList.toggle('on', axes[i] === g.axis));
      const flip = el('input', { type: 'checkbox', checked: g.flip }) as HTMLInputElement;
      flip.addEventListener('change', () => { pre(kp + 'flip'); g.flip = flip.checked; live(); });
      out.push(el('div', { class: 'row' }, el('label', {}, 'Direction'), el('div', { class: 'seg grow' }, ...btns), el('label', { class: 'inline' }, flip, ' Flip')));
    }
    const inv = el('input', { type: 'checkbox', checked: g.invert }) as HTMLInputElement;
    inv.addEventListener('change', () => { pre(kp + 'invert'); g.invert = inv.checked; live(); });
    out.push(el('label', { class: 'check-row' }, inv, ' Invert'));
    if (MICRO_TYPES.includes(g.type)) out.push(...this.microControls(g, pre, live, kp, layer));
    return out;
  }

  /** Controls of a Painter-style generator, grouped like Painter's (Texture, Ambient Occlusion, Curvature…). */
  private spControls(g: GenSettings, pre: (k: string) => void, live: () => void, kp: string): HTMLElement[] {
    const sp = (g.sp ??= spDefaults('dirt'));
    const def = SP_DEFS[sp.kind];
    const kindSel = select<string>(SP_KINDS.map((k) => ({ value: k, label: SP_DEFS[k].label })), sp.kind, (v) => {
      pre(kp + 'spkind'); g.sp = spDefaults(v as SpKind); live(); this.buildProperties();
    });
    const out: HTMLElement[] = [el('div', { class: 'row' }, el('label', {}, 'Generator'), kindSel), el('p', { class: 'note' }, def.desc)];
    // Smart mask presets: one Amount slider that grows / shrinks the whole mask.
    if (g.spBase !== undefined) out.push(slider('Amount', { min: 0, max: 1, step: 0.01, value: g.amount ?? g.spBase, onInput: (v) => { pre(kp + 'amount'); g.amount = v; live(); } }).el);
    const groups = new Map<string, HTMLElement[]>();
    const refresh = () => this.buildProperties();
    const ctl = (d: SpParam): HTMLElement => {
      const key = kp + 'sp:' + d.id;
      const cur = sp.p[d.id] ?? d.def;
      const set = (v: SpParam['def'], rebuild = false) => { pre(key); sp.p[d.id] = v; live(); if (rebuild) refresh(); };
      const gated = SP_DEFS[sp.kind].params.some((x) => x.if === d.id);
      switch (d.kind) {
        case 'b': {
          const c = el('input', { type: 'checkbox', checked: !!cur }) as HTMLInputElement;
          c.addEventListener('change', () => set(c.checked, gated));
          return el('label', { class: 'check-row' }, c, ' ' + d.label);
        }
        case 'i': return slider(d.label, { min: d.min ?? 1, max: d.max ?? 32, step: 1, value: Number(cur), onInput: (v) => set(v) }).el;
        case 'enum': return el('div', { class: 'row' }, el('label', {}, d.label), select<string>(d.opts!.map(([v, l]) => ({ value: String(v), label: l })), String(cur), (v) => set(Number(v))));
        case 'grunge': return el('div', { class: 'row' }, el('label', {}, d.label), this.grungeSelect(String(cur), (v) => set(v)));
        case 'vec3': {
          const a = (cur as [number, number, number]).slice() as [number, number, number];
          return el('div', { class: 'sp-vec' }, el('div', { class: 'sp-vec-h' }, d.label), ...['X', 'Y', 'Z'].map((ax, k) =>
            slider(ax, { min: 0, max: 1, step: 0.01, value: a[k], onInput: (v) => { a[k] = v; set([a[0], a[1], a[2]]); } }).el));
        }
        default: return slider(d.label, { min: d.min ?? 0, max: d.max ?? 1, step: (d.max ?? 1) - (d.min ?? 0) > 4 ? 0.1 : 0.005, value: Number(cur), fmt: (v) => v.toFixed(3), onInput: (v) => set(v) }).el;
      }
    };
    for (const d of def.params) {
      if (d.if && !sp.p[d.if]) continue;
      const k = d.grp ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(ctl(d));
    }
    for (const [name, list] of groups) {
      if (!name) { out.push(...list); continue; }
      const det = el('details', { class: 'sp-grp' }, el('summary', {}, name), ...list) as HTMLDetailsElement;
      const openKey = `${sp.kind}:${name}`;
      det.open = this.spOpen.has(openKey);
      det.addEventListener('toggle', () => { if (det.open) this.spOpen.add(openKey); else this.spOpen.delete(openKey); });
      out.push(det);
    }
    out.push(el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => { pre(kp + 'seed:' + Math.random()); g.seed = Math.round(Math.random() * 1000); live(); } }, 'New random seed')));
    return out;
  }
  private spOpen = new Set<string>();

  /** Grunge picker: the CC0 grunge library by category (procedural stand-ins until it has downloaded). */
  private grungeSelect(cur: string, onChange: (v: string) => void): HTMLSelectElement {
    const opts: { value: string; label: string }[] = [];
    for (const cat of GRUNGE_CATS) {
      const n = this.grungeCount(cat);
      if (!n) { opts.push({ value: `grunge:${cat}`, label: `${GRUNGE_CAT_LABEL[cat]} (pattern)` }); continue; }
      for (let k = 0; k < n; k++) { const g = this.grunges.info(cat, k)!; opts.push({ value: `grunge:${cat}/${g.id}`, label: `${GRUNGE_CAT_LABEL[cat]} · ${g.name}` }); }
    }
    // Keep the current choice in the list even when it isn't downloaded / known yet.
    let value = cur;
    if (!opts.some((o) => o.value === cur)) {
      const { cat, n, id } = parseGrungeRef(cur);
      const g = id ? this.grunges.byId(id) : this.grunges.info(cat, n);
      const match = g && opts.find((o) => o.value === `grunge:${g.cat}/${g.id}`);
      if (match) value = match.value; else opts.unshift({ value: cur, label: `${GRUNGE_CAT_LABEL[cat] ?? cat}${id ? ' · ' + id : n ? ' ' + (n + 1) : ''}` });
    }
    return select<string>(opts, value, onChange);
  }

  /** "Micro details" (Substance anchor points): pick an anchor whose height details this generator follows. */
  private microControls(g: GenSettings, pre: (k: string) => void, live: () => void, kp: string, layer?: Layer): HTMLElement[] {
    const anchors = this.ts.anchors.filter((a) => a !== layer);
    const sel = select<string>([{ value: '', label: anchors.length ? 'None' : 'None (add an anchor point first)' }, ...anchors.map((a) => ({ value: a.name, label: '⚓ ' + a.name }))],
      g.micro?.anchor ?? '', (v) => { pre(kp + 'micro'); g.micro = v ? { anchor: v, amount: g.micro?.amount ?? 1 } : undefined; live(); this.buildProperties(); });
    sel.title = 'Use the painted or shape height details of an anchored layer, so this mask wraps around them too';
    const out: HTMLElement[] = [el('div', { class: 'row' }, el('label', {}, 'Micro details'), sel)];
    if (g.micro?.anchor) out.push(slider('Detail strength', { min: 0, max: 2, step: 0.01, value: g.micro.amount, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { pre(kp + 'microAmt'); g.micro!.amount = v; live(); } }).el);
    return out;
  }

  private noiseControls(g: GenSettings, pre: (k: string) => void, live: () => void, kp: string): HTMLElement[] {
    const sl = (label: string, key: 'noise' | 'noiseScale', min: number, max: number, step: number) =>
      slider(label, { min, max, step, value: g[key], fmt: key === 'noiseScale' ? (v) => v.toFixed(1) : undefined, onInput: (v) => { pre(kp + key); g[key] = v; live(); } }).el;
    return [sl('Noise', 'noise', 0, 1, 0.01), sl('Noise size', 'noiseScale', 0.5, 40, 0.5),
      el('div', { class: 'row' }, el('label', {}, ''), el('button', { class: 'grow', onclick: () => { pre(kp + 'seed:' + Math.random()); g.seed = Math.round(Math.random() * 1000); live(); } }, 'New random seed'))];
  }

  private maskProps(layer: Layer): HTMLElement[] {
    const ts = this.ts;
    const m = layer.mask!;
    const live = () => { ts.maskChanged(layer); this.modified = true; };
    const pre = (k: string) => ts.checkpoint('Edit mask', `mask:${layer.id}:${k}`);
    const out: HTMLElement[] = [];
    const genSel = select<string>([{ value: '', label: 'None (paint only)' }, ...GEN_TYPES.map((t) => ({ value: t, label: GEN_LABEL[t] }))],
      m.gen?.type ?? '', (v) => { pre('type'); const keep = m.gen ? { fx: m.gen.fx, outInvert: m.gen.outInvert } : {}; m.gen = v ? { ...defaultGen(v as GenType), ...keep } : null; if (m.gen?.type === 'shape') this.placeShapeAtView(m.gen); live(); this.buildProperties(); });
    const gen = group(`Generator · ${layer.name}`, el('div', { class: 'row' }, el('label', {}, 'Type'), genSel));
    out.push(gen);
    if (m.gen?.type === 'id') {
      const g = m.gen;
      const sw = el('div', { class: 'id-swatches' });
      (g.colors ?? []).forEach((c, k) => {
        const chip = el('span', { class: 'id-swatch', title: rgbToHex(c), style: { background: rgbToHex(c) } });
        const x = el('button', { class: 'id-x', title: 'Remove this color', onclick: () => { pre('colors:' + Math.random()); g.colors = (g.colors ?? []).filter((_, i) => i !== k); live(); this.buildProperties(); } }, '×');
        sw.append(el('span', { class: 'id-item' }, chip, x));
      });
      if (!(g.colors ?? []).length) sw.append(el('span', { class: 'muted' }, 'No colors picked yet'));
      const inv = el('input', { type: 'checkbox', checked: g.invert }) as HTMLInputElement;
      inv.addEventListener('change', () => { pre('invert'); g.invert = inv.checked; live(); });
      const picking = this.idPick === layer.id;
      gen.append(
        sw,
        el('div', { class: 'row' }, el('button', { class: 'grow' + (picking ? ' primary' : ''), onclick: () => {
          if (this.idPick === layer.id) { this.idPick = -1; document.body.classList.remove('picking-id'); this.buildProperties(); return; }
          this.idPick = layer.id; document.body.classList.add('picking-id');
          if (this.view3 === 'material' && ts.baked.has('id')) { this.view2 = 'id'; this.applyViews(); }
          toast('Click a part of the model (3D or 2D view) to add its ID color');
          this.buildProperties();
        } }, picking ? 'Click the model… (cancel)' : 'Pick color from model')),
        slider('Tolerance', { min: 0.01, max: 0.5, step: 0.01, value: g.tolerance ?? 0.1, fmt: (v) => v.toFixed(2), onInput: (v) => { pre('tol'); g.tolerance = v; live(); } }).el,
        el('label', { class: 'check-row' }, inv, ' Invert'),
        el('p', { class: 'note' }, 'Shows the layer only where the ID map has the picked colors (like Substance\'s Color Selection). Bake the ID map in the Baking tab first; the 2D view can show it (ID map).'),
      );
      if (!ts.baked.has('id')) out.push(el('div', { class: 'note warn' }, 'The ID map isn\'t baked yet. ',
        el('button', { class: 'link', onclick: () => { this.bakeItem = 'id'; this.setMode('bake'); } }, 'Go to Baking')));
    } else if (m.gen) {
      const g = m.gen;
      gen.append(...this.genControls(g, pre, live, 'g', layer));
      if (g.type !== 'pattern' && g.type !== 'shape' && g.type !== 'painter') out.push(group('Grunge breakup', ...this.noiseControls(g, pre, live, 'g')));
      // Effect stack (Substance's mask layers / TextureCraft's effects): more generators and patterns blended on top.
      const fxBox = group('Mask effects', el('p', { class: 'note' }, 'Stack more generators and patterns on the one above (bottom → top). Multiply cuts away, Lighten adds more.'));
      (g.fx ?? []).forEach((e, k) => {
        const kp = `fx${k}`;
        const typeSel = select<string>([...GEN_TYPES.filter((t) => t !== 'id').map((t) => ({ value: t, label: GEN_LABEL[t] }))], e.type,
          (v) => { pre(kp + 'type'); const ne: MaskFx = { ...defaultGen(v as GenType), blend: e.blend, opacity: e.opacity, on: e.on }; if (ne.type === 'shape') this.placeShapeAtView(ne); g.fx![k] = ne; live(); this.buildProperties(); });
        const blendSel = select<string>(FX_BLENDS.map((b) => ({ value: b, label: FX_BLEND_LABEL[b] })), e.blend, (v) => { pre(kp + 'blend'); e.blend = v as MaskFx['blend']; live(); });
        const on = el('input', { type: 'checkbox', checked: e.on !== false, title: 'Enabled' }) as HTMLInputElement;
        on.addEventListener('change', () => { pre(kp + 'on'); e.on = on.checked; live(); });
        const head = el('div', { class: 'fx-head' }, on, el('b', { class: 'grow' }, `${k + 1}. ${e.type === 'pattern' ? PATTERN_LABEL[e.pattern ?? 'grunge'] : e.type === 'painter' && e.sp ? SP_DEFS[e.sp.kind].label : GEN_LABEL[e.type]}`),
          el('button', { title: 'Move up', disabled: k === g.fx!.length - 1, onclick: () => { pre('order:' + Math.random()); const f = g.fx!; [f[k], f[k + 1]] = [f[k + 1], f[k]]; live(); this.buildProperties(); } }, '▲'),
          el('button', { title: 'Move down', disabled: k === 0, onclick: () => { pre('order:' + Math.random()); const f = g.fx!; [f[k], f[k - 1]] = [f[k - 1], f[k]]; live(); this.buildProperties(); } }, '▼'),
          el('button', { title: 'Remove this effect', onclick: () => { pre('rm:' + Math.random()); g.fx!.splice(k, 1); if (!g.fx!.length) g.fx = undefined; live(); this.buildProperties(); } }, '×'));
        const box = el('div', { class: 'fx-item' + (e.on === false ? ' dim' : '') }, head,
          el('div', { class: 'row' }, el('label', {}, 'Type'), typeSel),
          el('div', { class: 'row' }, el('label', {}, 'Blend'), blendSel),
          slider('Opacity', { min: 0, max: 1, step: 0.01, value: e.opacity, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { pre(kp + 'op'); e.opacity = v; live(); } }).el,
          ...this.genControls(e, pre, live, kp, layer),
          ...(e.type !== 'pattern' && e.type !== 'noise' && e.type !== 'shape' && e.type !== 'painter' ? this.noiseControls(e, pre, live, kp) : []));
        fxBox.append(box);
      });
      const addSel = select<string>([{ value: '', label: '+ Add effect…' },
        ...PATTERNS.map((p) => ({ value: 'p:' + p, label: 'Pattern: ' + PATTERN_LABEL[p] })),
        ...GEN_TYPES.filter((t) => t !== 'id' && t !== 'pattern').map((t) => ({ value: 'g:' + t, label: 'Generator: ' + GEN_LABEL[t] }))], '', (v) => {
        if (!v) return;
        pre('add:' + Math.random());
        const base = v.startsWith('p:') ? { ...defaultGen('pattern'), pattern: v.slice(2) as PatternType } : defaultGen(v.slice(2) as GenType);
        if (base.type === 'shape') this.placeShapeAtView(base);
        (g.fx ??= []).push({ ...base, blend: 'multiply', opacity: 1 });
        live(); this.buildProperties();
      });
      const outInv = el('input', { type: 'checkbox', checked: !!g.outInvert }) as HTMLInputElement;
      outInv.addEventListener('change', () => { pre('outInv'); g.outInvert = outInv.checked; live(); });
      const presetSel = select<string>([{ value: '', label: 'Load a smart mask preset…' }, ...SMART_MASKS.map((p) => ({ value: p.id, label: p.label }))], '',
        (v) => { if (v) this.applySmartMaskTo(layer, v); this.buildProperties(); });
      fxBox.append(el('div', { class: 'row' }, addSel), el('label', { class: 'check-row' }, outInv, ' Invert the whole mask'), el('div', { class: 'row' }, presetSel));
      out.push(fxBox);
      const need: Partial<Record<GenType, BakeKey>> = { edge: 'curv', dirt: 'ao', ao: 'ao', curvature: 'curv', thick: 'thick', id: 'id' };
      const nk = [g, ...(g.fx ?? [])].flatMap((e) => e.type === 'painter' ? ['ao', 'curv'] as BakeKey[] : [need[e.type]]).find((k) => k && !ts.baked.has(k));
      if (ts.baking) out.push(el('p', { class: 'note warn' }, 'Mesh maps are baking — this mask updates when they finish.'));
      else if (nk) out.push(el('div', { class: 'note warn' }, `This mask needs the ${BAKE_ITEMS.find(([k]) => k === nk)![1]} map, which isn't baked yet. `,
        el('button', { class: 'link', onclick: () => { this.bakeItem = nk; this.setMode('bake'); } }, 'Go to Baking')));
    } else {
      const w = el('button', { onclick: () => { if (m.base === 'white') return; pre('base:' + Math.random()); m.base = 'white'; live(); w.classList.add('on'); bk.classList.remove('on'); } }, 'White');
      const bk = el('button', { onclick: () => { if (m.base === 'black') return; pre('base:' + Math.random()); m.base = 'black'; live(); bk.classList.add('on'); w.classList.remove('on'); } }, 'Black');
      (m.base === 'white' ? w : bk).classList.add('on');
      gen.append(el('div', { class: 'row' }, el('label', {}, 'Start as'), el('div', { class: 'seg grow' }, w, bk)));
    }
    out.push(group('Mask paint',
      el('p', { class: 'note' }, 'With the mask selected, the brush paints the mask: Paint shows the layer (white), Erase hides it (black).'),
      el('div', { class: 'seg' },
        el('button', { class: this.view3 === 'mask' ? 'on' : '', onclick: () => { const on = this.view3 !== 'mask'; this.view3 = on ? 'mask' : 'material'; this.view2 = on ? 'mask' : 'material'; this.applyViews(); this.buildProperties(); } }, 'View mask'),
        el('button', { disabled: !m.painted, onclick: () => { ts.clearMaskPaint(layer); this.modified = true; this.buildProperties(); } }, 'Clear paint'),
        el('button', { onclick: () => { ts.removeMask(layer); this.paintTarget = 'content'; this.modified = true; if (this.view3 === 'mask') this.setView('material'); } }, 'Remove mask'),
      ),
    ));
    return out;
  }

  refresh() {
    if (this.historyOpen) this.buildHistory();
    const layer = this.ts.activeLayer;
    if (this.paintTarget === 'mask' && !layer?.mask) this.paintTarget = 'content';
    if (this.view3 === 'mask' || this.view2 === 'mask') this.applyViews();
    if (this.mode === 'paint') this.buildRight();
    this.buildToolstrip();
    this.buildToolbar();
    this.buildStatus();
  }

  // ================================================================ collapsible groups

  private collapsed = new Set<string>(((): string[] => {
    try { return JSON.parse(localStorage.getItem('tp-collapsed2') ?? '[]'); } catch { return []; }
  })());

  private initCollapsible() {
    const key = (h: Element) => (h.textContent ?? '').trim().split(' · ')[0];
    document.addEventListener('click', (e) => {
      const h = (e.target as HTMLElement).closest('.group > h4');
      if (!h) return;
      const g = h.parentElement!;
      g.classList.toggle('collapsed');
      const k = key(h);
      if (g.classList.contains('collapsed')) this.collapsed.add(k); else this.collapsed.delete(k);
      try { localStorage.setItem('tp-collapsed2', JSON.stringify([...this.collapsed])); } catch { /* private mode */ }
    });
    const apply = (root: ParentNode) => root.querySelectorAll('.group > h4').forEach((h) => {
      if (this.collapsed.has(key(h))) h.parentElement!.classList.add('collapsed');
    });
    const obs = new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) apply(n.parentElement ?? n); }); });
    for (const id of ['shelf', 'right', 'viewport']) obs.observe(document.getElementById(id)!, { childList: true, subtree: true });
  }

  // ================================================================ export

  // ================================================================ export (like Painter's Export textures window)

  private exp?: ExportState;
  private expName = '';
  private expInclude = true;
  private expTab: 'settings' | 'templates' | 'list' = 'settings';
  private expLeft: 'global' | 'set' = 'global';
  private expEditing = '';
  private expSlot: { map: number; slot: number } | null = null;
  private expLog: string[] = [];
  private expBusy = false;

  openExport() {
    this.exp ??= loadExportState();
    const st = this.exp;
    if (!allTemplates(st).some((t) => t.id === st.template)) st.template = this.exportPreset && allTemplates(st).some((t) => t.id === this.exportPreset) ? this.exportPreset : 'pbr-gl';
    if (!st.dir && this.native?.exportDefaultDir) this.native.exportDefaultDir().then((d: string) => { if (!st.dir) { st.dir = d; this.renderExportDlg(); } }).catch(() => {});
    this.expName = this.expName || this.model.name.replace(/[^\w\-]+/g, '_') || 'texture';
    this.expEditing ||= st.template;
    this.expSlot = null;
    const dlg = document.getElementById('export-dialog') as HTMLDialogElement;
    this.renderExportDlg();
    if (!dlg.open) dlg.showModal();
  }

  private expTemplate(id?: string): ExportTemplate {
    const all = allTemplates(this.exp!);
    return all.find((t) => t.id === (id ?? this.exp!.template)) ?? all[0];
  }
  private expSizeOf(t: ExportTemplate, ts: TextureSet = this.ts) { const s = this.exp!.size || ts.size; return t.maxSize ? Math.min(s, t.maxSize) : s; }
  /** File-name base of each texture set: "<name>" for one set, "<name>_<material>" for several (Substance's $mesh_$textureSet). */
  private expSets(): { name: string; ts: TextureSet }[] {
    if (this.sets.length <= 1) return [{ name: this.expName, ts: this.ts }];
    return this.sets.map((st) => ({ name: `${this.expName}_${st.name.replace(/[^\w\-]+/g, '_')}`, ts: st.ts }));
  }
  private expFormatOf(mp: OutMap): { fmt: FileType; bits: 8 | 16 } {
    const fmt = (mp.format || this.exp!.format) as FileType;
    const bits = fmt === 'png' ? ((mp.bits || this.exp!.bits) as 8 | 16) : 8;
    return { fmt, bits };
  }
  private expList(t: ExportTemplate) {
    return this.expSets().flatMap((x) => {
      const size = this.expSizeOf(t, x.ts);
      return t.maps.map((mp) => { const f = this.expFormatOf(mp); return { name: fileName(mp.name, x.name, f.fmt), size, ...f }; });
    });
  }
  private expSave() { saveExportState(this.exp!); }

  private renderExportDlg() {
    const dlg = document.getElementById('export-dialog') as HTMLDialogElement;
    const st = this.exp!;
    const t = this.expTemplate();
    dlg.className = 'exp-dlg';
    dlg.innerHTML = '';
    const tab = (id: typeof this.expTab, label: string) => el('button', { class: 'exp-tab' + (this.expTab === id ? ' on' : ''), onclick: () => { this.expTab = id; this.renderExportDlg(); } }, label);
    const right = this.expTab === 'list'
      ? (this.native?.exportOpen ? el('button', { onclick: () => this.native.exportOpen(st.dir) }, 'Open output directory') : el('span'))
      : this.expTab === 'settings' ? el('button', { onclick: () => { this.expInclude = true; this.renderExportDlg(); } }, 'Include all') : el('span');
    let body: HTMLElement;
    if (this.expTab === 'settings') body = this.expSettingsTab(t);
    else if (this.expTab === 'templates') body = this.expTemplatesTab();
    else body = this.expListTab(t);
    const count = this.expInclude ? t.maps.length * Math.max(1, this.sets.length) : 0;
    const go = el('button', { class: 'primary exp-go', disabled: this.expBusy || !count, onclick: () => this.expRun() }, this.expBusy ? 'Exporting…' : 'Export');
    dlg.append(
      el('div', { class: 'exp-title' }, el('span', {}, 'Export textures'), el('button', { class: 'exp-x', title: 'Close', onclick: () => dlg.close() }, '×')),
      el('div', { class: 'exp-tabs' }, tab('settings', 'Settings'), tab('templates', 'Output templates'), tab('list', 'List of exports'), el('span', { class: 'grow' }), right),
      body,
      el('div', { class: 'exp-foot' },
        el('button', { onclick: () => { const custom = st.custom; this.exp = { ...structuredClone(DEFAULT_EXPORT), custom, dir: st.dir }; this.expSave(); this.renderExportDlg(); toast('Export settings reset'); } }, 'Reset all'),
        el('span', { class: 'grow' }),
        el('span', { class: 'muted' }, `${count} texture${count === 1 ? '' : 's'} selected for export`),
        el('button', { onclick: () => dlg.close() }, 'Cancel'),
        el('button', { onclick: () => { this.expSave(); toast('Export settings saved'); } }, 'Save settings'),
        go),
    );
  }

  private expSettingsTab(t: ExportTemplate): HTMLElement {
    const st = this.exp!;
    const set = () => { this.expSave(); this.renderExportDlg(); };
    const left = el('div', { class: 'exp-left' },
      el('button', { class: 'exp-item' + (this.expLeft === 'global' ? ' on' : ''), onclick: () => { this.expLeft = 'global'; this.renderExportDlg(); } }, 'Global settings'),
      (() => {
        const c = el('input', { type: 'checkbox', checked: this.expInclude }) as HTMLInputElement;
        c.addEventListener('click', (e) => e.stopPropagation());
        c.addEventListener('change', () => { this.expInclude = c.checked; this.renderExportDlg(); });
        return el('div', { class: 'exp-item' + (this.expLeft === 'set' ? ' on' : ''), onclick: () => { this.expLeft = 'set'; this.renderExportDlg(); } }, c, el('span', {}, this.expName));
      })());
    const row = (label: string, ...ctl: (HTMLElement | null)[]) => el('div', { class: 'exp-row' }, el('label', {}, label), el('div', { class: 'exp-ctl' }, ...ctl));
    let right: HTMLElement;
    if (this.expLeft === 'set') {
      const name = el('input', { type: 'text', value: this.expName }) as HTMLInputElement;
      name.addEventListener('input', () => { this.expName = name.value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'texture'; });
      name.addEventListener('change', () => this.renderExportDlg());
      right = el('div', { class: 'exp-right' },
        el('div', { class: 'exp-h' }, `Texture set · ${this.expName}`),
        row('Name ($textureSet)', name),
        el('p', { class: 'note' }, 'Used in the file names: $textureSet_BaseColor becomes ' + fileName(`$textureSet_BaseColor`, this.expName, 'png') + '.'),
        el('div', { class: 'exp-h sub' }, 'Files'),
        ...this.expList(t).map((f) => el('div', { class: 'exp-file' }, el('span', {}, f.name), el('span', { class: 'muted' }, `${f.size}×${f.size} · ${f.fmt} · ${f.bits} bits`))));
    } else {
      const groups = TEMPLATE_GROUPS.map((g) => ({ g, list: allTemplates(st).filter((x) => (x.custom ? 'Your templates' : x.group) === g) })).filter((x) => x.list.length);
      const tsel = el('select', { class: 'exp-template' }) as HTMLSelectElement;
      for (const { g, list } of groups) {
        const og = el('optgroup', { label: g });
        for (const x of list) og.append(el('option', { value: x.id }, x.label));
        tsel.append(og);
      }
      tsel.value = t.id;
      tsel.addEventListener('change', () => { st.template = tsel.value; this.exportPreset = tsel.value; this.expEditing = tsel.value; set(); });
      const fmt = select<FileType>([{ value: 'png', label: 'png' }, { value: 'jpg', label: 'jpg' }, { value: 'tga', label: 'tga' }], st.format, (v) => { st.format = v; set(); });
      const bits = select<number>([{ value: 8, label: '8 bits' }, { value: 16, label: '16 bits' }], st.format === 'png' ? st.bits : 8, (v) => { st.bits = v as 8 | 16; set(); });
      bits.disabled = st.format !== 'png';
      const sizes = [256, 512, 1024, 2048, 4096];
      const size = select<number>([{ value: 0, label: `Based on the texture set size (${this.ts.size})` }, ...sizes.map((s) => ({ value: s, label: `${s} × ${s}` }))], st.size, (v) => { st.size = v; set(); });
      const padSel = select<PadMode>((Object.keys(PAD_LABEL) as PadMode[]).map((p) => ({ value: p, label: PAD_LABEL[p] })), st.padding, (v) => { st.padding = v; set(); });
      const padPx = select<number>([1, 2, 4, 8, 16, 32, 64].map((v) => ({ value: v, label: String(v) })), st.padPx, (v) => { st.padPx = v; set(); });
      padPx.disabled = !(st.padding === 'dilate' || st.padding === 'dilate+transparent');
      padPx.classList.add('exp-px');
      let dirRow: HTMLElement;
      if (this.native?.exportWrite) {
        const dir = el('input', { type: 'text', value: st.dir, class: 'exp-dir' }) as HTMLInputElement;
        dir.addEventListener('change', () => { st.dir = dir.value.trim(); this.expSave(); });
        dirRow = row('Output directory', dir, el('button', { class: 'exp-browse', title: 'Choose a folder', onclick: async () => { const d = await this.native.exportPickDir(st.dir); if (d) { st.dir = d; set(); } } }, '…'));
      } else dirRow = row('Output directory', el('span', { class: 'muted' }, 'You\'ll pick a folder when you click Export.'));
      const open = el('input', { type: 'checkbox', checked: st.openAfter }) as HTMLInputElement;
      open.addEventListener('change', () => { st.openAfter = open.checked; this.expSave(); });
      const eff = this.expSizeOf(t), want = st.size || this.ts.size;
      right = el('div', { class: 'exp-right' },
        el('div', { class: 'exp-h' }, 'General export parameters',
          el('button', { class: 'exp-reset', title: 'Back to the defaults (keeps your templates and folder)', onclick: () => { const { custom, dir } = st; this.exp = { ...structuredClone(DEFAULT_EXPORT), custom, dir, template: st.template }; this.expSave(); this.renderExportDlg(); } }, '⟲')),
        dirRow,
        row('Output template', tsel),
        row('File type', fmt, bits),
        row('Size', size),
        row('Padding', padSel, padPx),
        this.native?.exportOpen ? el('label', { class: 'check-row exp-check' }, open, ' Open the output directory when done') : null,
        el('div', { class: 'exp-h sub' }, 'Normal map'),
        slider('Height strength', { min: 0, max: 30, step: 0.5, value: this.ts.heightStrength, fmt: (v) => v.toFixed(1), onInput: (v) => this.ts.setHeightStrength(v) }).el,
        t.note ? el('p', { class: 'note' }, t.note) : null,
        eff !== want ? el('p', { class: 'note warn' }, `This template exports at ${eff} px at most.`) : null,
        el('p', { class: 'note' }, 'Padding fills the space outside the UV islands so seams don\'t show when the texture gets smaller in the distance. Dilation infinite is the usual choice; Transparent leaves it empty (alpha).'));
    }
    return el('div', { class: 'exp-body' }, left, right);
  }

  /** Output templates: presets on the left, the chosen one's output maps in the middle, maps to drag on the right. */
  private expTemplatesTab(): HTMLElement {
    const st = this.exp!;
    const t = this.expTemplate(this.expEditing);
    const edit = !!t.custom;
    const changed = () => { this.expSave(); this.renderExportDlg(); };
    const presets = el('div', { class: 'exp-presets' },
      el('div', { class: 'exp-h' }, 'Presets', el('span', { class: 'grow' }),
        el('button', { class: 'exp-ib', title: 'Make your own copy of this template', onclick: () => {
          const copy: ExportTemplate = { ...structuredClone(t), id: 'my-' + Date.now().toString(36), label: `${t.label} (copy)`, group: 'Your templates', custom: true };
          st.custom.push(copy); this.expEditing = copy.id; changed();
        } }, '+'),
        el('button', { class: 'exp-ib', title: 'Delete this template (your own only)', disabled: !edit, onclick: () => {
          st.custom = st.custom.filter((x) => x.id !== t.id);
          if (st.template === t.id) st.template = 'pbr-gl';
          this.expEditing = st.template; changed();
        } }, '−')));
    for (const g of TEMPLATE_GROUPS) {
      const list = allTemplates(st).filter((x) => (x.custom ? 'Your templates' : x.group) === g);
      if (!list.length) continue;
      presets.append(el('div', { class: 'exp-grp' }, g));
      for (const x of list) presets.append(el('button', { class: 'exp-preset' + (x.id === t.id ? ' on' : ''), onclick: () => { this.expEditing = x.id; this.expSlot = null; this.renderExportDlg(); } }, x.label));
    }
    // ---- middle: output maps
    const create = (mode: MapMode, label: string) => el('button', { disabled: !edit, onclick: () => {
      const src: (ExpSrc | null)[] = MODE_SLOTS[mode].map(() => null);
      t.maps.push({ name: `$textureSet_${mode === 'gray' ? 'Gray' : 'Map'}${t.maps.length + 1}`, mode, src });
      changed();
    } }, label);
    const assign = (mi: number, si: number, s: ExpSrc | null) => {
      if (!edit) { toast('Built-in templates can\'t be changed. Click + to make your own copy.', true); return; }
      t.maps[mi].src[si] = s; this.expSlot = null; changed();
    };
    const rows = t.maps.map((mp, mi) => {
      const name = el('input', { type: 'text', value: mp.name, disabled: !edit }) as HTMLInputElement;
      name.addEventListener('change', () => { mp.name = name.value.trim() || '$textureSet'; changed(); });
      const slots = MODE_SLOTS[mp.mode].map((lab, si) => {
        const s = mp.src[si];
        const info = s ? SOURCES[s] : null;
        const sel = this.expSlot?.map === mi && this.expSlot.slot === si;
        const b = el('button', { class: 'exp-slot' + (sel ? ' on' : '') + (s ? '' : ' empty'), title: s ? `${lab}: ${info!.label} (double-click to clear)` : `${lab}: empty — drop a map here`,
          style: info ? { background: info.tint } : {},
          onclick: () => { this.expSlot = sel ? null : { map: mi, slot: si }; this.renderExportDlg(); },
          ondblclick: () => assign(mi, si, null) },
        el('b', {}, lab === 'L' ? 'Gray' : lab), el('span', {}, info ? info.label : '—'));
        b.addEventListener('dragover', (e) => { if (edit) { e.preventDefault(); b.classList.add('drop'); } });
        b.addEventListener('dragleave', () => b.classList.remove('drop'));
        b.addEventListener('drop', (e) => { e.preventDefault(); const v = e.dataTransfer?.getData('text/lmp-src') as ExpSrc; if (v) assign(mi, si, v); });
        return b;
      });
      const f = select<string>([{ value: '', label: 'global' }, { value: 'png', label: 'png' }, { value: 'jpg', label: 'jpg' }, { value: 'tga', label: 'tga' }], mp.format ?? '', (v) => { mp.format = v as FileType | ''; changed(); });
      const bt = select<number>([{ value: 0, label: 'global' }, { value: 8, label: '8 bits' }, { value: 16, label: '16 bits' }], mp.bits ?? 0, (v) => { mp.bits = v as 0 | 8 | 16; changed(); });
      f.disabled = bt.disabled = !edit;
      return el('div', { class: 'exp-map' }, name,
        el('button', { class: 'exp-ib', title: 'Insert $textureSet (the texture set name)', disabled: !edit, onclick: () => { mp.name += '$textureSet'; changed(); } }, '$'),
        el('div', { class: 'exp-slots' }, ...slots),
        el('div', { class: 'exp-fmt' }, f, bt),
        el('button', { class: 'exp-ib', title: 'Remove this output', disabled: !edit, onclick: () => { t.maps.splice(mi, 1); changed(); } }, '×'));
    });
    const labelIn = el('input', { type: 'text', value: t.label, disabled: !edit, class: 'grow' }) as HTMLInputElement;
    labelIn.addEventListener('change', () => { t.label = labelIn.value.trim() || 'My template'; changed(); });
    const mid = el('div', { class: 'exp-mid' },
      el('div', { class: 'exp-h' }, 'Current preset: ', labelIn),
      edit ? null : el('p', { class: 'note warn' }, 'This is a built-in template. Click + (top left) to make your own copy you can change.'),
      el('div', { class: 'exp-h sub' }, 'Output maps', el('span', { class: 'grow' }), el('span', { class: 'muted' }, 'Create: '),
        create('gray', 'Gray'), create('rgb', 'RGB'), create('r+g+b', 'R+G+B'), create('rgb+a', 'RGB+A'), create('r+g+b+a', 'R+G+B+A')),
      el('div', { class: 'exp-maps' }, ...rows),
      el('p', { class: 'note' }, 'Drag maps from the right onto an output\'s channels, or click a channel and then a map. Double-click a channel to empty it.'),
      el('p', { class: 'muted' }, `${t.maps.length} output map${t.maps.length === 1 ? '' : 's'} will be exported.`));
    // ---- right: maps to use
    const chip = (s: ExpSrc) => {
      const info = SOURCES[s];
      const c = el('button', { class: 'exp-src', draggable: true, title: this.expSlot ? `Put ${info.label} in the selected channel` : 'Drag onto an output channel',
        onclick: () => { if (this.expSlot) assign(this.expSlot.map, this.expSlot.slot, s); } },
      el('i', { style: { background: info.tint } }), info.label);
      c.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/lmp-src', s); });
      return c;
    };
    const list = (g: SrcInfo['group']) => (Object.keys(SOURCES) as ExpSrc[]).filter((s) => SOURCES[s].group === g).map(chip);
    const srcs = el('div', { class: 'exp-srcs' },
      el('div', { class: 'exp-h sub' }, 'Input maps'), ...list('input'),
      el('div', { class: 'exp-h sub' }, 'Mesh maps'), ...list('mesh'),
      el('div', { class: 'exp-h sub' }, 'Converted maps'), ...list('converted'), ...list('constant'));
    return el('div', { class: 'exp-body tpl' }, presets, mid, srcs);
  }

  private expListTab(t: ExportTemplate): HTMLElement {
    const files = this.expInclude ? this.expList(t) : [];
    const log = el('div', { class: 'exp-log' }, ...this.expLog.map((l) => el('div', { class: l.startsWith('✗') ? 'warn' : '' }, l)));
    setTimeout(() => (log.scrollTop = log.scrollHeight));
    return el('div', { class: 'exp-body list' },
      el('div', { class: 'exp-files' }, el('div', { class: 'exp-grp' }, `▾ ${this.expName}`),
        ...files.map((f) => el('div', { class: 'exp-file' }, el('span', {}, f.name), el('span', { class: 'muted' }, `${f.size}×${f.size}${this.exp!.size ? '' : ' (texture set size)'} · ${f.fmt} · ${f.bits} bits`))),
        files.length ? null : el('p', { class: 'note' }, 'Nothing selected. Tick the texture set in Settings.')),
      el('div', { class: 'exp-console' }, el('div', { class: 'exp-h' }, 'Console'), log));
  }

  /** Make the files of one template (shared by Export and the tests). */
  private async expBuild(t: ExportTemplate, opts: { size: number; padding: PadMode; padPx: number; name: string; log?: (s: string) => void; ts?: TextureSet }): Promise<{ name: string; blob: Blob }[]> {
    const ts = opts.ts ?? this.ts;
    const S = opts.size;
    const cache = new Map<string, Pix>();
    const get = (s: ExpSrc, float: boolean) => {
      const k = s + (float ? '#f' : '');
      let p = cache.get(k);
      if (!p) { p = ts.exportSource(s, S, float); cache.set(k, p); }
      return p;
    };
    let cov: Uint8Array | null = null, near: Int32Array | null = null;
    if (opts.padding !== 'none') {
      const c = ts.exportSource('coverage', S) as Uint8Array;
      cov = new Uint8Array(S * S);
      for (let i = 0; i < cov.length; i++) cov[i] = c[i * 4] > 127 ? 1 : 0;
      if (opts.padding !== 'transparent') near = nearestFill(cov, S, S, opts.padding === 'infinite' ? 0 : opts.padPx);
    }
    const out: { name: string; blob: Blob }[] = [];
    for (const mp of t.maps) {
      const { fmt, bits } = this.expFormatOf(mp);
      const float = bits === 16;
      const alpha = (opts.padding === 'transparent' || opts.padding === 'dilate+transparent') && fmt !== 'jpg';
      const data = compose(mp, (s) => get(s, float), S, S, bits, alpha);
      const nc = channelsOf(mp.mode, alpha);
      if (cov) pad(data, nc, S, S, cov, near, opts.padding);
      const name = fileName(mp.name, opts.name, fmt);
      const blob = fmt === 'png' ? await encodePNG(data, S, S, nc, bits)
        : fmt === 'tga' ? encodeTGA(data as Uint8Array, S, S, nc) : await encodeJPG(data as Uint8Array, S, S, nc);
      out.push({ name, blob });
      opts.log?.(`✓ ${name}  ${S}×${S} · ${fmt} · ${bits} bits`);
      await new Promise((r) => setTimeout(r));
    }
    return out;
  }

  private async expRun() {
    if (this.expBusy) return;
    const st = this.exp!;
    const t = this.expTemplate();
    if (!this.expInclude) { toast('Tick the texture set in Settings first', true); return; }
    this.expBusy = true;
    this.expTab = 'list';
    const size = this.expSizeOf(t);
    const sets = this.expSets();
    this.expLog = [`Exporting “${this.expName}”${sets.length > 1 ? ` (${sets.length} texture sets)` : ''} with ${t.label} at ${size}×${size}…`];
    this.renderExportDlg();
    const log = (s: string) => { this.expLog.push(s); const box = document.querySelector('#export-dialog .exp-log'); if (box) { box.append(el('div', { class: s.startsWith('✗') ? 'warn' : '' }, s)); box.scrollTop = box.scrollHeight; } };
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const x of sets) {
        if (sets.length > 1) log(`Texture set ${x.name}`);
        files.push(...await this.expBuild(t, { size: this.expSizeOf(t, x.ts), padding: st.padding, padPx: st.padPx, name: x.name, log, ts: x.ts }));
      }
      if (this.native?.exportWrite) {
        const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
        const r = await this.native.exportWrite(st.dir, data);
        if (!r?.ok) throw new Error(r?.error ?? 'could not write the files');
        log(`Saved ${r.written.length} files to ${r.dir}`);
        toast(`Exported ${r.written.length} textures to ${r.dir}`);
        if (st.openAfter) this.native.exportOpen(r.dir);
      } else {
        const msg = await saveFiles(files);
        log(msg === 'cancelled' ? 'Cancelled.' : msg);
        if (msg !== 'cancelled') toast(msg);
      }
      this.expSave();
    } catch (e: any) {
      console.error(e);
      log('✗ Export failed: ' + (e?.message ?? e));
      toast('Export failed: ' + (e?.message ?? e), true);
    } finally {
      this.expBusy = false;
      if ((document.getElementById('export-dialog') as HTMLDialogElement).open) this.renderExportDlg();
    }
  }

  // ================================================================ export mesh

  /** File > Export mesh: the model as GLB (optionally with the painted textures inside) or OBJ (+ MTL + textures). */
  async exportMeshDialog() {
    if (!this.model) return;
    const st = this.settings.meshExport;
    const sizes = [512, 1024, 2048, 4096];
    const fmtSel = select<string>([
      { value: 'glb', label: 'GLB with textures (one file)' }, { value: 'glb-mesh', label: 'GLB, mesh only' },
      { value: 'obj', label: 'OBJ + MTL with textures' }, { value: 'obj-mesh', label: 'OBJ, mesh only' },
    ], st.format, (v) => { st.format = v as typeof st.format; sizeRow.style.display = v.endsWith('-mesh') ? 'none' : ''; });
    const sizeRow = el('div', { class: 'np-field' }, el('label', {}, 'Texture size'), el('div', { class: 'np-ctl' },
      select<number>([{ value: 0, label: `Texture set size (${this.ts.size})` }, ...sizes.map((v) => ({ value: v, label: `${v} x ${v}` }))], st.size, (v) => { st.size = v; })), el('span'));
    sizeRow.style.display = st.format.endsWith('-mesh') ? 'none' : '';
    const orig = el('input', { type: 'checkbox', checked: st.original }) as HTMLInputElement;
    const nameIn = el('input', { type: 'text', value: this.expName || 'mesh' }) as HTMLInputElement;
    const content = el('div', { class: 'np' },
      el('div', { class: 'np-field' }, el('label', {}, 'File name'), el('div', { class: 'np-ctl' }, nameIn), el('span')),
      el('div', { class: 'np-field' }, el('label', {}, 'Format'), el('div', { class: 'np-ctl' }, fmtSel), el('span')),
      sizeRow,
      el('label', { class: 'check-row np-check', title: 'Off: the mesh is centered and scaled to fit LocalPaint\'s view, like you see it here.' }, orig, ' Keep the original size and position'),
      el('p', { class: 'muted' }, this.native ? 'Saved to the export folder from Export textures.' : 'You pick where to save it.'));
    const r = await this.modal({ title: 'Export mesh', text: '', icon: 'info', wide: true, content, buttons: [['Export', 'ok', 'primary'], ['Cancel', 'cancel']] });
    if (r !== 'ok') return;
    st.original = orig.checked;
    saveSettings(this.settings);
    const name = (nameIn.value.trim() || 'mesh').replace(/[\\/:*?"<>|]+/g, '_');
    try {
      toast('Exporting mesh…');
      const files = await this.buildMeshFiles(st.format, st.size || this.ts.size, st.original, name);
      if (this.native?.exportWrite) {
        this.exp ??= loadExportState();
        const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
        const w = await this.native.exportWrite(this.exp.dir, data);
        if (!w?.ok) throw new Error(w?.error ?? 'could not write the files');
        toast(`Saved ${files[0].name} to ${w.dir}`);
        if (this.exp.openAfter) this.native.exportOpen(w.dir);
      } else if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name);
      } else {
        const msg = await saveFiles(files);
        if (msg !== 'cancelled') toast(msg);
      }
    } catch (e: any) {
      console.error(e);
      toast('Export failed: ' + (e?.message ?? e), true);
    }
  }

  /** The mesh files (shared by Export mesh and the tests). */
  async buildMeshFiles(format: 'glb' | 'glb-mesh' | 'obj' | 'obj-mesh', size: number, original: boolean, name: string): Promise<{ name: string; blob: Blob }[]> {
    const xf = this.model.xf;
    const withTex = !format.endsWith('-mesh');
    const geos = this.model.geometries.map((g) => {
      const c = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'uv', 'color'] as const) if (g.attributes[a]) c.setAttribute(a, g.attributes[a].clone());
      if (g.index) c.setIndex(g.index.clone());
      c.name = g.name;
      if (original) { c.scale(1 / xf.scale, 1 / xf.scale, 1 / xf.scale); c.translate(xf.center[0], xf.center[1], xf.center[2]); }
      return c;
    });
    const out: { name: string; blob: Blob }[] = [];
    const scene = new THREE.Scene();
    const texs: THREE.Texture[] = [];
    const mtl: string[] = [`# LocalPaint ${VERSION}`];
    // One material per texture set (named after it), with that set's textures.
    const setList = this.sets.length ? this.sets : [{ name: this.model.name, ts: this.ts, geos: this.model.geometries.map((_, i) => i), visible: true }];
    const multi = setList.length > 1;
    const mats: THREE.MeshStandardMaterial[] = [];
    for (const st of setList) {
    const setName = multi ? `${name}_${st.name.replace(/[^\w\-]+/g, '_')}` : name;
    const mat = new THREE.MeshStandardMaterial({ name: multi ? st.name : name + '_mat', color: 0xffffff });
    mats.push(mat);
    if (withTex) {
      this.exp ??= loadExportState();
      const isGlb = format === 'glb';
      const t = this.expTemplate(isGlb ? 'gltf' : 'pbr-gl');
      const files = await this.expBuild(t, { size, padding: 'infinite', padPx: 16, name: setName, ts: st.ts });
      // Template map names are "<texture set>_<suffix>".
      const bySuffix = (sfx: string) => files[t.maps.findIndex((x) => x.name.endsWith('_' + sfx))];
      if (isGlb) {
        const tex = async (map: string, srgb: boolean) => {
          const f = bySuffix(map);
          if (!f) return null;
          const tx = new THREE.Texture(await createImageBitmap(f.blob, { imageOrientation: 'none' } as ImageBitmapOptions));
          tx.flipY = true; tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tx.needsUpdate = true;
          texs.push(tx);
          return tx;
        };
        mat.map = await tex('baseColor', true);
        const orm = await tex('occlusionRoughnessMetallic', false);
        mat.aoMap = orm; mat.roughnessMap = orm; mat.metalnessMap = orm; mat.roughness = 1; mat.metalness = 1;
        mat.normalMap = await tex('normal', false);
        const em = await tex('emissive', true);
        if (em) { mat.emissiveMap = em; mat.emissive.set(0xffffff); }
      } else {
        out.push(...files);
        const fn = (m: string) => bySuffix(m)?.name;
        const lines = [`newmtl ${mat.name}`, 'Ka 1 1 1', 'Kd 1 1 1', 'Ks 0 0 0', 'd 1', 'illum 2'];
        const add = (key: string, m: string) => { const f = fn(m); if (f) lines.push(`${key} ${f}`); };
        add('map_Kd', 'BaseColor'); add('map_Pr', 'Roughness'); add('map_Pm', 'Metallic'); add('norm', 'Normal'); add('map_Bump', 'Normal'); add('map_Ke', 'Emissive'); add('map_Ka', 'AmbientOcclusion');
        mtl.push(...lines, '');
      }
    }
    }
    if (withTex && !format.startsWith('glb')) out.unshift({ name: `${name}.mtl`, blob: new Blob([mtl.join('\n') + '\n'], { type: 'text/plain' }) });
    const setOfGeo = (i: number) => Math.max(0, setList.findIndex((st) => st.geos.includes(i)));
    geos.forEach((g, i) => { const m = new THREE.Mesh(g, mats[setOfGeo(i)]); m.name = geos.length > 1 ? `${g.name || name}_${i + 1}` : name; scene.add(m); });
    try {
      if (format.startsWith('glb')) {
        const buf = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false }) as ArrayBuffer;
        out.unshift({ name: `${name}.glb`, blob: new Blob([buf], { type: 'model/gltf-binary' }) });
      } else {
        let txt = new OBJExporter().parse(scene);
        // OBJExporter already writes "usemtl" for the named material.
        txt = (withTex ? `mtllib ${name}.mtl\n` : '') + (withTex ? txt : txt.replace(/^usemtl .*$/gm, ''));
        out.unshift({ name: `${name}.obj`, blob: new Blob([txt], { type: 'text/plain' }) });
      }
    } finally {
      geos.forEach((g) => g.dispose()); texs.forEach((t) => { (t.image as ImageBitmap)?.close?.(); t.dispose(); }); mats.forEach((m) => m.dispose());
    }
    return out;
  }

  // ================================================================ test hooks

  async exportForTest(presetId: string, size?: number, padding: PadMode = 'none') {
    this.exp ??= loadExportState();
    const t = this.expTemplate(presetId);
    const files = await this.expBuild(t, { size: t.maxSize ? Math.min(size ?? this.ts.size, t.maxSize) : size ?? this.ts.size, padding, padPx: 16, name: 'test' });
    const out: Record<string, string> = {};
    for (const f of files) out[f.name] = toB64(new Uint8Array(await f.blob.arrayBuffer()));
    return out;
  }
  async meshForTest(format: 'glb' | 'glb-mesh' | 'obj' | 'obj-mesh', size = 256, original = true) {
    const files = await this.buildMeshFiles(format, size, original, 'test');
    const out: Record<string, string> = {};
    for (const f of files) out[f.name] = toB64(new Uint8Array(await f.blob.arrayBuffer()));
    return out;
  }
  /** Render a Painter-style generator as the active layer's mask (flat, base64 PNG). */
  async painterMaskForTest(kind: SpKind, p: Record<string, any> = {}, size = 256, fx?: MaskFx[]) {
    let l = this.ts.allLayers.find((x) => x.name === '__sp');
    if (!l) { l = this.ts.addFillLayer('__sp'); this.ts.addMask(l, { base: 'black', gen: null }); }
    this.ts.activeId = l.id;
    const sp = spDefaults(kind); Object.assign(sp.p, p);
    l.mask!.gen = { ...defaultGen('painter'), seed: 7, sp, fx };
    this.ts.maskChanged(l);
    return await this.viewForTest('mask', size);
  }
  smartMaskIds() { return SMART_MASKS.filter((m) => m.painter).map((m) => m.id); }
  async projectForTest() {
    const blob = await serializeProject(this.projectSets(), this.model.name, this.model.source, this.projectSettings(), this.activeSet);
    return await blob.text();
  }
  /** Render one view flat to a PNG (base64). */
  async viewForTest(v: ViewMode, size = 512) {
    this.ts.compositeDirty();
    const src = this.viewSource(v) ?? { tex: this.ts.final.color.texture, mode: 0 as const };
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; uniform int m; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; if (m==3) c = mix(vec3(0.92,0.18,0.12), vec3(0.16,0.42,0.95), step(0.5, c.g)); gl_FragColor = vec4(m==1?vec3(c.r):m==2?vec3(c.g):m==4?vec3(c.b):c, 1.0); }',
      uniforms: { t: { value: src.tex }, m: { value: src.mode } },
      depthTest: false, depthWrite: false,
    });
    this.gpu.run(mat, rt);
    const px = this.gpu.readPixels(rt);
    rt.dispose(); mat.dispose();
    return toB64(new Uint8Array(await (await pixelsToPng(px, size)).arrayBuffer()));
  }
}

const app = new App();
app.newDefaultLayers();
(window as any).__tp = app;
