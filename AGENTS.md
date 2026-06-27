# Agent Guidance for SpectraCleanseAI

## Active project direction

- Current active product work is **Song Studio**, a desktop-first, local-first, song-first app under `apps/song-studio-desktop/`.
- Song Studio turns finished songs into short-form promotional content.
- Product flow: finished song → choose or define a song moment → audition visual direction → adjust naturally → export content worth posting.
- Default output quality matters more than adding more controls.
- Do not treat Song Studio as the old SpectraCleanse web app or as a generic video editor.

## Branch and PR workflow

- `feat/song-studio-desktop-foundation` is the active Song Studio desktop foundation branch.
- PR #55 is the parent/foundation PR.
- PR #56, Song Moment Selector v1, has already been merged into `feat/song-studio-desktop-foundation`.
- PR #51 is release-readiness work and should remain parked unless the user explicitly requests it.
- Do not merge branches or PRs unless the user explicitly instructs you to merge.
- Codex-created PRs should be reviewed before merge.

## Codex workflow rules

- Codex can edit files inside a task, but the user controls whether to click **Create PR** in the UI.
- Do not write instructions that assume Codex can push to an existing PR unless the current UI explicitly supports that action.
- Codex tasks should clearly say whether the user should click **Create PR**.
- ChatGPT/GitHub review handles PR review and merge only after explicit user approval.

## Prompt interpretation

- Casual examples are conceptual context, not literal build commands or feature requests.
- Inspect the relevant app and docs before coding.
- Build durable capability systems instead of isolated one-off effects.
- Avoid polishing the wrong surface: stay focused on Song Studio desktop unless the user explicitly changes scope.

## What not to work on by default

- Do not work on PR #51 unless explicitly requested.
- Do not work on the old SpectraCleanse web app unless explicitly requested.
- Do not implement product features during documentation-only workflow passes.
- Do not add broad cleanup, generated media, credentials, or unrelated changes.

## Verification expectations

For Song Studio desktop changes, prefer these checks from `apps/song-studio-desktop/`:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If `render:smoke` fails because the environment FFmpeg lacks `drawtext`, report it clearly and do not turn that into an FFmpeg tooling pass unless asked.

## Stop conditions

Stop and report rather than continuing if:

- The requested work would affect PR #51 or the old web app without explicit approval.
- The task requires merging or force-pushing without explicit user approval.
- Verification fails for reasons outside the requested scope.
