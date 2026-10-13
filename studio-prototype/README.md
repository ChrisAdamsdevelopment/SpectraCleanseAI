# Song Studio — v0 render spike

Proves one thing: **can we take one song's assets and generate a useful vertical
promotional video, exported locally?** Answer so far: **yes.**

> This is an **isolated architecture spike. It is not production-ready.** It is a
> CLI proof of the render pipeline only, kept separate from the main app.

It does not touch the main app, its `package.json`, production, billing, or the
database. It has its own dependencies under `studio-prototype/`.

---

## Scope — what this is and is NOT

This spike, as it stands:

- **does not ship a UI** (CLI only)
- **does not use Remotion** yet
- **does not use Tauri** yet
- **does not use any AI generation**
- **does not connect to TikTok, YouTube, Spotify, Instagram, Facebook, or any
  platform API** — there is no uploading, publishing, or scheduling
- **only exports local MP4 files** into `out/`

Platform requirements (exact dimensions, durations, codecs, file-size limits for
Spotify Canvas / TikTok / Reels / Shorts) are approximations here and **still
need verification against each platform's current spec before production use.**

---

## What it does (REAL)

Given a cover image (+ a song file for audio formats), it renders a vertical
1080×1920 MP4 with FFmpeg (via `ffmpeg-static`):

- blurred cover background + centered cover art
- audio waveform visualizer (for audio formats)
- slow zoom motion (for the silent Canvas format)
- optional title text overlay (only if a system font is found; otherwise skipped)
- audio muxed in (AAC), exported to `out/`

Formats (`presets.mjs`): `canvas` (silent, ~6s), `tiktok`, `reel`, `short`
(audio, ~12s — capped short for a fast proof; real max durations are TBD and
must be verified per platform).

## How to run

```bash
cd studio-prototype
npm ci                           # installs ffmpeg-static (bundled FFmpeg binary)

# TikTok / Reel / Short (needs audio):
node render.mjs --format tiktok --image cover.png --audio song.mp3 --title "Song Name" --out out/song.mp4

# Spotify Canvas (silent):
node render.mjs --format canvas --image cover.png --title "Song Name" --out out/canvas.mp4
```

Generated files go into `out/` (gitignored — nothing rendered is committed).

Note: the repo's `smoke-files/dummy.mp3` is an invalid placeholder — bring a real
audio file for actual use.

## Smoke test

```bash
npm run smoke
```

Generates **synthetic test media** (a sine tone + a solid-color cover — never
real music or artwork; for validation only), renders one audio asset and one
silent Canvas asset, and verifies both outputs exist and are non-empty. Exits
non-zero on failure. Smoke output also lands in `out/` and is not committed.

---

## Node compatibility

- Tested on **Node v22.22.3** (the environment used to build this spike).
- **Node 20 was NOT executed here**, so Node 20 is not verified by running it.
  `ffmpeg-static` declares `engines.node >= 16` and the scripts use only stable
  `node:` core APIs (`child_process`, `fs`, `util`), so Node 20 is expected to
  work — but this is an expectation, not a tested claim.

---

## What is NOT built yet (PLANNED / NOT ASSESSED)

- **PLANNED — Remotion renderer.** The intended stack is Remotion + FFmpeg.
  Remotion (React → video) is the right tool for animated/synced lyric videos
  and richer compositions; it is the next renderer layer.
- **PLANNED — desktop app (Tauri v2).** This spike is a CLI. Tauri packaging
  (and bundling FFmpeg as a sidecar cross-platform) is deferred so the render
  pipeline could be proven first.
- **PLANNED — UI** (import song / lyrics / artwork, pick format, preview).
- **PLANNED — animated/synced lyrics**, multi-scene templates, brand presets.
- **NOT ASSESSED — AI generation** (Midjourney/Runway/Veo, etc.). Not required
  for the MVP; the first asset is deterministic template rendering from assets
  the artist already has.

---

## Licensing & packaging — review required before production

This spike uses `ffmpeg-static`, which ships a prebuilt **FFmpeg** binary.
FFmpeg builds are typically GPL/LGPL (and some builds include components with
their own terms). **FFmpeg and `ffmpeg-static` licensing, plus how the binary is
bundled/distributed (especially inside a future desktop app), must be reviewed
before any production or commercial use.**

This is deliberate: rather than hide the decision, the spike **surfaces the
FFmpeg licensing/packaging question early** so it can be resolved before it
becomes load-bearing. If Remotion is adopted later, its **Company License** terms
must be reviewed too. Treat both as open decisions, not settled facts.

---

## Why FFmpeg-first (decision record)

The two big unknowns were the **media pipeline** and **desktop packaging**. Per a
"render first" decision, this proves the media pipeline in isolation. FFmpeg
alone clears it today (no headless Chromium needed); Remotion and Tauri layer on
top next without re-proving the core. The trade-off is that the FFmpeg
licensing/packaging review (above) must happen before production.
