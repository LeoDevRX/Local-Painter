import * as THREE from 'three';
import { GPU, RT, makeRT, quadShader } from './gpu';
import { MeshBaker, BakeSettings, DEFAULT_BAKE } from './Baker';
import { bakeHighToLow, HighBakeSettings, DEFAULT_HIGH, readFrames, FRAME_VERT, FRAME_FRAG } from './HighBaker';
import { MeshParts, strHash, materialName, idColor } from './MeshParts';
import { bakeThickness, downsample, ThicknessSettings, DEFAULT_THICK } from './Thickness';
import { RayBaker, SAMPLE_FLOATS } from './RayBaker';
import { DEFAULT_NAME_RULES, keyIds, wantsIgnoreBf, type NameRules } from './meshNames';
import { FRAG_LAYERFX, LayerFx, activeFx, fxOnChannel, filterIndex } from './LayerFx';
import { FRAG_GEN, FRAG_MICRO, GenSettings, LayerMaskSpec, axisVec, genIndex, MaskFx, FX_BLENDS, SHAPE_KINDS, usesMicro } from './Masks';
import { FRAG_PROC, ProcSource, patternIndex, procKey, PatternType } from './Procedural';
import { SpKind, SpSettings, spShader, spPack, spGlobalBlur, spGrungeParams, parseGrungeRef, GRUNGE_FALLBACK, FRAG_SP_PACK, FRAG_SP_PACK2, FRAG_SP_BLUR, SP_MAXP } from './PainterGen';
import type { GraphJSON } from '../designer/Graph';
import type { SbsState } from './Substance';

export type Ch = 'color' | 'rough' | 'metal' | 'height' | 'emit' | 'normal';
export const CHANNELS: Ch[] = ['color', 'rough', 'metal', 'height', 'emit', 'normal'];
/** Channels the brush can paint (normal comes from texture sets only). */
export const PAINT_CHANNELS: Ch[] = ['color', 'rough', 'metal', 'height', 'emit'];
/** Channels stored as RGB; the rest are grayscale. */
export const COLOR_CHANNELS: Ch[] = ['color', 'emit', 'normal'];
export const CH_LABEL: Record<Ch, string> = {
  color: 'Base Color', rough: 'Roughness', metal: 'Metallic', height: 'Height', emit: 'Emissive', normal: 'Normal',
};
const CH_DEFAULT: Record<Ch, [number, number, number]> = {
  color: [0.5, 0.5, 0.5], rough: [0.5, 0.5, 0.5], metal: [0, 0, 0], height: [0.5, 0.5, 0.5], emit: [0, 0, 0],
  normal: [0.5, 0.5, 1],
};

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'subtract' | 'darken' | 'lighten' | 'offset';
export const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', add: 'Add (linear dodge)',
  subtract: 'Subtract', darken: 'Darken', lighten: 'Lighten', offset: 'Offset (good for height)',
};
const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, add: 4, subtract: 5, darken: 6, lighten: 7, offset: 8,
};

/** Material values for one "brush material" or fill layer. Color is sRGB 0–1. */
export interface ChannelValues {
  color: [number, number, number];
  rough: number;
  metal: number;
  height: number;
  emit: [number, number, number];
}
export const chValue = (v: ChannelValues, ch: Ch): [number, number, number] =>
  ch === 'normal' ? [0.5, 0.5, 1]
    : ch === 'color' || ch === 'emit' ? (v[ch] ?? [0, 0, 0]) : [v[ch], v[ch], v[ch]];

export interface Brush {
  radius: number;   // world units (model fits in radius 1)
  hardness: number; // 0..1
  flow: number;     // 0..1, per stamp (builds up within a stroke)
  /** Stroke opacity: the most one stroke can cover (0..1, default 1). */
  opacity?: number;
  spacing: number;  // fraction of radius
  erase: boolean;
  channels: Record<Ch, boolean>;
  values: ChannelValues;
  /** Brush tip: 'round', 'square', or the id of a tip texture (see TextureSet.setTip). */
  tip?: string;
  /** Tip rotation in degrees. */
  angle?: number;
  /** Random rotation per stamp (0..1 = up to ±180°). */
  angleJitter?: number;
  /** Rotate the tip along the stroke direction. */
  followStroke?: boolean;
  /** Random size per stamp (0..1). */
  sizeJitter?: number;
  /** Random offset per stamp, in brush radii (0..1). */
  scatter?: number;
  /** Mirror painting across the model's centre planes. */
  symmetry?: { x: boolean; y: boolean; z: boolean };
  /** Where each mirror plane sits: −1…1 of the model's half size from its centre (0 = centre). */
  symOffset?: { x: number; y: number; z: number };
  /** Pen pressure changes the size / flow (a mouse always counts as full pressure). */
  pressureSize?: boolean;
  pressureFlow?: boolean;
  /** Lazy mouse: the brush trails the cursor on a string this long (0..1 → 0..100 px). */
  smoothing?: number;
  /** Backface culling: don't paint surface turned away from the view by more than this angle (degrees; 180 = off). */
  cullAngle?: number;
  /** Random flow per stamp (0..1). */
  flowJitter?: number;
  /** Colour variation per stroke: random hue (0..1 = up to ±180°), saturation and value (0..1 = up to ±100%). */
  hueJitter?: number;
  satJitter?: number;
  valJitter?: number;
  /** What a stroke does: paint (default), or smudge / clone / blur what's already on the layer. */
  tool?: 'paint' | 'smudge' | 'clone' | 'blur';
}

/** How a fill layer's images are laid on the model (Substance's UV transformations / projection). */
export interface FillTransform {
  proj: 'uv' | 'tri' | 'planar';
  rot: number; // degrees
  offU: number;
  offV: number;
  /** Tri-planar blend sharpness. */
  sharp: number;
  // Planar projection (like Substance's): the image is projected flat onto the model, placed with the gizmo.
  // Same fields as the Shape generator, so the same frame and handles work.
  shapeAt?: [number, number, number];
  shapeNormal?: [number, number, number];
  shapeSize?: number;
  shapeAspect?: number;
  shapeRot?: number;
  /** Planar: repeat the image outside its box instead of leaving it empty. */
  tile?: boolean;
  /** Planar: don't project onto surface facing away from the projector (the back of the model). */
  hideBack?: boolean;
  /** Use the base colour image's transparency for the whole layer (default on). */
  useAlpha?: boolean;
}
export const DEFAULT_XF: FillTransform = { proj: 'uv', rot: 0, offU: 0, offV: 0, sharp: 4 };
/** Per-channel adjustments of a fill layer's images. */
export interface FillAdjust {
  hue: number; sat: number; bright: number; contrast: number; tint: [number, number, number];
  roughMin: number; roughMax: number; roughInv: boolean;
  metalMin: number; metalMax: number;
  heightScale: number; heightOff: number;
  normalStr: number;
  emitInt: number;
}
export const DEFAULT_ADJ: FillAdjust = {
  hue: 0, sat: 1, bright: 1, contrast: 1, tint: [1, 1, 1],
  roughMin: 0, roughMax: 1, roughInv: false, metalMin: 0, metalMax: 1,
  heightScale: 1, heightOff: 0, normalStr: 1, emitInt: 1,
};

export type BakeKey = 'normal' | 'wsn' | 'id' | 'ao' | 'curv' | 'pos' | 'thick' | 'height';
export type IdSource = 'auto' | 'part' | 'island' | 'object' | 'material' | 'vertex';
export const ID_SOURCE_LABEL: Record<IdSource, string> = {
  auto: 'Auto (objects → parts → UV islands)', part: 'Mesh part (connected)', island: 'UV island', object: 'Object (mesh)', material: 'Material', vertex: 'Vertex color',
};

export interface LayerMask extends LayerMaskSpec {
  /** Painted mask on top of the generator: r = value, a = coverage. */
  paintRT: RT;
  painted: boolean;
  /** Computed mask (cached). */
  rt: RT;
  dirty: boolean;
  /** The generator stack alone (heavy noise), re-rendered only when its settings or the mesh maps change. */
  genRT?: RT;
  genKey?: string;
  /** Turned off (Substance's "Toggle mask"): the layer shows as if it had no mask. */
  off?: boolean;
  /** Inverted (black ↔ white) without changing what's painted. */
  inv?: boolean;
}

interface LayerCommon {
  id: number; name: string; visible: boolean; opacity: number; blend: BlendMode; mask?: LayerMask;
  /** Content effects (filters, generators, levels, fills) applied before the mask, bottom → top. */
  fx?: LayerFx[];
  /** Colour tag (index into the tag colours, 0 = none). */
  tag?: number;
  /** Anchor point (Substance): generators can use the stack's height up to here as micro details. */
  anchor?: boolean;
}
export interface PaintLayer extends LayerCommon { kind: 'paint'; rts: Record<Ch, RT> }
/** An image (from a texture set) that drives one channel of a fill layer. */
export interface FillImage { name: string; bytes: ArrayBuffer; tex: THREE.Texture; flipG?: boolean; /** Graph outputs render into this. */ rt?: THREE.WebGLRenderTarget }
/** A scanned material (LocalPaint's materials release) used by a fill layer; `use` = which of its maps to take. */
export interface ScanRef { file: string; name: string; cat: string; use?: Ch[] }
export interface FillLayer extends LayerCommon {
  kind: 'fill';
  values: ChannelValues;
  enabled: Record<Ch, boolean>;
  images?: Partial<Record<Ch, FillImage>>;
  tiling: number;
  /** Projection / UV transform for images (default: UV, no rotation). */
  xf?: FillTransform;
  /** Image adjustments (default: none). */
  adj?: FillAdjust;
  /** Where it came from (e.g. a translated Substance file). */
  note?: string;
  /** Procedural channel sources (TextureCraft-style): a pattern mapped between two values. */
  procs?: Partial<Record<Ch, ProcSource>>;
  /** Material Designer graph driving this layer's images (outputs named "graph:<channel>"). */
  graph?: GraphJSON;
  /** Substance material mode: an .sbsar and its parameter values drive this layer's images ("sbs:<channel>"). */
  sbs?: SbsState;
}
/** Folder: its children are composited together, then blended with the folder's mask / opacity. */
export interface GroupLayer extends LayerCommon { kind: 'group'; children: Layer[]; open: boolean }
export type Layer = PaintLayer | FillLayer | GroupLayer;

export type PaintTarget = 'content' | 'mask';
type StrokeKey = Ch | 'mask';
/** Pixel change (stroke, fill, cleared mask): stored textures are swapped back and forth. */
interface StrokeEntry { kind: 'stroke'; label: string; t?: number; layer: Layer; mask?: LayerMask; rts: Partial<Record<StrokeKey, RT>> }
/** Document change (layers added/removed/moved, properties, masks): a snapshot of the layer tree. */
interface StateEntry { kind: 'state'; label: string; snap: Snap; t?: number }
/** Several changes that undo together (e.g. dropping a smart material onto a mesh part). */
interface MultiEntry { kind: 'multi'; label: string; items: HistEntry[]; t?: number }
type HistEntry = StrokeEntry | StateEntry | MultiEntry;
type UndoEntry = StrokeEntry;
interface NodeSnap {
  layer: Layer; props: Record<string, unknown>; mask?: LayerMask;
  maskProps?: { base: 'white' | 'black'; gen: GenSettings | null; painted: boolean; off?: boolean; inv?: boolean };
  children?: NodeSnap[];
}
interface Snap { tree: NodeSnap[]; active: number }
const HISTORY_MAX = 300;
export interface MeshMapBytes { mesh: Uint8Array; bn: Uint8Array; bh: Uint8Array; id?: Uint8Array; wsn?: Uint8Array; pos?: Uint8Array; baked?: BakeKey[] }

/** Fill uncovered texels (a = 0) from covered neighbours, a few rings out. */
function padBytes(px: Uint8Array, size: number, rings: number) {
  for (let r = 0; r < rings; r++) {
    const src = px.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (src[o + 3] > 127) continue;
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const q = (yy * size + xx) * 4;
        if (src[q + 3] > 127) { s0 += src[q]; s1 += src[q + 1]; s2 += src[q + 2]; n++; }
      }
      if (n) { px[o] = s0 / n; px[o + 1] = s1 / n; px[o + 2] = s2 / n; px[o + 3] = 255; }
    }
  }
}

const UNDO_BUDGET_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------- shaders

const BAKE_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
void main() {
  vP = position;
  vN = normal;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const BAKE_FRAG = /* glsl */ `
uniform int mode;
varying vec3 vP;
varying vec3 vN;
void main() {
  gl_FragColor = mode == 0 ? vec4(vP, 1.0) : mode == 1 ? vec4(normalize(vN), 1.0) : vec4(1.0);
}`;

const FRAG_COPY = /* glsl */ `
uniform sampler2D src;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(src, vUv); }`;

const FRAG_INIT = /* glsl */ `
uniform sampler2D posMap;
uniform vec3 value;
varying vec2 vUv;
void main() { gl_FragColor = vec4(value, texture2D(posMap, vUv).a); }`;

const FRAG_LAYER = /* glsl */ `
uniform sampler2D prev;
uniform sampler2D layerTex;
uniform bool isFill;
uniform vec3 fillValue;
uniform bool useTex;
uniform bool texGray;
uniform bool texFlipG;
uniform sampler2D fillTex;
uniform float tiling;
uniform float opacity;
uniform bool hasMask;
uniform bool maskInv;
uniform bool isolate;
uniform sampler2D maskTex;
uniform int blend;
uniform bool isNormal;
uniform sampler2D posMap;
uniform sampler2D nrmMap;
uniform sampler2D tanMap;
uniform sampler2D bitMap;
uniform bool triplanar;
uniform float triSharp;
uniform vec2 rotCS;
uniform vec2 uvOff;
uniform bool planar;
uniform vec3 pjC;
uniform vec3 pjU;
uniform vec3 pjV;
uniform vec3 pjN;
uniform vec2 pjH;
uniform bool pjTile;
uniform bool pjBack;
uniform sampler2D alphaTex;
uniform bool useAlphaTex;
uniform bool texAlpha;
uniform int adjMode;
uniform vec4 adjA;
uniform vec3 adjTint;
varying vec2 vUv;
vec4 sampleFill(vec2 uv) {
  vec2 r = vec2(uv.x * rotCS.x - uv.y * rotCS.y, uv.x * rotCS.y + uv.y * rotCS.x) + uvOff;
  vec4 t = texture2D(fillTex, r);
  if (texFlipG) t.g = 1.0 - t.g;
  return t;
}
vec3 unrot(vec3 n) { return vec3(n.x * rotCS.x + n.y * rotCS.y, -n.x * rotCS.y + n.y * rotCS.x, n.z); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// Planar projection: this texel's place in the projector's box (0..1), and how much it's covered.
vec2 planarUV() {
  vec3 d = texture2D(posMap, vUv).xyz - pjC;
  return vec2(dot(d, pjU) / (2.0 * pjH.x), dot(d, pjV) / (2.0 * pjH.y)) + 0.5;
}
float planarCover() {
  vec2 q = planarUV();
  float c = 1.0;
  if (!pjTile) {
    vec2 e = min(q, 1.0 - q);
    c = step(0.0, min(e.x, e.y));
  }
  if (pjBack) c *= smoothstep(-0.02, 0.15, dot(normalize(texture2D(nrmMap, vUv).xyz + vec3(1e-6)), pjN));
  return c;
}
vec4 sampleTexAt(sampler2D tx, vec2 uv) {
  vec2 r = vec2(uv.x * rotCS.x - uv.y * rotCS.y, uv.x * rotCS.y + uv.y * rotCS.x) + uvOff;
  return texture2D(tx, r);
}
/** The colour image's alpha, laid on the model the same way as the layer's images. */
float alphaSample() {
  if (planar) return sampleTexAt(alphaTex, (planarUV() - 0.5) * tiling + 0.5).a;
  if (!triplanar) return sampleTexAt(alphaTex, vUv * tiling).a;
  vec3 P = texture2D(posMap, vUv).xyz * tiling * 0.5;
  vec3 N = normalize(texture2D(nrmMap, vUv).xyz + vec3(1e-6));
  vec3 w = pow(abs(N), vec3(triSharp)); w /= (w.x + w.y + w.z);
  return sampleTexAt(alphaTex, P.zy).a * w.x + sampleTexAt(alphaTex, P.xz).a * w.y + sampleTexAt(alphaTex, P.xy).a * w.z;
}
vec4 fillSample() {
  if (planar) {
    vec4 t = sampleFill((planarUV() - 0.5) * tiling + 0.5);
    if (isNormal) {
      // The image's normal is in the projector's frame: to world, then to the surface's tangent space.
      vec3 pn = unrot(t.xyz * 2.0 - 1.0);
      vec3 wn = normalize(pjU * pn.x + pjV * pn.y + pjN * pn.z);
      vec3 N = normalize(texture2D(nrmMap, vUv).xyz + vec3(1e-6));
      vec3 T = normalize(texture2D(tanMap, vUv).xyz + vec3(1e-6)), B = normalize(texture2D(bitMap, vUv).xyz + vec3(1e-6));
      return vec4(normalize(vec3(dot(wn, T), dot(wn, B), max(dot(wn, N), 0.05))) * 0.5 + 0.5, 1.0);
    }
    return t;
  }
  if (!triplanar) {
    vec4 t = sampleFill(vUv * tiling);
    if (isNormal) t.xyz = unrot(t.xyz * 2.0 - 1.0) * 0.5 + 0.5;
    return t;
  }
  vec3 P = texture2D(posMap, vUv).xyz * tiling * 0.5;
  vec3 N = normalize(texture2D(nrmMap, vUv).xyz + vec3(1e-6));
  vec3 w = pow(abs(N), vec3(triSharp));
  w /= (w.x + w.y + w.z);
  vec4 tx = sampleFill(P.zy), ty = sampleFill(P.xz), tz = sampleFill(P.xy);
  if (!isNormal) return tx * w.x + ty * w.y + tz * w.z;
  // Tri-planar normal (whiteout blend) to world space, then to the surface's tangent space.
  vec3 nx = unrot(tx.xyz * 2.0 - 1.0), ny = unrot(ty.xyz * 2.0 - 1.0), nz = unrot(tz.xyz * 2.0 - 1.0);
  vec3 wx = vec3(nx.xy + N.zy, abs(nx.z) * N.x).zyx;
  vec3 wy = vec3(ny.xy + N.xz, abs(ny.z) * N.y).xzy;
  vec3 wz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
  vec3 wn = normalize(wx * w.x + wy * w.y + wz * w.z);
  vec3 T = normalize(texture2D(tanMap, vUv).xyz + vec3(1e-6)), B = normalize(texture2D(bitMap, vUv).xyz + vec3(1e-6));
  vec3 ts = normalize(vec3(dot(wn, T), dot(wn, B), max(dot(wn, N), 0.05)));
  return vec4(ts * 0.5 + 0.5, 1.0);
}
vec3 adjust(vec3 c) {
  if (adjMode == 1) {
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    c = hsv2rgb(vec3(fract(h.x + adjA.x), clamp(h.y * adjA.y, 0.0, 1.0), h.z));
    c = ((c * adjA.z) - 0.5) * adjA.w + 0.5;
    return clamp(c * adjTint, 0.0, 1.0);
  }
  if (adjMode == 2) { float v = adjA.z > 0.5 ? 1.0 - c.r : c.r; return vec3(mix(adjA.x, adjA.y, v)); }
  if (adjMode == 3) return vec3(clamp(0.5 + (c.r - 0.5) * adjA.x + adjA.y, 0.0, 1.0));
  if (adjMode == 4) { vec3 n = c * 2.0 - 1.0; n.xy *= adjA.x; return normalize(n) * 0.5 + 0.5; }
  if (adjMode == 5) return c * adjA.x;
  if (adjMode == 6) return mix(adjA.xyz, adjTint, c.r);
  return c;
}
vec3 blendf(int m, vec3 b, vec3 s) {
  if (m == 1) return b * s;
  if (m == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 4) return b + s;
  if (m == 5) return b - s;
  if (m == 6) return min(b, s);
  if (m == 7) return max(b, s);
  if (m == 8) return b + (s - 0.5);
  return s;
}
void main() {
  vec4 p = texture2D(prev, vUv);
  vec4 l;
  if (isFill) {
    if (useTex) {
      vec4 t = fillSample();
      l = vec4(adjust(texGray ? vec3(t.r) : t.rgb), texAlpha ? t.a : 1.0);
    } else l = vec4(fillValue, 1.0);
    // Transparent images: the colour image's alpha cuts out every channel of the layer.
    if (useAlphaTex) l.a *= alphaSample();
    if (planar) l.a *= planarCover();
  } else l = texture2D(layerTex, vUv);
  // Just the layer's own content (content effects and flattening work on it).
  if (isolate) { gl_FragColor = vec4(l.rgb, clamp(l.a, 0.0, 1.0)); return; }
  float a = clamp(l.a * opacity, 0.0, 1.0);
  if (hasMask) { float mk = texture2D(maskTex, vUv).r; a *= maskInv ? 1.0 - mk : mk; }
  vec3 c = isNormal ? l.rgb : blendf(blend, p.rgb, l.rgb);
  gl_FragColor = vec4(clamp(mix(p.rgb, c, a), 0.0, 1.0), p.a);
}`;

// Pads colour outward from UV islands so filtering never shows seams.
const FRAG_DILATE = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
uniform float off;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  if (c.a > 0.5) { gl_FragColor = c; return; }
  vec3 s = vec3(0.0);
  float n = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      if (x == 0 && y == 0) continue;
      vec4 q = texture2D(src, vUv + vec2(float(x), float(y)) * texel * off);
      if (q.a > 0.5) { s += q.rgb; n += 1.0; }
    }
  }
  gl_FragColor = n > 0.0 ? vec4(s / n, 1.0) : c;
}`;

// Brush footprint: a 3D sphere around the hit point, evaluated per texel.
const FRAG_STAMP = /* glsl */ `
uniform sampler2D posMap;
uniform sampler2D nrmMap;
uniform vec3 center;
uniform vec3 bnormal;
uniform float radius;
uniform float hardness;
uniform bool uvMode;
uniform vec2 centerUV;
uniform float radiusUV;
uniform int shape; // 0 round, 1 square, 2 tip texture
uniform sampler2D tipTex;
uniform vec3 tanU;
uniform vec3 tanV;
uniform vec2 rotCS;
uniform float stampFlow;
uniform vec3 viewPos;
uniform float cullCos;
varying vec2 vUv;
float tipAt(vec2 q) {
  if (abs(q.x) >= 1.0 || abs(q.y) >= 1.0) return -1.0;
  if (shape == 1) return 1.0 - smoothstep(min(hardness, 0.999), 1.0, max(abs(q.x), abs(q.y)));
  return texture2D(tipTex, q * 0.5 + 0.5).r;
}
void main() {
  if (uvMode) {
    vec2 q = (vUv - centerUV) / radiusUV;
    if (shape == 0) {
      float du = length(q);
      if (du >= 1.0) discard;
      gl_FragColor = vec4(1.0 - smoothstep(min(hardness, 0.999), 1.0, du)) * stampFlow;
      return;
    }
    float t = tipAt(vec2(q.x * rotCS.x + q.y * rotCS.y, -q.x * rotCS.y + q.y * rotCS.x));
    if (t <= 0.0) discard;
    gl_FragColor = vec4(t) * stampFlow;
    return;
  }
  vec4 p = texture2D(posMap, vUv);
  if (p.a < 0.5) discard;
  vec3 dv = p.xyz - center;
  float f;
  if (shape == 0) {
    float d = length(dv) / radius;
    if (d >= 1.0) discard;
    f = 1.0 - smoothstep(min(hardness, 0.999), 1.0, d);
  } else {
    if (abs(dot(dv, bnormal)) >= radius) discard;
    f = tipAt(vec2(dot(dv, tanU), dot(dv, tanV)) / radius);
    if (f <= 0.0) discard;
  }
  vec3 n = texture2D(nrmMap, vUv).xyz;
  f *= smoothstep(-0.05, 0.3, dot(n, bnormal));
  // Backface culling (like Substance): skip surface turned away from the view by more than the angle.
  if (cullCos > -1.5) f *= smoothstep(cullCos - 0.05, cullCos + 0.05, dot(normalize(n), normalize(viewPos - p.xyz)));
  if (f <= 0.0) discard;
  gl_FragColor = vec4(f) * stampFlow;
}`;

// Smudge / clone / blur: blend the layer towards a source under this stamp's mask.
const FRAG_TOOL = /* glsl */ `
uniform sampler2D cur;
uniform sampler2D snap;
uniform sampler2D mask;
uniform sampler2D posMap;
uniform int mode; // 1 smudge, 2 clone, 3 blur
uniform vec2 delta;
uniform sampler2D carry;
uniform vec2 centerUV;
uniform float rUV;
uniform float depth;
uniform float blurUV;
uniform float blurWorld;
uniform vec2 texel;
varying vec2 vUv;
const vec2 P[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480),
  vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
bool inside(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0 && texture2D(posMap, uv).a > 0.5; }
void main() {
  vec4 c = texture2D(cur, vUv);
  float m = clamp(texture2D(mask, vUv).r, 0.0, 1.0);
  if (m <= 0.0) { gl_FragColor = c; return; }
  vec4 s = c;
  if (mode == 1) {
    // Smudge: lay down the paint the brush is carrying (brush space → this texel).
    vec2 q = (vUv - centerUV) / rUV;
    if (abs(q.x) >= 1.0 || abs(q.y) >= 1.0) { gl_FragColor = c; return; }
    s = texture2D(carry, q * 0.5 + 0.5);
    m *= depth;
  } else if (mode == 2) {
    vec2 uv = vUv + delta;
    if (!inside(uv)) { gl_FragColor = c; return; }
    s = texture2D(snap, uv);
  } else {
    float r = blurUV;
    if (r <= 0.0) {
      // Blur radius in UV from the brush's world size and this texel's world size.
      vec3 p = texture2D(posMap, vUv).xyz;
      vec4 q = texture2D(posMap, vUv + vec2(texel.x, 0.0));
      if (q.a < 0.5) q = texture2D(posMap, vUv - vec2(texel.x, 0.0));
      float tw = max(1e-6, length(q.xyz - p));
      r = clamp(blurWorld / tw, 1.0, 32.0) * texel.x;
    }
    vec4 acc = c; float w = 1.0;
    for (int i = 0; i < 12; i++) {
      for (int k = 1; k <= 2; k++) {
        vec2 uv = vUv + P[i] * r * (float(k) * 0.5);
        if (!inside(uv)) continue;
        acc += texture2D(cur, uv); w += 1.0;
      }
    }
    s = acc / w;
  }
  gl_FragColor = mix(c, s, m);
}`;

// Smudge pickup: what the brush carries (brush space) mixes with the paint under it.
const FRAG_PICKUP = /* glsl */ `
uniform sampler2D cur;
uniform sampler2D carry;
uniform sampler2D posMap;
uniform vec2 centerUV;
uniform float rUV;
uniform float keep;
uniform bool first;
varying vec2 vUv;
void main() {
  vec2 uv = centerUV + (vUv * 2.0 - 1.0) * rUV;
  vec4 old = texture2D(carry, vUv);
  bool ok = uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0 && texture2D(posMap, uv).a > 0.5;
  vec4 under = ok ? texture2D(cur, uv) : old;
  gl_FragColor = first ? under : mix(under, old, keep);
}`;

const FRAG_APPLY = /* glsl */ `
uniform sampler2D snap;
uniform sampler2D mask;
uniform vec3 value;
uniform float flow;
uniform bool erase;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(snap, vUv);
  float k = clamp(texture2D(mask, vUv).r * flow, 0.0, 1.0);
  if (erase) { gl_FragColor = vec4(s.rgb, s.a * (1.0 - k)); return; }
  float a = k + s.a * (1.0 - k);
  vec3 c = a > 0.0 ? (value * k + s.rgb * s.a * (1.0 - k)) / a : value;
  gl_FragColor = vec4(c, a);
}`;

// Height -> tangent-space normal, combined with the normal channel and the
// baked (high poly) normal using whiteout blending.
const FRAG_NMAP = /* glsl */ `
uniform sampler2D heightTex;
uniform sampler2D normalTex;
uniform sampler2D bakedTex;
uniform vec2 texel;
uniform float strength;
varying vec2 vUv;
void main() {
  float hl = texture2D(heightTex, vUv - vec2(texel.x, 0.0)).r;
  float hr = texture2D(heightTex, vUv + vec2(texel.x, 0.0)).r;
  float hd = texture2D(heightTex, vUv - vec2(0.0, texel.y)).r;
  float hu = texture2D(heightTex, vUv + vec2(0.0, texel.y)).r;
  vec3 n1 = normalize(vec3((hl - hr) * strength, (hd - hu) * strength, 1.0));
  vec3 n2 = normalize(texture2D(normalTex, vUv).xyz * 2.0 - 1.0);
  vec3 n0 = normalize(texture2D(bakedTex, vUv).xyz * 2.0 - 1.0);
  vec3 d = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
  vec3 n = normalize(vec3(n0.xy + d.xy, n0.z * d.z));
  gl_FragColor = vec4(n * 0.5 + 0.5, texture2D(heightTex, vUv).a);
}`;

// Turns the accumulated bake sums into AO (r) and curvature (g, 0.5 = flat).
const FRAG_BAKE_FINAL = /* glsl */ `
uniform sampler2D accum;
uniform sampler2D posMap;
uniform float curvStrength;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(accum, vUv);
  float ao = a.y > 1e-5 ? a.x / a.y : 1.0;
  ao = clamp(ao * 1.15, 0.0, 1.0);
  float c = a.w > 1e-5 ? a.z / a.w : 0.0;
  float cv = 0.5 + 0.5 * clamp(c * curvStrength, -1.0, 1.0);
  gl_FragColor = vec4(ao, cv, 0.0, texture2D(posMap, vUv).a);
}`;

// Mesh map encoders: 0 world normal (n * 0.5 + 0.5), 1 position (normalised to the bounding box), 2 upsampled gray map.
const FRAG_ENC = /* glsl */ `
uniform sampler2D src;
uniform sampler2D cov;
uniform int mode;
uniform vec3 bmin;
uniform vec3 bsize;
uniform int axis;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(src, vUv);
  float a = texture2D(cov, vUv).a;
  if (mode == 0) gl_FragColor = vec4(normalize(s.xyz + vec3(1e-6)) * 0.5 + 0.5, a);
  else if (mode == 1) {
    vec3 p = clamp((s.xyz - bmin) / bsize, 0.0, 1.0);
    gl_FragColor = vec4(axis == 0 ? vec3(p.x) : axis == 1 ? vec3(p.y) : axis == 2 ? vec3(p.z) : p, a);
  }
  else gl_FragColor = vec4(s.rgb, a);
}`;
const ID_VERT = /* glsl */ `
attribute vec3 idColor;
varying vec3 vC;
void main() { vC = idColor; gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }`;
const ID_FRAG = /* glsl */ `
varying vec3 vC;
void main() { gl_FragColor = vec4(vC, 1.0); }`;

// Export: 0 rgb, 1 gray, 2 normal (with optional DirectX flip), 3 ORM, 4 mask (max rgb), 5 gray from .r of meshMap
const FRAG_EXPORT = /* glsl */ `
uniform sampler2D src;
uniform sampler2D srcAO;
uniform sampler2D srcG;
uniform sampler2D srcB;
uniform int mode;
uniform bool flipG;
varying vec2 vUv;
void main() {
  if (mode == 0) { gl_FragColor = vec4(texture2D(src, vUv).rgb, 1.0); return; }
  if (mode == 1) { gl_FragColor = vec4(vec3(texture2D(src, vUv).r), 1.0); return; }
  if (mode == 4) {
    vec3 e = texture2D(src, vUv).rgb;
    gl_FragColor = vec4(vec3(max(e.r, max(e.g, e.b))), 1.0);
    return;
  }
  if (mode == 3) {
    gl_FragColor = vec4(texture2D(srcAO, vUv).r, texture2D(srcG, vUv).r, texture2D(srcB, vUv).r, 1.0);
    return;
  }
  vec3 n = texture2D(src, vUv).rgb;
  if (flipG) n.g = 1.0 - n.g;
  gl_FragColor = vec4(n, 1.0);
}`;

export type ExportKind =
  | { kind: 'rgb'; ch: Ch }
  | { kind: 'gray'; ch: Ch }
  | { kind: 'normal'; directX: boolean }
  | { kind: 'orm' }
  | { kind: 'ao' }
  | { kind: 'mask'; ch: Ch };

// ---------------------------------------------------------------- texture set

export class TextureSet {
  size: number;
  readonly gpu: GPU;
  readonly geometries: THREE.BufferGeometry[];
  layers: Layer[] = []; // index 0 = bottom
  activeId = -1;

  posRT!: RT;
  nrmRT!: RT;
  /** Baked mesh maps: r = ambient occlusion, g = curvature (0.5 flat). */
  meshRT!: RT;
  final!: Record<Ch, RT>;
  /** Final tangent-space normal (baked normal + height + normal channel). */
  finalN!: RT;
  /** Baked from the high poly: tangent-space normal (flat when there is no high poly). */
  bakedNRT!: RT;
  /** Baked from the high poly: r = height, g = ray hit (1) / miss (0). */
  bakedHRT!: RT;
  /** Baked ID map (colors per part / island / material / vertex color). */
  idRT!: RT;
  /** Baked world-space normal and position (normalised to the bounding box). */
  wsnRT!: RT;
  posNRT!: RT;
  /** Tangent frame per texel (for tri-planar normal maps). */
  tanRT!: RT;
  bitRT!: RT;
  /** Which mesh maps have been baked (unbaked ones hold neutral values). */
  baked = new Set<BakeKey>();
  idSource: IdSource = 'auto';
  thickSettings: ThicknessSettings = { ...DEFAULT_THICK };
  readonly parts: MeshParts;
  private highParts: { geos: THREE.BufferGeometry[]; parts: MeshParts } | null = null;
  private tips = new Map<string, THREE.Texture>();
  /** High poly to bake from (same space as the low poly), or null = bake from the low poly. */
  highGeometries: THREE.BufferGeometry[] | null = null;
  highName = '';
  highSettings: HighBakeSettings = { ...DEFAULT_HIGH };
  /** Stats of the last high bake. */
  lastHigh: { hits: number; texels: number } | null = null;
  private compA!: RT;
  private compB!: RT;
  private strokeRT!: RT;
  readonly bboxMin = new THREE.Vector3();
  readonly bboxMax = new THREE.Vector3();

  heightStrength = 8;
  bakeSettings: BakeSettings = { ...DEFAULT_BAKE };
  baking = false;
  bakedOnce = false;
  private baker: MeshBaker | null = null;

  dirty = new Set<Ch>();
  private normalDirty = true;
  /** Is there GPU work waiting (so the viewport must redraw)? */
  get busy(): boolean {
    return this.dirty.size > 0 || this.normalDirty || !!this.stroke || this.allLayers.some((l) => l.mask?.dirty);
  }
  onChange: (() => void) | null = null;

  private undoStack: HistEntry[] = [];
  private redoStack: HistEntry[] = [];
  /** Every layer / mask ever created; unreachable ones are freed by gc(). */
  private known = new Set<Layer>();
  private knownMasks = new Set<LayerMask>();
  private batchDepth = 0;
  private batchItems: HistEntry[] = [];
  private lastKey = '';
  private lastKeyTime = 0;
  /** Set to false while loading a project so it doesn't fill the history. */
  recording = true;
  private stroke: {
    layer: Layer; entry: UndoEntry; brush: Brush; target: PaintTarget; pending: boolean;
    last3?: THREE.Vector3; dir3?: number; last2?: THREE.Vector2; dir2?: number;
    copies?: { last3?: THREE.Vector3; dir3?: number }[];
    /** Smudge: the UV of the previous stamp. */
    lastUV?: THREE.Vector2;
  } | null = null;
  private nextId = 1;

  private matCopy = quadShader(FRAG_COPY, { src: { value: null } });
  private matInit = quadShader(FRAG_INIT, { posMap: { value: null }, value: { value: new THREE.Vector3() } });
  private matLayer = quadShader(FRAG_LAYER, {
    prev: { value: null }, layerTex: { value: null }, isFill: { value: false },
    fillValue: { value: new THREE.Vector3() }, opacity: { value: 1 },
    useTex: { value: false }, texGray: { value: false }, texFlipG: { value: false }, fillTex: { value: null }, tiling: { value: 1 },
    hasMask: { value: false }, maskTex: { value: null }, blend: { value: 0 }, isNormal: { value: false },
    maskInv: { value: false }, isolate: { value: false },
    posMap: { value: null }, nrmMap: { value: null }, tanMap: { value: null }, bitMap: { value: null },
    triplanar: { value: false }, triSharp: { value: 4 }, rotCS: { value: new THREE.Vector2(1, 0) }, uvOff: { value: new THREE.Vector2() },
    planar: { value: false }, pjC: { value: new THREE.Vector3() }, pjU: { value: new THREE.Vector3(1, 0, 0) }, pjV: { value: new THREE.Vector3(0, 1, 0) },
    pjN: { value: new THREE.Vector3(0, 0, 1) }, pjH: { value: new THREE.Vector2(1, 1) }, pjTile: { value: false }, pjBack: { value: true },
    alphaTex: { value: null }, useAlphaTex: { value: false }, texAlpha: { value: false },
    adjMode: { value: 0 }, adjA: { value: new THREE.Vector4() }, adjTint: { value: new THREE.Vector3(1, 1, 1) },
  });
  private matEnc = quadShader(FRAG_ENC, {
    src: { value: null }, cov: { value: null }, mode: { value: 0 }, bmin: { value: new THREE.Vector3() }, bsize: { value: new THREE.Vector3(1, 1, 1) }, axis: { value: -1 },
  });
  private matDilate = quadShader(FRAG_DILATE, {
    src: { value: null }, texel: { value: new THREE.Vector2() }, off: { value: 1 },
  });
  private matStamp = quadShader(FRAG_STAMP, {
    posMap: { value: null }, nrmMap: { value: null }, center: { value: new THREE.Vector3() },
    bnormal: { value: new THREE.Vector3() }, radius: { value: 0.1 }, hardness: { value: 0.5 },
    uvMode: { value: false }, centerUV: { value: new THREE.Vector2() }, radiusUV: { value: 0.03 },
    shape: { value: 0 }, tipTex: { value: null }, tanU: { value: new THREE.Vector3(1, 0, 0) }, tanV: { value: new THREE.Vector3(0, 1, 0) },
    rotCS: { value: new THREE.Vector2(1, 0) }, stampFlow: { value: 1 },
    viewPos: { value: new THREE.Vector3(0, 0, 10) }, cullCos: { value: -2 },
  }, {
    // Flow builds up like Substance's: each stamp adds flow × (1 − coverage so far).
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
  });
  private matTool = quadShader(FRAG_TOOL, {
    cur: { value: null }, snap: { value: null }, mask: { value: null }, posMap: { value: null }, mode: { value: 1 },
    delta: { value: new THREE.Vector2() }, blurUV: { value: 0 }, blurWorld: { value: 0 }, texel: { value: new THREE.Vector2() },
    carry: { value: null }, centerUV: { value: new THREE.Vector2() }, rUV: { value: 0.01 }, depth: { value: 1 },
  });
  private matPickup = quadShader(FRAG_PICKUP, {
    cur: { value: null }, carry: { value: null }, posMap: { value: null }, centerUV: { value: new THREE.Vector2() }, rUV: { value: 0.01 }, keep: { value: 0.9 }, first: { value: true },
  });
  /** Smudge: the paint the brush carries, per channel (brush-space ping-pong pair). */
  private carry = new Map<string, [RT, RT]>();
  private uvPerWorldCache = 0;
  /** Average UV distance per model-space distance (UV area / surface area), for brush sizes in UV. */
  get uvPerWorld(): number {
    if (this.uvPerWorldCache) return this.uvPerWorldCache;
    let wa = 0, ua = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const g of this.geometries) {
      const pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
      if (!uv) continue;
      const n = idx ? idx.count / 3 : pos.count / 3;
      const step = Math.max(1, Math.floor(n / 20000));
      for (let t = 0; t < n; t += step) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        wa += b.sub(a).cross(c.sub(a)).length() / 2;
        const ux = uv.getX(i1) - uv.getX(i0), uy = uv.getY(i1) - uv.getY(i0), vx = uv.getX(i2) - uv.getX(i0), vy = uv.getY(i2) - uv.getY(i0);
        ua += Math.abs(ux * vy - uy * vx) / 2;
      }
    }
    this.uvPerWorldCache = wa > 1e-12 && ua > 1e-12 ? Math.sqrt(ua / wa) : 0.5;
    return this.uvPerWorldCache;
  }
  private toolMaskRT: RT | null = null;
  private toolTmpRT: RT | null = null;
  /** Clone tool: the source point (UV) and, once the first clone stroke starts, the fixed offset to it. */
  cloneSource: THREE.Vector2 | null = null;
  cloneOffset: THREE.Vector2 | null = null;
  setCloneSource(uv: THREE.Vector2) { this.cloneSource = uv.clone(); this.cloneOffset = null; }

  private matApply = quadShader(FRAG_APPLY, {
    snap: { value: null }, mask: { value: null }, value: { value: new THREE.Vector3() },
    flow: { value: 1 }, erase: { value: false },
  });
  private matNmap = quadShader(FRAG_NMAP, {
    heightTex: { value: null }, normalTex: { value: null }, bakedTex: { value: null }, texel: { value: new THREE.Vector2() }, strength: { value: 8 },
  });
  private matGen = quadShader(FRAG_GEN, {
    posMap: { value: null }, nrmMap: { value: null }, meshMap: { value: null }, paintMask: { value: null },
    hasPaint: { value: false }, useGen: { value: false }, baseValue: { value: 1 }, type: { value: 0 },
    amount: { value: 0.5 }, contrast: { value: 0.5 }, noiseAmt: { value: 0 }, noiseScale: { value: 6 }, seed: { value: 0 },
    axis: { value: new THREE.Vector3(0, 1, 0) }, bmin: { value: new THREE.Vector3() }, bmax: { value: new THREE.Vector3() },
    invert: { value: false },
    idMap: { value: null }, idCols: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, idN: { value: 0 }, idTol: { value: 0.1 },
    ctr: { value: new THREE.Vector3() }, rad: { value: 1 }, patKind: { value: 0 }, patScale: { value: 3 },
    hasPrev: { value: false }, prevMap: { value: null }, fxBlend: { value: 0 }, fxOpacity: { value: 1 }, outInv: { value: false },
    shpKind: { value: 0 }, shpC: { value: new THREE.Vector3() }, shpN: { value: new THREE.Vector3(0, 0, 1) }, shpU: { value: new THREE.Vector3(1, 0, 0) },
    shpV: { value: new THREE.Vector3(0, 1, 0) }, shpHalf: { value: new THREE.Vector2(0.2, 0.2) }, shpSoft: { value: 0.02 },
    useMicro: { value: false }, microMap: { value: null }, microAmt: { value: 1 },
    shpUV: { value: false }, shpTile: { value: 1 }, shpOff: { value: new THREE.Vector2() }, shpRotCS: { value: new THREE.Vector2(1, 0) }, shpScale: { value: new THREE.Vector2(0.5, 0.5) },
  });
  /** Renders a Material Designer graph into fill images (set by the app; used when opening projects). */
  graphBaker: ((g: GraphJSON) => Promise<Partial<Record<Ch, FillImage>>>) | null = null;
  /** Loads a scanned material's maps (set by the app; smart materials built from scans use it). */
  scanResolver: ((ref: ScanRef) => Promise<Partial<Record<Ch, FillImage>>>) | null = null;
  /**
   * Compile every shader up front (loading screen), so the first smart mask, procedural material,
   * stroke or bake doesn't stall while the GPU driver compiles.
   */
  warmup() {
    const tiny = makeRT(4);
    const mats: THREE.Material[] = Object.values(this).filter((v): v is THREE.ShaderMaterial => v instanceof THREE.ShaderMaterial);
    try {
      const mb = new MeshBaker(this.gpu, this.geometries);
      for (const v of Object.values(mb)) if (v instanceof THREE.ShaderMaterial) mats.push(v);
    } catch { /* fine */ }
    for (const m of mats) { try { this.gpu.run(m, tiny); } catch { /* fine */ } }
    tiny.dispose();
  }

  /** Bumped whenever the baked mesh maps change (smart masks re-evaluate). */
  meshVersion = 0;
  private matMaskMix = quadShader(`
uniform sampler2D genTex; uniform sampler2D paintMask; uniform bool hasPaint; varying vec2 vUv;
void main() { float v = texture2D(genTex, vUv).r; if (hasPaint) { vec4 pm = texture2D(paintMask, vUv); v = mix(v, pm.r, pm.a); } gl_FragColor = vec4(v, v, v, 1.0); }`,
    { genTex: { value: null }, paintMask: { value: null }, hasPaint: { value: false } });
  /** Ping-pong targets for mask effect stacks. */
  private maskTmp: RT[] = [];
  private matProc = quadShader(FRAG_PROC, {
    posMap: { value: null }, nrmMap: { value: null }, ctr: { value: new THREE.Vector3() }, rad: { value: 1 },
    kind: { value: 0 }, scale: { value: 3 }, seedF: { value: 0 }, contrast: { value: 1 }, balance: { value: 0 }, inv: { value: false },
  });
  /** Rendered procedural patterns (UV space), shared by every layer using the same pattern. */
  private procCache = new Map<string, RT>();

  /** The UV-space render of a procedural pattern (cached). */
  procTexture(p: ProcSource): THREE.Texture {
    const key = procKey(p);
    let rt = this.procCache.get(key);
    if (!rt) {
      rt = makeRT(Math.min(this.size, 2048));
      const u = this.matProc.uniforms;
      u.posMap.value = this.posRT.texture; u.nrmMap.value = this.nrmRT.texture;
      (u.ctr.value as THREE.Vector3).copy(this.bboxMin).add(this.bboxMax).multiplyScalar(0.5);
      u.rad.value = Math.max(1e-4, this.bboxMin.distanceTo(this.bboxMax) * 0.5);
      u.kind.value = patternIndex(p.pattern); u.scale.value = p.scale; u.seedF.value = Math.max(0, Math.round(p.seed));
      u.contrast.value = p.contrast; u.balance.value = p.balance ?? 0; u.inv.value = !!p.invert;
      this.gpu.run(this.matProc, rt);
      this.procCache.set(key, rt);
      if (this.procCache.size > 48) { const [k0, r0] = this.procCache.entries().next().value!; if (k0 !== key) { r0.dispose(); this.procCache.delete(k0); } }
    }
    return rt.texture;
  }
  private clearProcCache() { this.procCache.forEach((r) => r.dispose()); this.procCache.clear(); }
  private matBakeFinal = quadShader(FRAG_BAKE_FINAL, {
    accum: { value: null }, posMap: { value: null }, curvStrength: { value: 1.5 },
  });
  private matExport = quadShader(FRAG_EXPORT, {
    src: { value: null }, srcAO: { value: null }, srcG: { value: null }, srcB: { value: null }, mode: { value: 0 },
    flipG: { value: false },
  });
  private bakeMat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, uniforms: { mode: { value: 0 } },
    side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });

  constructor(gpu: GPU, geometries: THREE.BufferGeometry[], size: number) {
    this.gpu = gpu;
    this.geometries = geometries;
    this.size = size;
    this.parts = new MeshParts(geometries);
    const box = new THREE.Box3();
    for (const g of geometries) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    this.bboxMin.copy(box.min); this.bboxMax.copy(box.max);
    this.allocate();
  }

  // ------------------------------------------------------------ setup

  private floatType(): THREE.TextureDataType {
    return this.gpu.renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
  }

  private allocate() {
    const s = this.size;
    this.posRT = makeRT(s, { type: this.floatType(), nearest: true });
    this.nrmRT = makeRT(s, { type: THREE.HalfFloatType, nearest: true });
    this.meshRT = makeRT(s, { type: THREE.HalfFloatType });
    this.compA = makeRT(s, { type: THREE.HalfFloatType });
    this.compB = makeRT(s, { type: THREE.HalfFloatType });
    this.strokeRT = makeRT(s);
    this.final = {} as Record<Ch, RT>;
    for (const ch of CHANNELS) this.final[ch] = makeRT(s, { type: THREE.HalfFloatType, mips: true });
    this.finalN = makeRT(s, { type: THREE.HalfFloatType, mips: true });
    this.bakedNRT = makeRT(s);
    this.bakedHRT = makeRT(s);
    this.idRT = makeRT(s, { nearest: true });
    this.wsnRT = makeRT(s);
    this.posNRT = makeRT(s);
    this.tanRT = makeRT(s, { type: THREE.HalfFloatType, nearest: true });
    this.bitRT = makeRT(s, { type: THREE.HalfFloatType, nearest: true });
    this.bakeGeometry();
    this.bakeFrames();
    this.resetHighMaps();
    // Neutral mesh maps until you bake (Baking mode): AO white, flat curvature, mid thickness.
    this.matInit.uniforms.posMap.value = this.posRT.texture;
    this.matInit.uniforms.value.value.set(1, 0.5, 0.5);
    this.gpu.run(this.matInit, this.meshRT);
    this.matInit.uniforms.value.value.set(0, 0, 0);
    for (const rt of [this.idRT, this.wsnRT, this.posNRT]) this.gpu.run(this.matInit, rt);
    this.baked.clear();
    this.bakedOnce = false;
    for (const ch of CHANNELS) this.dirty.add(ch);
    this.normalDirty = true;
  }

  /** Bake world position + normal per texel (what the brush and generators read). */
  private bakeGeometry() {
    const scene = new THREE.Scene();
    const wire = this.bakeMat.clone();
    wire.wireframe = true;
    const solid = this.bakeMat.clone();
    for (const g of this.geometries) {
      const mw = new THREE.Mesh(g, wire); mw.frustumCulled = false; mw.renderOrder = 0;
      const ms = new THREE.Mesh(g, solid); ms.frustumCulled = false; ms.renderOrder = 1;
      scene.add(mw, ms);
    }
    for (const [mode, rt] of [[0, this.posRT], [1, this.nrmRT]] as const) {
      wire.uniforms.mode.value = mode;
      solid.uniforms.mode.value = mode;
      this.gpu.renderScene(scene, rt, true);
    }
    wire.dispose(); solid.dispose();
  }

  /** Tangent / bitangent per texel, matching the viewport's normal mapping. */
  private bakeFrames() {
    const scene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      vertexShader: FRAME_VERT, fragmentShader: FRAME_FRAG, uniforms: { mode: { value: 2 } },
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    for (const g of this.geometries) {
      if (!g.getAttribute('rayNormal')) g.setAttribute('rayNormal', g.attributes.normal);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m);
    }
    for (const [mode, rt] of [[2, this.tanRT], [3, this.bitRT]] as const) {
      mat.uniforms.mode.value = mode;
      this.gpu.renderScene(scene, this.compA, true);
      this.dilate(this.compA, rt);
    }
    mat.dispose();
  }

  /** Register a brush tip texture (grayscale, white = paint). */
  setTip(id: string, tex: THREE.Texture) {
    const old = this.tips.get(id);
    if (old && old !== tex) old.dispose();
    this.tips.set(id, tex);
  }
  hasTip(id: string) { return this.tips.has(id); }

  private resetHighMaps() {
    const u = this.matInit.uniforms;
    u.posMap.value = this.posRT.texture;
    u.value.value.set(0.5, 0.5, 1);
    this.gpu.run(this.matInit, this.bakedNRT);
    u.value.value.set(0.5, 1, 0);
    this.gpu.run(this.matInit, this.bakedHRT);
    this.lastHigh = null;
    this.normalDirty = true;
  }

  /**
   * Bake mesh maps (async; masks update when done). With a high poly: normal +
   * height by ray casting, then AO + curvature of the high poly. Without: AO +
   * curvature of the low poly.
   */
  /** Per-map state of the current / last bake (for the progress list). */
  bakeStage: Partial<Record<BakeKey, 'queued' | 'working' | 'done'>> = {};
  onBakeStage: ((k: BakeKey, state: 'working' | 'done') => void) | null = null;

  async bakeMeshMaps(onProgress?: (f: number) => void): Promise<boolean> {
    if (this.baker) this.baker.cancelled = true;
    const high = this.highGeometries;
    const maps = { ...this.bakeMaps };
    this.bakeStage = {};
    for (const k of Object.keys(maps) as BakeKey[]) if (maps[k]) this.bakeStage[k] = 'queued';
    const stage = (k: BakeKey, st: 'working' | 'done') => { if (!maps[k]) return; this.bakeStage[k] = st; this.onBakeStage?.(k, st); };
    const baker = new MeshBaker(this.gpu, high ?? this.geometries);
    this.baker = baker;
    this.baking = true;
    const accum = makeRT(this.size, { type: THREE.HalfFloatType, nearest: true });
    const posRT = this.posRT;
    const stale = () => baker.cancelled || this.baker !== baker || posRT !== this.posRT;
    let posTex: THREE.Texture = this.posRT.texture, nrmTex: THREE.Texture = this.nrmRT.texture;
    const temps: THREE.Texture[] = [];
    const tmp = makeRT(this.size, { type: THREE.HalfFloatType });
    const doRays = !!high && (maps.normal || maps.height || maps.wsn || maps.pos || maps.id || maps.ao || maps.curv || maps.thick);
    const doAO = maps.ao || maps.curv;
    const bs = { ...DEFAULT_BAKE, ...this.bakeSettings };
    const traced = bs.method !== 'gpu';
    const W = { rays: doRays ? 5 : 0, ao: doAO ? (traced ? 8 : 3) : 0, thick: maps.thick ? 3 : 0 };
    const total = W.rays + W.ao + W.thick || 1;
    let done = 0;
    const prog = (k: keyof typeof W, f: number) => onProgress?.((done + W[k] * f) / total);
    let hiPos: Float32Array | null = null, hiNrm: Float32Array | null = null;
    // Bake by mesh name: low and high meshes share a name group when their names match without the suffixes.
    const rules: NameRules = { low: bs.lowSuffix ?? DEFAULT_NAME_RULES.low, high: bs.highSuffix ?? DEFAULT_NAME_RULES.high, ignoreBf: bs.bfSuffix ?? DEFAULT_NAME_RULES.ignoreBf };
    const rayTargets = high ?? this.geometries;
    const [lowKey, tgtKey] = keyIds([this.geometries.map((g) => g.name), rayTargets.map((g) => g.name)], rules);
    try {
      if (doRays) {
        for (const k of ['normal', 'height', 'id', 'wsn', 'pos'] as BakeKey[]) stage(k, 'working');
        const res = await bakeHighToLow(this.gpu, this.geometries, high!, this.size, this.highSettings,
          (f) => prog('rays', f), stale, maps.id ? this.highIdOptions(high!) : undefined,
          bs.matchBy === 'name' ? { lowIdx: this.meshIndexMap(this.size), lowKey, highKey: tgtKey } : undefined);
        if (!res || stale()) return false;
        if (maps.normal) {
          this.writeRT(this.compA, res.normal, this.size);
          this.dilate(this.compA, this.bakedNRT);
          this.baked.add('normal');
          stage('normal', 'done');
        }
        // Height (r) only if ticked; the ray hit flag (g) always reflects this bake.
        this.writeRT(this.compA, res.height, this.size);
        this.dilate(this.compA, tmp);
        this.mergeInto(tmp, this.bakedHRT, [maps.height, true, false, false]);
        if (maps.height) { this.baked.add('height'); stage('height', 'done'); }
        if (maps.id && res.id) {
          this.writeRT(this.compA, res.id, this.size);
          this.dilate(this.compA, this.idRT);
          this.baked.add('id');
          stage('id', 'done');
        }
        this.lastHigh = { hits: res.hits, texels: res.texels };
        this.normalDirty = true;
        const ft = (d: Float32Array) => {
          const t = new THREE.DataTexture(d, this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
          t.magFilter = t.minFilter = THREE.NearestFilter;
          t.needsUpdate = true;
          temps.push(t);
          return t;
        };
        posTex = ft(res.pos);
        nrmTex = ft(res.nrm);
        hiPos = res.pos; hiNrm = res.nrm;
        done += W.rays;
      } else if (!high && (maps.normal || maps.height)) {
        // "Low poly as high poly": the baked normal/height are neutral.
        this.resetHighMaps();
        if (maps.normal) { this.baked.add('normal'); stage('normal', 'done'); }
        if (maps.height) { this.baked.add('height'); stage('height', 'done'); }
      }
      if (!high && maps.id) { stage('id', 'working'); this.bakeIdLow(); this.baked.add('id'); stage('id', 'done'); }
      const enc = (src: THREE.Texture, mode: number, out: RT) => {
        const u = this.matEnc.uniforms;
        u.src.value = src; u.cov.value = this.posRT.texture; u.mode.value = mode;
        const norm = mode === 1 ? bs.posNorm ?? 'bbox' : 'bbox';
        if (norm === 'bsphere') {
          // Normalised to the bounding sphere: the same scale on every axis.
          const c = new THREE.Vector3().addVectors(this.bboxMin, this.bboxMax).multiplyScalar(0.5);
          const r = Math.max(1e-4, this.bboxMax.distanceTo(this.bboxMin) / 2);
          u.bmin.value.set(c.x - r, c.y - r, c.z - r); u.bsize.value.set(2 * r, 2 * r, 2 * r);
        } else if (norm === 'none') { u.bmin.value.set(0, 0, 0); u.bsize.value.set(1, 1, 1); }
        else {
          u.bmin.value.copy(this.bboxMin);
          u.bsize.value.subVectors(this.bboxMax, this.bboxMin).max(new THREE.Vector3(1e-4, 1e-4, 1e-4));
        }
        const pm = bs.posMode ?? 'all';
        u.axis.value = mode === 1 && pm !== 'all' ? 'xyz'.indexOf(pm) : -1;
        this.gpu.run(this.matEnc, this.compA);
        u.src.value = null; u.axis.value = -1;
        this.dilate(this.compA, out);
      };
      if (maps.wsn) { enc(nrmTex, 0, this.wsnRT); this.baked.add('wsn'); stage('wsn', 'done'); }
      if (maps.pos) { enc(posTex, 1, this.posNRT); this.baked.add('pos'); stage('pos', 'done'); }
      let rb: RayBaker | null = null;
      const diag = this.bboxMax.distanceTo(this.bboxMin);
      // "Relative to bounding box" distances use the largest side of the box (like TextureCraft).
      const ext = new THREE.Vector3().subVectors(this.bboxMax, this.bboxMin);
      const scaleU = Math.max(1e-6, ext.x, ext.y, ext.z);
      const tracer = () => (rb ??= new RayBaker(rayTargets, { groups: tgtKey, cull: rayTargets.map((g) => wantsIgnoreBf(g.name, rules)) }));
      const stopTracer = setInterval(() => { if (stale() && rb) rb.cancelled = true; }, 200);
      try {
      if (doAO && traced) {
        // Ray traced like Substance: per texel position + normal (on the high poly when baking from one).
        const N = this.size * this.size;
        const { idx, pts } = this.samples(this.size, hiPos, hiNrm);
        const grp = this.sampleGroups(this.size, idx, lowKey);
        const base = {
          minD: (bs.aoMin ?? 1e-5) * scaleU, spread: bs.aoSpread ?? 180, dist: bs.aoDist ?? 'cosine', atten: bs.aoAtten ?? 'linear',
          ground: !!bs.aoGround, groundY: this.bboxMin.y + (bs.aoGroundOffset ?? 0) * scaleU, eps: 1e-6 * diag, meshScale: scaleU,
        } as const;
        const parts = (maps.ao ? 1 : 0) + (maps.curv ? 1 : 0);
        let ph = 0;
        const sub = (f: number) => prog('ao', (ph + f) / parts);
        stage('ao', 'working');
        const ao = maps.ao ? await tracer().run(pts, { ...base, kind: 'ao', rays: bs.aoRays ?? 64, maxD: (bs.aoMax ?? 1) * scaleU, radius: 0,
          sameName: bs.aoSelf === 'name', back: bs.aoBack ?? 'never' }, sub, grp) : null;
        if (maps.ao) { if (!ao || stale()) return false; ph++; }
        if (maps.ao) {
          // Show AO right away (on the model too) while curvature is still tracing.
          const pre = new Uint8Array(N * 4);
          idx.forEach((t, k) => { pre[t * 4] = Math.round(Math.min(1, Math.max(0, ao![k])) * 255); pre[t * 4 + 1] = 128; pre[t * 4 + 3] = 255; });
          this.writeRT(this.compA, pre, this.size);
          this.dilate(this.compA, tmp);
          this.mergeInto(tmp, this.meshRT, [true, false, false, false]);
          this.baked.add('ao');
          stage('ao', 'done');
        }
        stage('curv', 'working');
        const cv = maps.curv ? await tracer().run(pts, { ...base, kind: 'curv', rays: bs.curvRays ?? 32, maxD: 0, radius: (bs.curvRadius ?? 0.001) * scaleU, high: !!hiNrm,
          sameName: bs.curvSelf === 'name' }, sub, grp) : null;
        if (maps.curv && (!cv || stale())) return false;
        // Curvature: automatic tonemapping (symmetric around 0.5 = flat), as in Substance / TextureCraft.
        let scale = 1;
        if (cv) {
          let m = 0;
          for (const v of cv) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
          scale = Math.max(1e-6, m) / Math.max(0.05, bs.curvStrength);
        }
        const bytes = new Uint8Array(N * 4);
        idx.forEach((t, k) => {
          bytes[t * 4] = Math.round(Math.min(1, Math.max(0, ao ? ao[k] : 1)) * 255);
          bytes[t * 4 + 1] = Math.round(Math.min(1, Math.max(0, cv ? 0.5 + 0.5 * cv[k] / scale : 0.5)) * 255);
          bytes[t * 4 + 3] = 255;
        });
        this.writeRT(this.compA, bytes, this.size);
        this.dilate(this.compA, tmp);
        this.mergeInto(tmp, this.meshRT, [maps.ao, maps.curv, false, false]);
        if (maps.ao) this.baked.add('ao');
        if (maps.curv) { this.baked.add('curv'); stage('curv', 'done'); }
        done += W.ao;
      } else if (doAO) {
        stage('ao', 'working'); stage('curv', 'working');
        const ok = await baker.run(posTex, nrmTex, accum, this.bakeSettings, (f) => prog('ao', f));
        if (!ok || stale()) return false;
        const u = this.matBakeFinal.uniforms;
        u.accum.value = accum.texture;
        u.posMap.value = this.posRT.texture;
        u.curvStrength.value = this.bakeSettings.curvStrength;
        this.gpu.run(this.matBakeFinal, this.compA);
        this.dilate(this.compA, tmp);
        this.mergeInto(tmp, this.meshRT, [maps.ao, maps.curv, false, false]);
        if (maps.ao) { this.baked.add('ao'); stage('ao', 'done'); }
        if (maps.curv) { this.baked.add('curv'); stage('curv', 'done'); }
        done += W.ao;
      }
      if (maps.thick) {
        stage('thick', 'working');
        // Thickness varies slowly: compute it at up to 512 px and upsample.
        const ts = Math.min(512, this.size);
        let P: Float32Array, Nn: Float32Array;
        if (hiPos && hiNrm) { P = downsample(hiPos, this.size, ts); Nn = downsample(hiNrm, this.size, ts); }
        else { const fr = readFrames(this.gpu, this.geometries, ts, false); P = fr.pos; Nn = fr.nrm; }
        let bytes: Uint8Array | null;
        if (traced) {
          const M = ts * ts;
          const { idx: ids, pts } = this.samples(ts, hiPos ? P : null, hiNrm ? Nn : null);
          const tk = this.thickSettings;
          const th = await tracer().run(pts, { kind: 'thick', rays: tk.rays, minD: (tk.minDist ?? 1e-5) * scaleU, maxD: tk.maxDist * scaleU,
            spread: tk.spread ?? 180, dist: tk.dist ?? 'cosine', atten: 'none', ground: false, groundY: 0, eps: 1e-6 * diag, meshScale: scaleU, radius: 0,
            sameName: tk.self === 'name' }, (f) => prog('thick', f), this.sampleGroups(ts, ids, lowKey));
          if (!th || stale()) return false;
          // Normalised relative to min / max, like TextureCraft's default.
          let lo = Infinity, hi = -Infinity;
          for (const v of th) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          const rng = hi - lo > 1e-9 ? hi - lo : 1;
          bytes = new Uint8Array(M * 4);
          ids.forEach((t, k) => { const v = Math.round(Math.min(1, Math.max(0, (th[k] - lo) / rng)) * 255); bytes![t * 4] = bytes![t * 4 + 1] = bytes![t * 4 + 2] = v; bytes![t * 4 + 3] = 255; });
        } else bytes = await bakeThickness(P, Nn, ts, high ?? this.geometries, diag, this.thickSettings, (f) => prog('thick', f), stale);
        if (!bytes || stale()) return false;
        padBytes(bytes, ts, 6);
        const t = new THREE.DataTexture(bytes, ts, ts, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.magFilter = t.minFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        temps.push(t);
        const u = this.matEnc.uniforms;
        u.src.value = t; u.cov.value = this.posRT.texture; u.mode.value = 2;
        this.gpu.run(this.matEnc, this.compA);
        u.src.value = null;
        this.dilate(this.compA, tmp);
        this.mergeInto(tmp, this.meshRT, [false, false, true, false]);
        this.baked.add('thick');
        stage('thick', 'done');
        done += W.thick;
      }
      } finally { clearInterval(stopTracer); (rb as RayBaker | null)?.dispose(); }
      onProgress?.(1);
      this.bakedOnce = true;
      this.meshVersion++;
      for (const l of this.allLayers) if (l.mask) l.mask.dirty = true;
      this.markDirty();
      return true;
    } finally {
      accum.dispose();
      tmp.dispose();
      temps.forEach((t) => t.dispose());
      if (this.baker === baker) { this.baking = false; this.baker = null; }
      baker.dispose();
    }
  }

  /** 'auto': one colour per material when there are several, else separate objects, else connected parts, else UV islands. */
  private resolveIdSource(geos: THREE.BufferGeometry[], parts: MeshParts): Exclude<IdSource, 'auto'> {
    if (this.idSource !== 'auto') return this.idSource;
    if (parts.materialCount() > 1) return 'material';
    if (geos.length > 1) return 'object';
    const ids = parts.triIds('part', 0);
    for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[0]) return 'part';
    return geos[0].attributes.uv ? 'island' : 'part';
  }

  /**
   * Texel samples for the ray tracer: position, shading normal, geometric normal and
   * world size of one texel (from the UV-space derivatives), for every covered texel.
   */
  private samples(size: number, hiPos: Float32Array | null, hiNrm: Float32Array | null): { idx: number[]; pts: Float32Array } {
    const fr = readFrames(this.gpu, this.geometries, size, false);
    const geo = this.readGeoFrames(size);
    const P = hiPos ?? fr.pos, Nn = hiNrm ?? fr.nrm;
    const idx: number[] = [];
    for (let i = 0; i < size * size; i++) if (P[i * 4 + 3] > 0.5) idx.push(i);
    const pts = new Float32Array(idx.length * SAMPLE_FLOATS);
    idx.forEach((t, k) => {
      const o = k * SAMPLE_FLOATS;
      for (let c = 0; c < 3; c++) { pts[o + c] = P[t * 4 + c]; pts[o + 3 + c] = Nn[t * 4 + c]; }
      // on the high poly the low poly's face normal isn't right: use the shading normal there
      if (hiNrm || geo[t * 4 + 3] <= 0) { pts[o + 6] = Nn[t * 4]; pts[o + 7] = Nn[t * 4 + 1]; pts[o + 8] = Nn[t * 4 + 2]; }
      else { pts[o + 6] = geo[t * 4]; pts[o + 7] = geo[t * 4 + 1]; pts[o + 8] = geo[t * 4 + 2]; }
      pts[o + 9] = geo[t * 4 + 3];
    });
    return { idx, pts };
  }

  /** Low poly mesh per texel (its index + 1; 0 where no mesh covers the texel), by rasterising in UV space. */
  meshIndexMap(size: number): Float32Array {
    const mats: THREE.ShaderMaterial[] = [];
    const scene = new THREE.Scene();
    this.geometries.forEach((g, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: `void main() { gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `uniform float id; void main() { gl_FragColor = vec4(id, 0.0, 0.0, 1.0); }`,
        uniforms: { id: { value: i + 1 } },
        side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      });
      mats.push(mat);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m);
    });
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
    const r = this.gpu.renderer;
    const saved = new THREE.Color(); const sa = r.getClearAlpha(); r.getClearColor(saved);
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    r.render(scene, this.gpu.camera);
    const buf = new Float32Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    r.setClearColor(saved, sa); r.setRenderTarget(null);
    rt.dispose(); mats.forEach((m) => m.dispose());
    const out = new Float32Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = buf[i * 4];
    return out;
  }

  /** Name group of the low poly mesh under each traced texel (for "Only same mesh name"). */
  private sampleGroups(size: number, idx: number[], lowKey: number[]): Int32Array | null {
    if (this.geometries.length < 2 && !this.highGeometries) return null;
    const m = this.meshIndexMap(size);
    const g = new Int32Array(idx.length);
    idx.forEach((t, k) => { g[k] = lowKey[Math.round(m[t]) - 1] ?? -1; });
    return g;
  }

  /** Per texel: geometric (face) normal + world size of one texel, by rasterising in UV space. */
  private readGeoFrames(size: number): Float32Array {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vP; varying vec3 vN; void main() { vP = position; vN = normal; gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vP; varying vec3 vN;
        void main() {
          vec3 a = dFdx(vP), b = dFdy(vP);
          vec3 c = cross(a, b);
          float L = length(c);
          vec3 g = L > 0.0 ? c / L : normalize(vN);
          if (dot(g, vN) < 0.0) g = -g;
          gl_FragColor = vec4(g, sqrt(L));
        }`,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const scene = new THREE.Scene();
    for (const g of this.geometries) { const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m); }
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
    const r = this.gpu.renderer;
    const saved = new THREE.Color(); const sa = r.getClearAlpha(); r.getClearColor(saved);
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    r.render(scene, this.gpu.camera);
    const buf = new Float32Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    r.setClearColor(saved, sa); r.setRenderTarget(null);
    rt.dispose(); mat.dispose();
    return buf;
  }

  private highIdOptions(high: THREE.BufferGeometry[]) {
    if (!this.highParts || this.highParts.geos !== high) this.highParts = { geos: high, parts: new MeshParts(high) };
    const hp = this.highParts.parts;
    const src = this.resolveIdSource(high, hp);
    return {
      // Material colours come from the material's name, so the high poly's "Metal" matches the low poly's "Metal".
      tri: high.map((g, gi) => (src === 'vertex' && g.attributes.color ? null : src === 'material'
        ? hp.triIds('material', gi).map((m) => strHash(materialName(g, m)))
        : hp.triIds(src === 'vertex' ? 'part' : src, gi))),
      vertexColor: src === 'vertex',
      color: idColor,
      global: src === 'material',
    };
  }

  /** ID map from the low poly: one color per part / island / object / material, or the vertex colors. */
  private bakeIdLow() {
    const scene = new THREE.Scene();
    const solid = new THREE.ShaderMaterial({
      vertexShader: ID_VERT, fragmentShader: ID_FRAG,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const wire = solid.clone(); wire.wireframe = true;
    const temps: THREE.BufferGeometry[] = [];
    const resolved = this.resolveIdSource(this.geometries, this.parts);
    this.geometries.forEach((g, gi) => {
      const src = resolved;
      const vc = src === 'vertex' ? g.attributes.color : undefined;
      const ids = vc ? null : this.parts.triIds(src === 'vertex' ? 'part' : src, gi);
      const uv = g.attributes.uv, idx = g.index;
      const n = (idx ? idx.count : g.attributes.position.count) / 3;
      const pos = new Float32Array(n * 9), uvs = new Float32Array(n * 6), col = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const c = ids ? idColor(src === 'material' ? strHash(materialName(g, ids[t])) : gi * 7919 + ids[t]) : null;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(t * 3 + k) : t * 3 + k, o = t * 3 + k;
          uvs[o * 2] = uv.getX(v); uvs[o * 2 + 1] = uv.getY(v);
          pos[o * 3] = uvs[o * 2]; pos[o * 3 + 1] = uvs[o * 2 + 1];
          if (c) { col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2]; }
          else { col[o * 3] = vc!.getX(v); col[o * 3 + 1] = vc!.getY(v); col[o * 3 + 2] = vc!.getZ(v); }
        }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      tg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      tg.setAttribute('idColor', new THREE.BufferAttribute(col, 3));
      temps.push(tg);
      const mw = new THREE.Mesh(tg, wire); mw.frustumCulled = false; mw.renderOrder = 0;
      const ms = new THREE.Mesh(tg, solid); ms.frustumCulled = false; ms.renderOrder = 1;
      scene.add(mw, ms);
    });
    this.gpu.renderScene(scene, this.compA, true);
    this.dilate(this.compA, this.idRT);
    temps.forEach((t) => t.dispose());
    solid.dispose(); wire.dispose();
  }

  /** Read a texture at a UV (RGB 0..1). */
  sampleTex(tex: THREE.Texture, uv: THREE.Vector2): [number, number, number] {
    const rt = makeRT(1);
    const u = this.matSample.uniforms;
    u.uv.value.copy(uv);
    u.src.value = tex;
    this.gpu.run(this.matSample, rt);
    const px = this.gpu.readPixels(rt);
    rt.dispose();
    u.src.value = null;
    return [px[0] / 255, px[1] / 255, px[2] / 255];
  }

  /** Read the final material at a UV (for the color picker). */
  sampleAt(uv: THREE.Vector2): ChannelValues {
    this.compositeDirty();
    const rt = makeRT(1);
    const u = this.matSample.uniforms;
    u.uv.value.copy(uv);
    const read = (tex: THREE.Texture) => {
      u.src.value = tex;
      this.gpu.run(this.matSample, rt);
      const px = this.gpu.readPixels(rt);
      return [px[0] / 255, px[1] / 255, px[2] / 255] as [number, number, number];
    };
    const v: ChannelValues = {
      color: read(this.final.color.texture), rough: read(this.final.rough.texture)[0],
      metal: read(this.final.metal.texture)[0], height: read(this.final.height.texture)[0],
      emit: read(this.final.emit.texture),
    };
    rt.dispose();
    return v;
  }
  private matSample = quadShader(/* glsl */ `
uniform sampler2D src;
uniform vec2 uv;
void main() { gl_FragColor = vec4(texture2D(src, uv).rgb, 1.0); }`, { src: { value: null }, uv: { value: new THREE.Vector2() } });

  /** Which maps the next bake should (re)compute. Unticked maps keep their previous result. */
  bakeMaps: Record<BakeKey, boolean> = { normal: true, wsn: true, id: true, ao: true, curv: true, pos: true, thick: true, height: true };

  /** Copy channels of `src` into `dst` where `use[i]` is true; keep dst's other channels. */
  private mergeInto(src: RT, dst: RT, use: [boolean, boolean, boolean, boolean]) {
    const u = this.matMerge.uniforms;
    u.a.value = src.texture;
    u.b.value = dst.texture;
    u.use.value.set(+use[0], +use[1], +use[2], +use[3]);
    const out = makeRT(this.size, { type: THREE.HalfFloatType });
    this.gpu.run(this.matMerge, out);
    this.matCopy.uniforms.src.value = out.texture;
    this.gpu.run(this.matCopy, dst);
    out.dispose();
  }
  private matMerge = quadShader(/* glsl */ `
uniform sampler2D a;
uniform sampler2D b;
uniform vec4 use;
varying vec2 vUv;
void main() {
  vec4 x = texture2D(a, vUv), y = texture2D(b, vUv);
  gl_FragColor = vec4(mix(y.rgb, x.rgb, use.rgb), x.a);
}`, { a: { value: null }, b: { value: null }, use: { value: new THREE.Vector4(1, 1, 1, 1) } });

  /** Raw 8-bit copies of the baked maps (for saving in a project). */
  readMeshMaps(): MeshMapBytes {
    return {
      mesh: this.readRT8(this.meshRT), bn: this.readRT(this.bakedNRT), bh: this.readRT(this.bakedHRT),
      id: this.readRT(this.idRT), wsn: this.readRT(this.wsnRT), pos: this.readRT(this.posNRT), baked: [...this.baked],
    };
  }

  writeMeshMaps(m: MeshMapBytes, size: number) {
    this.writeRT(this.meshRT, m.mesh, size);
    this.writeRT(this.bakedNRT, m.bn, size);
    this.writeRT(this.bakedHRT, m.bh, size);
    if (m.id) this.writeRT(this.idRT, m.id, size);
    if (m.wsn) this.writeRT(this.wsnRT, m.wsn, size);
    if (m.pos) this.writeRT(this.posNRT, m.pos, size);
    // Older projects: every map that existed then was baked.
    this.baked = new Set(m.baked ?? ['normal', 'height', 'ao', 'curv']);
    this.bakedOnce = true;
    this.meshVersion++;
    for (const l of this.allLayers) if (l.mask) l.mask.dirty = true;
    this.normalDirty = true;
    this.markDirty();
  }

  /** Read any render target as RGBA8 (float targets are converted first). */
  readRT8(rt: RT): Uint8Array {
    const tmp = makeRT(this.size);
    this.matCopy.uniforms.src.value = rt.texture;
    this.gpu.run(this.matCopy, tmp);
    const px = this.gpu.readPixels(tmp);
    tmp.dispose();
    return px;
  }

  private allRTs(): RT[] {
    const all: RT[] = [this.posRT, this.nrmRT, this.meshRT, this.compA, this.compB, this.strokeRT, this.finalN,
      this.bakedNRT, this.bakedHRT, this.idRT, this.wsnRT, this.posNRT, this.tanRT, this.bitRT, ...Object.values(this.final)];
    return all;
  }

  dispose() {
    if (this.baker) this.baker.cancelled = true;
    const all = this.allRTs();
    for (const e of [...this.undoStack, ...this.redoStack]) this.discard(e);
    for (const l of this.known) this.disposeLayer(l);
    for (const m of this.knownMasks) { m.rt.dispose(); m.paintRT.dispose(); m.genRT?.dispose(); }
    this.known.clear(); this.knownMasks.clear();
    for (const t of this.tips.values()) t.dispose();
    this.toolMaskRT?.dispose(); this.toolTmpRT?.dispose();
    this.tips.clear();
    this.clearProcCache();
    this.maskTmp.forEach((t) => t.dispose());
    all.forEach((r) => r.dispose());
    for (const pair of this.pool) pair.forEach((r) => r.dispose());
    this.pool = [];
    this.layers = [];
    this.undoStack = []; this.redoStack = [];
    this.thumbRTs.forEach((r) => r.dispose()); this.thumbRTs.clear();
    this.anchorH.forEach((r) => r.dispose()); this.anchorD.forEach((r) => r.dispose()); this.anchorH.clear(); this.anchorD.clear();
  }

  /** Free one layer's own GPU data (children and masks are tracked separately). */
  private disposeLayer(l: Layer) {
    if (l.kind === 'paint') Object.values(l.rts).forEach((r) => r.dispose());
    else if (l.kind === 'fill') for (const img of Object.values(l.images ?? {})) img!.tex.dispose();
  }

  // ------------------------------------------------------------ history (undo / redo)

  snapshot(): Snap {
    const node = (l: Layer): NodeSnap => {
      const props: Record<string, unknown> = { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, anchor: l.anchor,
        fx: l.fx ? structuredClone(l.fx) : undefined, tag: l.tag };
      if (l.kind === 'fill') {
        props.values = structuredClone(l.values); props.enabled = { ...l.enabled }; props.tiling = l.tiling;
        props.images = l.images ? { ...l.images } : undefined;
        props.xf = l.xf ? { ...l.xf } : undefined; props.adj = l.adj ? structuredClone(l.adj) : undefined;
        props.procs = l.procs ? structuredClone(l.procs) : undefined;
        props.graph = l.graph;
        props.sbs = l.sbs ? structuredClone(l.sbs) : undefined;
      }
      if (l.kind === 'group') props.open = l.open;
      const n: NodeSnap = { layer: l, props, mask: l.mask };
      if (l.mask) n.maskProps = { base: l.mask.base, gen: l.mask.gen ? structuredClone(l.mask.gen) : null, painted: l.mask.painted, off: l.mask.off, inv: l.mask.inv };
      if (l.kind === 'group') n.children = l.children.map(node);
      return n;
    };
    return { tree: this.layers.map(node), active: this.activeId };
  }

  private restore(s: Snap) {
    const build = (n: NodeSnap): Layer => {
      const l = n.layer as any;
      for (const [k, v] of Object.entries(n.props)) l[k] = k === 'values' || k === 'adj' || k === 'procs' || k === 'sbs' || k === 'fx' ? (v === undefined ? v : structuredClone(v)) : k === 'enabled' || (k === 'xf' && v) ? { ...(v as object) } : v;
      l.mask = n.mask;
      if (n.mask && n.maskProps) {
        n.mask.base = n.maskProps.base;
        n.mask.gen = n.maskProps.gen ? structuredClone(n.maskProps.gen) : null;
        n.mask.painted = n.maskProps.painted;
        n.mask.off = n.maskProps.off; n.mask.inv = n.maskProps.inv;
        n.mask.dirty = true;
      }
      if (n.children) l.children = n.children.map(build);
      return l;
    };
    this.layers = s.tree.map(build);
    this.activeId = s.active;
    this.markDirty();
  }

  private push(e: HistEntry) {
    if (!this.recording) { this.discard(e); return; }
    if (this.batchDepth > 0) { this.batchItems.push(e); return; }
    e.t = Date.now();
    this.undoStack.push(e);
    for (const r of this.redoStack) this.discard(r);
    this.redoStack = [];
    this.trimHistory();
    this.gc();
  }

  /**
   * Record the document state before a change. Edits with the same `key`
   * within a second (e.g. dragging a slider) merge into one undo step.
   */
  checkpoint(label: string, key?: string) {
    if (!this.recording) return;
    const now = performance.now();
    if (key && this.batchDepth === 0 && key === this.lastKey && now - this.lastKeyTime < 1000) { this.lastKeyTime = now; return; }
    this.lastKey = key ?? '';
    this.lastKeyTime = now;
    this.push({ kind: 'state', label, snap: this.snapshot() });
  }

  private beginBatch() {
    if (this.batchDepth === 0) this.batchItems = [];
    this.batchDepth++;
  }

  private endBatch(label: string) {
    this.batchDepth--;
    if (this.batchDepth > 0 || !this.batchItems.length) return;
    const items = this.batchItems;
    this.batchItems = [];
    this.lastKey = '';
    this.push(items.length === 1 ? { ...items[0], label } : { kind: 'multi', label, items });
  }

  /** Run several changes as one undo step. */
  async batch<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    this.beginBatch();
    try { return await fn(); } finally { this.endBatch(label); }
  }

  batchSync<T>(label: string, fn: () => T): T {
    this.beginBatch();
    try { return fn(); } finally { this.endBatch(label); }
  }

  private apply(e: HistEntry, undo: boolean) {
    if (e.kind === 'stroke') this.swapEntry(e);
    else if (e.kind === 'state') { const cur = this.snapshot(); this.restore(e.snap); e.snap = cur; }
    else {
      const items = undo ? [...e.items].reverse() : e.items;
      for (const it of items) this.apply(it, undo);
    }
  }

  private discard(e: HistEntry) {
    if (e.kind === 'stroke') Object.values(e.rts).forEach((r) => r!.dispose());
    else if (e.kind === 'multi') e.items.forEach((x) => this.discard(x));
  }

  private entryBytes(e: HistEntry): number {
    if (e.kind === 'stroke') return Object.keys(e.rts).length * this.size * this.size * 4;
    if (e.kind === 'multi') return e.items.reduce((a, x) => a + this.entryBytes(x), 0);
    return 0;
  }

  private trimHistory() {
    let total = this.undoStack.reduce((a, e) => a + this.entryBytes(e), 0);
    const max = Math.max(1, Math.min(HISTORY_MAX, this.historyLimit));
    while (this.undoStack.length > 1 && (total > UNDO_BUDGET_BYTES || this.undoStack.length > max)) {
      const e = this.undoStack.shift()!;
      total -= this.entryBytes(e);
      this.discard(e);
    }
  }

  /** Free layers / masks no longer reachable from the document or the history. */
  private gc() {
    const layers = new Set<Layer>(), masks = new Set<LayerMask>();
    const visitLayer = (l: Layer) => { layers.add(l); if (l.mask) masks.add(l.mask); if (l.kind === 'group') l.children.forEach(visitLayer); };
    this.layers.forEach(visitLayer);
    const visitNode = (n: NodeSnap) => { layers.add(n.layer); if (n.mask) masks.add(n.mask); n.children?.forEach(visitNode); };
    const visitEntry = (e: HistEntry) => {
      if (e.kind === 'state') e.snap.tree.forEach(visitNode);
      else if (e.kind === 'stroke') { layers.add(e.layer); if (e.mask) masks.add(e.mask); }
      else e.items.forEach(visitEntry);
    };
    [...this.undoStack, ...this.redoStack, ...this.batchItems].forEach(visitEntry);
    if (this.stroke) { layers.add(this.stroke.layer); if (this.stroke.entry.mask) masks.add(this.stroke.entry.mask); }
    for (const l of this.known) if (!layers.has(l)) { this.disposeLayer(l); this.known.delete(l); }
    for (const m of this.knownMasks) if (!masks.has(m)) { m.rt.dispose(); m.paintRT.dispose(); m.genRT?.dispose(); this.knownMasks.delete(m); }
  }

  clearHistory() {
    for (const e of [...this.undoStack, ...this.redoStack]) this.discard(e);
    this.undoStack = []; this.redoStack = [];
    this.gc();
  }

  /** How many undo steps are kept (Settings; default 25). */
  historyLimit = 25;
  /** Bumped on every history change (the History panel listens). */
  historyVersion = 0;
  /** The history, oldest first: done steps, then undone ones (greyed in the panel). */
  historyList(): { label: string; t: number; kind: string; done: boolean }[] {
    const kindOf = (e: HistEntry): string => e.kind === 'multi' ? (e.items[0] ? kindOf(e.items[0]) : 'state') : e.kind;
    return [
      ...this.undoStack.map((e) => ({ label: e.label, t: e.t ?? 0, kind: kindOf(e), done: true })),
      ...[...this.redoStack].reverse().map((e) => ({ label: e.label, t: e.t ?? 0, kind: kindOf(e), done: false })),
    ];
  }
  get historyPos() { return this.undoStack.length; }
  /** Undo / redo until `n` steps are done (0 = as the file was opened). */
  jumpTo(n: number) {
    if (this.stroke) return;
    while (this.undoStack.length > n && this.undo()) { /* step back */ }
    while (this.undoStack.length < n && this.redoStack.length && this.redo()) { /* step forward */ }
  }

  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? ''; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? ''; }

  // ------------------------------------------------------------ layers

  /** Every layer, depth first (bottom to top within each folder). */
  get allLayers(): Layer[] {
    const out: Layer[] = [];
    const walk = (list: Layer[]) => { for (const l of list) { out.push(l); if (l.kind === 'group') walk(l.children); } };
    walk(this.layers);
    return out;
  }

  get activeLayer(): Layer | undefined {
    return this.allLayers.find((l) => l.id === this.activeId);
  }

  /** The list (top level or folder children) that holds a layer. */
  where(id: number): { list: Layer[]; index: number; parent: GroupLayer | null } | null {
    const find = (list: Layer[], parent: GroupLayer | null): ReturnType<TextureSet['where']> => {
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (l.id === id) return { list, index: i, parent };
        if (l.kind === 'group') { const r = find(l.children, l); if (r) return r; }
      }
      return null;
    };
    return find(this.layers, null);
  }

  addGroup(name?: string, aboveActive = true, parent?: GroupLayer): GroupLayer {
    const layer: GroupLayer = {
      id: this.nextId++, kind: 'group', name: name ?? `Folder ${this.nextId - 1}`,
      visible: true, opacity: 1, blend: 'normal', children: [], open: true,
    };
    this.insert(layer, aboveActive, parent);
    return layer;
  }

  /** Move a layer above / below / into another one. */
  moveLayerTo(id: number, targetId: number, place: 'above' | 'below' | 'inside') {
    if (id === targetId) return;
    const src = this.where(id);
    if (!src) return;
    const layer = src.list[src.index];
    // never move a folder into itself
    if (layer.kind === 'group') {
      const inside = (g: GroupLayer): boolean => g.children.some((c) => c.id === targetId || (c.kind === 'group' && inside(c)));
      if (inside(layer)) return;
    }
    if (!this.where(targetId)) return;
    this.checkpoint('Move layer');
    src.list.splice(src.index, 1);
    const dst = this.where(targetId);
    if (!dst) { src.list.splice(src.index, 0, layer); return; }
    const target = dst.list[dst.index];
    if (place === 'inside' && target.kind === 'group') { target.children.push(layer); target.open = true; }
    else dst.list.splice(place === 'above' ? dst.index + 1 : dst.index, 0, layer);
    this.markAll();
  }

  /** Move several layers together, keeping their order (one undo step). */
  moveLayersTo(ids: number[], targetId: number, place: 'above' | 'below' | 'inside') {
    const ids2 = ids.filter((id) => id !== targetId && !this.isInside(targetId, id));
    if (!ids2.length) return;
    this.batchSync(ids2.length > 1 ? `Move ${ids2.length} layers` : 'Move layer', () => {
      let prev = -1;
      for (const id of ids2) {
        if (prev < 0) this.moveLayerTo(id, targetId, place);
        else this.moveLayerTo(id, prev, 'above');
        prev = id;
      }
    });
  }

  /** Is layer `id` somewhere inside folder `groupId`? */
  isInside(id: number, groupId: number): boolean {
    const g = this.allLayers.find((l) => l.id === groupId);
    if (!g || g.kind !== 'group') return false;
    const walk = (x: GroupLayer): boolean => x.children.some((c) => c.id === id || (c.kind === 'group' && walk(c)));
    return walk(g);
  }

  markAll() {
    this.markDirty();
    this.onChange?.();
  }

  addPaintLayer(name?: string, aboveActive = true, parent?: GroupLayer): PaintLayer {
    const rts = {} as Record<Ch, RT>;
    for (const ch of CHANNELS) { rts[ch] = makeRT(this.size); this.gpu.clear(rts[ch]); }
    const layer: PaintLayer = {
      id: this.nextId++, kind: 'paint', name: name ?? `Layer ${this.nextId - 1}`,
      visible: true, opacity: 1, blend: 'normal', rts,
    };
    this.insert(layer, aboveActive, parent);
    return layer;
  }

  addFillLayer(
    name?: string, values?: Partial<ChannelValues>, enabled?: Partial<Record<Ch, boolean>>, aboveActive = true,
    images?: Partial<Record<Ch, FillImage>>, tiling = 1, parent?: GroupLayer,
  ): FillLayer {
    const layer: FillLayer = {
      id: this.nextId++, kind: 'fill', name: name ?? `Fill ${this.nextId - 1}`, visible: true, opacity: 1, blend: 'normal',
      values: { color: [0.62, 0.62, 0.62], rough: 0.45, metal: 0, height: 0.5, emit: [0, 0, 0], ...values },
      enabled: { color: true, rough: true, metal: true, height: false, emit: false, normal: false, ...enabled },
      images, tiling,
    };
    this.insert(layer, aboveActive, parent);
    return layer;
  }

  /** parent given → top of that folder; else above the active layer (same folder), else top of the stack. */
  private insert(layer: Layer, aboveActive: boolean, parent?: GroupLayer) {
    this.checkpoint(layer.kind === 'group' ? 'Add folder' : layer.kind === 'fill' ? 'Add fill layer' : 'Add paint layer');
    this.known.add(layer);
    if (parent) parent.children.push(layer);
    else {
      const w = aboveActive ? this.where(this.activeId) : null;
      if (w) w.list.splice(w.index + 1, 0, layer);
      else this.layers.push(layer);
    }
    this.activeId = layer.id;
    this.markAll();
  }

  removeLayer(id: number) {
    const w = this.where(id);
    if (!w) return;
    this.checkpoint('Delete layer');
    // Detach only: the history keeps it alive so Ctrl+Z can bring it back.
    w.list.splice(w.index, 1);
    if (this.activeId === id || !this.activeLayer) {
      this.activeId = w.list[Math.min(w.index, w.list.length - 1)]?.id ?? w.parent?.id ?? this.layers[this.layers.length - 1]?.id ?? -1;
    }
    this.markAll();
  }

  moveLayer(id: number, dir: 1 | -1) {
    const w = this.where(id);
    if (!w) return;
    const j = w.index + dir;
    if (j < 0 || j >= w.list.length) return;
    this.checkpoint('Move layer');
    [w.list[w.index], w.list[j]] = [w.list[j], w.list[w.index]];
    this.markAll();
  }

  layerChanged() { this.markAll(); }

  /** Re-composite without notifying the UI (for live slider / color edits). */
  markDirty(chs: Ch[] = CHANNELS) {
    for (const ch of chs) this.dirty.add(ch);
  }

  // ------------------------------------------------------------ masks

  addMask(layer: Layer, spec: LayerMaskSpec) {
    this.checkpoint('Add mask');
    const paintRT = makeRT(this.size);
    this.gpu.clear(paintRT);
    layer.mask = { ...spec, gen: spec.gen ? structuredClone(spec.gen) : null, paintRT, painted: false, rt: makeRT(this.size), dirty: true };
    this.knownMasks.add(layer.mask);
    this.markAll();
  }

  removeMask(layer: Layer) {
    if (!layer.mask) return;
    this.checkpoint('Remove mask');
    layer.mask = undefined; // kept by the history until it's no longer needed
    this.markAll();
  }

  /** Fill a mask's paint from a grayscale picture (levels: amount / contrast / invert, like a grunge's balance). */
  maskFromImage(layer: Layer, tex: THREE.Texture, amount = 0.5, contrast = 0.5, invert = false) {
    const m = layer.mask;
    if (!m) return;
    const u = this.matMaskImg.uniforms;
    u.img.value = tex;
    u.th.value = 1 - amount;
    u.soft.value = 0.5 + (0.01 - 0.5) * Math.min(1, Math.max(0, contrast));
    u.inv.value = invert;
    u.posMap.value = this.posRT.texture;
    this.gpu.run(this.matMaskImg, m.paintRT);
    u.img.value = null;
    m.painted = true;
    m.dirty = true;
    this.markDirty();
  }
  private matMaskImg = quadShader(/* glsl */ `
uniform sampler2D img;
uniform sampler2D posMap;
uniform float th;
uniform float soft;
uniform bool inv;
varying vec2 vUv;
void main() {
  float g = texture2D(img, vUv).r;
  float v = smoothstep(th - soft, th + soft, g);
  if (inv) v = 1.0 - v;
  gl_FragColor = vec4(v, v, v, 1.0);
}`, { img: { value: null }, posMap: { value: null }, th: { value: 0.5 }, soft: { value: 0.25 }, inv: { value: false } });

  /** Call after editing a mask's generator settings (live). */
  maskChanged(layer: Layer) {
    if (layer.mask) layer.mask.dirty = true;
    this.markDirty();
  }

  clearMaskPaint(layer: Layer) {
    if (!layer.mask) return;
    const snap = makeRT(this.size);
    this.matCopy.uniforms.src.value = layer.mask.paintRT.texture;
    this.gpu.run(this.matCopy, snap);
    this.push({ kind: 'stroke', label: 'Clear mask paint', layer, mask: layer.mask, rts: { mask: snap } });
    this.gpu.clear(layer.mask.paintRT);
    layer.mask.painted = false;
    this.maskChanged(layer);
  }

  private updateMask(layer: Layer) {
    const m = layer.mask!;
    const u = this.matGen.uniforms;
    const g: GenSettings | null = m.gen;
    if (!g) {
      // Plain painted mask: cheap, no generator.
      u.posMap.value = this.posRT.texture; u.nrmMap.value = this.nrmRT.texture; u.meshMap.value = this.meshRT.texture;
      u.paintMask.value = m.paintRT.texture; u.baseValue.value = m.base === 'white' ? 1 : 0;
      this.setGenUniforms(null);
      u.hasPrev.value = false; u.prevMap.value = null; u.outInv.value = false; u.hasPaint.value = m.painted;
      this.gpu.run(this.matGen, m.rt);
      m.dirty = false;
      return;
    }
    const key = `${JSON.stringify(g)}#${this.meshVersion}#${this.size}${usesMicro(g) ? '#a' + this.anchorVersion : ''}${JSON.stringify(g).includes('"sp"') ? '#g' + this.grungeVersion : ''}`;
    if (!m.genRT || m.genRT.width !== this.size || m.genKey !== key) {
      if (!m.genRT || m.genRT.width !== this.size) { m.genRT?.dispose(); m.genRT = makeRT(this.size); }
      this.renderGenStack(m, g, m.genRT);
      m.genKey = key;
    }
    // Painting the mask only re-mixes the paint over the cached generator result.
    const mu = this.matMaskMix.uniforms;
    mu.genTex.value = m.genRT.texture; mu.paintMask.value = m.paintRT.texture; mu.hasPaint.value = m.painted;
    this.gpu.run(this.matMaskMix, m.rt);
    mu.genTex.value = null; mu.paintMask.value = null;
    m.dirty = false;
  }

  private renderGenStack(m: LayerMask, g: GenSettings, out: RT) {
    const u = this.matGen.uniforms;
    u.posMap.value = this.posRT.texture;
    u.nrmMap.value = this.nrmRT.texture;
    u.meshMap.value = this.meshRT.texture;
    u.paintMask.value = null;
    u.hasPaint.value = false;
    u.baseValue.value = m.base === 'white' ? 1 : 0;
    u.bmin.value.copy(this.bboxMin);
    u.bmax.value.copy(this.bboxMax);
    (u.ctr.value as THREE.Vector3).copy(this.bboxMin).add(this.bboxMax).multiplyScalar(0.5);
    u.rad.value = Math.max(1e-4, this.bboxMin.distanceTo(this.bboxMax) * 0.5);
    u.idMap.value = this.idRT.texture;
    const effects: GenSettings[] = [g, ...(g.fx ?? []).filter((e) => e.on !== false && e.opacity > 0)];
    if (effects.length > 1 && (this.maskTmp.length !== 2 || this.maskTmp[0].width !== this.size)) {
      this.maskTmp.forEach((t) => t.dispose());
      this.maskTmp = [makeRT(this.size), makeRT(this.size)];
    }
    let prev: RT | null = null;
    effects.forEach((e, k) => {
      const last = k === effects.length - 1;
      const target = last ? out : this.maskTmp[k % 2];
      if (e.type === 'painter' && e.sp) {
        const fe = e as MaskFx;
        const shift = last && g.spBase !== undefined ? Math.max(-0.49, Math.min(0.49, (g.amount ?? g.spBase) - g.spBase)) : 0;
        this.runPainterGen(e.sp, prev, target, Math.max(0, FX_BLENDS.indexOf(fe.blend ?? 'normal')), Math.max(0, Math.min(1, fe.opacity ?? 1)), last && !!g.outInvert, e.seed, !!e.invert, shift);
        prev = target;
        return;
      }
      this.setGenUniforms(e);
      u.hasPrev.value = !!prev;
      u.prevMap.value = prev ? prev.texture : null;
      const fe = e as MaskFx;
      u.fxBlend.value = Math.max(0, FX_BLENDS.indexOf(fe.blend ?? 'normal'));
      u.fxOpacity.value = k === 0 ? 1 : Math.max(0, Math.min(1, fe.opacity ?? 1));
      u.outInv.value = last && !!g.outInvert;
      this.gpu.run(this.matGen, target);
      prev = target;
    });
    u.prevMap.value = null;
  }

  private setGenUniforms(g: GenSettings | null) {
    const u = this.matGen.uniforms;
    u.useGen.value = !!g;
    if (!g) return;
    u.type.value = genIndex(g.type);
    u.amount.value = g.amount;
    u.contrast.value = g.contrast;
    u.noiseAmt.value = g.noise;
    u.noiseScale.value = g.noiseScale;
    u.seed.value = Math.max(0, Math.round(g.seed));
    u.axis.value.fromArray(axisVec(g.axis, g.flip));
    u.invert.value = g.invert;
    u.patKind.value = patternIndex(g.pattern ?? 'grunge');
    u.patScale.value = g.scale ?? 3;
    const cols = g.colors ?? [];
    u.idN.value = Math.min(8, cols.length);
    (u.idCols.value as THREE.Vector3[]).forEach((v, k) => v.fromArray(cols[k] ?? [0, 0, 0]));
    u.idTol.value = g.tolerance ?? 0.1;
    if (g.type === 'shape') this.shapeUniforms(g);
    const md = g.micro?.anchor ? this.anchorDetail(g.micro.anchor) : null;
    u.useMicro.value = !!md;
    u.microMap.value = md;
    u.microAmt.value = g.micro?.amount ?? 1;
  }

  // ------------------------------------------------------------ Painter-style generators (PainterGen.ts)

  /** Gives the grunge texture for a `grunge:<category>/<n>` reference, or null while it isn't downloaded (set by the app). */
  grungeResolver: ((ref: string) => THREE.Texture | null) | null = null;
  /** Bump when grunge textures arrive, so masks that use them re-render. */
  grungeVersion = 0;
  private spMats = new Map<SpKind, THREE.ShaderMaterial>();
  private spParams = new Float32Array(SP_MAXP);
  private spPyr: RT[] = [];
  private spPyrKey = '';
  private spTmp: RT[] = [];
  private matSpPack = quadShader(FRAG_SP_PACK, { uMesh: { value: null }, uPos: { value: null } });
  private matSpPack2 = quadShader(FRAG_SP_PACK2, { uSrc: { value: null }, uMesh: { value: null } });
  private matSpBlur = quadShader(FRAG_SP_BLUR, { uSrc: { value: null }, uDir: { value: new THREE.Vector2() } });

  /** Compile every Painter-style generator's shader now (loading screen), so the first smart material doesn't stall. */
  warmupPainter(kinds: SpKind[]) {
    const tiny = makeRT(4, { type: THREE.HalfFloatType });
    for (const k of kinds) this.runPainterGen({ kind: k, p: {} } as SpSettings, null, tiny, 0, 1, false, 0);
    tiny.dispose();
  }
  private spMat(kind: SpKind) {
    let m = this.spMats.get(kind);
    if (!m) {
      m = quadShader(spShader(kind), {
        uPos: { value: null }, uNrm: { value: null }, uMesh: { value: null },
        uL0: { value: null }, uL1: { value: null }, uL2: { value: null }, uL3: { value: null }, uL4: { value: null }, uL5: { value: null },
        uG0: { value: null }, uG1: { value: null }, uGOk0: { value: false }, uGOk1: { value: false }, uGPat0: { value: 0 }, uGPat1: { value: 0 },
        uBmin: { value: new THREE.Vector3() }, uBmax: { value: new THREE.Vector3() }, uSize: { value: 1024 }, uSeed: { value: 0 },
        P: { value: this.spParams }, uStage: { value: 2 }, uSrc: { value: null }, uHasPrev: { value: false }, uPrev: { value: null },
        uFxBlend: { value: 0 }, uFxOp: { value: 1 }, uOutInv: { value: false }, uSelfInv: { value: false }, uShift: { value: 0 },
      });
      this.spMats.set(kind, m);
    }
    return m;
  }

  /** Blur `src` (sigma in texels of `src`) with a separable Gaussian; `tmp` is the same size. */
  private spBlur(src: RT, tmp: RT, out: RT, sigma: number) {
    const u = this.matSpBlur.uniforms;
    const w = src.width;
    // One pass of the 9-tap kernel is sigma ≈ 1.5; spread the taps for a wider blur.
    const step = Math.max(0.5, sigma / 1.5);
    u.uSrc.value = src.texture; (u.uDir.value as THREE.Vector2).set(step / w, 0);
    this.gpu.run(this.matSpBlur, tmp);
    u.uSrc.value = tmp.texture; (u.uDir.value as THREE.Vector2).set(0, step / w);
    this.gpu.run(this.matSpBlur, out);
    u.uSrc.value = null;
  }

  /** The blurred mesh maps (6 levels, each half the size and twice the blur of the one before). */
  private spPyramid(): RT[] {
    const key = `${this.meshVersion}#${this.size}`;
    if (this.spPyrKey === key && this.spPyr.length === 6) return this.spPyr;
    this.spPyr.forEach((r) => r.dispose());
    this.spPyr = [];
    const S = this.size;
    const full = makeRT(S, { type: THREE.HalfFloatType }), full2 = makeRT(S, { type: THREE.HalfFloatType });
    const pu = this.matSpPack.uniforms;
    pu.uMesh.value = this.meshRT.texture; pu.uPos.value = this.posRT.texture;
    this.gpu.run(this.matSpPack, full);
    // Pad the islands outwards first so blurring doesn't pull in the empty background.
    const du = this.matDilate.uniforms;
    du.texel.value.set(1 / S, 1 / S);
    let a = full, b = full2;
    for (const off of [1, 2, 4, 8, 16, 32]) { du.src.value = a.texture; du.off.value = off; this.gpu.run(this.matDilate, b); [a, b] = [b, a]; }
    du.src.value = null;
    const p2 = this.matSpPack2.uniforms;
    p2.uSrc.value = a.texture; p2.uMesh.value = this.meshRT.texture;
    this.gpu.run(this.matSpPack2, b);
    p2.uSrc.value = null;
    let src = b;
    let size = S;
    for (let k = 0; k < 6; k++) {
      const lvl = makeRT(size, { type: THREE.HalfFloatType });
      const tmp = makeRT(size, { type: THREE.HalfFloatType });
      if (src.width !== size) {
        this.matCopy.uniforms.src.value = src.texture;
        this.gpu.run(this.matCopy, lvl);
        this.matCopy.uniforms.src.value = null;
        this.spBlur(lvl, tmp, lvl === tmp ? tmp : lvl, 1.5);
      } else {
        this.spBlur(src, tmp, lvl, 1.5);
      }
      tmp.dispose();
      this.spPyr.push(lvl);
      src = lvl;
      size = Math.max(32, size >> 1);
    }
    full.dispose(); full2.dispose();
    this.spPyrKey = key;
    return this.spPyr;
  }

  private spGrunge(ref: string | undefined): { tex: THREE.Texture | null; pat: number } {
    const r = ref ?? 'grunge:soft';
    const { cat } = parseGrungeRef(r);
    return { tex: this.grungeResolver?.(r) ?? null, pat: patternIndex((GRUNGE_FALLBACK[cat] ?? 'clouds') as PatternType) };
  }

  /** Run one Painter-style generator into `target`, blended over `prev`. */
  private runPainterGen(sp: SpSettings, prev: RT | null, target: RT, blend: number, opacity: number, outInv: boolean, seed: number, selfInv = false, shift = 0) {
    const m = this.spMat(sp.kind);
    const u = m.uniforms;
    const pyr = this.spPyramid();
    spPack(sp, this.spParams);
    u.uPos.value = this.posRT.texture; u.uNrm.value = this.nrmRT.texture; u.uMesh.value = this.meshRT.texture;
    pyr.forEach((r, k) => { u['uL' + k].value = r.texture; });
    const gs = spGrungeParams(sp.kind);
    for (let k = 0; k < 2; k++) {
      // Dirt mixes two built-in grunges; generators with one grunge input use slot 0.
      const ref = gs[k] ? String(sp.p[gs[k].id] ?? gs[k].def)
        : sp.kind === 'dirt' && k === 1 ? 'grunge:soft/SurfaceImperfections015' : sp.kind === 'builder' && k === 1 ? 'grunge:spots/SurfaceImperfections001' : 'grunge:clouds';
      // Built-in grunges when "Use Custom Grunge" is off (CC0 lookalikes of Painter's: spots + grunge map for Dirt, scratches for edge wear).
      const builtin = !sp.p.Use_Custom_Grunge && !sp.p.Grunge_Use_Custom_Grunge && k === 0
        ? sp.kind === 'dirt' ? 'grunge:spots/SurfaceImperfections001' : sp.kind === 'wear' ? 'grunge:scratches/Scratches002' : sp.kind === 'fiberwear' ? 'grunge:scratches/Scratches005' : sp.kind === 'builder' ? 'grunge:soft/SurfaceImperfections016' : null
        : null;
      const gr = this.spGrunge(builtin ?? ref);
      u['uG' + k].value = gr.tex; u['uGOk' + k].value = !!gr.tex; u['uGPat' + k].value = gr.pat;
    }
    u.uBmin.value.copy(this.bboxMin); u.uBmax.value.copy(this.bboxMax);
    u.uSize.value = this.size; u.uSeed.value = Math.max(0, Math.round(seed ?? 0));
    u.uHasPrev.value = !!prev; u.uPrev.value = prev ? prev.texture : null;
    u.uFxBlend.value = blend; u.uFxOp.value = opacity; u.uOutInv.value = outInv; u.uSelfInv.value = selfInv; u.uShift.value = shift;
    const gb = spGlobalBlur(sp);
    if (gb > 0) {
      if (this.spTmp.length !== 2 || this.spTmp[0].width !== this.size) { this.spTmp.forEach((t) => t.dispose()); this.spTmp = [makeRT(this.size, { type: THREE.HalfFloatType }), makeRT(this.size, { type: THREE.HalfFloatType })]; }
      u.uStage.value = 0;
      this.gpu.run(m, this.spTmp[0]);
      this.spBlur(this.spTmp[0], this.spTmp[1], this.spTmp[0], gb * 16 * (this.size / 1024));
      u.uStage.value = 1; u.uSrc.value = this.spTmp[0].texture;
      this.gpu.run(m, target);
      u.uSrc.value = null;
    } else {
      u.uStage.value = 2;
      this.gpu.run(m, target);
    }
    u.uPrev.value = null;
  }

  /** Where a Shape generator sits: its centre, facing and size (defaults to the front of the model). */
  shapeFrame(g: GenSettings) {
    const c = this.bboxMin.clone().add(this.bboxMax).multiplyScalar(0.5);
    const rad = Math.max(1e-4, this.bboxMin.distanceTo(this.bboxMax) * 0.5);
    const at = g.shapeAt ? new THREE.Vector3().fromArray(g.shapeAt) : new THREE.Vector3(c.x, c.y, this.bboxMax.z);
    const n = new THREE.Vector3().fromArray(g.shapeNormal ?? [0, 0, 1]).normalize();
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u0 = new THREE.Vector3().crossVectors(ref, n).normalize();
    const v0 = new THREE.Vector3().crossVectors(n, u0);
    const a = ((g.shapeRot ?? 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const u = u0.clone().multiplyScalar(ca).addScaledVector(v0, sa);
    const v = v0.clone().multiplyScalar(ca).addScaledVector(u0, -sa);
    const half = Math.max(1e-4, (g.shapeSize ?? 0.2) * rad);
    return { at, n, u, v, hx: half * (g.shapeAspect ?? 1), hy: half, rad };
  }

  private shapeUniforms(g: GenSettings) {
    const u = this.matGen.uniforms;
    const f = this.shapeFrame(g);
    u.shpKind.value = Math.max(0, SHAPE_KINDS.indexOf(g.shape ?? 'circle'));
    (u.shpC.value as THREE.Vector3).copy(f.at);
    (u.shpN.value as THREE.Vector3).copy(f.n);
    (u.shpU.value as THREE.Vector3).copy(f.u);
    (u.shpV.value as THREE.Vector3).copy(f.v);
    (u.shpHalf.value as THREE.Vector2).set(f.hx, f.hy);
    u.shpSoft.value = THREE.MathUtils.lerp(0.35, 0.004, THREE.MathUtils.clamp(g.contrast, 0, 1));
    u.shpUV.value = g.shapeProj === 'uv';
    u.shpTile.value = Math.max(1, Math.round(g.shapeTile ?? 1));
    (u.shpOff.value as THREE.Vector2).set(g.shapeOff?.[0] ?? 0, g.shapeOff?.[1] ?? 0);
    const a = ((g.shapeRot ?? 0) * Math.PI) / 180;
    (u.shpRotCS.value as THREE.Vector2).set(Math.cos(a), Math.sin(a));
    const sz = Math.max(0.01, (g.shapeSize ?? 0.2) * 2.5);
    (u.shpScale.value as THREE.Vector2).set(sz * (g.shapeAspect ?? 1), sz);
  }

  // ------------------------------------------------------------ compositing

  compositeDirty() {
    for (let pass = 0; pass < 2; pass++) {
      for (const l of this.allLayers) {
        if (l.mask?.dirty) { this.updateMask(l); this.markDirty(); }
      }
      if (this.dirty.size) {
        for (const ch of this.dirty) this.composite(ch);
        if (this.dirty.has('height') || this.dirty.has('normal')) this.normalDirty = true;
        this.dirty.clear();
      }
      // Anchors changed: masks whose generators use them as micro details update once more.
      if (!this.anchorChanged || pass === 1) break;
      this.anchorChanged = false;
      let any = false;
      for (const l of this.allLayers) if (l.mask?.gen && usesMicro(l.mask.gen)) { l.mask.dirty = true; any = true; }
      if (!any) break;
    }
    this.anchorChanged = false;
    if (this.normalDirty) this.updateNormal();
  }

  setHeightStrength(v: number) {
    this.heightStrength = v;
    this.normalDirty = true;
  }

  private updateNormal() {
    const u = this.matNmap.uniforms;
    u.heightTex.value = this.final.height.texture;
    u.normalTex.value = this.final.normal.texture;
    u.bakedTex.value = this.bakedNRT.texture;
    u.texel.value.set(1 / this.size, 1 / this.size);
    u.strength.value = this.heightStrength * (this.size / 1024);
    this.gpu.run(this.matNmap, this.finalN);
    this.normalDirty = false;
  }

  /** Scratch ping-pong pairs for folders, one pair per nesting depth. */
  private pool: [RT, RT][] = [];
  private pair(depth: number): [RT, RT] {
    if (depth === 0) return [this.compA, this.compB];
    while (this.pool.length < depth) this.pool.push([makeRT(this.size, { type: THREE.HalfFloatType }), makeRT(this.size, { type: THREE.HalfFloatType })]);
    return this.pool[depth - 1];
  }

  private composite(ch: Ch) {
    this.matInit.uniforms.posMap.value = this.posRT.texture;
    this.matInit.uniforms.value.value.fromArray(CH_DEFAULT[ch]);
    this.gpu.run(this.matInit, this.compA);
    const out = this.compList(this.layers, ch, this.compA, 0);
    // Seam padding into the display texture.
    this.dilateFrom(out, out === this.compA ? this.compB : this.compA, this.final[ch]);
  }

  // ------------------------------------------------------------ anchor points (micro details)

  private anchorH = new Map<number, RT>();
  private anchorD = new Map<number, RT>();
  /** Bumped whenever an anchor's height changes, so generators that use it re-render. */
  anchorVersion = 0;
  private anchorChanged = false;
  private matMicro = quadShader(FRAG_MICRO, { heightTex: { value: null }, texel: { value: new THREE.Vector2() }, gain: { value: 30 } });
  /** Keep the height composited up to an anchored layer, and its detail map (rims and cavities). */
  private snapAnchor(l: Layer, rt: RT) {
    let h = this.anchorH.get(l.id), d = this.anchorD.get(l.id);
    if (!h || h.width !== this.size) { h?.dispose(); h = makeRT(this.size, { type: THREE.HalfFloatType }); this.anchorH.set(l.id, h); }
    if (!d || d.width !== this.size) { d?.dispose(); d = makeRT(this.size); this.anchorD.set(l.id, d); }
    this.matCopy.uniforms.src.value = rt.texture;
    this.gpu.run(this.matCopy, h);
    this.matCopy.uniforms.src.value = null;
    const u = this.matMicro.uniforms;
    u.heightTex.value = h.texture;
    (u.texel.value as THREE.Vector2).set(1 / this.size, 1 / this.size);
    this.gpu.run(this.matMicro, d);
    u.heightTex.value = null;
    this.anchorVersion++;
    this.anchorChanged = true;
  }
  /** Anchored layers anywhere in the stack (bottom → top). */
  get anchors(): Layer[] { return this.allLayers.filter((l) => l.anchor); }
  /** The detail map of an anchor, by layer name (what generators store). */
  anchorDetail(name: string): THREE.Texture | null {
    const l = this.allLayers.find((x) => x.anchor && x.name === name);
    return l ? this.anchorD.get(l.id)?.texture ?? null : null;
  }

  /** Composite a list of layers on top of `start` (which belongs to this depth's pair). */
  private compList(list: Layer[], ch: Ch, start: RT, depth: number): RT {
    const g = this.gpu;
    const [pa, pb] = this.pair(depth);
    let src = start, dst = start === pa ? pb : pa;
    for (const l of list) {
      layer: {
      if (!l.visible || l.opacity <= 0) break layer;
      if (l.kind === 'fill' && !l.enabled[ch]) break layer;
      if (l.kind === 'fill' && ch === 'normal' && !l.images?.normal) break layer;
      let groupResult: RT | null = null;
      if (l.kind === 'group') {
        if (!l.children.length) break layer;
        // Children paint onto a copy of what's below, then the folder blends that in with its mask.
        const [ga] = this.pair(depth + 1);
        this.matCopy.uniforms.src.value = src.texture;
        g.run(this.matCopy, ga);
        groupResult = this.compList(l.children, ch, ga, depth + 1);
      }
      const u = this.matLayer.uniforms;
      u.prev.value = src.texture;
      u.opacity.value = l.opacity;
      u.isFill.value = l.kind === 'fill';
      u.useTex.value = false;
      u.texFlipG.value = false;
      u.blend.value = BLEND_INDEX[l.blend] ?? 0;
      u.isNormal.value = ch === 'normal';
      u.hasMask.value = !!l.mask && !l.mask.off;
      u.maskInv.value = !!l.mask?.inv;
      u.isolate.value = false;
      // Unbind unused samplers: a stale binding to a target we're drawing into is a feedback loop.
      u.maskTex.value = l.mask && !l.mask.off ? l.mask.rt.texture : null;
      u.layerTex.value = null;
      u.fillTex.value = null;
      u.triplanar.value = false;
      u.planar.value = false;
      u.useAlphaTex.value = false; u.alphaTex.value = null; u.texAlpha.value = false;
      u.adjMode.value = 0;
      u.rotCS.value.set(1, 0);
      u.uvOff.value.set(0, 0);
      if (l.kind === 'fill') {
        const img = l.images?.[ch];
        // Projection and transparency apply to every channel of the layer, image or plain value.
        const lxf = l.xf ? { ...DEFAULT_XF, ...l.xf } : DEFAULT_XF;
        const cimg = l.images?.color;
        if (cimg || img) {
          const r0 = (lxf.rot * Math.PI) / 180;
          u.rotCS.value.set(Math.cos(r0), Math.sin(r0));
          u.uvOff.value.set(lxf.offU, lxf.offV);
          u.tiling.value = l.tiling;
          u.triplanar.value = lxf.proj === 'tri';
          u.triSharp.value = lxf.sharp;
          u.posMap.value = this.posRT.texture; u.nrmMap.value = this.nrmRT.texture;
          u.tanMap.value = this.tanRT.texture; u.bitMap.value = this.bitRT.texture;
        }
        if (lxf.proj === 'planar' && (cimg || img)) {
          const f = this.shapeFrame(lxf as unknown as GenSettings);
          u.planar.value = true;
          u.pjC.value.copy(f.at); u.pjU.value.copy(f.u); u.pjV.value.copy(f.v); u.pjN.value.copy(f.n);
          u.pjH.value.set(f.hx, f.hy);
          u.pjTile.value = !!lxf.tile; u.pjBack.value = lxf.hideBack !== false;
        }
        if (cimg && lxf.useAlpha !== false && ch !== 'color') { u.useAlphaTex.value = true; u.alphaTex.value = cimg.tex; }
        if (ch === 'color' && img && lxf.useAlpha !== false) u.texAlpha.value = true;
        const pr = !img && ch !== 'normal' ? l.procs?.[ch] : undefined;
        if (pr) {
          u.useTex.value = true;
          u.fillTex.value = this.procTexture(pr);
          u.texGray.value = false;
          u.tiling.value = 1;
          u.adjMode.value = 6;
          (u.adjA.value as THREE.Vector4).set(pr.low[0], pr.low[1], pr.low[2], 0);
          u.adjTint.value.fromArray(COLOR_CHANNELS.includes(ch) ? pr.high : [pr.high[0], pr.high[0], pr.high[0]]);
          if (!COLOR_CHANNELS.includes(ch)) (u.adjA.value as THREE.Vector4).set(pr.low[0], pr.low[0], pr.low[0], 0);
        } else if (img) {
          u.useTex.value = true;
          u.fillTex.value = img.tex;
          u.texGray.value = !COLOR_CHANNELS.includes(ch);
          u.texFlipG.value = !!img.flipG;
          u.tiling.value = l.tiling;
          const xf = l.xf ? { ...DEFAULT_XF, ...l.xf } : DEFAULT_XF, a = l.adj ? { ...DEFAULT_ADJ, ...l.adj } : DEFAULT_ADJ;
          const r = (xf.rot * Math.PI) / 180;
          u.rotCS.value.set(Math.cos(r), Math.sin(r));
          u.uvOff.value.set(xf.offU, xf.offV);
          u.triplanar.value = xf.proj === 'tri';
          u.triSharp.value = xf.sharp;
          u.posMap.value = this.posRT.texture; u.nrmMap.value = this.nrmRT.texture;
          u.tanMap.value = this.tanRT.texture; u.bitMap.value = this.bitRT.texture;
          const A = u.adjA.value as THREE.Vector4;
          u.adjMode.value = 0;
          if (ch === 'color') { u.adjMode.value = 1; A.set(a.hue, a.sat, a.bright, a.contrast); u.adjTint.value.fromArray(a.tint); }
          else if (ch === 'rough') { u.adjMode.value = 2; A.set(a.roughMin, a.roughMax, a.roughInv ? 1 : 0, 0); }
          else if (ch === 'metal') { u.adjMode.value = 2; A.set(a.metalMin, a.metalMax, 0, 0); }
          else if (ch === 'height') { u.adjMode.value = 3; A.set(a.heightScale, a.heightOff, 0, 0); }
          else if (ch === 'normal') { u.adjMode.value = 4; A.set(a.normalStr, 0, 0, 0); }
          else if (ch === 'emit') { u.adjMode.value = 5; A.set(a.emitInt, 0, 0, 0); }
        } else u.fillValue.value.fromArray(chValue(l.values, ch));
      } else if (l.kind === 'paint') u.layerTex.value = l.rts[ch].texture;
      else u.layerTex.value = groupResult!.texture;
      const fxs = l.kind !== 'group' ? activeFx(l.fx).filter((f) => fxOnChannel(f, ch)) : [];
      if (this.alone && this.alone.id === l.id) { this.renderAloneHere(l, ch, fxs); break layer; }
      if (fxs.length) {
        const res = this.runContentFx(fxs, ch);
        u.layerTex.value = res.texture;
      }
      g.run(this.matLayer, dst);
      u.layerTex.value = null;
      [src, dst] = [dst, src];
      }
      if (ch === 'height' && l.anchor && !this.isolating) this.snapAnchor(l, src);
    }
    return src;
  }

  // ------------------------------------------------------------ content effects (filters, generators, levels, fills)

  private fxRT: RT[] = [];
  private fxGen = new Map<number, { rt: RT; key: string }>();
  private matFx = quadShader(FRAG_LAYERFX, {
    src: { value: null }, genTex: { value: null }, maskTex: { value: null }, hasMask: { value: false }, maskInv: { value: false },
    op: { value: 0 }, p: { value: new THREE.Vector4() }, p2: { value: new THREE.Vector4() }, col: { value: new THREE.Vector3(1, 1, 1) },
    val: { value: 0.5 }, blend: { value: 0 }, opacity: { value: 1 }, isColor: { value: false }, texel: { value: new THREE.Vector2() },
  });
  private ensureFxRT() {
    if (this.fxRT.length === 2 && this.fxRT[0].width === this.size) return;
    this.fxRT.forEach((r) => r.dispose());
    this.fxRT = [makeRT(this.size, { type: THREE.HalfFloatType }), makeRT(this.size, { type: THREE.HalfFloatType })];
  }
  /** A content generator's grey output (cached until its settings or the mesh maps change). */
  private fxGenTex(f: LayerFx): THREE.Texture | null {
    const g = f.gen;
    if (!g) return null;
    const js = JSON.stringify(g);
    const key = `${js}#${this.meshVersion}#${this.size}${usesMicro(g) ? '#a' + this.anchorVersion : ''}${js.includes('"sp"') ? '#g' + this.grungeVersion : ''}`;
    let c = this.fxGen.get(f.id);
    if (!c || c.rt.width !== this.size) { c?.rt.dispose(); c = { rt: makeRT(this.size), key: '' }; this.fxGen.set(f.id, c); }
    if (c.key !== key) { this.renderGenStack({ base: 'black' } as LayerMask, g, c.rt); c.key = key; }
    return c.rt.texture;
  }
  /**
   * Runs with matLayer's uniforms already set for the layer: draws just its content, then each effect on top.
   * Leaves matLayer ready to composite the result as a plain texture.
   */
  private runContentFx(fxs: LayerFx[], ch: Ch): RT {
    this.ensureFxRT();
    const u = this.matLayer.uniforms;
    u.isolate.value = true;
    this.gpu.run(this.matLayer, this.fxRT[0]);
    u.isolate.value = false;
    u.isFill.value = false;
    let cur = 0;
    const f = this.matFx.uniforms;
    (f.texel.value as THREE.Vector2).set(1 / this.size, 1 / this.size);
    f.isColor.value = ch === 'color' || ch === 'emit';
    f.hasMask.value = false; f.maskTex.value = null;
    for (const e of fxs) {
      f.genTex.value = e.kind === 'generator' ? this.fxGenTex(e) : null;
      const P = f.p.value as THREE.Vector4, P2 = f.p2.value as THREE.Vector4;
      P.set(0, 0, 0, 0); P2.set(0, 0, 0, 0);
      (f.col.value as THREE.Vector3).fromArray(e.color ?? [1, 1, 1]);
      f.val.value = e.value ?? 0.5;
      if (e.kind === 'filter' && e.filter) {
        f.op.value = filterIndex(e.filter);
        const q = e.p ?? [];
        P.set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 0);
        if (e.filter === 'blur') P.x *= this.size / 1024;
      } else if (e.kind === 'generator') f.op.value = 20;
      else if (e.kind === 'levels') { const v = e.lv ?? [0, 1, 1, 0, 1]; f.op.value = 21; P.set(v[0], v[1], v[2], v[3]); P2.set(v[4], 0, 0, 0); }
      else f.op.value = 22;
      f.blend.value = Math.max(0, FX_BLENDS.indexOf(e.blend ?? 'normal'));
      f.opacity.value = Math.max(0, Math.min(1, e.opacity));
      f.src.value = this.fxRT[cur].texture;
      this.gpu.run(this.matFx, this.fxRT[1 - cur]);
      cur = 1 - cur;
    }
    f.src.value = null; f.genTex.value = null;
    return this.fxRT[cur];
  }

  // ------------------------------------------------------------ one layer alone (flatten, export channels)

  private alone: { id: number; out: RT } | null = null;
  /** Rendering a layer on its own: anchors must not pick up these partial stacks. */
  private isolating = false;
  private renderAloneHere(l: Layer, ch: Ch, fxs: LayerFx[]) {
    let res: RT;
    if (fxs.length) res = this.runContentFx(fxs, ch);
    else {
      this.ensureFxRT();
      const u = this.matLayer.uniforms;
      u.isolate.value = true;
      this.gpu.run(this.matLayer, this.fxRT[0]);
      u.isolate.value = false;
      res = this.fxRT[0];
    }
    this.finishAlone(l, res, this.alone!.out, 99);
  }
  /** op 99: content × opacity × mask; op 98: un-mix a folder rendered over black (src) and white (gen). */
  private finishAlone(l: Layer, src: RT, out: RT, op: 98 | 99, white?: RT) {
    const f = this.matFx.uniforms;
    f.op.value = op;
    f.src.value = src.texture;
    f.genTex.value = white ? white.texture : null;
    f.opacity.value = l.opacity;
    const m = l.mask && !l.mask.off ? l.mask : null;
    f.hasMask.value = !!m; f.maskTex.value = m ? m.rt.texture : null; f.maskInv.value = !!m?.inv;
    this.gpu.run(this.matFx, out);
    f.src.value = null; f.genTex.value = null; f.maskTex.value = null; f.hasMask.value = false;
  }
  /** Render what one layer (or folder) paints on a channel, as straight RGBA with its opacity and mask, into `out`. */
  private renderAlone(l: Layer, ch: Ch, out: RT) {
    this.compositeDirty();
    this.isolating = true;
    try { this.renderAloneInner(l, ch, out); } finally { this.isolating = false; }
  }
  private renderAloneInner(l: Layer, ch: Ch, out: RT) {
    this.gpu.clear(out);
    if (!l.visible) return;
    const [a0] = this.pair(1);
    const init = (v: number) => {
      this.matInit.uniforms.posMap.value = this.posRT.texture;
      this.matInit.uniforms.value.value.set(v, v, v);
      this.gpu.run(this.matInit, a0);
    };
    if (l.kind !== 'group') {
      init(0);
      this.alone = { id: l.id, out };
      try { this.compList([l], ch, a0, 1); } finally { this.alone = null; }
      return;
    }
    if (!l.children.length) return;
    // Children's effects use fxRT, so the over-black result is kept in its own target.
    const keep = makeRT(this.size, { type: THREE.HalfFloatType });
    try {
      init(0);
      const b = this.compList(l.children, ch, a0, 1);
      this.matCopy.uniforms.src.value = b.texture;
      this.gpu.run(this.matCopy, keep);
      this.matCopy.uniforms.src.value = null;
      init(1);
      const w = this.compList(l.children, ch, a0, 1);
      this.finishAlone(l, keep, out, 98, w);
    } finally { keep.dispose(); }
  }
  /** RGBA8 pixels (rows bottom-up) of what a layer paints on one channel. */
  layerChannelPixels(l: Layer, ch: Ch): Uint8Array {
    const rt = makeRT(this.size);
    try { this.renderAlone(l, ch, rt); return this.readRT(rt); } finally { rt.dispose(); }
  }
  /** The computed mask (generators + paint), RGBA8 rows bottom-up. */
  maskPixels(l: Layer): Uint8Array | null {
    if (!l.mask) return null;
    this.compositeDirty();
    if (l.mask.dirty) this.updateMask(l);
    return this.readRT(l.mask.rt);
  }
  /**
   * Substance's "Flatten layer": bake a layer (with its effects, mask and opacity) or a whole folder into one paint
   * layer that looks the same. Returns the new layer.
   */
  flattenLayer(l: Layer): PaintLayer | null {
    const w = this.where(l.id);
    if (!w) return null;
    this.activeId = l.id;
    const pl = this.addPaintLayer(l.name, true, undefined);
    pl.blend = l.kind === 'group' ? 'normal' : l.blend;
    pl.anchor = l.anchor; pl.tag = l.tag;
    for (const ch of CHANNELS) this.renderAlone(l, ch, pl.rts[ch]);
    this.removeLayer(l.id);
    this.activeId = pl.id;
    this.markAll();
    return pl;
  }

  // ------------------------------------------------------------ polygon fill

  /**
   * Fill whole triangles (a mesh part, UV island…) as one undoable stroke:
   * into the active paint layer's channels, or into its mask.
   */
  polyFill(brush: Brush, target: PaintTarget, parts: { geo: number; tris: ArrayLike<number> }[]): boolean {
    if (!this.beginStroke({ ...brush, flow: 1 }, target)) return false;
    const scene = new THREE.Scene();
    const wire = this.bakeMat.clone(); wire.wireframe = true; wire.uniforms.mode.value = 2;
    const solid = this.bakeMat.clone(); solid.uniforms.mode.value = 2;
    const temp: THREE.BufferGeometry[] = [];
    for (const p of parts) {
      const src = this.geometries[p.geo];
      if (!src) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position);
      g.setAttribute('normal', src.attributes.normal);
      g.setAttribute('uv', src.attributes.uv);
      const idx = new Uint32Array(p.tris.length * 3);
      const si = src.index;
      for (let i = 0; i < p.tris.length; i++) {
        const t = p.tris[i];
        for (let k = 0; k < 3; k++) idx[i * 3 + k] = si ? si.getX(t * 3 + k) : t * 3 + k;
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      temp.push(g);
      const mw = new THREE.Mesh(g, wire); mw.frustumCulled = false;
      const ms = new THREE.Mesh(g, solid); ms.frustumCulled = false;
      scene.add(mw, ms);
    }
    this.gpu.renderScene(scene, this.strokeRT, false);
    temp.forEach((g) => { for (const k of Object.keys(g.attributes)) g.deleteAttribute(k); g.dispose(); });
    wire.dispose(); solid.dispose();
    this.stroke!.pending = true;
    this.endStroke();
    return true;
  }

  /** Dilate `src` into `out`, using the scratch buffers. `src` may be compA or compB. */
  private dilateFrom(src: RT, spare: RT, out: RT) {
    const du = this.matDilate.uniforms;
    du.texel.value.set(1 / this.size, 1 / this.size);
    let a = src, b = spare;
    for (const off of [1, 2, 4]) {
      du.src.value = a.texture; du.off.value = off;
      this.gpu.run(this.matDilate, b);
      [a, b] = [b, a];
    }
    du.src.value = a.texture; du.off.value = 8;
    this.gpu.run(this.matDilate, out);
  }

  private dilate(src: RT, out: RT) {
    this.dilateFrom(src, src === this.compA ? this.compB : this.compA, out);
  }

  // ------------------------------------------------------------ painting

  private targetRT(layer: Layer, key: StrokeKey): RT {
    return key === 'mask' ? layer.mask!.paintRT : (layer as PaintLayer).rts[key];
  }
  private setTargetRT(layer: Layer, key: StrokeKey, rt: RT) {
    if (key === 'mask') layer.mask!.paintRT = rt;
    else (layer as PaintLayer).rts[key] = rt;
  }

  /** Returns false if the active layer can't be painted with this target. */
  beginStroke(brush: Brush, target: PaintTarget = 'content'): boolean {
    const layer = this.activeLayer;
    if (!layer) return false;
    let keys: StrokeKey[];
    if (target === 'mask') {
      if (!layer.mask) return false;
      keys = ['mask'];
    } else {
      if (layer.kind !== 'paint') return false;
      keys = PAINT_CHANNELS.filter((c) => brush.channels[c]);
      if (!keys.length) return false;
    }
    const entry: StrokeEntry = {
      kind: 'stroke', label: target === 'mask' ? 'Mask paint' : brush.erase ? 'Erase' : 'Paint',
      layer, mask: target === 'mask' ? layer.mask : undefined, rts: {},
    };
    for (const k of keys) {
      const snap = makeRT(this.size);
      this.matCopy.uniforms.src.value = this.targetRT(layer, k).texture;
      this.gpu.run(this.matCopy, snap);
      entry.rts[k] = snap;
    }
    this.gpu.clear(this.strokeRT);
    const values = { ...brush.values };
    // Colour variation: every stroke gets a slightly different colour.
    if (brush.hueJitter || brush.satJitter || brush.valJitter) {
      const c = new THREE.Color(...values.color), hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      const r = () => Math.random() * 2 - 1;
      hsl.h = (((hsl.h + r() * 0.5 * (brush.hueJitter ?? 0)) % 1) + 1) % 1;
      hsl.s = Math.min(1, Math.max(0, hsl.s + r() * (brush.satJitter ?? 0)));
      hsl.l = Math.min(1, Math.max(0, hsl.l + r() * 0.5 * (brush.valJitter ?? 0)));
      c.setHSL(hsl.h, hsl.s, hsl.l);
      values.color = [c.r, c.g, c.b];
    }
    this.stroke = { layer, entry, brush: { ...brush, values }, target, pending: false };
    return true;
  }

  get painting() { return !!this.stroke; }

  /** Pen pressure of the next stamps (0..1, the app sets it from pointer events). */
  pressure = 1;
  private pSize(b: Brush) { return b.pressureSize ? 0.08 + 0.92 * this.pressure : 1; }
  private pFlow(b: Brush) { return b.pressureFlow ? Math.max(0.02, this.pressure) : 1; }

  /** Tip shape + rotation for the next stamp; returns the rotation angle (radians). */
  private tipSetup(b: Brush, dirAngle: number | null): number {
    const u = this.matStamp.uniforms;
    const tip = b.tip ?? 'round';
    const tex = tip !== 'round' && tip !== 'square' ? this.tips.get(tip) : undefined;
    u.shape.value = tip === 'square' ? 1 : tex ? 2 : 0;
    u.tipTex.value = tex ?? null;
    let a = ((b.angle ?? 0) * Math.PI) / 180;
    if (b.followStroke && dirAngle !== null) a += dirAngle;
    if (b.angleJitter) a += (Math.random() * 2 - 1) * Math.PI * b.angleJitter;
    return a;
  }

  private jitterRadius(b: Brush, r: number) { return b.sizeJitter ? r * (1 - b.sizeJitter * Math.random() * 0.9) : r; }

  /** The point the mirror planes go through (model centre + the brush's offsets). */
  symmetryCenter(b: Brush): THREE.Vector3 {
    const c = this.bboxMin.clone().add(this.bboxMax).multiplyScalar(0.5);
    const half = this.bboxMax.clone().sub(this.bboxMin).multiplyScalar(0.5);
    const o = b.symOffset;
    if (o) { c.x += o.x * half.x; c.y += o.y * half.y; c.z += o.z * half.z; }
    return c;
  }

  /** Where a mirror plane cuts the model: line segments (pairs of points), lifted off the surface a little. */
  mirrorLines(axis: 'x' | 'y' | 'z', at: number): Float32Array {
    const out: number[] = [];
    const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const lift = this.bboxMin.distanceTo(this.bboxMax) * 0.0015;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (const g of this.geometries) {
      const pos = g.attributes.position, idx = g.index;
      const tris = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        const da = a.getComponent(k) - at, db = b.getComponent(k) - at, dc = c.getComponent(k) - at;
        if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize().multiplyScalar(lift);
        const pts: THREE.Vector3[] = [];
        const edge = (p: THREE.Vector3, q: THREE.Vector3, dp: number, dq: number) => {
          if ((dp > 0) === (dq > 0) || dp === dq) return;
          pts.push(p.clone().lerp(q, dp / (dp - dq)).add(n));
        };
        edge(a, b, da, db); edge(b, c, db, dc); edge(c, a, dc, da);
        if (pts.length >= 2) out.push(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z);
      }
    }
    return new Float32Array(out);
  }

  /** Stamp at a surface point (model space), plus its mirror images when symmetry is on. */
  stamp(point: THREE.Vector3, normal: THREE.Vector3, uv?: THREE.Vector2) {
    const st = this.stroke;
    if (!st) return;
    this.stampUVHint = uv ?? null;
    const sym = st.brush.symmetry;
    const axes = sym ? (['x', 'y', 'z'] as const).filter((a) => sym[a]) : [];
    // Smudge / clone / blur work on what's under the brush; mirrored copies are painting only.
    if (!axes.length || (st.brush.tool ?? 'paint') !== 'paint') { this.stampOne(point, normal, 0); return; }
    const c = this.symmetryCenter(st.brush);
    for (let m = 0; m < 1 << axes.length; m++) {
      const p = point.clone(), n = normal.clone();
      axes.forEach((a, i) => { if (m & (1 << i)) { p[a] = 2 * c[a] - p[a]; n[a] = -n[a]; } });
      this.stampOne(p, n, m);
    }
  }

  private stampOne(point: THREE.Vector3, normal: THREE.Vector3, copy: number) {
    const st = this.stroke!;
    const b = st.brush;
    const mem = (st.copies ??= []);
    const cm = (mem[copy] ??= {});
    st.last3 = cm.last3; st.dir3 = cm.dir3;
    const u = this.matStamp.uniforms;
    u.posMap.value = this.posRT.texture;
    u.nrmMap.value = this.nrmRT.texture;
    const n = normal.clone().normalize();
    // Tangent frame on the surface: along the stroke if it moved, else a fixed world-up reference.
    const ref = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t0 = new THREE.Vector3().crossVectors(ref, n).normalize();
    const b0 = new THREE.Vector3().crossVectors(n, t0);
    let dirAngle: number | null = null;
    if (st.last3) {
      const d = point.clone().sub(st.last3);
      const dx = d.dot(t0), dy = d.dot(b0);
      if (dx * dx + dy * dy > 1e-12) dirAngle = Math.atan2(dy, dx);
    }
    if (dirAngle !== null) st.dir3 = dirAngle; else dirAngle = st.dir3 ?? null;
    st.last3 = point.clone();
    const a = this.tipSetup(b, dirAngle);
    const ca = Math.cos(a), sa = Math.sin(a);
    const tu = t0.clone().multiplyScalar(ca).addScaledVector(b0, sa);
    const tv = new THREE.Vector3().crossVectors(n, tu);
    const r = this.jitterRadius(b, b.radius * this.pSize(b));
    const c = point.clone();
    if (b.scatter) c.addScaledVector(tu, (Math.random() * 2 - 1) * b.scatter * r).addScaledVector(tv, (Math.random() * 2 - 1) * b.scatter * r);
    u.center.value.copy(c);
    u.bnormal.value.copy(n);
    u.tanU.value.copy(tu);
    u.tanV.value.copy(tv);
    u.radius.value = r;
    u.hardness.value = b.hardness;
    u.uvMode.value = false;
    const cullDeg = b.cullAngle ?? 90;
    u.viewPos.value.copy(this.viewPos);
    u.cullCos.value = cullDeg >= 179.5 ? -2 : Math.cos((cullDeg * Math.PI) / 180);
    u.stampFlow.value = Math.max(0.005, Math.min(1, b.flow * this.pFlow(b) * (b.flowJitter ? 1 - b.flowJitter * Math.random() : 1)));
    if ((b.tool ?? 'paint') !== 'paint') this.toolStamp(this.stampUVHint, 0, r);
    else this.gpu.run(this.matStamp, this.strokeRT);
    u.tipTex.value = null;
    cm.last3 = st.last3; cm.dir3 = st.dir3;
    st.pending = true;
  }

  private stampUVHint: THREE.Vector2 | null = null;
  /** Camera position in model space (the app sets it), for backface culling. */
  viewPos = new THREE.Vector3(0, 0, 10);

  /** Smudge / clone / blur one stamp: its footprint goes to its own mask, then the layer is blended towards the source. */
  private toolStamp(uv: THREE.Vector2 | null, radiusUV: number, radiusWorld: number) {
    const st = this.stroke!;
    const tool = st.brush.tool!;
    const delta = new THREE.Vector2();
    const rUV = radiusUV > 0 ? radiusUV : radiusWorld * this.uvPerWorld;
    let firstPick = false;
    if (tool === 'smudge') {
      // The brush picks paint up and carries it along the stroke.
      const prev = st.lastUV;
      st.lastUV = uv?.clone();
      if (!uv) return;
      firstPick = !prev || prev.distanceTo(uv) > Math.max(0.08, rUV * 4); // stroke start, or jumped to another UV island
    } else if (tool === 'clone') {
      if (!uv || !this.cloneSource) return;
      this.cloneOffset ??= new THREE.Vector2().subVectors(this.cloneSource, uv);
      delta.copy(this.cloneOffset);
    }
    if (this.toolMaskRT && this.toolMaskRT.width !== this.size) { this.toolMaskRT.dispose(); this.toolTmpRT?.dispose(); this.toolMaskRT = this.toolTmpRT = null; }
    this.toolMaskRT ??= makeRT(this.size);
    this.toolTmpRT ??= makeRT(this.size);
    this.gpu.clear(this.toolMaskRT);
    this.gpu.run(this.matStamp, this.toolMaskRT);
    const t = this.matTool.uniforms;
    t.mask.value = this.toolMaskRT.texture; t.posMap.value = this.posRT.texture;
    t.mode.value = tool === 'smudge' ? 1 : tool === 'clone' ? 2 : 3;
    t.delta.value.copy(delta);
    t.blurUV.value = radiusUV > 0 ? radiusUV * 0.35 : 0;
    t.blurWorld.value = radiusWorld * 0.35;
    t.texel.value.set(1 / this.size, 1 / this.size);
    t.centerUV.value.copy(uv ?? new THREE.Vector2()); t.rUV.value = Math.max(1e-4, rUV);
    const pk = this.matPickup.uniforms;
    pk.posMap.value = this.posRT.texture; pk.centerUV.value.copy(uv ?? new THREE.Vector2()); pk.rUV.value = Math.max(1e-4, rUV);
    // Flow sets how far the paint is carried (higher = longer smears).
    // Like a finger in wet paint: the brush lays down part of what it carries and keeps picking up more.
    // Flow sets the strength (higher = longer, stronger smears).
    const fl = Math.min(1, Math.max(0, st.brush.flow));
    pk.keep.value = 0.55 + 0.33 * fl;
    t.depth.value = 0.15 + 0.4 * fl;
    for (const k of Object.keys(st.entry.rts) as StrokeKey[]) {
      const target = this.targetRT(st.layer, k);
      this.matCopy.uniforms.src.value = target.texture;
      this.gpu.run(this.matCopy, this.toolTmpRT);
      this.matCopy.uniforms.src.value = null;
      t.cur.value = this.toolTmpRT.texture; t.snap.value = st.entry.rts[k]!.texture;
      if (tool === 'smudge') {
        let pair = this.carry.get(k);
        if (!pair) { pair = [makeRT(128), makeRT(128)]; this.carry.set(k, pair); }
        if (!firstPick) { t.carry.value = pair[0].texture; this.gpu.run(this.matTool, target); }
        // Pick up from the layer as it is now (after laying paint down).
        this.matCopy.uniforms.src.value = target.texture;
        this.gpu.run(this.matCopy, this.toolTmpRT);
        this.matCopy.uniforms.src.value = null;
        pk.cur.value = this.toolTmpRT.texture; pk.carry.value = pair[0].texture; pk.first.value = firstPick;
        this.gpu.run(this.matPickup, pair[1]);
        pk.cur.value = pk.carry.value = null;
        this.carry.set(k, [pair[1], pair[0]]);
        t.carry.value = null;
      } else this.gpu.run(this.matTool, target);
      if (k === 'mask') { const m = st.entry.mask ?? st.layer.mask!; m.painted = true; m.dirty = true; this.markDirty(); }
      else this.dirty.add(k);
    }
    t.cur.value = t.snap.value = t.mask.value = null;
  }

  /** Stamp the brush tip in UV space (painting in the 2D view). */
  stampUV(uv: THREE.Vector2, radiusUV: number) {
    const st = this.stroke;
    if (!st) return;
    const b = st.brush;
    const u = this.matStamp.uniforms;
    let dirAngle: number | null = null;
    if (st.last2) {
      const dx = uv.x - st.last2.x, dy = uv.y - st.last2.y;
      if (dx * dx + dy * dy > 1e-14) dirAngle = Math.atan2(dy, dx);
    }
    if (dirAngle !== null) st.dir2 = dirAngle; else dirAngle = st.dir2 ?? null;
    st.last2 = uv.clone();
    const a = this.tipSetup(b, dirAngle);
    const r = this.jitterRadius(b, radiusUV * this.pSize(b));
    const c = uv.clone();
    if (b.scatter) c.add(new THREE.Vector2((Math.random() * 2 - 1) * b.scatter * r, (Math.random() * 2 - 1) * b.scatter * r));
    u.uvMode.value = true;
    u.centerUV.value.copy(c);
    u.radiusUV.value = r;
    u.rotCS.value.set(Math.cos(a), Math.sin(a));
    u.hardness.value = b.hardness;
    u.stampFlow.value = Math.max(0.005, Math.min(1, b.flow * this.pFlow(b) * (b.flowJitter ? 1 - b.flowJitter * Math.random() : 1)));
    if ((b.tool ?? 'paint') !== 'paint') this.toolStamp(c, r, 0);
    else this.gpu.run(this.matStamp, this.strokeRT);
    u.uvMode.value = false;
    u.tipTex.value = null;
    st.pending = true;
  }

  /** Write the accumulated stroke into the layer (call once per frame). */
  flushStroke() {
    const st = this.stroke;
    if (!st || !st.pending) return;
    if ((st.brush.tool ?? 'paint') !== 'paint') { st.pending = false; return; }
    const u = this.matApply.uniforms;
    u.mask.value = this.strokeRT.texture;
    u.flow.value = st.brush.opacity ?? 1;
    for (const k of Object.keys(st.entry.rts) as StrokeKey[]) {
      u.snap.value = st.entry.rts[k]!.texture;
      if (k === 'mask') {
        // Mask painting: brush paints white, eraser paints black.
        u.erase.value = false;
        const v = st.brush.erase ? 0 : 1;
        u.value.value.set(v, v, v);
        const m = st.entry.mask ?? st.layer.mask!;
        this.gpu.run(this.matApply, m.paintRT);
        m.painted = true;
        m.dirty = true;
        this.markDirty();
      } else {
        u.erase.value = st.brush.erase;
        u.value.value.fromArray(chValue(st.brush.values, k));
        this.gpu.run(this.matApply, (st.layer as PaintLayer).rts[k]);
        this.dirty.add(k);
      }
    }
    st.pending = false;
  }

  /** Live path: throw away the stamps so far (the layer goes back to how it was), keep the stroke open. */
  restartStroke() {
    const st = this.stroke;
    if (!st) return;
    this.gpu.clear(this.strokeRT);
    st.copies = []; st.last3 = undefined; st.dir3 = undefined; st.last2 = undefined; st.dir2 = undefined;
    st.pending = true; // the next flush rewrites the layer from its snapshot
  }

  /** Abandon the open stroke: restore the layer and add nothing to the history. */
  cancelStroke() {
    const st = this.stroke;
    if (!st) return;
    for (const k of Object.keys(st.entry.rts) as StrokeKey[]) {
      const snap = st.entry.rts[k]!;
      this.matCopy.uniforms.src.value = snap.texture;
      const target = k === 'mask' ? (st.entry.mask ?? st.layer.mask!).paintRT : (st.layer as PaintLayer).rts[k];
      this.gpu.run(this.matCopy, target);
      this.matCopy.uniforms.src.value = null;
      snap.dispose();
      if (k === 'mask') { const m = st.entry.mask ?? st.layer.mask!; m.dirty = true; } else this.dirty.add(k);
    }
    this.gpu.clear(this.strokeRT);
    this.stroke = null;
    this.markDirty();
  }

  endStroke() {
    const st = this.stroke;
    if (!st) return;
    for (const [a, b] of this.carry.values()) { a.dispose(); b.dispose(); }
    this.carry.clear();
    this.flushStroke();
    this.stroke = null;
    this.lastKey = '';
    this.push(st.entry);
    this.onChange?.();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Undo/redo swap the stored textures with the layer's, so nothing is copied. */
  private swapEntry(e: StrokeEntry) {
    for (const k of Object.keys(e.rts) as StrokeKey[]) {
      if (k === 'mask') {
        const m = e.mask ?? e.layer.mask;
        if (!m) continue;
        const cur = m.paintRT;
        m.paintRT = e.rts.mask!;
        e.rts.mask = cur;
        m.painted = true; m.dirty = true;
        this.markDirty();
        continue;
      }
      const cur = this.targetRT(e.layer, k);
      this.setTargetRT(e.layer, k, e.rts[k]!);
      e.rts[k] = cur;
      this.dirty.add(k);
    }
    if (this.allLayers.includes(e.layer)) this.activeId = e.layer.id;
  }

  /** Returns the label of what was undone ('' if nothing). */
  undo(): string {
    if (this.stroke) return '';
    const e = this.undoStack.pop();
    if (!e) return '';
    this.apply(e, true);
    this.redoStack.push(e);
    this.lastKey = '';
    this.onChange?.();
    return e.label;
  }

  redo(): string {
    if (this.stroke) return '';
    const e = this.redoStack.pop();
    if (!e) return '';
    this.apply(e, false);
    this.undoStack.push(e);
    this.lastKey = '';
    this.onChange?.();
    return e.label;
  }

  // ------------------------------------------------------------ resolution

  setResolution(size: number) {
    if (size === this.size) return;
    this.clearProcCache();
    if (this.baker) this.baker.cancelled = true;
    const resample = (rt: RT) => {
      const n = makeRT(size);
      this.matCopy.uniforms.src.value = rt.texture;
      this.gpu.run(this.matCopy, n);
      rt.dispose();
      return n;
    };
    for (const pair of this.pool) pair.forEach((r) => r.dispose());
    this.pool = [];
    this.clearHistory();
    for (const l of this.allLayers) {
      if (l.kind === 'paint') for (const ch of CHANNELS) l.rts[ch] = resample(l.rts[ch]);
      if (l.mask) {
        l.mask.paintRT = resample(l.mask.paintRT);
        l.mask.rt.dispose();
        l.mask.rt = makeRT(size);
        l.mask.genRT?.dispose(); l.mask.genRT = undefined; l.mask.genKey = undefined;
        l.mask.dirty = true;
      }
    }
    // Keep the baked mesh maps (resampled) instead of resetting them.
    const old = [this.meshRT, this.bakedNRT, this.bakedHRT, this.idRT, this.wsnRT, this.posNRT];
    const baked = new Set(this.baked), bakedOnce = this.bakedOnce, lastHigh = this.lastHigh;
    const keepSet = new Set(old);
    this.allRTs().forEach((r) => { if (!keepSet.has(r)) r.dispose(); });
    this.size = size;
    this.allocate();
    const fresh = [this.meshRT, this.bakedNRT, this.bakedHRT, this.idRT, this.wsnRT, this.posNRT];
    old.forEach((o, k) => {
      this.matCopy.uniforms.src.value = o.texture;
      this.gpu.run(this.matCopy, fresh[k]);
      o.dispose();
    });
    this.matCopy.uniforms.src.value = null;
    this.baked = baked; this.bakedOnce = bakedOnce; this.lastHigh = lastHigh;
    this.meshVersion++;
    for (const l of this.allLayers) if (l.mask) l.mask.dirty = true;
    this.normalDirty = true;
    this.onChange?.();
  }

  // ------------------------------------------------------------ IO

  readRT(rt: RT): Uint8Array { return this.gpu.readPixels(rt); }

  private thumbRTs = new Map<number, RT>();
  /** A small copy of a layer's content or mask (RGBA8, rows bottom-up) for the Layers panel. */
  layerThumb(layer: Layer, what: 'content' | 'mask', n = 40): { px: Uint8Array; gray: boolean } | null {
    let src: RT | undefined;
    let gray = false;
    if (what === 'mask') {
      if (!layer.mask) return null;
      this.compositeDirty();
      src = layer.mask.rt; gray = true;
    } else if (layer.kind === 'paint') {
      src = layer.rts.color;
    } else return null;
    const step = (from: THREE.Texture, size: number) => {
      let rt = this.thumbRTs.get(size);
      if (!rt) { rt = makeRT(size); this.thumbRTs.set(size, rt); }
      this.matCopy.uniforms.src.value = from;
      this.gpu.run(this.matCopy, rt);
      return rt;
    };
    let tex: THREE.Texture = src.texture;
    for (let s = this.size >> 2; s > n * 2; s >>= 2) tex = step(tex, s).texture; // shrink in steps so thin strokes don't vanish
    const out = step(tex, n);
    this.matCopy.uniforms.src.value = null;
    return { px: this.gpu.readPixels(out), gray };
  }

  readLayerChannel(layer: PaintLayer, ch: Ch): Uint8Array {
    return this.gpu.readPixels(layer.rts[ch]);
  }

  /** Upload raw RGBA8 pixels (rows bottom-up) into a render target. */
  writeRT(rt: RT, bytes: Uint8Array, size: number) {
    const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.matCopy.uniforms.src.value = tex;
    this.gpu.run(this.matCopy, rt);
    tex.dispose();
  }

  writeLayerChannel(layer: PaintLayer, ch: Ch, bytes: Uint8Array, size: number) {
    this.writeRT(layer.rts[ch], bytes, size);
    this.dirty.add(ch);
  }

  private matMeshOut = quadShader(/* glsl */ `
uniform sampler2D src; uniform int mode; varying vec2 vUv;
void main() { vec4 s = texture2D(src, vUv); vec3 c = mode == 0 ? vec3(s.r) : mode == 1 ? vec3(s.g) : mode == 2 ? vec3(s.b) : s.rgb; gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`,
  { src: { value: null }, mode: { value: 0 } });
  private matMeshIn = quadShader(/* glsl */ `
uniform sampler2D src; uniform sampler2D prev; uniform int mode; uniform bool flipG; varying vec2 vUv;
void main() {
  vec4 s = texture2D(src, vUv);
  vec4 p = texture2D(prev, vUv);
  float g = dot(s.rgb, vec3(0.3333));
  if (mode == 0) gl_FragColor = vec4(g, p.g, p.b, 1.0);
  else if (mode == 1) gl_FragColor = vec4(p.r, g, p.b, 1.0);
  else if (mode == 2) gl_FragColor = vec4(p.r, p.g, g, 1.0);
  else { vec3 c = s.rgb; if (flipG) c.g = 1.0 - c.g; gl_FragColor = vec4(c, 1.0); }
}`, { src: { value: null }, prev: { value: null }, mode: { value: 0 }, flipG: { value: false } });
  /**
   * Use a mesh map baked somewhere else (Painter, Marmoset, Blender…) instead of baking it here.
   * `flipG` = it's a DirectX normal map.
   */
  importMeshMap(key: BakeKey, tex: THREE.Texture, flipG = false) {
    const u = this.matMeshIn.uniforms;
    const into = (rt: RT, mode: number) => {
      const tmp = makeRT(this.size, { type: rt.texture.type });
      u.src.value = tex; u.prev.value = rt.texture; u.mode.value = mode; u.flipG.value = flipG;
      this.gpu.run(this.matMeshIn, tmp);
      this.matCopy.uniforms.src.value = tmp.texture;
      this.gpu.run(this.matCopy, rt);
      this.matCopy.uniforms.src.value = null;
      tmp.dispose();
    };
    if (key === 'ao') into(this.meshRT, 0);
    else if (key === 'curv') into(this.meshRT, 1);
    else if (key === 'thick') into(this.meshRT, 2);
    else into(key === 'normal' ? this.bakedNRT : key === 'wsn' ? this.wsnRT : key === 'pos' ? this.posNRT : key === 'id' ? this.idRT : this.bakedHRT, 3);
    u.src.value = u.prev.value = null;
    this.baked.add(key);
    this.meshVersion++;
    this.markAll();
  }

  /** One baked mesh map as RGBA8 pixels (rows bottom-up), for Substance image inputs; null when it isn't baked. */
  meshMapPixels(key: BakeKey, size: number): Uint8Array | null {
    if (!this.baked.has(key)) return null;
    const src: [RT, number] = key === 'ao' ? [this.meshRT, 0] : key === 'curv' ? [this.meshRT, 1] : key === 'thick' ? [this.meshRT, 2]
      : key === 'wsn' ? [this.wsnRT, 3] : key === 'pos' ? [this.posNRT, 3] : key === 'normal' ? [this.bakedNRT, 3] : key === 'id' ? [this.idRT, 3] : [this.bakedHRT, 0];
    const u = this.matMeshOut.uniforms;
    u.src.value = src[0].texture; u.mode.value = src[1];
    const rt = makeRT(size);
    this.gpu.run(this.matMeshOut, rt);
    u.src.value = null;
    const px = this.gpu.readPixels(rt);
    rt.dispose();
    return px;
  }

  private matSrc = quadShader(/* glsl */ `
uniform sampler2D src; uniform sampler2D src2; uniform int mode; uniform bool flipG; uniform vec4 k;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(src, vUv);
  vec3 c;
  if (mode == 0) c = a.rgb;
  else if (mode == 1) c = vec3(a.r);
  else if (mode == 2) { c = a.rgb; if (flipG) c.g = 1.0 - c.g; }
  else if (mode == 3) c = vec3(a.g);
  else if (mode == 4) c = vec3(a.b);
  else if (mode == 5) c = vec3(a.a);
  else if (mode == 6) c = vec3(1.0 - a.r);
  else if (mode == 7) c = a.rgb * (1.0 - texture2D(src2, vUv).r);
  else if (mode == 8) c = mix(vec3(0.22), a.rgb, texture2D(src2, vUv).r);
  else if (mode == 10) c = vec3(max(a.r, max(a.g, a.b)));
  else if (mode == 11) c = a.rgb * texture2D(src2, vUv).r;
  else c = k.rgb;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`, { src: { value: null }, src2: { value: null }, mode: { value: 0 }, flipG: { value: false }, k: { value: new THREE.Vector4() } });
  private floatOK: boolean | null = null;
  /**
   * One export source (a channel, a baked mesh map or a converted map) as RGBA pixels, rows bottom-up.
   * float = 0..1 floats for 16-bit files (falls back to 8-bit if the GPU can't read floats).
   */
  exportSource(src: string, size: number, float = false): Uint8Array | Float32Array {
    this.compositeDirty();
    const u = this.matSrc.uniforms;
    u.flipG.value = false; u.src2.value = null;
    const set = (t: THREE.Texture | null, mode: number, t2: THREE.Texture | null = null) => { u.src.value = t; u.mode.value = mode; u.src2.value = t2; };
    const F = this.final;
    switch (src) {
      case 'baseColor': set(F.color.texture, 0); break;
      case 'roughness': set(F.rough.texture, 1); break;
      case 'glossiness': set(F.rough.texture, 6); break;
      case 'metallic': set(F.metal.texture, 1); break;
      case 'height': set(F.height.texture, 1); break;
      case 'emissive': set(F.emit.texture, 0); break;
      case 'emissiveMask': set(F.emit.texture, 10); break;
      case 'normalGL': set(this.finalN.texture, 2); break;
      case 'normalDX': set(this.finalN.texture, 2); u.flipG.value = true; break;
      case 'diffuse': set(F.color.texture, 7, F.metal.texture); break;
      case 'specular': set(F.color.texture, 8, F.metal.texture); break;
      case 'colorAO': set(F.color.texture, 11, this.meshRT.texture); break;
      case 'ao': case 'mixedAO': set(this.meshRT.texture, 1); break;
      case 'curvature': set(this.meshRT.texture, 3); break;
      case 'thickness': set(this.meshRT.texture, 4); break;
      case 'position': set(this.posNRT.texture, 0); break;
      case 'wsn': set(this.wsnRT.texture, 0); break;
      case 'id': set(this.idRT.texture, 0); break;
      case 'meshNormal': set(this.bakedNRT.texture, 0); break;
      case 'meshHeight': set(this.bakedHRT.texture, 1); break;
      case 'coverage': set(this.posRT.texture, 5); break;
      case 'white': set(null, 9); (u.k.value as THREE.Vector4).set(1, 1, 1, 1); break;
      default: set(null, 9); (u.k.value as THREE.Vector4).set(0, 0, 0, 1); break;
    }
    if (this.floatOK === null) this.floatOK = this.gpu.renderer.extensions.has('EXT_color_buffer_float');
    if (float && this.floatOK) {
      try {
        const rt = makeRT(size, { type: THREE.FloatType });
        this.gpu.run(this.matSrc, rt);
        const buf = new Float32Array(size * size * 4);
        this.gpu.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
        rt.dispose();
        this.floatOK = true;
        u.src.value = u.src2.value = null;
        return buf;
      } catch { this.floatOK = false; }
    }
    const rt = makeRT(size);
    this.gpu.run(this.matSrc, rt);
    u.src.value = u.src2.value = null;
    const px = this.gpu.readPixels(rt);
    rt.dispose();
    return px;
  }

  /** Render one export map at the given size. Rows are bottom-up (GL order). */
  renderExport(kind: ExportKind, size: number): Uint8Array {
    this.compositeDirty();
    const u = this.matExport.uniforms;
    u.flipG.value = false;
    switch (kind.kind) {
      case 'rgb': u.mode.value = 0; u.src.value = this.final[kind.ch].texture; break;
      case 'gray': u.mode.value = 1; u.src.value = this.final[kind.ch].texture; break;
      case 'mask': u.mode.value = 4; u.src.value = this.final[kind.ch].texture; break;
      case 'ao': u.mode.value = 1; u.src.value = this.meshRT.texture; break;
      case 'orm':
        u.mode.value = 3; u.srcAO.value = this.meshRT.texture;
        u.srcG.value = this.final.rough.texture; u.srcB.value = this.final.metal.texture;
        break;
      case 'normal':
        u.mode.value = 2; u.src.value = this.finalN.texture; u.flipG.value = kind.directX;
        break;
    }
    const rt = makeRT(size);
    this.gpu.run(this.matExport, rt);
    const px = this.gpu.readPixels(rt);
    rt.dispose();
    return px;
  }
}
