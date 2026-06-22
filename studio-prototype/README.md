# Song Studio — v0 render spike

Proves one thing: **can we take one song's assets and generate a useful vertical
promotional video, exported locally?** Answer so far: **yes.**

This is an isolated spike. It does not touch the main app, its `package.json`,
production, billing, or the database. It has its own dependencies.

---

## What it does (REAL)

Given a cover image (+ a song for audio formats), it renders a vertical
1080×1920 MP4 with FFmpeg:

- blurred cover background + centered cover art
- audio waveform visualizer (for audio formats)
- slow zoom motion (for the silent Canvas format)
- optional title text overlay (if a system font is found)
- audio muxed in (AAC), exported to `out/`

Formats (`presets.mjs`): `canvas` (silent, ~6s), `tiktok`, `reel`, `short`
(audio, ~12s — capped short for a fast proof; real max durations come later).

## How to run

```bash
cd studio-prototype
npm install                      # installs ffmpeg-static (bundled FFmpeg binary)

# TikTok/Reel/Short (needs audio):
node render.mjs --format tiktok --image cover.png --audio song.mp3 --title "Song Name" --out out/song.mp4

# Spotify Canvas (silent):
node render.mjs --format canvas --image cover.png --title "Song Name" --out out/canvas.mp4
```

Note: the repo's `smoke-files/dummy.mp3` is an invalid placeholder — use a real
audio file. (A synthesized sine tone was used to validate the audio path.)

---

## What is NOT built yet (PLANNED / NOT ASSESSED)

- **PLANNED — Remotion renderer.** The stated stack is Remotion + FFmpeg.
  Remotion (React → video) is the right tool for animated lyric videos and
  richer compositions; it's the next renderer layer. This v0 uses FFmpeg
  directly because it's lighter (no headless Chromium), has no licensing
  entanglement, and produces a real artifact immediately. Remotion also
  requires a paid Company License for for-profit teams above a small size —
  a decision to settle before committing to it.
- **PLANNED — desktop app (Tauri v2).** This spike is a CLI. Tauri packaging
  (and bundling FFmpeg as a sidecar cross-platform) is the next unknown to
  de-risk — deliberately deferred so the render pipeline could be proven first.
- **PLANNED — UI** (import song / lyrics / artwork, pick format, preview).
- **PLANNED — animated/synced lyrics**, multi-scene templates, brand presets.
- **NOT ASSESSED — AI generation** (Midjourney/Runway/Veo, etc.). The MVP does
  not require these; the first asset is deterministic template rendering from
  assets the artist already has.

---

## Why FFmpeg-first (decision record)

The two big unknowns were the media pipeline and desktop packaging. Per the
"render first" decision, this proves the media pipeline in isolation. FFmpeg
alone clears it today; Remotion and Tauri layer on top next without re-proving
the core.
