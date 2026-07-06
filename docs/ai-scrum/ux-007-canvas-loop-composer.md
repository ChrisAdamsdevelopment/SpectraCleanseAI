# UX-007 — First Real Creative Workflow: Contextual Workspace + Canvas Loop Composer

> **Historical story notice (SCRUM-002, 2026-07-06):** This file is preserved as evidence of prior work. It is not current product authority; start with `docs/ai-scrum/START_HERE.md` for active doctrine, branch rules, and work hierarchy.

Story ID: UX-007
Story title: Contextual Workspace + Canvas Loop Composer (discovery + implementation pass)
Status: EXECUTED — OWNER ACCEPTANCE REQUIRED (user-facing; owner must test the running Tauri app)
Completion level: Owner-Reviewable Product Story

## 1. Context

Builds on the merged foundation: Release Project + Outputs spine (PR #80), UX-004 contextual controls (PR #81), and the consolidated LoopCore + Context Engine v1 (PR #84, superseding the individually-closed PR #82/#83). This story is the first pass that makes those structures do real creative work instead of adding another passive layer on top of them.

## 2. Product diagnosis

Before this story, `ContextMode` existed but drove exactly one read-only summary card. LoopCore existed but nothing consumed `motionIntensity`; it was pure decoration. The editor treated a Spotify Canvas output (silent, loop-based) with the same Song/Direction UI built for audio-driven promos, even though the exported Canvas MP4 does not embed the song audio. The correction after UX-007 is important: **Canvas export is silent; Canvas creation remains song-aware.** The song stays the creative reference while the short loop is the visual object being composed. The images' deeper point was never "reproduce these three screens" — it was "the workspace should visibly respond to what the creator is focused on," with Canvas as the proving ground.

## 3. What this story completed

- **Contextual workspace, now real across three surfaces**, not one read-only card:
  - Left rail: selecting/opening a Spotify Canvas output prioritizes a genuine **Loop workspace** (editable loop length, active Hard Loop continuity, and a Zoom motion slider) while keeping a compact Song Reference below it. The creator can play/scrub the real uploaded song while watching the visual loop, but the UI does not claim beat sync, audio-reactive rendering, or embedded Canvas audio. Any other output type keeps the existing Song/Direction UI unchanged.
  - Center column: canvas-edit mode shows a **loop-span timeline** (Start / Mid / End, computed from the real render-plan duration) and replaces the "silent, won't use your song" nudge (which was correct messaging for a promo but wrong framing for Canvas creation) with an honest "silent Canvas export + song-aware creation reference" explanation.
  - The former UX-006 bottom "Loop + Motion summary" read-only card is retired — its role is now filled by the interactive Loop workspace, so the same facts aren't shown twice.
- **Zoom motion is now a real creative control**, not a passive number. `render/composition.ts` gained `motionIntensityToZoom(baseZoom, motionIntensity)`, and `recipeToComposition`'s `opts.motionIntensity` — when provided — re-derives the background layer's Ken Burns `zoom` from the template's own baseline. This flows through the **unchanged** `buildFfmpegArgs` zoompan filter, so moving the slider changes the actual exported video. `motionIntensity = 0.5` (what every existing/default output already has) reproduces the exact pre-existing zoom value — verified with a standalone script comparing the real generated `-filter_complex` string before and after, so no existing project's render output changes unless the creator actively moves the slider.
- **Preview now gives honest visual feedback for Motion**: `Preview.tsx`'s Ken Burns CSS animation end-scale, previously a hardcoded `1.16` for every template's loop, now reads a `--ss-zoom-to` custom property derived from the real zoom amount — a small correctness fix (different templates' true zoom amounts now preview accurately) with the side effect of making the Motion slider visibly do something.
- **Fixed a real correctness gap found during the audit**: switching an output's type (via "Change output type" or a promo direction) never recomputed `loopCore` — a Canvas output switched to a promo kept a stale LoopCore, and a promo switched to Canvas got no LoopCore at all. Fixed via a `loopCoreFor()` helper used by both `applyRecipe` and `applyPromoDirection`.
- **Continuity mode is truthful in the creator UI**: Hard Loop is the active/current behavior. Soft Loop data-model intent is preserved for older development projects and future rendering, but Soft Loop is disabled as "coming later" until it changes the exported render.

## 4. What remains aspirational (explicitly not built, and why)

- No seam-quality score, energy-match score, beat-alignment score, or any other invented metric. E3's "92% seam quality" etc. have no real analysis behind them in the creator-facing render path and were not fabricated.
- No soft-loop crossfade rendering. `continuityMode: 'soft-loop'` remains preserved compatibility/future intent, not a render behavior — no FFmpeg change was made to support it.
- No real beat/rhythm detection. `LoopAnchorPoint`s remain empty and unpopulated; the Start/Mid/End markers shown in the Loop span timeline are trivial, honest arithmetic on the loop's own duration (0, duration/2, duration) — not song analysis, not beat detection, and they are computed for display only, never written into the reserved `anchorPoints` field.
- No multi-image / visual-asset UI (see the readiness decision below).

## 5. Asset / Template readiness decision

**NOT YET — one prerequisite comes first.**

The render engine (`render/composition.ts` + `render/ffmpegArgs.ts`) is single-cover-image only: `CoverLayer` is singular, and `buildFfmpegArgs` takes exactly one `imagePath`. `ProjectAsset` (role: cover/artist-photo/extra/reference/logo) exists as a typed, persisted field on `ReleaseProject.assets[]`, but nothing writes to it and nothing reads it for rendering — it is genuinely inert. Building E2-style multi-visual editing (a Visual Assets list, per-visual scale/position/depth/blend controls, image cues) would require extending the Composition model to N image layers and teaching `buildFfmpegArgs` to overlay more than one image — a real rendering-engine change, which this story's constraints explicitly forbid touching without evidence that it's ready. It is not ready.

**The exact prerequisite for the next attempt:** extend `Composition`/`buildFfmpegArgs` to support an ordered list of image layers (not just one `CoverLayer`), verified by extending `render:smoke` to cover a multi-image composition, before any asset-library UI is built on top of it. Building the UI first would be wasted work — it would have nothing real to drive.

**What the engine CAN consume today:** exactly one image path per output (cover art), fed through the existing `CoverLayer`. Nothing else.

**First seed pack recommendation (once the render prerequisite lands, not before):** a small set of **motion/template variations**, not raw stock images, since the engine already models "recipe + template" as its native content unit:
1. 2–3 new `VisualTemplate` motion presets (e.g., a slower/calmer zoom, a subtle pan instead of zoom-only) — these need no new render capability at all, since `motionStyle`/`bgZoom` are already first-class template fields. This is buildable **right now**, independent of the multi-image prerequisite.
2. A "Loop" preset family purpose-built for Canvas (today Canvas reuses `release_card`'s template) — 2–3 dedicated Canvas-flavored templates (calmer contrast/blur defaults tuned for continuous looping rather than a single-view release card).
3. Do **not** yet create: artist-photo treatments, image-cue assets, or any multi-image-dependent preset — these are wasted work until the render prerequisite exists.

## 6. Dependencies discovered

- The Canvas Loop Lab (`src/canvas/*`, `docs/roadmap/canvas_loop_engine.md`, Canvas Test Drive) is a fully separate system from the creator-facing render path this story touches — it operates on a real video-file input and has genuine frame-comparison/loop-scoring capability, but it is not wired to `ReleaseProject`/`ProjectOutput` at all. Bridging real seam/continuity scoring into the creator-facing workflow is a substantial, distinct integration task — see the roadmap note added to that document.
- Spotify Canvas outputs render **silently** (`clean_canvas.audioRequired === false`); "the loop repeats while the song plays" is a true statement about how Spotify combines its own audio playback with the silent looping video, not a claim the rendered file itself embeds audio or uses a selected song timestamp. Song Studio still keeps the uploaded song available in Canvas creation as a real creative reference for judging the visual loop against the music.

## 7. Anti-drift roadmap (tracks this story must not let disappear)

- Full contextual panel/surface system (this story proves the principle on 3 surfaces for one output type; extending it further — e.g., a genuinely different right-rail per mode — remains open).
- Multi-image Project assets + image cue placement (blocked on the render-engine prerequisite above).
- Real Canvas Loop Composer seam/continuity intelligence (blocked on bridging the internal Loop Lab's real scoring capability, or building new analysis, into the creator-facing path).
- Real rhythm/beat understanding (no work started; `anchorPoints` remains reserved and empty).
- Template and asset library (seed-pack recommendation above; motion-preset variants are unblocked now, image-dependent presets are not).
- Natural-language creative direction, AI Producer, longer social promo outputs, release-pack generation — untouched, unblocked, not started.

## 8. Recommended next milestone

Two independent, unblocked next steps (either can go first):
1. **Extend the render engine to support N image layers** (the asset-readiness prerequisite) — the highest-leverage next step toward E2, since it unblocks the entire multi-image track.
2. **Add 2–3 Canvas-specific motion templates** (seed pack item 1 above) — zero prerequisites, directly deepens the Canvas Loop Composer with real template variety instead of reusing the release-card template.

## 9. Verification

`typecheck`, `build`, `canvas:smoke`, `render:smoke` (4/4 templates, valid non-empty MP4s), `npm audit --audit-level=high`, `git diff --check` all pass. A standalone script proved the real FFmpeg `-filter_complex` zoompan target changes with `motionIntensity` and that the default value (0.5) is bit-for-bit identical to the pre-existing baseline. Owner acceptance is required — this is user-facing and was not visually verified in a running GUI.
