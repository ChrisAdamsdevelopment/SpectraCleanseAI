import type { CreativeFunction, RenderRecipe } from './types';

// Built-in creative recipes (presets). Structured as portable objects so a
// future creator ecosystem (save / import / export / share / fork / AI-modify)
// can exist without rewriting render code. NOT a marketplace yet — local only.
export const RECIPES: RenderRecipe[] = [
  {
    id: 'clean_canvas',
    name: 'Clean Canvas',
    description: 'Silent vertical loop: cover art with a slow zoom on a blurred background.',
    creator: 'Song Studio',
    version: 1,
    category: 'canvas',
    tags: ['canvas', 'loop', 'minimal'],
    platformTargets: ['spotify'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 6,
    audioRequired: false,
    visualTemplateId: 'cover_focus',
    motionStyle: 'zoom',
    backgroundStyle: 'blurred-cover',
    titleStyle: 'simple',
    overlayStyle: 'none',
    colorMood: 'neutral',
    intensity: 0.3,
  },
  {
    id: 'vertical_promo',
    name: 'Clean Hook Promo',
    description: 'Vertical promo with the song audio and a clean waveform.',
    creator: 'Song Studio',
    version: 1,
    category: 'promo',
    tags: ['promo', 'hook', 'waveform'],
    platformTargets: ['tiktok', 'reels', 'shorts'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 15,
    audioRequired: true,
    visualTemplateId: 'cover_focus',
    motionStyle: 'static',
    backgroundStyle: 'blurred-cover',
    titleStyle: 'simple',
    overlayStyle: 'waveform',
    colorMood: 'neutral',
    intensity: 0.5,
  },
  {
    id: 'dark_street_hook',
    name: 'Dark Street Hook',
    description: 'Darker, harder promo: high-contrast vignette background and a bold title.',
    creator: 'Song Studio',
    version: 1,
    category: 'promo',
    tags: ['promo', 'hook', 'dark', 'street'],
    platformTargets: ['tiktok', 'reels', 'shorts'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 15,
    audioRequired: true,
    visualTemplateId: 'dark_street',
    motionStyle: 'static',
    backgroundStyle: 'dark-vignette',
    titleStyle: 'bold',
    overlayStyle: 'waveform',
    colorMood: 'dark',
    intensity: 0.7,
  },
  {
    id: 'neon_visualizer',
    name: 'Neon Visualizer',
    description: 'Saturated, moody visualizer with a cyan waveform.',
    creator: 'Song Studio',
    version: 1,
    category: 'visualizer',
    tags: ['visualizer', 'neon', 'waveform'],
    platformTargets: ['tiktok', 'reels', 'shorts'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 15,
    audioRequired: true,
    visualTemplateId: 'neon_pulse',
    motionStyle: 'static',
    backgroundStyle: 'neon',
    titleStyle: 'simple',
    overlayStyle: 'waveform',
    colorMood: 'neon',
    intensity: 0.8,
  },
];

export function getRecipe(id: string): RenderRecipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** User-facing intents — "what do you want to make?" */
export const CREATIVE_FUNCTIONS: CreativeFunction[] = [
  {
    id: 'make_canvas',
    label: 'Make a Canvas loop',
    description: 'A short silent vertical loop (Spotify Canvas-style).',
    audio: false,
    defaultRecipeId: 'clean_canvas',
  },
  {
    id: 'make_hook_promo',
    label: 'Make a Hook Promo',
    description: 'A vertical clip of your song for TikTok / Reels / Shorts.',
    audio: true,
    defaultRecipeId: 'vertical_promo',
  },
  {
    id: 'make_visualizer',
    label: 'Make a Visualizer',
    description: 'A moody audio visualizer clip.',
    audio: true,
    defaultRecipeId: 'neon_visualizer',
  },
];

export function getFunction(id: string): CreativeFunction | undefined {
  return CREATIVE_FUNCTIONS.find((f) => f.id === id);
}

/** Recipes (styles) compatible with a creative function (matched by audio mode). */
export function recipesForFunction(fn: CreativeFunction): RenderRecipe[] {
  return RECIPES.filter((r) => r.audioRequired === fn.audio);
}
