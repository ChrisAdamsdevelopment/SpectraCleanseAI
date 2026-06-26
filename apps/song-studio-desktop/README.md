# Song Studio (desktop)

A **desktop-first, post-song content studio** for artists. You already finished the
song — Song Studio helps you turn it into the **videos, Canvas loops, hook clips,
and visualizers** you need to promote it.

> Product direction: **Song → Assets → Content → Promotion → Growth.** The song is
> the center of the workflow.

The aim is **BandLab-style simplicity** — but for music-promo content, not music
creation (Song Studio is not affiliated with BandLab). Instead of asking "what
video settings do you want?", it asks **"what do you want to make for this song?"**
and bundles the technical decisions into simple creative functions with smart
defaults. Advanced controls can be exposed later.

Isolated under `apps/song-studio-desktop/`. Does not touch the old root web app,
auth, billing, database, or release-readiness code.

---

## Stack

- **Tauri v2** desktop shell (Rust) — native window, file dialogs, runs FFmpeg.
- **React + TypeScript + Vite** UI.
- **Shared render core** (`src/render/`): the model is split into
  **CreativeFunction** (what to make) → **RenderRecipe** (portable preset) →
  **VisualTemplate** (the FFmpeg look), plus a stable `RenderEngine` interface and
  a pure `buildFfmpegArgs()`. The UI calls an engine; render logic never lives in UI.
- **FFmpeg** renders. The Rust command is a thin executor (resolve FFmpeg → dedupe
  output → run); no render logic in Rust.

---

## Run (dev)

Requires **Node 20.19+ / 22.12+**, **Rust** (stable) + **MSVC Build Tools** on
Windows (for Tauri), and **FFmpeg** (auto-resolved in dev — see below).

```bash
cd apps/song-studio-desktop
npm install
npm run tauri dev        # launches the desktop app
```

Other scripts: `npm run dev` (frontend only, browser — no file/render),
`npm run typecheck`, `npm run build`, `npm run render:smoke` (verifies the render
engine by producing real MP4s into `out/`).

### FFmpeg resolution (dev fallback)

`run_ffmpeg` resolves FFmpeg in this order, and shows the resolved path/source in
the app before rendering:

1. `SONG_STUDIO_FFMPEG` env var
2. bundled sidecar (PLANNED — not packaged yet)
3. dev fallback: `node_modules/ffmpeg-static/ffmpeg(.exe)`
4. system `ffmpeg` on `PATH`

So after `npm install`, dev mode finds FFmpeg automatically — no manual env var
needed. If none is found, the app shows a clear error.

---

## Using it

1. **Song project** — enter title + artist; choose cover art, song audio, output folder.
2. **What do you want to make?** — Canvas loop / Hook promo / Visualizer.
3. **Style** — pick a recipe (e.g. Clean, Dark Street, Neon) compatible with that function.
4. **Clip selection** — for audio functions set a **start** (`0:42` or `42`) and a
   **duration** (3–60s). Canvas uses a duration only.
5. **Compose (live preview)** — a 9:16 preview shows the result instantly. Pick a
   layer (background / cover art / title / waveform) and edit it in the inspector;
   the preview updates as you drag. A preset is a **starting point** — edit freely.
6. **Clip & export** — set clip start/duration, review the output, **Render MP4**.

### Preview Composer (v1)

The editor is a **workspace** (top project bar · left rail for make/style/layers ·
center 9:16 preview · right inspector · bottom clip/export/log) sized for a laptop
screen — no long vertical scrolling. You can **drag the cover art and title
directly in the preview**, hear/scrub the song in the **audio panel** and press
"Use current time as clip start", and pick **friendly fonts and named colors**.

> Local media (cover art + audio) loads in the preview via the Tauri **asset
> protocol** (enabled in `tauri.conf.json`); broken/missing media shows a clear
> message instead of failing silently.

Recipes compile into an **editable layer stack** (`src/render/composition.ts`):
`background`, `cover_art`, `title_text`, `waveform`, `effect_overlay`. The DOM/CSS
live preview and the FFmpeg exporter read the **same** composition, so editing a
value changes both. Inspector controls:

- **Background** — zoom, blur, darkness/brightness, saturation (uses the cover art).
- **Cover art** — size, X/Y position, shape (square/rounded/circle), shadow.
- **Title** — text, size, Y position, color, background box + opacity, alignment.
- Per-layer **visibility** and **opacity**.

**What the final FFmpeg render respects** (verified): background blur / brightness /
saturation / zoom (Canvas), cover **size + X/Y position** (square), title
**text / font family / size / X+Y / color / box + opacity / alignment**, vignette,
waveform **color + Y position**, clip start + duration, and layer visibility.

**Preview / export drift** (preview-only for now, not yet in the MP4):
- Cover **shape** rounded/circle and **shadow** (FFmpeg renders a square cover).
- **Rotation** and per-layer **opacity** for cover/title.
- Background **zoom** only animates in the silent Canvas export (audio presets are
  static); the preview shows a small static scale.
- The preview's blur/brightness/color are **CSS approximations**, not pixel-exact,
  and the waveform is a stylized placeholder (FFmpeg uses `showwaves`).
- Font/typography may differ from the system font FFmpeg uses.

Outputs are named `SongTitle_recipe_YYYYMMDD_HHMMSS.mp4`, and the app never
overwrites an existing file (it picks a unique name).

### Allowed formats (v1, LIMITED)

- Audio: `mp3, wav, m4a, aac, flac`. Image: `png, jpg, jpeg, webp`. Passed to
  FFmpeg; not exhaustively tested.

---

## Built-in recipes & templates

Creative functions → default recipe:
- **Make a Canvas loop** → *Clean Canvas* (silent, slow zoom).
- **Make a Hook Promo** → *Clean Hook Promo* (audio + waveform).
- **Make a Visualizer** → *Neon Visualizer* (audio + cyan waveform, saturated).

Recipes also include *Dark Street Hook* (darker, vignette, bold title). Visual
templates (`cover_focus`, `dark_street`, `neon_pulse`) are deterministic FFmpeg
looks — no AI, no shaders.

---

## Truthfulness

**REAL**
- Tauri v2 desktop window (verified launching on Windows by the founder).
- React/TypeScript UI (builds + typechecks).
- Audio file / cover art / output-folder selection via native dialogs.
- FFmpeg render engine + local MP4 export (Canvas + audio promo) — verified; the
  founder produced a real Canvas MP4 from the app, and `render:smoke` renders all
  recipes/templates.
- Creative-function / recipe / **editable layer-stack** composition model.
- **Live 9:16 DOM/CSS preview** with layer selection and an inspector.
- **Preview ↔ export parity**: edited composition values flow into the FFmpeg
  render (verified for background, cover, title, clip — see drift list above).
- Manual clip controls (start + duration, seconds or m:ss) with validation.
- Pre-render "what will be created" summary.
- Unique, timestamped output filenames (no overwrite).
- Dev FFmpeg auto-resolution (env → dev node_modules → PATH).

**LIMITED**
- Live preview is a **CSS approximation**, not pixel-identical to the MP4 (drift list above).
- Some inspector controls are **preview-only** so far (cover shape/shadow, rotation, opacity) — see drift.
- Visual templates / title typography (first-pass styling, not art-directed).
- Preset library (4 built-ins; not platform-certified for exact specs).
- Progress reporting (status + a log tail; not per-frame).
- Error handling (FFmpeg stderr tail; not exhaustive).
- Project persistence (single JSON via save/open dialog).
- Audio preview (uses Tauri `convertFileSrc`; may not play for all formats/paths).
- Title overlay (best-effort; uses a system font if found, else skipped).

**PLANNED**
- Creator preset save / import / export / share / fork; trending/community presets.
- AI creative director (suggest presets/sections, modify recipes).
- Waveform / timeline, hook detection.
- Richer templates, lyric clips, caption packs, campaign workspace, "5 variations".
- FFmpeg sidecar packaging + desktop installers.

**NOT ASSESSED**
- Platform API integrations (TikTok/Spotify/YouTube/Instagram/Facebook) — none.
- Analytics — none.
- Commercial FFmpeg licensing / re-distribution.
- Cloud rendering.

---

## What came from the render spike (PR #53)

The FFmpeg filtergraph (blurred cover background + centered art + audio waveform /
slow zoom + optional title) was **refactored** from the `studio-prototype` spike
into the typed, shared `buildFfmpegArgs()` and split into recipes + templates so
it can be reused and extended. The spike's throwaway CLI structure was not kept.

---

## Production packaging notes

- `npm run tauri build` needs the full icon set (committed here) and per-OS
  signing (PLANNED).
- **FFmpeg must be bundled** for end users — v1 resolves it in dev only; production
  should ship FFmpeg as a Tauri **sidecar** (PLANNED).
- **FFmpeg licensing / packaging review required before any commercial release**
  (FFmpeg builds are typically GPL/LGPL). Surfaced early on purpose.
- The `fs` capability scope is broad (`**`) for v1 convenience; tighten before release.
