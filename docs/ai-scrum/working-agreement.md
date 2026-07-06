# AI Scrum Working Agreement — Song Studio Desktop

## Purpose

This is the durable work-management system for Song Studio Desktop. It aligns ChatGPT, Claude, Codex, future agents, and humans on product authority, hierarchy, proof, review, and acceptance.

## Product authority

Start every major Song Studio task with `docs/ai-scrum/START_HERE.md`. Current product truth lives in the Product North Star, Product Outcome Tree, Current State, Working Agreement, active story, and newest relevant decision records. Historical story docs are evidence, not governing authority.

## Work hierarchy

- Level 0 — North Star Outcome.
- Level 1 — Product Capability.
- Level 2 — Epic / System.
- Level 3 — Story.
- Level 4 — Task.
- Level 5 — Evidence / Acceptance.

## Story types

- User Story: creator-visible outcome.
- Enabler Story: necessary technical capability; must name its first creator-facing consumer.
- Discovery / Research Story: resolves a real unknown before implementation.
- Process Story: changes coordination or verification.

No story type is exempt from parent capability, parent epic/system, North Star contribution, acceptance criteria, non-goals, verification path, completion target, and proof.

## Lifecycle states

- PROPOSED: idea exists but is not approved for execution.
- OWNER APPROVED: owner accepts the intended outcome.
- READY TO RUN: story is complete enough to hand to an agent.
- IN PROGRESS: real work has begun.
- EXECUTED: agent returned real work and evidence.
- PR OPEN: real PR exists.
- VERIFIED: ChatGPT or another reviewer inspected actual repo evidence.
- MERGED: repo change landed.
- OWNER ACCEPTED: owner tested and accepted user-facing behavior, or accepted a process/document system.
- BLOCKED: cannot proceed.
- SUPERSEDED: replaced by a newer decision or story.

PR merged is not Owner Accepted. User-facing work should not be called Owner Accepted without owner testing. Historical work may be superseded without rewriting history.

## Required story fields

Every Story must contain ID, title, work-item type, status, parent North Star, parent capability, parent epic/system, North Star contribution, user/system outcome, why now, acceptance criteria, non-goals, test/verification path, completion target, owner approval requirement, repo scope, implementation constraints, proof required, and roll-up impact.

Additional required fields:

- User-facing controls: Control Causality — what real behavior changes because the control exists?
- AI/generation work: Generation Economics — what can happen before expensive generation, and what consumes external credits or paid calls?
- Enabler Stories: First Creator-Facing Consumer — what real experience consumes this system first?

## No passive abstraction rule

Do not create passive enums, passive fields, future hooks, unused metadata, or read-only summaries and count them as meaningful progress. An Enabler must identify the creator-facing behavior enabled, first consuming slice, and verification that it is actually consumed. Passive foundation work requires explicit owner approval as discovery or migration.

## Example-not-specification rule

Owner examples explain a general problem, possibility, or use case unless the owner explicitly says the example itself is a requirement. Ask what general capability an example reveals. Do not overfit architecture or stories to lightning, explosions, monsoons, multiple artists, Spanish trap, bass impacts, CTAs, or any other example.

## Control and generation rules

- No control without causality: controls must change output plans/results in testable ways.
- Cheap intelligence before expensive generation: AI should earn generation.
- Provider, billing, BYOK, credits, legal, and pricing decisions require separate approval.
- Never regenerate good video only to change deterministic material when targeted deterministic revision is possible.

## Multi-agent review protocol

Roles:

- Owner defines product truth and final acceptance.
- ChatGPT acts as product manager, story architect, evidence reviewer, PR/merge gate, and reconciler.
- Codex performs scoped repo work and correction passes.
- Claude provides independent architecture/product/implementation review when requested.

Major work chain:

1. Owner approves intended outcome.
2. ChatGPT prepares story/prompt.
3. Codex creates first repo-backed implementation.
4. ChatGPT reviews Codex summary before Create PR.
5. A real PR is created.
6. ChatGPT inspects actual diff and status.
7. Claude may independently review the exact PR.
8. ChatGPT reconciles findings.
9. Codex applies approved corrections to the same PR.
10. ChatGPT re-verifies updated diff.
11. Owner authorizes merge.
12. User-facing work receives owner acceptance testing after merge unless explicitly tested earlier.

Review agents should not create competing implementation branches by default.

## Codex workflow rule

1. Start from latest remote `main` unless the owner explicitly names another base.
2. Work on one task branch.
3. Return real evidence.
4. Do not merge.
5. Owner brings the summary to ChatGPT.
6. ChatGPT decides whether the user should click Create PR.
7. After Create PR, ChatGPT inspects the actual PR.
8. Corrections update the same PR branch.
9. ChatGPT decides whether Update PR is ready.
10. Merge occurs only after explicit owner authorization.

If no real repo change, branch, commit, or reviewable output can be produced, return `BLOCKED:` as the first line.

## Definition of Done

For repo work, report story ID, status, completion level, starting branch/ref, working branch, commit SHA if available, PR if created, files changed, checks run, failed checks, runtime-code impact, old-root-app impact, unresolved items, and whether owner acceptance remains needed.

For docs/process work, `git diff --check` and `git diff --name-only` are expected. Do not run expensive app builds for docs-only tasks.
