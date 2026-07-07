# Agent Guidance for SpectraCleanseAI

## Active product and scope

- Active product: **Song Studio Desktop** under `apps/song-studio-desktop/`.
- Old root SpectraCleanse web app: off limits unless the owner explicitly requests it.
- Documentation-only tasks must not quietly become runtime implementation tasks.

## Mandatory load order

Before major Song Studio work, read `docs/ai-scrum/START_HERE.md` and then follow its authority order. The SCRUM-002 canonical docs govern current product direction, process, proof, and work hierarchy.

## Current product direction summary

- Song Studio is a music-aware directing system for modern release videos.
- The artist directs the relationship between the song and visual world; Song Studio makes the video.
- The Release Project is the reusable product container and source of truth.
- The current deterministic renderer is useful but is not the creative ceiling.
- The product needs meaningful time-based control without becoming a professional editing interface.

See `docs/ai-scrum/product-north-star.md` for the full doctrine.

## Branch and PR workflow

- Default new work starts from latest remote `main` unless the owner explicitly names another base.
- Historical note: `feat/song-studio-desktop-foundation` and PR #55 were the former foundation workflow; they are no longer the default active branch/parent guidance.
- Do not merge branches or PRs unless the owner explicitly instructs you to merge.
- Codex-created PRs should be reviewed before merge.

## Existing-PR correction workflow

Preferred outcome: corrections belong on the same PR.

Capability-aware execution:

- If the current Codex UI/environment supports Update PR or pushing to the existing PR branch, use it.
- If it does not, do not pretend the PR was updated.
- Do not create a competing PR by default.
- Report the local correction commit, branch, patch evidence, and remote-update limitation.
- The owner may then use the platform's available Update PR / branch update flow.
- ChatGPT verifies the actual remote PR head after the remote update occurs.

Never claim an existing PR was updated until the remote GitHub head actually changed.

## Anti-drift rules

- Owner examples are conceptual unless explicitly stated as requirements.
- Ask what general capability an example reveals.
- No control without causality.
- Do not count passive abstractions as meaningful product progress.
- Cheap intelligence should happen before expensive generation where applicable.
- Inspect actual repo truth before coding.
- Do not optimize around limitations of the current renderer.

## Scope and stop rules

- Do not work on the old root web app without approval.
- Do not add unrelated cleanup, credentials, generated media, or broad dependencies.
- Do not merge, force-push, or perform destructive cleanup without explicit owner authorization.
- Stop and report if requested work would affect off-limits scope or requires unsupported remote PR update capability.

## Verification expectations

For Song Studio desktop runtime changes, prefer these checks from `apps/song-studio-desktop/`:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If `render:smoke` fails because the environment FFmpeg lacks `drawtext`, report it clearly and do not turn that into an FFmpeg tooling pass unless asked. For docs-only work, follow the validation path in the active story or `docs/ai-scrum/working-agreement.md`.
