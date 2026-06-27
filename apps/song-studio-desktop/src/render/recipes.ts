import type { CreativeFunction, RenderRecipe } from './types';

// Built-in creative recipes (presets). Structured as portable objects so a
// future creator ecosystem (save / import / export / share / fork / AI-modify)
// can exist without rewriting render code. NOT a marketplace yet — local only.
export const RECIPES: RenderRecipe[] = [
  {
    id: 'clean_canvas',
    name: 'Clean Release Card',
    description: 'Minimal release-announcement loop: a centered cover on a soft, slowly zooming background with calm label-style text.',
    creator: 'Song Studio',
    version: 2,
    category: 'release',
    tags: ['release', 'announcement', 'canvas', 'minimal'],
    platformTargets: ['spotify', 'instagram'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 7,
    audioRequired: false,
    visualTemplateId: 'release_card',
    motionStyle: 'zoom',
    backgroundStyle: 'blurred-cover',
    titleStyle: 'simple',
    overlayStyle: 'none',
    colorMood: 'neutral',
    intensity: 0.3,
  },
  {
    id: 'vertical_promo',
    name: 'Cover Motion Teaser',
    description: 'Vertical hook clip: the song plays over a slowly zooming cover with clean, readable title text — no busy visualizer.',
    creator: 'Song Studio',
    version: 2,
    category: 'promo',
    tags: ['promo', 'hook', 'teaser', 'motion'],
    platformTargets: ['tiktok', 'reels', 'shorts'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 12,
    audioRequired: true,
    visualTemplateId: 'cover_focus',
    motionStyle: 'zoom',
    backgroundStyle: 'blurred-cover',
    titleStyle: 'simple',
    overlayStyle: 'none',
    colorMood: 'neutral',
    intensity: 0.5,
  },
  {
    id: 'dark_street_hook',
    name: 'Dark Hook Promo',
    description: 'Darker, harder hook: high-contrast cinematic background, soft motion, and a bold high-impact title. Good for trap, drill, rock and aggressive tracks.',
    creator: 'Song Studio',
    version: 2,
    category: 'promo',
    tags: ['promo', 'hook', 'dark', 'bold'],
    platformTargets: ['tiktok', 'reels', 'shorts'],
    width: 1080,
    height: 1920,
    fps: 30,
    defaultDurationSec: 12,
    audioRequired: true,
    visualTemplateId: 'dark_street',
    motionStyle: 'zoom',
    backgroundStyle: 'dark-vignette',
    titleStyle: 'bold',
    overlayStyle: 'none',
    colorMood: 'dark',
    intensity: 0.7,
  },
  {
    id: 'neon_visualizer',
    name: 'Neon Visualizer',
    description: 'Saturated, moody audio visualizer with a cyan waveform.',
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
    motionStyle: 'zoom',
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
    label: 'Make a Release Card',
    description: 'A short silent vertical loop for release announcements (Spotify Canvas-style).',
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
