# Product Outcome Tree

## Hierarchy levels

- Level 0 — North Star Outcome: the global product result.
- Level 1 — Product Capability: a major thing the product must be able to do.
- Level 2 — Epic / System: a coherent product or engineering system needed for a capability.
- Level 3 — Story: an owner-reviewable outcome that advances one epic/system.
- Level 4 — Task: an implementation detail inside an approved story.
- Level 5 — Evidence / Acceptance: proof that the story worked and whether the owner accepted it.

Do not use `CreativeFunction` as a hierarchy level; it is an implementation term in render code.

## Maturity model

- M0 — Not Defined: capability is not understood or approved.
- M1 — Defined / Owner-Approved: capability and intended outcome are understood.
- M2 — Foundation Landed: real implementation exists, but the full creator outcome is not proven.
- M3 — End-to-End Proof: a complete slice works from input to real output.
- M4 — Owner-Accepted Useful Capability: owner tested and accepted useful behavior.
- M5 — Reusable / Scalable Product Capability: stable across relevant outputs/projects.

Rules: tasks do not directly increase maturity; documentation alone does not equal runtime product progress; merged PRs are evidence, not owner acceptance; parent progress rolls up from direct required child systems; avoid fake percentages.

## Dependency model

This is a product/system dependency map, not a locked technical architecture:

- CAP-01 Release Project Memory & Reuse provides reusable source truth to every other capability.
- CAP-02 Song + Intent Understanding informs CAP-03 Directing Timeline + Direction Cues and CAP-04 Pre-Generation Intelligence + Planning.
- CAP-03 Directing Timeline + Direction Cues provides creator direction to CAP-04 planning and CAP-05 sequence/scene systems.
- CAP-04 Pre-Generation Intelligence + Planning constrains CAP-06 Generation Orchestration and CAP-05 Directed Sequence planning before expensive generation.
- CAP-05 Directed Sequence + Scene Engine organizes generated and deterministic material for CAP-07 Finishing + Targeted Revision.
- CAP-06 Generation Orchestration + Cost Control supplies expensive visual material with provenance/cost context.
- CAP-07 Finishing + Targeted Revision assembles, repairs, and exports results.
- CAP-08 Identity + Quality Integrity is cross-cutting and validates identity, direction-following, and quality across planning, generation, finishing, and revision.
- CAP-09 Output Contracts + Scale consumes the relevant systems for Canvas loops, teasers, promos, longer-form assembly, and derivative release outputs.

## Compact evidence map

Do not count open PRs as landed evidence. Current M2 claims are supported by merged history and implemented files:

- CAP-01 M2 evidence: PR #80 / `218df08` Release Project + Outputs Spine; PR #87 / `2278703` Release Preparation Workspace; `apps/song-studio-desktop/src/project/types.ts` includes `ReleaseProject`, `ProjectOutput`, render status/freshness fields, assets, and output ownership.
- CAP-07 M2 evidence: PR #55 / `af66053` Song Studio foundation plus implemented render model in `apps/song-studio-desktop/src/render/types.ts` and deterministic layer compilation in `apps/song-studio-desktop/src/render/composition.ts`; PR #87 / `e2dbad1` render freshness guard. This supports deterministic export/composition only, not targeted regeneration.
- CAP-09 M2 evidence: PR #80 / `218df08` multiple Outputs spine and PR #85 / `46d4fac` Contextual Workspace + Canvas Loop Composer; `ProjectOutput.functionId`, `recipeId`, duration fields, and LoopCore support output-specific work. Open PR #88 is not counted.

## NS-001 — Directed Release Video System

North Star: an artist can direct, generate, revise, and finish modern release videos from a reusable Release Project without becoming a video editor or prompt-lottery player.

### CAP-01 — Release Project Memory & Reuse

Purpose: maintain the reusable source of truth connecting song, assets, direction, generated media, output history, and release-specific decisions.

Level 2 systems:

- SYS-01.1 — Release Project Spine: established product requirement; foundation landed for shared song/project fields and output ownership.
- SYS-01.2 — Shared Release Assets: established requirement; partial storage foundation exists, but assets do not yet drive direction/generation.
- SYS-01.3 — Output Ownership & History: established requirement; foundation landed for multiple outputs and last-render metadata.
- SYS-01.4 — Render Freshness & Staleness: established requirement; foundation landed for freshness protection.
- SYS-01.5 — Release Readiness: established requirement; foundation landed as a creator-facing preparation surface.
- SYS-01.6 — Artist Identity Memory: current system hypothesis; later optional until identity research is approved.

Dependencies: feeds CAP-02 through CAP-09 as the reusable project context.

Maturity: **M2 foundation landed**. Required for next meaningful step: prove reuse across a directed-video slice where one Release Project informs song understanding, direction, generation/composition, and output history. Optional/later: durable identity memory.

### CAP-02 — Song + Intent Understanding

Purpose: help the creator understand what the song offers and express broad creative intent without requiring shot lists or technical animation instructions.

Level 2 systems:

- SYS-02.1 — Song Map: established product requirement; exact implementation unresolved.
- SYS-02.2 — Song Structure Understanding: established requirement; current duration heuristics are prototype evidence only.
- SYS-02.3 — User Creative-Intent Interpretation: established requirement; not implemented.
- SYS-02.4 — Creative Opportunity Surfacing: current system hypothesis; must surface only useful directing decisions.
- SYS-02.5 — Loop Intelligence: current system hypothesis; exact scoring/fit method unresolved.

Dependencies: consumes CAP-01 project context; informs CAP-03 and CAP-04.

Maturity: **M1 defined / owner-approved with partial prototype evidence**. Required for next meaningful step: a discovery-approved first Song Map/intent slice consumed by a creator-facing directing decision. Optional/later: advanced loop-fit scoring.

### CAP-03 — Directing Timeline + Direction Cues

Purpose: let the creator place intention against the real song without operating a professional editing timeline.

Level 2 systems:

- SYS-03.1 — Song Studio Directing Timeline: established product requirement; interaction model unresolved.
- SYS-03.2 — Meaningful Song Regions: established requirement; depends on CAP-02 Song Map quality.
- SYS-03.3 — Direction Cues: established requirement; cue taxonomy unresolved.
- SYS-03.4 — Asset / Identity Assignment: current system hypothesis; “relevant here” must not collapse into “display this JPEG.”
- SYS-03.5 — Progressive Control Surfaces: established requirement; must avoid powerful interfaces while preserving meaningful control.

Dependencies: consumes CAP-01 and CAP-02; feeds CAP-04 and CAP-05.

Maturity: **M1 defined / owner-approved**. Required for next meaningful step: a first owner-approved cue/timeline interaction consumed by planning or rendering. Optional/later: full identity assignment.

### CAP-04 — Pre-Generation Intelligence + Planning

Purpose: use cheap intelligence to earn expensive generation by turning song, intent, and cues into an understandable plan.

Level 2 systems:

- SYS-04.1 — AI Interpretation: established requirement; provider/model details unresolved.
- SYS-04.2 — Useful Questions & Missing Decisions: established requirement; must avoid analysis for analysis's sake.
- SYS-04.3 — Direction Contract: established requirement; MUST/SHOULD/OPEN UX and schema unresolved.
- SYS-04.4 — Visual / Cue Scaffold: current system hypothesis; must be consumed by sequence/scene planning.
- SYS-04.5 — Generation Plan & Cost Preflight: established requirement; exact economics/provider data unresolved.

Dependencies: consumes CAP-02 and CAP-03; constrains CAP-05 and CAP-06.

Maturity: **M1 defined / owner-approved**. Required for next meaningful step: a first plan/contract that the creator can inspect before an expensive or simulated generation step. Optional/later: provider-specific cost optimization.

### CAP-05 — Directed Sequence + Scene Engine

Purpose: organize temporal visual evolution into short directed sequences, scenes, states, and events that can scale from Canvas loops to longer outputs.

Level 2 systems:

- SYS-05.1 — Directed Sequence Concept: current product hypothesis; exact schema not approved.
- SYS-05.2 — Scene Planning: established direction; implementation boundary unresolved.
- SYS-05.3 — Visual States & Events: established direction; taxonomy unresolved.
- SYS-05.4 — Loop Contract: established output need for Canvas; exact mechanics unresolved.
- SYS-05.5 — Linear / Next-Sequence Contract: established output need for longer videos; exact mechanics unresolved.
- SYS-05.6 — Generated-Event Comparison: current system hypothesis; depends on generation/validation capabilities.

Dependencies: consumes CAP-03 and CAP-04; coordinates CAP-06 material and CAP-07 assembly; validated by CAP-08.

Maturity: **M1 defined / owner-approved**. Required for next meaningful step: a first sequence/scene slice consumed by a real output contract. Optional/later: generated-event comparison.

### CAP-06 — Generation Orchestration + Cost Control

Purpose: keep Song Studio owner of project, direction, plan, provenance, cost awareness, and revision workflow while external/local systems supply expensive media.

Level 2 systems:

- SYS-06.1 — Provider-Agnostic Broker: established architecture direction; provider selection unresolved.
- SYS-06.2 — Provider Capability Adapters: current system hypothesis; no vendor commitment approved.
- SYS-06.3 — Generation Provenance: established requirement; exact records unresolved.
- SYS-06.4 — Caching / Reuse: established requirement; depends on project/sequence identity.
- SYS-06.5 — Cost Estimates & Consent: established requirement; billing and provider economics unresolved.
- SYS-06.6 — Credits / Account Model: later optional business system; not approved.

Dependencies: constrained by CAP-04; supplies material to CAP-05 and CAP-07; audited by CAP-08.

Maturity: **M1 defined / owner-approved**. Required for next meaningful step: discovery of provider/cost constraints and a mocked or local first orchestration slice before any paid calls. Optional/later: credits/account model.

### CAP-07 — Finishing + Targeted Revision

Purpose: assemble final outputs and preserve good work while changing only what needs to change.

Level 2 systems:

- SYS-07.1 — Deterministic Compositor: established requirement; foundation landed for current single-image/layer path.
- SYS-07.2 — Local Final Assembly: established requirement; foundation landed for local FFmpeg-style output.
- SYS-07.3 — Lock Good Work: established requirement; not implemented.
- SYS-07.4 — Targeted Regeneration / Repair: established requirement; provider capabilities unresolved.
- SYS-07.5 — Deterministic Text / Logo / CTA Revision: established requirement; exact event model unresolved.
- SYS-07.6 — Safe Export Variants: current system hypothesis; output-specific requirements unresolved.

Dependencies: consumes CAP-05 structure and CAP-06 material; validated by CAP-08; delivers to CAP-09.

Maturity: **M2 foundation landed** for deterministic export/composition only. Required for next meaningful step: prove a directed sequence can be assembled and revised without regenerating deterministic changes. Optional/later: provider-aware partial regeneration.

### CAP-08 — Identity + Quality Integrity

Purpose: protect identity, distinctive details, direction-following, and the “would I be proud to release this?” quality gate.

Level 2 systems:

- SYS-08.1 — Identity Pack: established future capability; representation technology unresolved.
- SYS-08.2 — Identity Anchors & Assignments: current system hypothesis; depends on CAP-03 and CAP-05.
- SYS-08.3 — Distinctive-Detail Preservation: established future need; validation method unresolved.
- SYS-08.4 — Generated-Scene Validation: established requirement; depends on CAP-06 outputs.
- SYS-08.5 — Direction-Following Validation: established requirement; depends on Direction Contract and observed output.
- SYS-08.6 — Product Quality Gate: established requirement; exact automated/manual mix unresolved.

Dependencies: cross-cuts CAP-02 through CAP-07 and informs CAP-09 acceptance.

Maturity: **M1 defined / owner-approved**. Required for next meaningful step: research and first validation target connected to a creator-facing output. Optional/later: tattoo/detail recognition technology.

### CAP-09 — Output Contracts + Scale

Purpose: turn the same Release Project and directing systems into Canvas loops, short teasers, promos, longer videos, derivatives, and future release packs.

Level 2 systems:

- SYS-09.1 — Canvas Loop Output Contract: established output need; loop contract mechanics unresolved.
- SYS-09.2 — 10-15 Second Teaser Contract: established future output; first proof unresolved.
- SYS-09.3 — 30 Second Promo Contract: established future output; depends on sequence assembly.
- SYS-09.4 — Longer-Form Sequence Assembly: later capability; depends on multiple Directed Sequences.
- SYS-09.5 — Derivative Release Outputs: current system hypothesis; exact release-pack scope unresolved.
- SYS-09.6 — Future Release Pack: later optional packaging/product system.

Dependencies: consumes CAP-01 project memory, CAP-02/03 direction, CAP-04 planning, CAP-05 sequence structure, CAP-06 generated material, CAP-07 finishing, and CAP-08 quality validation.

Maturity: **M2 foundation landed** for multiple Outputs and deterministic Canvas/promo-style exports. Required for next meaningful step: an end-to-end directed-video output contract that uses real direction/sequence planning. Optional/later: longer-form release-pack assembly.

## Current work roll-up

- `SCRUM-002` advances the process system and clarifies all capabilities but does not increase runtime maturity.
- `VIDEO-001A` is the proposed next discovery candidate to define the first runtime slice and its parent capability impact.
