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
- An internal Canvas Loop Lab exists under `apps/song-studio-desktop/src/canvas/` with real loop-analysis/scoring-oriented machinery, but it is disconnected from the current creator-facing render path, is not the overall product roadmap, and must not be mistaken for the directed-video engine.
- Current Composition/RenderJob is fundamentally a deterministic layer stack with one primary `imagePath`, optional audio, text, waveform, and template-derived visuals.
- ProjectAsset roles are persisted but do not yet drive creative generation, scene assignment, identity conditioning, or rendering.
- On `main`, Canvas/promo direction behavior is limited to landed selector/workflow foundations and deterministic recipe/template output paths. It should not be read as a landed three-direction creative system.
- Open PR #88 appears to add Canvas creative-direction behavior and tests; if verified, it remains useful evidence of the “few strong directions before technical controls” interaction model. Because PR #88 is open/unmerged, it does not increase landed capability maturity and is not proof of real modern video generation.

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

PR #88 was accessible through GitHub pull refs at audit time. Its head ref changed runtime app files, package metadata, tests, and `docs/ai-scrum/ux-009-canvas-creative-directions.md`; the diff appears to add Canvas creative-direction behavior. PR #88 is open/unmerged, was not used as the base for SCRUM-002, and is not modified here. Do not count PR #88 as landed maturity evidence until it merges.

## Historical docs that could mislead agents

- `docs/ai-scrum/working-agreement.md` contained stale branch guidance targeting `feat/song-studio-desktop-foundation` and stale current priority language.
- `docs/PRODUCT_DEFINITION_SONG_CONTENT_STUDIO.md` described an earlier song-centered content-studio pivot and must not override the current directed-release-video doctrine.
- `docs/roadmap/canvas_loop_engine.md` describes an internal Canvas Loop Lab roadmap and must not be treated as the overall Song Studio product roadmap.

## Mission layer and current status registry

- `docs/ai-scrum/decisions/DEC-003-director-mode-ai-production-engine.md` records the accepted Director Mode doctrine: Song Studio is an **AI video directing and orchestration system**; **AI-generated moving scenes are the production engine**, not an optional add-on; still images are references/conditioning inputs; the deterministic renderer is the finishing/assembly layer; the creator directs meaning and the system compiles it into provider-neutral generation instructions; scenes can be preserved/repaired independently; characters/objects/locations/styles persist across many generated clips via approved references + versioned identity fingerprints; the directing vocabulary grows through safe declarative user-created tools; monetization is deferred. Animating still images or adding waveform/pixel controls does not count as progress toward the North Star.
- **Director Mode v1 (VIDEO-003)** — EXECUTED on a branch. Implementation evidence exists (see registry entry below); merge, verification, and owner acceptance remain separate lifecycle gates.
- `docs/ai-scrum/decisions/DEC-002-product-mission-active-wedge-and-future-horizons.md` records the product mission, the current wedge, the core loop/memory/decision doctrine, and two named-but-inactive future horizons (NS-002, NS-003) sitting above NS-001. It does not change NS-001, CAP-01 through CAP-09, or their maturity ratings.
- **SCRUM-002** — OWNER ACCEPTED. The process/source-of-truth system is accepted; minor future refinements remain possible.
- **MISSION-001 / DEC-002** — recorded as structural doctrine; no runtime maturity change.
- **NS-001 — Directed Release Video System** — the only ACTIVE North Star.
- **NS-002 — Release Campaign Intelligence** — FUTURE HORIZON / INACTIVE. Not an approved roadmap or authorized work; see DEC-002 for activation conditions.
- **NS-003 — Artist Continuity & Identity** — FUTURE HORIZON / INACTIVE. Not an approved roadmap or authorized work; see DEC-002 for activation conditions.
- **VIDEO-002** — EXECUTED. Implementation evidence exists; merge, verification, and owner acceptance remain separate lifecycle gates. First causal visual-direction slice: a project-owned, song-relative `DirectionCue` assigns one artist-photo asset to a song moment; the audio teaser (hook promo) output — and only that output type in v1 — renders that asset as the primary visual for the overlapping clip span (title/waveform preserved above it). See the registry entry below for evidence.
- **Release Clock** — PROPOSED FUTURE CONCEPT / NOT AUTHORIZED. No `releaseDate` field exists; NS-002 is not activated by this record.

## Current open work registry

### SCRUM-002 — Rebuild Song Studio product hierarchy, source of truth, and multi-agent work system

- Work-item type: Process Story.
- Delivery record: PR #89. Status: OWNER ACCEPTED (see Mission layer and current status registry above).
- Parent North Star: NS-001.
- Parent capability: process support across CAP-01 through CAP-09.
- Completion target: Owner-Accepted Process System.
- Runtime code allowed: no.

### VIDEO-001A — Directed Video System Repository Audit and First Slice Definition

- Work-item type: Discovery / Research Story.
- Status: INVESTIGATION DELIVERED. This report is evidence, not canonical authority by itself; its recommended first proof, VIDEO-002, remains PROPOSED and not started unless separately owner-accepted.
- Purpose: inspect how song time, user intent, directing timeline, direction cues, pre-generation planning, directed sequences, scenes, and loop/linear contracts should connect to the current repo.
- Not a substitute for owner approval of VIDEO-002; VIDEO-002 is not READY TO RUN until the owner approves its acceptance criteria and exact visual implementation.

### VISION-001A — Artist Operating System and Creative Continuity Investigation

- Work-item type: Discovery / Research Story.
- Status: INVESTIGATION DELIVERED. This report is evidence, not canonical authority by itself; its recommendations are not all owner-accepted — only the structural conclusions the owner accepted are now recorded through DEC-002.
- Purpose: assess the larger product mission, future horizons (NS-002, NS-003), and how current landed work (`ReleaseProject`, `readiness.ts`, `renderFreshness.ts`) already forms the core mission machinery.
- Does not authorize any horizon activation, Artist/Persona/Campaign/Era/Canon types, or the Release Clock; see DEC-002.

### VIDEO-002 — First causal visual direction proof

- Work-item type: User Story (NS-001 / CAP-03 direction cues; consumes CAP-01 assets; extends CAP-07 compositor).
- Status: EXECUTED — implementation evidence exists; merge, verification, and owner acceptance remain separate lifecycle gates.
- Implementation evidence: `ReleaseProject.directionCues` (project-owned, song-relative; schema v4, back-compat normalized), an artist-photo-only asset consumer (invariant enforced in normalization and runtime resolution, not just the UI), a pure `project/direction.ts` windowing seam, a gated full-frame directed composite in `render/ffmpegArgs.ts` (title/waveform stay above; byte-identical baseline when no cue), freshness invalidation via the existing `renderRevision` path, and an honest non-animated `DirectionPanel`.
- v1 runtime boundary: the audio teaser (`make_hook_promo`) is the ONLY output type that surfaces the control and consumes a directed visual (`isDirectableOutputType`); the visualizer and Canvas keep their current behavior. The persistence + windowing are intentionally general/reusable for a later story to widen the boundary.
- Evidence: `npm run typecheck`/`build` pass; `direction:test` (windowing, persistence/back-compat, FFmpeg causality) passes; `render:smoke` extended to prove from REAL decoded MP4 pixels that the directed asset shows only inside its span, the cover shows before/after, and a no-direction render is unchanged at the same timestamp.
- Note on scope: this is the first causal slice. `LoopCore.anchorPoints`/`visualStateMarkers` remain reserved-and-unread and are NOT this primitive; the `DirectionCue` is the real song-time visual-direction record and may later supersede those markers. No Scene/Sequence/generation/provider work was done.

### VIDEO-003 — Director Mode v1 (AI-directed video system)

- Work-item type: User Story (NS-001 / CAP-03 direction, CAP-04 planning, CAP-05 scenes, CAP-06 generation orchestration, CAP-07 review/repair/assembly, CAP-08 identity).
- Status: EXECUTED on a branch — implementation evidence exists; not VERIFIED, not MERGED, not OWNER ACCEPTED.
- Implementation evidence: a canonical provider-independent directing model on `ReleaseProject.director` (schema v5; entities + approved reference variants + versioned identity fingerprints; scenes with exact/consistent/related/invented casting; generation takes with request snapshots + structured repair; lyric performance events; safe declarative directing tools; workprint state; explicit audio-retime gate) with full normalization/migration (pre-Director projects open unchanged); a deterministic conflict preflight; a conditioning compiler producing a provider-neutral GenerationPacket (named references, prompt/negative, timed lyrics, pose data, extracted scene audio, return contract) with capability-fit conflicts surfaced (never silently dropped); a manual generation package export + sidecar-manifest result import; a real Google video adapter (Veo via the Gemini API, verified against official docs) behind a capability boundary; a Director workspace UI (visual library, full-song scene board, take review/accept/reject/repair, lyric lane, tool studio with an SVG pose primitive, assembly panel); and song-synchronized workprint assembly. Verified locally: model/logic unit suites, a real-MP4 assembly smoke (accepted clips placed in their song ranges, gaps black, song audio kept, targeted single-scene replacement), typecheck, build, VIDEO-002 regression, and audit. Live provider generation is credential-blocked in this environment (no API key) — the manual bridge transports the identical contract and is the tested path.

### MISSION-001 — Record the product mission, active wedge, and future horizons

- Work-item type: Process Story.
- Status: EXECUTED — docs-only structural record delivered; merge and owner acceptance remain separate lifecycle gates.
- Delivery record: `docs/ai-scrum/decisions/DEC-002-product-mission-active-wedge-and-future-horizons.md` plus cross-reference updates to `START_HERE.md` and `product-north-star.md`.
- Parent North Star: NS-001 (process support; establishes the mission layer above it).
- Completion target: Owner-Accepted Process Rule.
- Runtime code allowed: no.
