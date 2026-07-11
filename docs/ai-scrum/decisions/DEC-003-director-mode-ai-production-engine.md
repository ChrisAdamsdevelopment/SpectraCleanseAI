# DEC-003 — Director Mode: AI generation is the production engine

- Decision ID: DEC-003
- Date: 2026-07-10
- Status: OWNER APPROVED / RECORDED
- Owner approval: explicit owner direction commissioning Director Mode v1 (the VIDEO-003 build directive), superseding the earlier investigate-first sequencing for this scope
- Affected capabilities/stories: NS-001, CAP-01 through CAP-09 (especially CAP-03/04/05/06/07/08), VIDEO-002 (preserved), VIDEO-003 Director Mode v1

## Context

VIDEO-002 proved the causal direction spine (creator decision → persisted song-relative direction → windowed render change) but its material was still images. The owner has now made the product decision: stop sequencing toward generation through smaller proofs and build the directing-and-generation system itself.

## Decision

1. Song Studio is an **AI video directing and orchestration system**.
2. **AI-generated moving scenes are the production engine** — not an optional future add-on.
3. The creator directs meaning; the system translates that direction into machine-facing generation instructions (the conditioning compiler).
4. **Still images are primarily references and conditioning inputs** (identity, tattoo, wardrobe, object, location, style, first/last frame, composition) — still-image animation is not the product's path to real video.
5. The deterministic renderer is the **finishing and assembly layer**: joining generated scenes, song synchronization, titles/lyrics/logos/end cards, output formatting, final export. It is not the primary scene-creation engine.
6. The interface uses **artist/director language** (who/what/where/feel/camera/what stays the same/what may change), not raw technical parameters by default; advanced views may expose compiled prompts and provider parameters.
7. The creator can **preserve successful scenes and regenerate only failed scenes** — the scene is the revision boundary.
8. **Characters, objects, locations, styles, and continuity survive across many generated clips** via approved reference variants and versioned identity fingerprints; a generated proposal never silently becomes canonical identity — approval is explicit.
9. The directing vocabulary may grow through **AI-generated, user-created, shareable directing tools** — declarative, schema-validated, never arbitrary executable code.
10. A major video story advances at least one of: directing, AI generation, identity preservation, continuity, scene planning, review, repair, assembly.
11. **Animating still images, adding waveform styles, or adding manual pixel controls cannot masquerade as progress** toward the North Star.
12. **Monetization is intentionally deferred** until the creative system exists: no subscriptions, credits, tiers, gates, or billing architecture in this phase.
13. Imported real footage remains an optional ingredient entering the same scene/take seam; it must not replace or postpone AI generation as the defining workflow.
14. Exact / Consistent / Related / Invented is the canonical continuity vocabulary relating scene elements to approved project identity.

## Reasons

- The wedge's promise ("Song Studio makes the video") requires moving scenes the creator did not have to shoot; generation is the only scalable source.
- The VIDEO-002 seam (project-owned song-relative direction, output windowing, freshness, gated compositing) was built to carry richer material; deferring generation further would optimize the wrong axis (DEC-001's warning).
- Provider-neutral canonical direction plus a manual generation bridge keeps the system honest and testable with or without live credentials.

## Consequences

- CAP-06 (generation orchestration) moves from parked to active; the Google video provider (Veo family via the Gemini API) is the first live adapter, behind a capability-described boundary, with the manual generation package as a first-class peer path.
- The clarified DEC-002 "peripheral / not now" list no longer covers the **generation provider** — generation was always the sanctioned bidirectional integration (CAP-06); platform/social integrations remain not-now.
- VIDEO-002's photo-direction behavior is preserved unchanged; Director Mode is additive.
- API keys are never stored in the ReleaseProject and never committed; session-only entry until secure platform storage is implemented.

## Supersedes or clarifies

Clarifies DEC-001/DEC-002 sequencing: the "cheap intelligence before expensive generation" principle now operates *inside* Director Mode (conflict preflight, compiled-packet inspection, cost preflight before submission) rather than as a reason to defer generation entirely.

## Unresolved questions

- Monetization/packaging (deliberately deferred).
- Lip-sync live provider selection (manual repair bridge is v1 truth).
- Community distribution of shareable directing tools (package format is designed for it; no hosted registry now).
