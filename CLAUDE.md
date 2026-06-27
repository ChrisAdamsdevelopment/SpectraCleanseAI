# Claude Context: Song Studio

## North star

Song Studio is desktop-first, local-first, and song-first. It helps artists turn finished songs into short-form promotional content worth posting.

Core flow: finished song → choose or define a song moment → audition visual direction → adjust naturally → export.

## Active scope

- Active app path: `apps/song-studio-desktop/`
- Active foundation branch: `feat/song-studio-desktop-foundation`
- Parent/foundation PR: #55
- Song Moment Selector v1 PR #56 has been merged into the foundation branch.
- PR #51 is parked release-readiness work. Do not work on it unless explicitly asked.

## Product principles

- This is not the old SpectraCleanse web app.
- This is not a generic video editor.
- Default output quality matters more than adding more controls.
- Build capability systems, not one-off effects.
- Treat examples as conceptual context unless the prompt explicitly asks for that exact implementation.

## Work style

- Start fresh after repeated corrections.
- Inspect and diagnose before coding.
- Keep changes scoped to the requested task.
- Do not add generated media, broad cleanup, or unrelated product features.
- Do not merge unless the user explicitly instructs you to merge.

## Verification

From `apps/song-studio-desktop/`, use:

```bash
npm install --include=dev
npm run typecheck
npm run build
npm run render:smoke
npm audit --audit-level=high
```

If render smoke fails because FFmpeg lacks `drawtext`, report that directly and do not expand the task into FFmpeg tooling.
