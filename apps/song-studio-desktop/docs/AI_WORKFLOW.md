# Song Studio AI Workflow

> **Current-authority notice (SCRUM-002):** This file is operational context for agents working in the active app, but it is not the canonical product or process authority. Before major Song Studio work, read `docs/ai-scrum/START_HERE.md` from the repo root and follow its authority order. The SCRUM-002 source of truth governs current product direction, hierarchy, implementation truth, process, evidence, and approval.

## Active app scope

- Active app path: `apps/song-studio-desktop/`.
- Old root SpectraCleanse web app work remains off limits unless explicitly requested.
- Documentation-only tasks must not become runtime implementation tasks without approval.

## Current product direction pointer

Song Studio Desktop is now framed as a music-aware directing system for modern release videos. The artist directs the relationship between the song and visual world; Song Studio makes the video. The Release Project is the reusable product container, and the current deterministic renderer is useful but not the creative ceiling.

See `docs/ai-scrum/product-north-star.md` for full doctrine. Do not treat the older short-form-only flow as the complete product definition.

## Branch and PR truth

- Default new work starts from latest remote `main` unless the owner explicitly names another base.
- Historical note: `feat/song-studio-desktop-foundation` and PR #55 were the former foundation workflow; they are no longer active default branch/parent guidance.
- Do not create competing PRs for correction work by default; follow `docs/ai-scrum/working-agreement.md` for the same-PR correction and remote-update fallback workflow.
- Never merge without explicit owner authorization.

## Prompt interpretation and review

- Owner examples are conceptual unless explicitly stated as literal requirements.
- Ask what general capability an example reveals.
- Inspect actual repo truth before coding.
- No control without causality.
- Do not count passive abstractions as meaningful product progress.
- Do not optimize the product around limitations of the current renderer.

## Verification checklist

For Song Studio desktop runtime changes, from `apps/song-studio-desktop/`:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If `render:smoke` fails because the environment FFmpeg lacks `drawtext`, report that clearly. Do not convert the task into an FFmpeg tooling pass unless the owner asks. For docs-only work, use the validation path in the active story or `docs/ai-scrum/working-agreement.md`.
