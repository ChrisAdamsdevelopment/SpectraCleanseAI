# Song Studio AI Workflow

This file is shared operational context for Codex, Claude Code, Claude CoWork, and future agent sessions working on Song Studio.

## Product frame

Song Studio is a desktop-first, local-first, song-first tool for turning finished songs into short-form promotional content.

Stay aligned to this flow:

1. Finished song
2. Choose or define a song moment
3. Audition visual direction
4. Adjust naturally
5. Export content worth posting

Do not treat the app as the old SpectraCleanse web app or as a generic video editor.

## Active branch and PR truth

- Active foundation branch: `feat/song-studio-desktop-foundation`
- Parent/foundation PR: #55
- Song Moment Selector v1 PR #56 and Promo Direction Selector v1 PR #58 have been merged into the foundation branch.
- PR #51 is parked release-readiness work. Do not work on it unless explicitly requested.

## Codex workflow

- Codex can edit files inside a task.
- The user controls whether to click **Create PR**.
- Do not assume Codex can push updates to an existing PR unless the UI explicitly supports it.
- End reports should say whether the user should click **Create PR** and why.
- Do not merge Codex-created PRs automatically.

## Claude workflow

- Claude Code or Claude CoWork may be used for deeper product and code passes.
- After repeated corrections, start a fresh Claude prompt instead of layering more fixes onto a confused thread.
- Claude should inspect before coding.
- Claude should not treat casual examples as literal feature requests.
- Prefer capability systems over isolated one-off effects.

## Prompt interpretation rule

Examples are usually context for intent, quality bar, or interaction style. Do not turn examples into exact feature work unless the user explicitly asks for that exact behavior.

## Product review checklist

Before shipping a Song Studio change, ask:

- Does it support the finished-song-to-promo-content flow?
- Does it improve default output quality or decision clarity?
- Is it scoped to `apps/song-studio-desktop/` unless otherwise requested?
- Does it avoid old web app work and PR #51?
- Does it avoid adding controls or polish that distract from the requested task?

## Verification checklist

From `apps/song-studio-desktop/`:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If `render:smoke` fails because the environment FFmpeg lacks `drawtext`, report that clearly. Do not convert the task into an FFmpeg tooling pass unless the user asks.

## Merge policy

Create PRs only when the task calls for it or the final report tells the user to click **Create PR**. Never merge without explicit user approval and review.
