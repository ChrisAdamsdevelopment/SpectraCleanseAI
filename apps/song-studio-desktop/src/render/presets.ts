import type { RenderPreset } from './types';

// First-pass presets. LIMITED: dimensions are the common 1080x1920 vertical
// frame, but durations/specs are NOT yet certified against each platform's
// current requirements. The TikTok/Reels/Shorts preset is intentionally one
// shared "vertical promo" implementation for v1.
export const PRESETS: RenderPreset[] = [
  {
    id: 'canvas',
    label: 'Spotify Canvas-style loop',
    description: 'Silent 1080×1920 vertical loop with a slow zoom on the cover art.',
    width: 1080,
    height: 1920,
    fps: 30,
    maxDurationSec: 6,
    audio: false,
  },
  {
    id: 'vertical_promo',
    label: 'TikTok / Reels / Shorts promo',
    description: '1080×1920 vertical video: cover art over a blurred background with an audio waveform.',
    width: 1080,
    height: 1920,
    fps: 30,
    maxDurationSec: 15,
    audio: true,
  },
];

export function getPreset(id: string): RenderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
