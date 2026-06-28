# AI Scrum Working Agreement

Story ID: SCRUM-001  
Story title: Lightweight working agreement and source-of-truth setup  
Status: OWNER APPROVED / READY TO RECORD IN REPO  
Completion level: Owner-Accepted Process Rule

## 1. Product North Star

The active product is Song Studio Desktop, a desktop-first, local-first, song-first app under `apps/song-studio-desktop/`.

Song Studio Desktop turns finished songs into short-form promotional content. The product flow is: finished song -> choose or define a song moment -> audition visual direction -> adjust naturally -> export content worth posting.

Default output quality matters more than adding more controls. Song Studio Desktop should not be treated as the old SpectraCleanse web app or as a generic video editor.

Current priority: UX Recovery / Guided MVP flow.

Current product status: Song Studio Desktop is testable but confusing, not owner-accepted, and needs UX recovery.

Canvas Test Drive status: Internal testable, not product-ready, and needs owner validation.

## 2. Working Agreement

This is a lightweight working system, not a second project and not a giant Scrum system. It exists to keep future ChatGPT, Claude, Codex, and GitHub work aligned on proof, scope, PR, and story-gate rules.

Source-of-truth model:

1. Structured plan project = live planning workspace.
2. Repo docs = durable source of truth for approved direction and rules.
3. GitHub PRs, commits, branches, changed files, and checks = proof that repo work happened.
4. GitHub Issues or Projects may be added later, but are not required now.

A chat summary is not proof that work happened.

Proof means one or more of:

- branch
- commit SHA
- PR link/number
- changed file list
- checks run
- screenshots or manual UI test notes
- owner test result
- committed docs or code

No more feature work should move to `READY TO RUN` unless it has:

- user story
- acceptance criteria
- non-goals
- test path
- completion target
- owner approval when user-facing

If there is no clear user outcome, the work stays `PROPOSED`.

Owner approval is required before coding for:

- new user-facing feature
- new screen/panel
- major UX flow change
- hiding or deleting visible functionality
- provider/API/cloud/paid integrations
- major dependency changes
- major architecture changes
- primary product direction changes
- merging PRs that affect user-facing product behavior
- anything that changes what the user is supposed to do

Agents may decide without owner approval:

- wording improvements inside approved scope
- small internal docs updates
- minor test improvements
- small bug fixes that do not alter product direction
- formatting/cleanup that does not change behavior
- implementation details inside approved acceptance criteria

All changes must still be reported.

Repo boundaries:

- Active app path: `apps/song-studio-desktop/`
- Active base branch: `feat/song-studio-desktop-foundation`
- New work should branch from `feat/song-studio-desktop-foundation`.
- PRs should target `feat/song-studio-desktop-foundation`.
- Do not target `main` unless explicitly instructed.
- Old root SpectraCleanse web app: Off-limits unless explicitly requested.

Also off-limits unless explicitly approved:

- production provider/API integrations
- Gemini/Veo implementation
- paid calls
- cloud uploads
- API keys/secrets
- generated media committed to repo
- major dependency additions
- unrelated app areas outside `apps/song-studio-desktop/`
- release/package/distribution changes unless scoped
- destructive cleanup/deleting existing work without approval

## 3. Status Labels

### PROPOSED

An idea, recommendation, plan, story, or draft only. Nothing has been executed.

### READY TO RUN

The prompt, story, or command set is clear enough for another tool/person to execute.

### EXECUTED

Logs or output show that something was actually run. Execution alone does not mean the work is verified.

### VERIFIED

There is proof: PR, commit SHA, file list, checks, screenshots, manual test notes, or owner test result.

### BLOCKED

The task could not be completed.

The first line must start with:

`BLOCKED:`

Then explain why.

## 4. Completion Levels

Use these completion levels:

- Prototype
- Internal Tool / Internal Testable
- User-Testable Feature
- MVP-Usable Feature
- Owner-Accepted Feature

Do not say only “done.” Every work item should identify its completion level.

Important distinction:

- PR merged = repo work landed.
- User-testable = owner can test it.
- Owner-accepted = owner tested and approved it.

## 5. Backlog

First process item:

- SCRUM-001 — Lightweight working agreement and source-of-truth setup
  - Status: OWNER APPROVED / READY TO RECORD IN REPO
  - Completion level: Owner-Accepted Process Rule

First product story after SCRUM-001:

- UX-001 — Guided MVP first-run flow
  - Status: PROPOSED

Do not start UX-001. Do not create implementation tasks for UX-001. Do not redesign the app as part of SCRUM-001.

## 6. Current Sprint / Current Focus

Current priority: UX Recovery / Guided MVP flow.

Current focus is recording SCRUM-001 as a durable process rule. Product implementation work remains gated by story readiness and owner approval.

UX-001 remains `PROPOSED` until it has a clear user story, acceptance criteria, non-goals, test path, completion target, and owner approval.

## 7. Story Template

Use this lightweight template before moving work to `READY TO RUN`:

- Story ID:
- Story title:
- Status:
- Completion target:
- User story:
- Acceptance criteria:
- Non-goals:
- Test path:
- Owner approval required? Yes/No
- Repo scope:
- Branch target:
- PR target:
- Proof required:

## 8. Definition of Done

A work item is not complete just because a chat says it is complete. Completion requires evidence appropriate to the work type and completion level.

For repo work, report:

- status label
- story ID
- branch name
- commit SHA if available
- PR link/number if created
- files changed
- checks run
- failed checks with explanation
- whether runtime code changed
- whether old root web app was untouched
- completion level
- what remains unfinished
- whether PR is merged; normally it should not be

If no real repo output exists, the first line must be:

`BLOCKED:`

## 9. PR Review Gate

Codex-created PRs should be reviewed before merge. Agents must not merge PRs unless the owner explicitly instructs them to merge.

PRs that affect user-facing product behavior require owner approval before merge.

For Song Studio Desktop work:

- Branch from `feat/song-studio-desktop-foundation`.
- Target PRs to `feat/song-studio-desktop-foundation`.
- Do not target `main` unless explicitly instructed.
- Include changed files and checks run in the completion report.
- Include screenshots or manual UI test notes when user-facing UI changes are made.

## 10. Agent Handoff Rules

### Owner

Responsible for:

- product direction
- final acceptance
- approving user-facing stories
- deciding whether a feature feels useful
- approving merges that affect user-facing behavior

### ChatGPT

Responsible for:

- product reasoning
- lightweight Scrum guidance
- turning owner feedback into stories
- writing Codex/Claude prompts
- reviewing Codex/Claude outputs
- checking claims against evidence
- protecting scope
- recommending merge/revise/reject/block
- never claiming repo work happened without proof

### Claude

Responsible for:

- larger architecture/refactor reasoning
- deeper implementation strategy
- UX/product restructuring proposals
- complex code changes if connected to repo
- identifying risks before implementation
- reporting what is incomplete

Claude must not return only a plan unless the owner asked for only a plan.

### Codex

Responsible for:

- scoped repo edits
- creating branches inside its environment
- committing changes
- running checks
- preparing PRs through its available platform PR tool or Create PR flow
- reporting changed files and proof
- not merging

Important Codex rule:

Raw `git push` may fail from the shell because shell GitHub auth may not exist.

That does not automatically mean Codex cannot create a PR through the platform-level PR tool or Create PR flow.

Codex must use the available Create PR flow when available.

If no PR is created and no real repo proof exists, the status must be:

`BLOCKED`
