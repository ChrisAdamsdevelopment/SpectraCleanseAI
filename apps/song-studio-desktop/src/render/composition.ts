import type {
  Composition, Layer, RenderRecipe, VisualTemplate,
  BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer, EffectLayer,
} from './types';

// Compile a recipe + template into an editable layer stack. The user edits the
// returned Composition; the preview and the FFmpeg exporter both read it.
export function recipeToComposition(
  recipe: RenderRecipe,
  template: VisualTemplate,
  opts: { title?: string } = {},
): Composition {
  const audio = recipe.audioRequired;
  const coverY = audio ? 0.43 : 0.5; // nudge up to leave room for the waveform

  const background: BackgroundLayer = {
    id: 'background', type: 'background', visible: true, locked: false, opacity: 1,
    blur: template.bgBlur, brightness: template.bgBrightness, saturation: template.bgSaturation,
    zoom: recipe.motionStyle === 'zoom' ? 0.2 : 0,
  };
  const cover: CoverLayer = {
    id: 'cover_art', type: 'cover_art', visible: true, locked: false, opacity: 1,
    scale: template.coverScale, x: 0.5, y: coverY, rotation: 0, shape: 'square', shadow: 0,
  };
  const title: TitleLayer = {
    id: 'title_text', type: 'title_text', visible: Boolean(opts.title), locked: false, opacity: 1,
    text: opts.title ?? '', size: template.titleFontSize, x: 0.5, y: 0.88,
    color: '#ffffff', box: true, boxOpacity: template.titleBoxAlpha, align: 'center',
  };
  const waveform: WaveformLayer = {
    id: 'waveform', type: 'waveform', visible: audio && recipe.overlayStyle === 'waveform', locked: false, opacity: 1,
    color: template.waveColor,
  };
  const effect: EffectLayer = {
    id: 'effect_overlay', type: 'effect_overlay', visible: template.vignette, locked: false, opacity: 1,
    vignette: template.vignette,
  };

  return {
    width: recipe.width, height: recipe.height, fps: recipe.fps, audio,
    layers: [background, cover, waveform, effect, title],
  };
}

export function getLayer<T extends Layer = Layer>(comp: Composition, id: string): T | undefined {
  return comp.layers.find((l) => l.id === id) as T | undefined;
}

// Immutable layer update (keeps React state changes simple).
export function updateLayer(comp: Composition, id: string, patch: Partial<Layer>): Composition {
  return {
    ...comp,
    layers: comp.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
  };
}

export const LAYER_LABELS: Record<string, string> = {
  background: 'Background',
  cover_art: 'Cover art',
  title_text: 'Title',
  waveform: 'Waveform',
  effect_overlay: 'Effects',
};
