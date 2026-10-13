# Release Risk, Readiness & Product Packaging

Status: recommendation report for founder review · Does not change Phase 1 or the architecture · Does not block Phase 2.

**Founder direction (locked):**
- §1–§3 (risk / readiness / scoring definitions) are **approved** as the foundation for the scoring system.
- §4–§5 (tiers / Stripe) are **NOT locked.** Final packaging, plan names, feature bundles, and Stripe products are deferred until Phase 2 ships and a full Packaging & Monetization Report is completed (scope in §4a).
- Until then: **preserve all existing Stripe product IDs, subscribers, and billing relationships. No Stripe changes, no plan renames, no user migration.** Architect for entitlements. Continue Phase 2.

This document formally defines the mission in operational terms (risk, readiness, scoring) and proposes product packaging + Stripe alignment. It reconciles the business language ("release risk") with the engine already built (findings carry a `category` = where we check, and a `businessImpact` = the risk outcome we reduce).

---

## 1. Release Risk — definition

> **A release risk is any detectable condition in a release package that materially raises the probability of an adverse outcome at or after distribution** — rejection, takedown, withheld or lost revenue, reduced discoverability, broken attribution, or platform non-compliance.

Every risk is characterized by four properties the engine already records on each finding:

| Property | Engine field | Meaning |
|---|---|---|
| Surface (where found) | `category` | metadata · rights · ai_disclosure · platform_compliance · distribution_readiness |
| Outcome (the harm) | `businessImpact` | rejection · takedown · revenue_withheld · royalty_loss · delay · account_risk · reduced_reach |
| Severity (how bad) | `severity` | critical · warning · info |
| Certainty (how sure) | `confidence` | 0..1 |

**The six risk domains** (the founder's taxonomy) map to outcomes, not to a single surface — one surface can produce several risk types:

| Risk domain | Primary outcomes | Typical sources |
|---|---|---|
| Revenue risk | revenue_withheld, royalty_loss | missing/unregistered credits, wrong splits, missing ISRC/publisher |
| Distribution risk | rejection, delay | missing required fields, formatting, cover-art specs, file issues |
| Platform risk | takedown, account_risk, reduced_reach | DSP policy conflicts, disclosure mismatches |
| Rights risk | takedown, revenue_withheld, account_risk | uncleared samples, ownership/split conflicts, missing licenses |
| AI disclosure risk | takedown, account_risk, rejection | missing/inconsistent disclosure vs platform requirements |
| Operational risk | delay, rejection | missing release steps, incomplete package |

Key reframing the founder asked for: the question is **not** "is the metadata correct?" — it is **"what could prevent approval, monetization, discoverability, attribution, payment, or platform compliance?"** Metadata is one *surface*; the risks span all six domains above.

---

## 2. Release Readiness — definition

> **A release is Ready when, across every required assessment surface, no unresolved material risk remains and the release has actually been assessed on those surfaces.**

Formally, Ready requires all of:
1. No unresolved **critical** risk at or above the confidence gate.
2. No unresolved **warning** at or above the confidence gate.
3. Overall risk-reduction score ≥ the ready threshold (90).
4. **Every required surface has actually been assessed** (metadata, rights, platform_compliance). If any is unassessed, readiness is capped — "not checked" is never "safe."

Otherwise the release is **Needs Attention** (resolvable risk remains) or **High Risk** (a blocking risk or score below the high-risk threshold). This is exactly the verdict engine already shipped in Phase 1.

---

## 3. Scoring Philosophy

> **The score is a risk-reduction index, not a metadata-correctness grade.** 100 means no detected residual risk on the surfaces we assessed; lower means measurable risk remains.

- Each finding removes **expected risk** = `scoreImpact × confidence` (a near-certain critical costs more than a low-confidence "possible" one).
- Surfaces are weighted by how much real-world damage they cause — rights, platform, and metadata heaviest (founder-approved weights).
- The overall number is the inverse of remaining weighted risk across **assessed** surfaces; unassessed surfaces are excluded and cap the verdict (transparency over completeness).
- Therefore "improving your score" literally means "reducing your release risk," and every fix shows `+points if resolved` — the score *is* the risk model, made legible.

This satisfies the directive: the scoring engine measures risk reduction, not technical correctness.

---

## 4. Product Packaging Proposal (PRELIMINARY — not locked)

The tiering below is a working hypothesis to guide entitlement architecture, **not a committed packaging decision.** Final names, bundles, and tiers are deferred to the Packaging & Monetization Report (§4a) after Phase 2.

Value is grouped by *which risks we help you retire*, with clear personas and upgrade triggers. (Pricing intentionally omitted.)

| Tier | Persona | Value: risks addressed | Representative features |
|---|---|---|---|
| **Free — Scan** | Curious / first-time creator | See *that a* risk exists | Basic release scan, verdict + top issues, limited scans/month, no export, metadata cleanse (existing) |
| **Creator** | Active independent / AI-assisted creator | Retire metadata + disclosure risk | Full readiness reports, metadata validation, AI disclosure guidance, unlimited scans, export, batch-lite |
| **Pro** (today's "Studio") | Serious / frequent releaser | Retire rights + platform risk | Everything in Creator + rights validation, platform-compliance packs, advanced/exportable reports, full batch |
| **Label / Team** | Label, distributor, manager | Oversight across a roster | Everything in Pro + multi-user/seats, batch validation, team management, compliance oversight dashboard |

Upgrade paths (each driven by a risk the user just hit):
- Free → Creator: hit the scan limit, or wants the fix-it detail + export to actually resolve issues.
- Creator → Pro: needs rights/platform/AI-compliance depth, or batch across a release.
- Pro → Label: managing multiple artists / needs seats and oversight.

The original metadata cleanse is **not removed** — it folds in as a capability from Creator up, preserving existing value (per the no-removal constraint).

### 4a. Packaging & Monetization Report — deferred (complete after Phase 2)

To avoid locking branding/packaging before the providers give us evidence, the full review is deferred. When Phase 2 (and ideally Phase 3) providers exist, produce a report answering:

1. Which features belong in **Free**.
2. Which features belong in **Creator**.
3. Which features belong in **Professional-level** plans.
4. Whether **"Studio"** remains the correct name.
5. Whether **Release Readiness** becomes the primary value proposition.
6. Whether future **Label / Team** tiers are justified.
7. How the roadmap maps to **future Stripe products**.

Inputs that make this report credible: real findings volume/severity per provider, which checks users actually act on, and where the "needs attention → ready" conversion happens. We won't have that until providers run.

---

## 5. Stripe Alignment Proposal (recommendation only — do not implement yet)

Current state (from `server.js`): plans `free` / `creator` ($9.99) / `studio` ($29.99); `enterprise` is a type with no Stripe product; gating today is plan-based (`FREE_MONTHLY_LIMIT = 3`, batch requires a paid plan).

Hard constraints (founder direction): **preserve all existing Stripe product IDs, all subscribers, and all billing relationships. No Stripe changes, no plan renames, no user migration — now or as part of Phase 2.**

Recommendations (to evaluate in §4a, NOT to execute now):
1. **Keep the existing `creator` and `studio` price IDs intact.** Never delete a price ID with live subscribers — that breaks billing. Any forward mapping (e.g. whether `studio` is later presented as "Pro") is a §4a decision, not done now.
2. **Free stays non-Stripe** (no change).
3. **A future Label/Team tier** would be a *new* Stripe product (needs seat quantity + per-seat billing) added only in the phase that ships team features — justification is a §4a question.
4. **Build now: a plan→capability entitlement matrix** (server-side) mapping each plan to the providers/features it may use. This is *orthogonal* to feature flags (flags = what exists in an environment; entitlements = what a plan may use) and additive — no architecture change. This is the one packaging-related thing safe to architect for before names are decided.
5. Preserve the existing billing safety constraints (webhook `express.raw` ordering, price-ID env validation) — unchanged.

Net: zero Stripe changes now. Entitlements are architected so that when §4a finalizes packaging, monetizing modules is a config/entitlement decision — not a billing rebuild and not a subscriber migration.

---

## 6. Architecture Impact Assessment

**No architecture redesign. Phase 1 stands. Phase 2 proceeds unchanged.**

- The risk/readiness/scoring definitions above are already expressible with the shipped schema (`category` + `businessImpact` + `severity` + `confidence`). Nothing to refactor.
- Two **optional, additive** enhancements for later (not required for Phase 2):
  1. A "risk by domain" grouping in the report (group findings by `businessImpact`/domain) for a risk-centric view — the data already exists; it's a presentation add.
  2. The plan→capability entitlement matrix (item 5) — needed when we start charging per module, not before.
- Phase 2 (metadata validation provider) is unaffected: build it regardless of tier decisions. Packaging gates *who can run* a provider; it does not change *how* a provider is built.

**Guidance:** do not gate Phase 2 engineering on packaging/pricing decisions. The provider model means business packaging is a thin entitlement layer added later, over an engine that's built the same way regardless.
