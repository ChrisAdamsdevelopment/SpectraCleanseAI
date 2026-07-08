# DEC-002 — Product mission, active wedge, and future horizons

- Decision ID: DEC-002
- Date: 2026-07-07
- Status: OWNER APPROVED / RECORDED
- Owner approval: explicitly accepted by the owner after review of SCRUM-002, VIDEO-001A, VISION-001A, and the resulting architecture conclusions
- Affected capabilities/stories: NS-001, CAP-01 through CAP-09, SCRUM-002, VIDEO-001A, VISION-001A, MISSION-001, proposed VIDEO-002

## Context

SCRUM-002 established NS-001 — Directed Release Video System as the product's only active North Star, with CAP-01 through CAP-09 underneath it. Two follow-on investigations (VIDEO-001A, a repository/architecture investigation for the directed-video engine, and VISION-001A, a whole-product investigation into a larger artist-operating-system vision) surfaced a larger product mission that explains *what NS-001 ultimately contributes toward*, without changing NS-001 itself.

The repository needed a small, durable place to record that larger mission, the current focused wedge, the structural doctrine already implicit in landed work (`ReleaseProject`, `readiness.ts`, `renderFreshness.ts`, `selectedMomentId`), and named-but-inactive future horizons — so future agents understand why directed-video work matters without mistaking the larger vision for authorized scope.

## Decision

Song Studio exists to give independent artists persistent creative context, situational awareness, decision support, and coordinated execution capability that would otherwise require multiple people, tools, and disconnected systems.

Internal architecture formulation: Song Studio is a persistent creative-context system that derives situational awareness, captures creator decisions as causal direction, and executes them through appropriate engines — video first.

This mission sits *above* NS-001 as an explanatory layer. It does not replace, dilute, or compete with NS-001.

```
PRODUCT MISSION
        |
        +-- NS-001 -- Directed Release Video System         STATUS: ACTIVE
        |
        +-- NS-002 -- Release Campaign Intelligence          STATUS: FUTURE HORIZON / INACTIVE
        |
        +-- NS-003 -- Artist Continuity & Identity           STATUS: FUTURE HORIZON / INACTIVE
```

### Current wedge

The product being built and sold first: **a music-aware directing system for modern release videos.**

Outward promise: *Your song is finished. Song Studio helps create everything you need to promote it.*

The active North Star remains NS-001 — Directed Release Video System, with CAP-01 through CAP-09 unchanged.

### Core mission machinery

Not a separate product, not a separate North Star, not a CAP-00, not an abstract platform project. It is the repeated structural discipline through which real creator-facing work should be built:

- persistent context
- observation
- derived interpretation
- creator decisions
- causal execution
- recorded results

This machinery emerges only through stories that create real product value. Abstract foundation work with no immediate consumer is not authorized by this decision.

### Single active North Star

NS-001 — Directed Release Video System is the only active North Star. CAP-01 through CAP-09 and their maturity ratings are unchanged by this decision.

### Future horizons (named, inactive)

**NS-002 — Release Campaign Intelligence.** Future question: how can Song Studio help an independent artist understand what a release needs, what matters now, what to create next, and how to keep execution coordinated across external platforms? Possible future areas: release timing, release phase, readiness, next-best-action, coordinated output needs, external platform contracts, later optional imported signals. Not an approved roadmap. Minimum activation conditions: (1) an owner-accepted directed-video causal proof exists, and (2) the owner explicitly activates the horizon. The "Release Clock" concept (deriving campaign phase and time-aware next-best-action from a release date) remains a candidate future proof under this horizon. It is not authorized.

**NS-003 — Artist Continuity & Identity.** Future question: how can Song Studio help a human, AI-assisted, or original virtual artist maintain a coherent creative identity across songs, releases, albums, eras, visuals, and time? Possible future areas: identity continuity, visual continuity, creative canon, era-scoped continuity, catalog memory, album/story continuity, original virtual-artist continuity, provenance and consent. Minimum activation conditions: (1) a real cross-release continuity need exists, (2) a creator-facing consumer exists, and (3) the owner explicitly activates the horizon. Do not create Artist, Persona, Canon, or Era types under this decision.

NS-002 and NS-003 are labels for future horizons only. They are not active North Stars, approved roadmaps, implementation queues, authorized capabilities, or authorized stories. They are not added as active branches of `docs/ai-scrum/product-outcome-tree.md`.

### Core product loop

```
CONTEXT
   |
OBSERVE
   |
INTERPRET
   |
DECIDE
   |
EXECUTE
   |
RECORD
```

CONTEXT is the substrate, not a one-time stage. OBSERVE: what is true right now? INTERPRET: what matters? DECIDE: what needs creator judgment? EXECUTE: what should the system now do? RECORD: what actually happened, and what should future decisions know? The next cycle reads the updated record. Military terminology (e.g. OODA) may be noted elsewhere as conceptual inspiration only; it must not appear in runtime identifiers.

### Memory doctrine

Persist facts, accepted decisions, and results. Derive awareness.

Illustrative examples of potentially persisted truth: project facts, assets, release date, accepted direction, selected results, provenance, revision history, meaningful creator acceptance or rejection. Illustrative examples of generally derived awareness: readiness, next-best-action, current release phase, contradictions, opportunity suggestions, current priority. These are examples, not a current schema requirement.

### Decision doctrine

AI may propose. The creator establishes truth. Accepted AI direction enters the same causal path as accepted human direction; there is no separate AI-only truth.

Intentional creator action may imply acceptance (e.g. explicitly keeping a result, or deliberately selecting and using a variant). Automatic system behavior may not (e.g. a previewed-but-not-chosen variant, or a system-selected default) — these must not silently become artist canon.

### Release Project boundary

`ReleaseProject` remains the correct current workhorse. It is not replaced or redesigned by this decision.

Release-specific truth stays in `ReleaseProject`. Cross-release truth must not be stuffed into `ReleaseProject` merely because no parent object exists yet.

Possible future conceptual shape (hypothesis only, no schema or parent objects created by this decision):

```
ARTIST / CROSS-RELEASE CONTEXT
        |
ERA / ALBUM CONTEXT
        |
RELEASE PROJECT
        |
OUTPUTS
```

### Product ownership boundaries

Durable ownership direction (doctrine, not a claim that all of this is implemented today) around: creative context, creator-owned accepted decisions, song understanding, visual direction, creative memory, coordinated creation, output readiness, output-contract compliance, next meaningful creative action, provenance of what Song Studio creates, generation planning, generation cost gating, preserving good work, and revision without unnecessary regeneration.

**Never core product systems** — Song Studio should not become: paid reach / advertising infrastructure, fan CRM, a music distribution service, or a DAW / music-production environment.

**Peripheral / not now** — potential future thin integrations may include: publishing, scheduling, read-only analytics import, platform API connections. These must not become core product systems. They may only be considered later if they remove real friction, remain peripheral, do not dominate architecture, and do not become separate product categories. None are built by this decision.

### Future hypothesis — era-scoped continuity

Preserve only the insight: consistency should not mean permanence. Artists evolve. Future continuity may be scoped to eras, albums, worlds, or periods of time, so old decisions can remain history without controlling current direction — continuity without creative imprisonment. No schema or implementation is created by this decision.

## Reasons

- NS-001 needed a stated purpose beyond itself so future agents understand why directed-video work matters, without that purpose becoming competing current scope.
- VIDEO-001A and VISION-001A independently converged on the same underlying pattern already present in landed code (`ReleaseProject`, `readiness.ts`/`nextAction`, `renderFreshness.ts`, `selectedMomentId`): persist facts and accepted decisions, derive awareness, execute causally, record results. Naming this pattern lets future stories be recognized as advancing the mission without requiring new authorized capabilities.
- Two named horizons (rather than zero, or many) let the larger vision be preserved without inviting either total scope silence or an uncontrolled backlog.

## Consequences

- Future stories continue to name their parent capability under NS-001 exactly as before; this decision adds no new required fields to the work-item template.
- NS-002 and NS-003 must not be treated as sources of authorized work until their activation conditions are met and the owner explicitly activates them.
- The Release Clock, Artist/Persona/Canon/Era objects, campaign features, and continuity features remain unauthorized until a future decision activates the relevant horizon.
- `docs/ai-scrum/product-outcome-tree.md` is unchanged by this decision; CAP-01 through CAP-09 and their maturity ratings are unaffected.
- VIDEO-002 remains PROPOSED; its accepted general frontier is "assign visual direction to song time and causally honor it," and its exact visual implementation (timed overlay, artist-photo overlay, full-frame replacement, visual-state transition, or otherwise) remains unresolved and is not settled by this decision.

## Supersedes or clarifies

Clarifies NS-001's place in a larger, mostly unbuilt mission without superseding any part of DEC-001 or the SCRUM-002 hierarchy. Does not supersede or reopen VIDEO-001A or VISION-001A; both remain investigation evidence, not authority.

## Unresolved questions

- Whether "place a visual moment" (VIDEO-002's general frontier) is the right first causal proof, and its exact visual implementation.
- When and whether NS-002's activation conditions will be met, and what its first proof (Release Clock or otherwise) should be.
- When and whether NS-003's activation conditions will be met.
- Whether a future Artist/cross-release parent object is ever needed above `ReleaseProject`, and if so, its exact shape.
- Provider, billing, identity, and quality validation decisions remain unresolved (carried over from DEC-001).
