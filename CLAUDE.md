# Claude Context: Song Studio

## Active product and scope

- Active product: **Song Studio Desktop** under `apps/song-studio-desktop/`.
- Old root SpectraCleanse web app: off limits unless the owner explicitly requests it.
- Documentation-only tasks must not quietly become runtime implementation tasks.

## Mandatory authority load

Before major Song Studio work, read `docs/ai-scrum/START_HERE.md` and follow its authority order. The SCRUM-002 canonical docs govern current product direction, product hierarchy, current implementation truth, process, evidence, and approval.

## Current product direction summary

- Song Studio is a music-aware directing system for modern release videos.
- The artist directs the relationship between the song and the visual world.
- Song Studio makes the video.
- The Release Project is the reusable product container and source of truth.
- The current deterministic renderer is useful but is not the creative ceiling.
- The product needs meaningful time-based control without becoming a professional editing interface.

See `docs/ai-scrum/product-north-star.md` for the full doctrine.

## Branch and PR workflow

- Default new work starts from latest remote `main` unless the owner explicitly names another base.
- Historical note: `feat/song-studio-desktop-foundation` and PR #55 were the former foundation workflow; they are no longer the default active branch/parent guidance.
- Do not merge branches or PRs unless the owner explicitly instructs you to merge.
- Use the canonical working agreement at `docs/ai-scrum/working-agreement.md` for lifecycle, proof, review, and existing-PR correction workflow.

## Anti-drift rules

- Owner examples are conceptual unless explicitly stated as literal requirements.
- Ask what general capability an example reveals.
- Inspect actual repo truth before coding.
- No control without causality.
- Do not count passive abstractions as meaningful product progress.
- Cheap intelligence should happen before expensive generation where applicable.
- Do not optimize the product around limitations of the current renderer.
- Do not merge without explicit owner authorization.

## Verification

For Song Studio desktop runtime changes, from `apps/song-studio-desktop/`, prefer:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If `render:smoke` fails because FFmpeg lacks `drawtext`, report that directly and do not expand the task into FFmpeg tooling. For docs-only work, follow the active story or `docs/ai-scrum/working-agreement.md`.
