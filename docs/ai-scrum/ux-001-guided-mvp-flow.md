# UX-001 — Guided MVP first-run flow

> **Historical story notice (SCRUM-002, 2026-07-06):** This file is preserved as evidence of prior work. It is not current product authority; start with `docs/ai-scrum/START_HERE.md` for active doctrine, branch rules, and work hierarchy.

Story ID: UX-001  
Story title: Guided MVP first-run flow  
Status: PROPOSED — OWNER REVIEW NEEDED BEFORE IMPLEMENTATION  
Completion level target: Owner-Reviewable Product Story

## 1. Status

PROPOSED — OWNER REVIEW NEEDED BEFORE IMPLEMENTATION.

This story is ready for owner review only. It is not approved for implementation until the owner confirms the direction.

## 2. Product context

Current product priority: UX Recovery / Guided MVP flow.

Song Studio Desktop is testable but confusing, not owner-accepted, and needs UX recovery. Canvas Test Drive is internal testable, not product-ready, and needs owner validation.

The app already has real functionality, but the next development direction should not be adding more features. The next direction should be turning the existing pieces into one guided creator path:

1. Add song/audio.
2. Add cover art.
3. Choose simple promo output.
4. Preview.
5. Create MP4.
6. Review result.

## 3. Current problem

The app runs, but the experience feels confusing, overbuilt, and not organized around a simple useful creator workflow.

Recent work added real functionality, but the current app exposes too many internal concepts and technical panels to the user. The UI currently feels more like a development control surface than a guided creator tool.

UX observations to preserve as product guidance:

- The current app has real functionality but feels too dense.
- The start screen is moving in the right direction.
- The editor exposes too many concepts at once.
- The UI currently feels more like a development control surface than a guided creator tool.
- Canvas Test Drive should stay internal for now.
- Export review/result panels are useful but should support a clearer main flow.
- The first user win should be creating one useful MP4.

## 4. Target user

A music creator who wants a simple promo video without understanding render engines, metrics, recipes, layers, or internal test panels.

## 5. Desired user outcome

The user opens Song Studio Desktop, chooses a simple promo-video path, adds cover art and audio, clicks one clear create/render button, and receives an MP4 they can review.

## 6. Proposed guided flow

Core flow:

1. Start with a clear promise.
2. Add audio.
3. Add cover art.
4. Choose promo type or vibe.
5. Pick or accept a suggested song moment.
6. Preview the promo.
7. Click one clear create/render button.
8. Review the completed MP4.

The flow should feel like a creator path, not like a technical configuration sequence. Defaults should carry more weight than controls, and the main path should remain obvious even if deeper customization remains available later.

## 7. What should be simplified or hidden

This story proposes simplifying the creator-facing experience by reducing the prominence of internal concepts and diagnostics. These are product guidance notes only, not implemented changes.

Concepts that should be simplified, deferred, or hidden from the primary creator path:

- Render engines and low-level render readiness details unless something is wrong.
- Metrics and internal test panels.
- Recipe-like or development-facing configuration language.
- Layer terminology before the user has a reason to edit design details.
- Inspector-style technical controls before the user has a first useful preview.
- Canvas Test Drive as a primary product destination.

Suggested language improvements to consider during implementation, as proposed examples only:

| Current / technical language | Proposed creator-facing language |
| --- | --- |
| Directions | Pick a promo vibe |
| Manual fallback | Choose promo type |
| Style | Choose a look |
| Layers | Edit design |
| Inspector | Customize |
| Clip start | Start at |
| Duration | Length |
| Export review | Before you render |
| Render MP4 | Create MP4 |
| Canvas Test Drive | Internal/dev only, not primary product UI |
| FFmpeg ready | Hide under diagnostics unless there is a problem |

## 8. Acceptance criteria

For this story to move from proposed to ready for implementation, the owner should be able to review this document and confirm that it describes the desired UX recovery direction.

Implementation acceptance criteria proposed for the future UX-001 work:

- The first-run path clearly explains what Song Studio Desktop helps the creator make.
- The required inputs are obvious: audio and cover art.
- The default editor experience emphasizes preview, moment/look selection, and one clear create action.
- The user can follow the main path without understanding render engines, metrics, recipes, layers, or internal test panels.
- Canvas Test Drive and internal diagnostics are not presented as the main creator workflow.
- Export review/result panels support the main path and make the completed MP4 obvious.
- The first user win is creating one useful MP4.
- Creator-facing labels are reviewed for clarity and avoid unnecessary technical wording.

## 9. Non-goals

Do not use this story to:

- Implement UX-001 yet.
- Change runtime app code.
- Redesign UI.
- Create components.
- Move panels.
- Rename UI labels in code.
- Hide Canvas Test Drive in code.
- Modify `apps/song-studio-desktop/` runtime files.
- Touch the old root SpectraCleanse web app.
- Add features.
- Add dependencies.
- Add provider/API/cloud/paid behavior.
- Commit generated media.
- Create UX implementation tasks beyond the proposed slices below.
- Create a giant Scrum system.
- Target `main`.

## 10. Test path / checks

Documentation-only checks for this story-definition task:

```bash
git diff --check
```

If Markdown lint tooling already exists and is easy to run, run it without adding new tooling.

Do not run app builds unless runtime files are changed, which this story explicitly does not require.

Future implementation test path, to be refined after owner approval:

1. Launch Song Studio Desktop.
2. Start from the first-run or start screen.
3. Add an audio file.
4. Add cover art.
5. Choose or accept a promo type/vibe.
6. Choose or accept a song moment.
7. Preview the promo.
8. Create MP4.
9. Confirm the completed MP4 is visible and reviewable.
10. Confirm the user did not need to understand internal render, metrics, recipe, layer, or diagnostic concepts to complete the main flow.

## 11. Completion target

Initial target: User-Testable Feature.

Final target after owner testing: Owner-Accepted Feature.

This document's completion target is Owner-Reviewable Product Story.

## 12. Owner validation questions

Main owner validation question:

Does this make Song Studio Desktop feel like a clear creator product instead of a collection of technical panels?

Additional validation questions:

- Is the proposed first user win correct: creating one useful MP4?
- Are audio and cover art the right required inputs to emphasize first?
- Should the first-run path ask for promo type/vibe before or after choosing a song moment?
- Which technical concepts, if any, must remain visible in the primary creator flow?
- Is Canvas Test Drive clearly internal-only for now?
- Are the proposed implementation slices the right order for a UX recovery pass?

## 13. Proposed implementation slices

These are proposed slices only. They are not implementation tasks until the owner approves the story direction.

### UX-001A — First-run product path clarity

Goal: Make the first screen communicate the main promise and required inputs clearly.

Potential scope:

- Clarify the first-run promise.
- Make audio and cover art feel like the obvious starting inputs.
- Avoid introducing internal concepts before the creator has a path.

### UX-001B — Guided editor simplification

Goal: Make the default editor view focus on preview, moment/look selection, and one clear create button.

Potential scope:

- Make the preview the center of the default workflow.
- Keep moment/look decisions creator-facing.
- Reduce prominence of technical panels in the default path.

### UX-001C — Export success path

Goal: Make the completed MP4 result obvious, with clear next actions.

Potential scope:

- Make export progress and completion understandable.
- Make the completed MP4 easy to find and review.
- Keep next actions simple after render completes.

### UX-001D — Internal tools boundary

Goal: Keep Canvas Test Drive and internal metrics separate from the creator-facing flow.

Potential scope:

- Define which tools are internal-only for now.
- Keep diagnostics available for troubleshooting without making them the primary experience.
- Preserve internal testability while protecting creator clarity.

### UX-001E — Creator-language polish pass

Goal: Replace technical labels with creator-facing language where appropriate.

Potential scope:

- Review labels in the main flow.
- Replace technical wording where it blocks understanding.
- Keep language accurate without exposing implementation details unnecessarily.

## 14. Risks / open questions

- Simplifying the visible flow could accidentally hide useful power controls if the boundary between default path and customization is not clear.
- Canvas Test Drive may still be needed by the team, so internal access should be preserved even if it is removed from the primary creator path later.
- The exact order of promo type/vibe selection and song moment selection may need owner testing.
- Export review/result panels may need clearer hierarchy rather than removal.
- Creator-facing language should be tested against the owner's expectations before broad renaming.
- This story should not become a broad redesign; it should recover one guided MVP path.

## 15. Implementation has not started

Implementation has not started.

This document defines UX-001 for owner review only. No runtime app code, UI labels, panels, components, Canvas Test Drive visibility, dependencies, generated media, or old root web app files are changed by this story-definition task.
