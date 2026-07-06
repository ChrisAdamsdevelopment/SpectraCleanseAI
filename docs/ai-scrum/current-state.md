# Current State — Song Studio Desktop

## Audit date

2026-07-06. Based on latest remote `main` plus inspection of active app files and PR #88 refs available from GitHub.

## Implemented foundations worth preserving

- `ReleaseProject` is the persisted root object; `SongProject` is now a single-output view merged from shared release fields plus one output.
- `ProjectOutput` records output-specific function, recipe, selected moment, promo direction, status, last render, render revision, and LoopCore metadata.
- Release Readiness, output history/ownership, render freshness/staleness, and async render ownership have landed on `main` through earlier work.
- `ProjectAsset` roles exist for cover, artist photo, extra, reference, and logo.
- The deterministic renderer has a shared Composition/layer model and a RenderJob path that can create local MP4 outputs.

## Partial / prototype implementation boundaries

- `SongAnalysis` is duration-heuristic: `buildSongAnalysis` estimates moments from duration and optional manual selection. It is not real song-structure or musical-intent understanding.
- LoopCore contains future-facing loop concepts. Some motion intensity affects current zoom, but anchor points and visual-state markers are not a real directed-video or loop-intelligence engine.
- Current Composition/RenderJob is fundamentally a deterministic layer stack with one primary `imagePath`, optional audio, text, waveform, and template-derived visuals.
- ProjectAsset roles are persisted but do not yet drive creative generation, scene assignment, identity conditioning, or rendering.
- Current Canvas creative directions are useful proof that a few strong creative choices are better than many technical controls, but they are not proof of modern generated video.

## Not built

- Real Song Map.
- Song Studio directing timeline.
- Direction cues and Direction Contract.
- Directed Sequence or scene engine.
- Provider-agnostic generation orchestration.
- Cost preflight for expensive generation.
- Targeted partial regeneration.
- Identity Pack, distinctive-detail validation, or direction-following quality gate.
- Loop intelligence that relates intended visual events to repeated playback across the song.

## PR #88 status

PR #88 was accessible through GitHub pull refs at audit time. Its head ref changed runtime app files, package metadata, tests, and `docs/ai-scrum/ux-009-canvas-creative-directions.md`. It appears to be Canvas creative-directions work. This SCRUM-002 branch was started from `origin/main`, did not branch from PR #88, and does not modify PR #88.

## Historical docs that could mislead agents

- `docs/ai-scrum/working-agreement.md` contained stale branch guidance targeting `feat/song-studio-desktop-foundation` and stale current priority language.
- `docs/PRODUCT_DEFINITION_SONG_CONTENT_STUDIO.md` described an earlier song-centered content-studio pivot and must not override the current directed-release-video doctrine.
- `docs/roadmap/canvas_loop_engine.md` describes an internal Canvas Loop Lab roadmap and must not be treated as the overall Song Studio product roadmap.

## Current open work registry

### SCRUM-002 — Rebuild Song Studio product hierarchy, source of truth, and multi-agent work system

- Work-item type: Process Story.
- Status: EXECUTED after this documentation pass; not owner accepted until reviewed.
- Parent North Star: NS-001.
- Parent capability: process support across CAP-01 through CAP-09.
- Completion target: Owner-Accepted Process System.
- Runtime code allowed: no.

### VIDEO-001A — Directed Video System Repository Audit and First Slice Definition

- Work-item type: Discovery / Research Story.
- Status: PROPOSED.
- Purpose: inspect how song time, user intent, directing timeline, direction cues, pre-generation planning, directed sequences, scenes, and loop/linear contracts should connect to the current repo.
- Not READY TO RUN until the owner chooses the exact first runtime proof after accepting SCRUM-002.
