# START HERE — Song Studio AI Scrum Source of Truth

## Mandatory authority order

1. This `START_HERE.md` entry point.
2. `docs/ai-scrum/product-north-star.md`.
3. `docs/ai-scrum/product-outcome-tree.md`.
4. `docs/ai-scrum/current-state.md`.
5. `docs/ai-scrum/working-agreement.md`.
6. The active story or decision record for the work being executed.
7. Relevant implementation files and historical docs.

Historical story docs are evidence, not current product authority. Newer owner-approved decision records may clarify or supersede older direction.

## Mission layer

A durable product mission sits above the single active North Star and explains what NS-001 ultimately contributes toward, without changing NS-001 or authorizing new work. See `docs/ai-scrum/decisions/DEC-002-product-mission-active-wedge-and-future-horizons.md` for the mission, the current wedge, the core loop/memory/decision doctrine, and two named-but-inactive future horizons (NS-002, NS-003).

## Active product and repo scope

- Active product: **Song Studio Desktop**.
- Active app path: `apps/song-studio-desktop/`.
- Old root SpectraCleanse web app: **off limits unless explicitly requested**.
- Current default base for new work: latest remote `main`, unless the owner explicitly names another base.
- Do not branch from or modify another open PR unless the owner explicitly says to do that.

## Current work

- `SCRUM-002` — Rebuild Song Studio product hierarchy, source of truth, and multi-agent work system.
- Delivery record: PR #89. Verify the current GitHub lifecycle state from the PR. Merge does not imply `OWNER ACCEPTED`; owner acceptance of the process system remains explicit.
- Completion target: Owner-Accepted Process System.

## Canonical docs

- Product North Star: `docs/ai-scrum/product-north-star.md`
- Product outcome tree and maturity: `docs/ai-scrum/product-outcome-tree.md`
- Current implementation truth: `docs/ai-scrum/current-state.md`
- Working agreement: `docs/ai-scrum/working-agreement.md`
- Work item template: `docs/ai-scrum/templates/work-item.md`
- Decision record template: `docs/ai-scrum/templates/decision-record.md`
- First decision record: `docs/ai-scrum/decisions/DEC-001-directed-video-north-star.md`
- Product mission / active wedge / future horizons: `docs/ai-scrum/decisions/DEC-002-product-mission-active-wedge-and-future-horizons.md`
- Director Mode / AI production engine doctrine: `docs/ai-scrum/decisions/DEC-003-director-mode-ai-production-engine.md`

## Required agent handoff header

Every major Song Studio handoff should identify:

- authority/ref loaded
- active story
- parent capability
- parent epic/system
- North Star contribution
- out-of-scope boundaries
- whether runtime code changes are allowed
- proof required
