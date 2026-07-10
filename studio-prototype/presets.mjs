// Format presets for the v0 render spike. Durations are capped short so the
// proof renders fast; real per-platform max durations come later.
export const PRESETS = {
  canvas: { label: 'Spotify Canvas', width: 1080, height: 1920, fps: 30, maxDurationSec: 6,  audio: false },
  tiktok: { label: 'TikTok',         width: 1080, height: 1920, fps: 30, maxDurationSec: 12, audio: true  },
  reel:   { label: 'Instagram Reel', width: 1080, height: 1920, fps: 30, maxDurationSec: 12, audio: true  },
  short:  { label: 'YouTube Short',  width: 1080, height: 1920, fps: 30, maxDurationSec: 12, audio: true  },
};
