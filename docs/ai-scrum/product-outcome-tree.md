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

Rules: tasks do not directly increase maturity; documentation alone does not equal runtime product progress; merged PRs are evidence, not owner acceptance; parent progress rolls up from required children; avoid fake percentages.

## NS-001 — Directed Release Video System

North Star: an artist can direct, generate, revise, and finish modern release videos from a reusable Release Project without becoming a video editor or prompt-lottery player.

### CAP-01 — Release Project Memory & Reuse

Potential systems: shared release assets, output ownership/history, render freshness/staleness, Release Readiness, future Artist Identity memory, reuse between outputs.

Initial maturity: **M2 foundation landed**. ReleaseProject, Outputs, Release Readiness, render freshness, and async render ownership exist, but reuse across advanced directed-video outputs is not yet proven.

### CAP-02 — Song + Intent Understanding

Potential systems: real Song Map, song structure understanding, user creative-intent interpretation, creative opportunity surfacing, loop intelligence.

Initial maturity: **M1 defined / owner-approved with partial prototype evidence**. Duration-heuristic song moments exist, but real music understanding and intent interpretation are not built.

### CAP-03 — Directing Timeline + Direction Cues

Potential systems: Song Studio directing timeline, song regions, direction cues, asset/identity assignment, progressive controls, contextual decision surfaces.

Initial maturity: **M1 defined / owner-approved**. Current clip/moment selection is not the target directing timeline.

### CAP-04 — Pre-Generation Intelligence + Planning

Potential systems: AI interpretation, useful questions, Direction Contract, visual/cue scaffold, generation plan, cost preflight.

Initial maturity: **M1 defined / owner-approved**. No Direction Contract or generation preflight is implemented.

### CAP-05 — Directed Sequence + Scene Engine

Potential systems: Directed Sequence concept, scene planning, visual states/events, loop contract, linear/next-sequence contract, generated-event comparison.

Initial maturity: **M1 defined / owner-approved**. LoopCore and deterministic Composition provide useful foundations, but no directed sequence or scene engine exists.

### CAP-06 — Generation Orchestration + Cost Control

Potential systems: provider-agnostic broker, provider capability adapters, generation provenance, caching/reuse, cost estimates, future credits/account model.

Initial maturity: **M1 defined / owner-approved**. Provider selection, billing model, and paid generation are intentionally unresolved.

### CAP-07 — Finishing + Targeted Revision

Potential systems: lock good work, regenerate only bad work, deterministic compositor, local final assembly, text/lyrics/CTA as directed visual events, safe export variants.

Initial maturity: **M2 foundation landed** for deterministic export/composition only. Targeted revision and provider-aware partial regeneration are not built.

### CAP-08 — Identity + Quality Integrity

Potential systems: Identity Pack, identity anchors, distinctive-detail preservation, generated-scene validation, quality gate, direction-following validation.

Initial maturity: **M1 defined / owner-approved**. ProjectAsset roles are a storage foundation, not active identity direction or validation.

### CAP-09 — Output Contracts + Scale

Potential systems: Canvas loop output, 10-15 second teaser, 30 second promo, longer-form sequence assembly, derivative release outputs, future Release Pack.

Initial maturity: **M2 foundation landed** for multiple Outputs and deterministic Canvas/promo-style exports. Loop/linear contracts and scaled directed sequence assembly are not proven.

## Current work roll-up

- `SCRUM-002` advances the process system and clarifies all capabilities but does not increase runtime maturity.
- `VIDEO-001A` is the proposed next discovery candidate to define the first runtime slice and its parent capability impact.
