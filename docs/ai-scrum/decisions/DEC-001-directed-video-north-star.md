# DEC-001 — Song Studio is a music-aware directing system, not an animated-artwork renderer

- Decision ID: DEC-001
- Date: 2026-07-06
- Status: OWNER APPROVED / RECORDED
- Owner approval: approved through SCRUM-002 prompt direction
- Affected capabilities/stories: NS-001, CAP-01 through CAP-09, SCRUM-002, proposed VIDEO-001A

## Context

Earlier Song Studio work proved valuable foundations: Release Projects, Outputs, Release Readiness, render freshness, deterministic composition, song moment selection, and Canvas/promo direction selection. Some historical documents and implementation comments can make the current renderer appear to be the main product path.

The owner clarified that Song Studio's target is broader: a finished song should become reusable release visuals through a system where the artist directs the relationship between the song and visual world.

## Decision

Song Studio is a music-aware directing system for modern release videos. It is not merely an animated-artwork renderer, a generic video editor, or a prompt-only generation tool.

The current deterministic single-image renderer remains useful and should be preserved as one composition path, but it is not the creative ceiling. Product architecture should move toward song understanding, creator intent, direction cues, Direction Contracts, directed sequences, scenes, generation orchestration, validation, targeted revision, and final output.

## Reasons

- Artists need release visuals that feel directed, not just technically valid MP4s.
- Prompt-only generation is expensive and unreliable without pre-generation planning.
- Professional editing timelines expose too much execution detail for the target experience.
- Reusable Release Projects can preserve song, assets, identity, direction, generated media, output history, and revision context.
- Controls must have causal impact on output plans and results.

## Consequences

- Future stories must identify their parent capability and first creator-facing consumer.
- Extending blur, zoom, particles, waveforms, and background treatments is not the default path to product maturity.
- Documentation-only progress does not increase runtime maturity.
- Directed Sequence and scene concepts remain hypotheses until validated by dedicated discovery and first-slice work.
- Provider, billing, identity, and quality validation decisions remain unresolved.

## Supersedes or clarifies

Clarifies and supersedes any historical language that presents Song Studio primarily as a Canvas Loop Lab, animated-cover-art renderer, generic content studio, or flat story backlog.

## Unresolved questions

- Exact first runtime slice after SCRUM-002.
- Canvas planning versus vertical teaser as first proof.
- Exact Song Map, directing timeline, cue taxonomy, Directed Sequence schema, provider strategy, cost model, identity technology, and loop-fit scoring.
