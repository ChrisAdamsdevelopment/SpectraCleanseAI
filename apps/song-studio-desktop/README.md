# Song Studio (desktop)

The beginning of the **real** Song-Centered Artist Content Studio: a local desktop
app that turns **one song → a vertical promotional video**. Built in the structure
intended to keep (Tauri v2 + React + TypeScript + Vite + a modular FFmpeg render
engine), not a throwaway prototype.

> Product direction: **Song → Assets → Content → Promotion → Growth.** The song is
> the center of the workflow.

This app is isolated under `apps/song-studio-desktop/` and does not touch the old
root web app, its dependencies, auth, billing, database, or release-readiness code.

---

## Stack

- **Tauri v2** desktop shell (Rust) — native window, file dialogs, runs FFmpeg.
- **React + TypeScript + Vite** UI.
- **Shared render core** (TypeScript): `src/render/` defines the stable
  `RenderJob` / `RenderPreset` / `RenderResult` / `RenderStatus` / `RenderEngine`
  interfaces, the preset registry, and `buildFfmpegArgs()`. All render logic lives
  here — the UI calls an engine, never raw FFmpeg.
- **FFmpeg** does the actual rendering. The Rust command is a thin executor that
  runs FFmpeg with args built by the shared TypeScript core (no render logic in Rust).

---

## How to run (dev)

Requires **Node 20.19+ (or 22.12+)**, **Rust** (stable, for Tauri), and **FFmpeg**
available (on `PATH`, or set `SONG_STUDIO_FFMPEG=/path/to/ffmpeg`).

```bash
cd apps/song-studio-desktop
npm install
npm run tauri dev      # launches the desktop app (Vite dev server + Tauri window)
```

- `npm run dev` alone starts only the Vite frontend in a browser — file selection
  and rendering require the desktop runtime (`npm run tauri dev`). The UI shows a
  banner when not running inside Tauri.
- If `tauri dev` complains about icons, generate the full set once:
  `npx @tauri-apps/cli icon ./src-tauri/icons/icon.png`.

### Verify the render engine without Tauri

```bash
npm run render:smoke   # generates synthetic assets, renders 2 MP4s into out/, verifies them
```

---

## Using the app

1. Enter **song title** and **artist name**.
2. **Choose cover art** (png / jpg / jpeg / webp).
3. **Choose song audio** (mp3 / wav / m4a / aac / flac) — required for audio presets.
4. **Choose an output folder.**
5. Pick a **preset** (Canvas-style loop, or TikTok/Reels/Shorts promo).
6. Click **Render MP4**. Watch status + logs.
7. The exported MP4 path and size appear in the output panel.
8. **Save / Open project** stores the inputs as a local `.songstudio.json` file.

**Outputs** are written to the folder you choose, as `<title>_<preset>.mp4`.

### Allowed formats (v1, LIMITED)

- Audio: `mp3, wav, m4a, aac, flac` (passed to FFmpeg; not exhaustively tested).
- Image: `png, jpg, jpeg, webp`.

---

## Presets (LIMITED — not platform-certified)

- **Spotify Canvas-style loop** — silent 1080×1920, slow zoom on the cover, ~6s.
- **TikTok / Reels / Shorts promo** — 1080×1920 with audio + a waveform, ~15s.
  One shared implementation for all three; dimensions/durations are first-pass and
  **not yet verified against each platform's current spec.**

---

## Truthfulness

**REAL**
- Tauri v2 desktop shell *code/structure* (window, dialog + fs plugins, `run_ffmpeg` + `font_path` commands).
- React/TypeScript UI (builds via Vite; typechecks).
- FFmpeg render engine + **local MP4 export** — verified by `npm run render:smoke` producing real MP4s through the shared engine.
- Modular render interface shared by the Tauri and Node engines.

**LIMITED**
- Preset accuracy (dimensions/durations are first-pass, not platform-certified).
- Progress reporting (status + a log tail; not per-frame progress).
- Error handling (surfaces FFmpeg stderr tail; not exhaustive).
- Project persistence (single JSON file via a save/open dialog).
- Title overlay (best-effort; uses a system font if one is found, else skipped).

**PLANNED**
- Richer templates, animated/synced lyric clips, caption generation.
- Campaign workspace (multiple assets per song).
- Desktop installers / packaging (and **bundling FFmpeg as a Tauri sidecar**).
- Remotion as an alternative/richer renderer (still under consideration).

**NOT ASSESSED**
- Platform API integrations (TikTok/Spotify/YouTube/Instagram/Facebook) — none.
- Analytics — none.
- Production FFmpeg licensing/packaging (see below).
- Cloud rendering — none.

---

## What came from the render spike (PR #53)

The FFmpeg filtergraph (blurred cover background + centered art + audio waveform
for promo, slow zoom for Canvas, optional title overlay) was **refactored** from
the `studio-prototype` spike into the shared, typed `buildFfmpegArgs()` so it can
be reused by both the desktop app and the Node verification runner. The spike's
CLI/throwaway structure was **not** carried over.

---

## Production packaging notes

- `npm run tauri build` produces installers — requires the full icon set
  (`npx @tauri-apps/cli icon …`) and a code-signing story per OS (PLANNED).
- **FFmpeg must be bundled** for end users. v1 resolves FFmpeg from `PATH` /
  `SONG_STUDIO_FFMPEG`; production should ship FFmpeg as a Tauri **sidecar** binary
  (PLANNED).
- The `fs` capability scope is broad (`**`) for v1 convenience; tighten before release.

### FFmpeg licensing / packaging — review required

FFmpeg builds are typically GPL/LGPL and some include components with their own
terms. **FFmpeg licensing and how it is bundled/distributed inside the desktop
installer must be reviewed before any production/commercial release.** This is
deliberately surfaced early rather than hidden.

---

## Known limitations

- `npm run tauri dev` was **not executed in the build environment** because the
  Rust toolchain is not installed there; the Tauri shell code is provided and the
  render engine was verified independently (`render:smoke`). Run `tauri dev` on a
  machine with Rust + FFmpeg to launch the full app.
- No accounts, no cloud, no database, no payments — by design (local desktop tool).
