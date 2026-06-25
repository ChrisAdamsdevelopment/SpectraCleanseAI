import type { VisualTemplate } from './types';

// Deterministic FFmpeg looks. The current "cover focus" look from the first
// render proof is now one template among several — not the whole product.
// LIMITED: these are first-pass styling, not finely art-directed.
export const VISUAL_TEMPLATES: VisualTemplate[] = [
  {
    id: 'cover_focus',
    label: 'Cover Focus',
    description: 'Centered cover art over a blurred, slightly dimmed version of itself.',
    coverScale: 0.8,
    bgBlur: 20,
    bgBrightness: -0.12,
    bgSaturation: 1.0,
    vignette: false,
    titleFontSize: 64,
    titleBoxAlpha: 0.4,
    waveColor: 'white',
  },
  {
    id: 'dark_street',
    label: 'Dark Street',
    description: 'Darker, higher-contrast background with a vignette and a bolder title.',
    coverScale: 0.82,
    bgBlur: 14,
    bgBrightness: -0.3,
    bgSaturation: 0.9,
    vignette: true,
    titleFontSize: 78,
    titleBoxAlpha: 0.55,
    waveColor: 'white',
  },
  {
    id: 'neon_pulse',
    label: 'Neon Pulse',
    description: 'Saturated, moody background with a cyan waveform emphasis.',
    coverScale: 0.8,
    bgBlur: 18,
    bgBrightness: -0.18,
    bgSaturation: 1.35,
    vignette: false,
    titleFontSize: 70,
    titleBoxAlpha: 0.35,
    waveColor: '0x4fd1ff',
  },
];

export function getTemplate(id: string): VisualTemplate {
  return VISUAL_TEMPLATES.find((t) => t.id === id) ?? VISUAL_TEMPLATES[0];
}
