// Song Studio render model. Framework-agnostic (no React / Tauri / Node imports)
// so the same logic is shared by the desktop app and the Node verification runner.
//
// Three layers, kept deliberately separate so the product can grow:
//   CreativeFunction  — what the user wants to MAKE ("Make a Canvas loop").
//   RenderRecipe      — a portable creative recipe (preset) it maps to.
//   VisualTemplate    — the deterministic FFmpeg look a recipe uses.
// A future preset marketplace / AI creative-director should modify recipes,
// not the render code.

export type RenderStatus = 'idle' | 'ready' | 'rendering' | 'success' | 'error';

/** Deterministic FFmpeg "look". Pure data — consumed by buildFfmpegArgs. */
export interface VisualTemplate {
  id: string;
  label: string;
  description: string;
  coverScale: number;     // foreground cover size as a fraction of width
  bgBlur: number;         // background boxblur strength
  bgBrightness: number;   // eq brightness (negative = darker)
  bgSaturation: number;   // eq saturation (1 = neutral)
  vignette: boolean;      // add a vignette
  titleFontSize: number;
  titleBoxAlpha: number;  // 0..1 background box opacity behind the title
  waveColor: string;      // FFmpeg color for the audio waveform
  // Demo-Ready Output Pack v1 — optional creative direction (back-compat defaults).
  bgContrast?: number;    // eq contrast (1 = neutral); subtle cinematic punch
  bgZoom?: number;        // slow Ken Burns zoom amount (0 = none); works with audio
  titleY?: number;        // 0..1 default title baseline (kept in safe social zone)
  titleBox?: boolean;     // use the legacy black slab behind the title (default off)
  titleStroke?: number;   // drawtext border width for readable text without a slab
  titleStrokeColor?: string;
  titleShadow?: number;   // drawtext shadow offset (px @1080 wide)
  coverShadow?: number;   // 0..1 soft drop shadow behind the cover for depth
}

/** A portable creative recipe / preset. Structured for future sharing. */
export interface RenderRecipe {
  id: string;
  name: string;
  description: string;
  creator: string;          // "Song Studio" for built-ins
  version: number;
  category: string;         // e.g. "canvas", "promo", "visualizer"
  tags: string[];
  platformTargets: string[]; // e.g. ["spotify"], ["tiktok","reels","shorts"]
  width: number;
  height: number;
  fps: number;
  defaultDurationSec: number;
  audioRequired: boolean;
  visualTemplateId: string;
  motionStyle: 'zoom' | 'static';
  backgroundStyle: string;
  titleStyle: string;
  overlayStyle: 'waveform' | 'none';
  colorMood: string;
  intensity: number;       // 0..1 simple creative dial (reserved for future use)
  advanced?: Record<string, unknown>; // reserved; not yet surfaced in UI
}

/** What the user chooses to make. Maps to one or more recipes. */
export interface CreativeFunction {
  id: string;
  label: string;
  description: string;
  audio: boolean;          // does this function use the song audio?
  defaultRecipeId: string;
}

// ── Editable layer/composition model (Preview Composer v1) ───────────────────
// A recipe compiles into a Composition of layers. The user edits the layers;
// BOTH the DOM/CSS live preview and the FFmpeg exporter read the same values.

export type LayerType = 'background' | 'cover_art' | 'title_text' | 'waveform' | 'effect_overlay';

export interface LayerBase {
  id: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
}
export interface BackgroundLayer extends LayerBase {
  type: 'background';
  blur: number;        // boxblur strength
  brightness: number;  // eq brightness (negative = darker)
  saturation: number;  // eq saturation
  contrast?: number;   // eq contrast (1 = neutral); subtle cinematic punch
  zoom: number;        // slow Ken Burns zoom amount (0 = none); applies with or without audio
}
export interface CoverLayer extends LayerBase {
  type: 'cover_art';
  scale: number;       // fraction of frame width
  x: number;           // 0..1 center anchor
  y: number;
  rotation: number;    // degrees (preview only for now)
  shape: 'square' | 'rounded' | 'circle';
  shadow: number;      // 0..1 (preview only for now)
}
export interface TitleLayer extends LayerBase {
  type: 'title_text';
  text: string;
  font: string;        // font-family id (see lib/fonts.ts)
  size: number;        // font size in px (1080-wide frame)
  x: number;           // 0..1 anchor
  y: number;
  color: string;       // #rrggbb
  box: boolean;
  boxOpacity: number;  // 0..1
  align: 'left' | 'center' | 'right';
  stroke?: number;     // outline width for readability without a heavy box
  strokeColor?: string;
  shadow?: number;     // soft drop-shadow offset (px @1080 wide)
}
export interface WaveformLayer extends LayerBase {
  type: 'waveform';
  color: string;       // #rrggbb (mapped to an FFmpeg color at export)
  y: number;           // 0..1 vertical position
}
export interface EffectLayer extends LayerBase {
  type: 'effect_overlay';
  vignette: boolean;
}
export type Layer = BackgroundLayer | CoverLayer | TitleLayer | WaveformLayer | EffectLayer;

export interface Composition {
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  layers: Layer[];
}

// VIDEO-002: a directed visual that becomes the PRIMARY visual for an
// OUTPUT-LOCAL span [startSec, endSec] (seconds from the start of this clip,
// already windowed from the project's song-relative direction). Rendered above
// the base cover composite and below title/waveform.
export interface DirectedVisual {
  imagePath: string;
  startSec: number; // output-local (clip-local) seconds
  endSec: number;   // output-local (clip-local) seconds
}

export interface RenderJob {
  recipeId: string;
  functionId?: string;
  imagePath: string;
  audioPath?: string | null;
  title?: string;
  artist?: string;
  outputPath: string;
  durationSec?: number;     // clip duration; clamped to 1..60
  audioStartSec?: number;   // clip start in the song (audio recipes only)
  composition?: Composition; // edited composition from the UI; falls back to the recipe
  directedVisuals?: DirectedVisual[]; // VIDEO-002; empty/absent = baseline render
}

export interface RenderResult {
  ok: boolean;
  outputPath?: string;
  bytes?: number;
  durationMs?: number;
  error?: string;
}

export type RenderLogFn = (line: string) => void;

export interface RenderEngine {
  render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult>;
}

export interface FfmpegStatus {
  found: boolean;
  path: string;
  source: 'env' | 'sidecar' | 'dev-node-modules' | 'system-path' | 'unknown';
}
