# Release Readiness Intelligence — Foundational Specification

Status: draft for approval · Owner: founder + engineering · Supersedes the module-first ordering in `feature-flags-and-migration.md`.

> North star: **"Can I safely release this content today, and if not, exactly what do I need to fix first?"**
> Every feature, API, report, and UI decision is filtered through one question: *does this reduce release risk?* If no, it is not in the MVP.

This document specifies the five foundational systems. Get these right and metadata validation, rights, AI disclosure, and platform compliance all become **modules that plug into one intelligence framework**. Get them wrong and we rebuild later.

The five specs:
1. Findings Schema (the atomic unit)
2. Scoring Methodology
3. Verdict Engine
4. Report Generation System
5. Compliance Rule Registry

Plus: the Provider interface that lets modules plug in, and the phase plan.

---

## 0. Architecture in one paragraph

Normalized release inputs flow into a set of **check providers** (one per module, each behind its feature flag). Every provider emits **findings** in a single shared schema. The **scoring engine** turns findings into per-category scores; the **verdict engine** turns scores + severities into one status; the **report generator** composes everything into a persisted, exportable `ReleaseReadinessReport`. Platform-specific knowledge lives in a **data-driven compliance rule registry**, not in code. Education is not a separate system — it is built into every finding.

```
inputs → [providers: metadata · rights · ai · platform · distribution]
       → findings[]  → scoring engine → category scores
                     → verdict engine → status + overall score
                     → report generator → ReleaseReadinessReport (persisted, exportable)
   compliance rule registry (versioned data) ──┘ feeds providers
```

---

## 1. Findings Schema

The atomic unit. Findings are designed around **real-world outcomes**, not technical observations, and every finding teaches.

```ts
type Severity   = 'critical' | 'warning' | 'info';
type Category   = 'metadata' | 'rights' | 'ai_disclosure' | 'platform_compliance' | 'distribution_readiness';
type CheckStatus = 'fail' | 'warn' | 'pass' | 'unknown'; // unknown = not enough info to decide

type BusinessImpact =
  | 'rejection'        // release blocked at submission
  | 'takedown'         // removed after going live
  | 'revenue_withheld' // royalties held
  | 'royalty_loss'     // money leaks via wrong/missing credits
  | 'delay'            // release delayed
  | 'account_risk'     // strike / suspension
  | 'reduced_reach'    // discoverability / algorithmic suppression
  | 'none';

interface Finding {
  id: string;                 // stable code, namespaced by category: "metadata.missing_artist"
  category: Category;
  severity: Severity;         // how bad IF it is a real problem
  status: CheckStatus;        // the actual outcome of the check
  confidence: number;         // 0..1 — honesty about uncertainty (binary checks = 1.0)
  title: string;              // short label: "No artist name"
  what: string;               // what was found
  why: string;                // why it matters, in plain language
  businessImpact: BusinessImpact; // the real-world consequence (enum → sortable/groupable)
  howToFix: string;           // the concrete action
  scoreImpact: number;        // nominal points removed from the category (pre-confidence)
  field?: string;             // input field involved, if any
  evidence?: Record<string, unknown>; // matched value, marker names, etc.
  ruleRef?: { registryId: string; version: string }; // set if produced by the rule registry
  learnMoreId?: string;       // pointer into education/glossary content
}
```

Design rules:
- **severity ≠ status ≠ confidence.** Severity is "how bad if true," status is "what we actually found," confidence is "how sure we are." Keeping them separate is what lets us say *"possible sample usage (medium confidence)"* honestly instead of pretending it is definitive.
- **Every finding carries the teaching fields** (`what`, `why`, `businessImpact`, `howToFix`, optional `learnMoreId`). The UI never has to invent explanations.
- **`businessImpact` is an enum**, not prose, so the dashboard can group/sort by real-world consequence (the creator's mental model) and rank fixes.
- **`id` is stable and namespaced** so findings can be referenced, suppressed, linked to education, and tracked over time.

---

## 2. Scoring Methodology

Per-category scores, then one overall score. Tunable constants live in config, not scattered in code.

**Per-category score**
- Each assessed category starts at `100`.
- For each finding with `status ∈ {fail, warn}`: `effectiveDeduction = scoreImpact × confidence`.
  (`info`/`pass`/`unknown` deduct 0.) Multiplying by confidence means a low-confidence "possible AI" finding dents the score less than a certain one — uncertainty is represented, not faked.
- `categoryScore = clamp(100 − Σ effectiveDeduction, 0, 100)`.

**Overall score**
- Weighted average over **assessed** categories only. Weights (sum 1.0, tunable) — tuned rights-and-compliance-heavy because takedowns, withheld royalties, and rights disputes are the top creator pains:

  | Category | Weight |
  |---|---|
  | rights | 0.30 |
  | platform_compliance | 0.25 |
  | metadata | 0.25 |
  | ai_disclosure | 0.12 |
  | distribution_readiness | 0.08 |

- **Coverage honesty:** a category with no provider enabled or no input is `not_assessed` and **excluded** from the average (remaining weights renormalize). We never invent a fake 100 for a category we did not check. This is what makes phased rollout safe — in Phase 2 only `metadata` is assessed, and the report says so.

---

## 3. Verdict Engine

Status is driven by **both** score and severity, because a single critical issue must dominate even when the arithmetic looks fine.

```ts
interface Verdict {
  status: 'ready' | 'needs_attention' | 'high_risk';
  overallScore: number;          // 0..100
  rationale: string[];           // human reasons: "1 critical: no artist name"
  assessedCategories: Category[];
  notAssessed: Category[];
}
```

Rules (evaluated top-down) — tuned strict, so "Ready" is hard to earn:
- **High Risk** if any `critical` finding with `confidence ≥ 0.4` and `status = fail`, OR `overallScore < 60`.
- **Needs Attention** if any `warning` with `confidence ≥ 0.4`, OR a required field is unresolved, OR `overallScore < 90`.
- **Ready** otherwise.
- **Honesty cap:** if any *required* category is `not_assessed`, the verdict may not be "Ready" — it is capped at "Needs Attention" with a "not fully assessed" note. We never tell a creator they are clear based on incomplete data.

Thresholds (confidence gate `0.4`, High Risk `60`, Needs Attention `90`) are config constants, tunable after we see real data.

---

## 4. Report Generation System

One canonical structure, persisted on every run (this *is* the audit trail / readiness history) and exportable.

```ts
interface ReleaseReadinessReport {
  reportId: string;
  releaseId: string;
  generatedAt: string;            // ISO
  engineVersion: string;          // bump when scoring/verdict logic changes (reproducibility)
  ruleRegistryVersion: string;    // which compliance data was used
  verdict: Verdict;
  categoryScores: Array<{
    category: Category;
    score: number | null;         // null = not assessed
    status: 'pass' | 'attention' | 'risk' | 'not_assessed';
    findingCounts: { critical: number; warning: number; info: number };
  }>;
  prioritizedFixes: Finding[];    // "fix this first" — see ranking below
  findings: Finding[];            // full list
  inputsSnapshot: Record<string, unknown>; // exactly what was evaluated (reproducibility + audit)
}
```

**Prioritized-fix ranking** (the most important UX output): sort by
1. severity (`critical` > `warning` > `info`),
2. `businessImpact` rank (`rejection`/`takedown`/`revenue_withheld` highest),
3. effective score impact (`scoreImpact × confidence`),
4. category weight.

**Persistence:** each report is stored (`release_reports`) keyed to the release; the history is the audit trail. `engineVersion` + `ruleRegistryVersion` + `inputsSnapshot` make any past verdict reproducible. Hashes/timestamps (chain-of-custody) attach here later as *supporting infrastructure* — never marketed as blockchain.

**Export:** JSON is canonical; a human-readable PDF/printable view is generated from the same structure in a later phase.

---

## 5. Compliance Rule Registry

Platform and distributor policies change constantly. They must be **data, versioned and updatable independently of core code** — no platform logic hardcoded across the app.

```ts
interface ComplianceRule {
  id: string;                 // "spotify.title_no_featured"
  registryId: string;         // pack grouping, e.g. "spotify"
  platforms: string[];        // ['spotify','apple'] or ['*']
  category: Category;         // usually platform_compliance; rules may target any category
  severity: Severity;
  confidence: number;         // default confidence when the rule fails
  scoreImpact: number;
  appliesWhen?: Condition;    // optional precondition; if omitted, always applies
  assertion: Condition;       // must be TRUE for compliance; if FALSE → emit finding
  title: string; what: string; why: string;
  businessImpact: BusinessImpact; howToFix: string;
  learnMoreId?: string;
  source?: string;            // policy citation / URL
  lastReviewed: string;       // date — policies drift, track freshness
}

// Safe, declarative predicate AST over the release context. No eval, ever.
type Condition =
  | { field: string; op: 'present'|'absent'|'matches'|'not_matches'|'in'|'gt'|'lt'|'eq'; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };
```

**Engine:** `evaluateRules(context, rules) → Finding[]`. For each rule whose `appliesWhen` holds (or is absent), if `assertion` evaluates false, emit a finding built from the rule's teaching fields, tagged with `ruleRef = { registryId, version }`.

**Packaging:** rules ship as versioned JSON (e.g. `compliance/spotify.v3.json`) each carrying `version` + `lastReviewed`. Updating a policy = edit data, bump version. The active registry version is recorded in every report. The Phase 1 engine is built now; the packs get populated in Phase 5.

---

## 6. Provider interface (how modules plug in)

```ts
interface ReleaseContext {
  metadata: Record<string, string>;     // title, artist, albumArtist, producer, copyright, genre, tags, ...
  analysis?: { format?: string; detectedMarkers?: string[]; provenanceRisk?: 'High'|'Low'; parseError?: string|null };
  disclosures?: unknown;                 // declared AI usage (Phase 4)
  rights?: unknown;                      // samples, splits, licenses (Phase 3)
  targets?: { platforms?: string[]; distributor?: string }; // (Phase 5)
}

interface CheckProvider {
  category: Category;
  featureFlag: string;                   // provider runs only when its flag is enabled
  evaluate(ctx: ReleaseContext): Finding[] | Promise<Finding[]>;
}
```

The framework runs every **enabled** provider, aggregates findings, scores, renders the verdict, and generates the report. Adding a module = implement a provider + register it. Nothing else in the engine changes.

---

## 7. Phase plan (revised order)

| Phase | Deliverable | Flag(s) | Notes |
|---|---|---|---|
| 0 ✅ | Feature-flag + branch scaffolding | — | done |
| 1 | **Intelligence framework**: findings schema, scoring engine, verdict engine, report generator, rule-registry engine, provider interface, release storage, gated API + dashboard shell | `release_readiness` | the foundation; ships with full unit tests and an example provider |
| 2 | Metadata validation provider | `metadata_validation` | first real provider; first honest verdict |
| 3 | Rights & ownership provider | `rights_verification` | |
| 4 | AI credits / disclosure provider | `ai_disclosure` | |
| 5 | Platform compliance rule packs | `platform_compliance` | populate the registry the Phase 1 engine already runs |

Education (`what`/`why`/`businessImpact`/`howToFix`/`learnMoreId` + the release wizard, "why we ask" explainers, first-run tour, sample release) is cross-cutting across all phases.

---

## 8. Decisions — resolved (founder sign-off, 2026-06)

1. **Category weights** — ✅ rights-and-compliance-heavy: rights 0.30, platform_compliance 0.25, metadata 0.25, ai_disclosure 0.12, distribution_readiness 0.08 (§2).
2. **Verdict thresholds** — ✅ strict: High Risk `<60`, Needs Attention `<90`, confidence gate `0.4` (§3).
3. **The five categories** — ✅ keep all five; `distribution_readiness` stays distinct (distributor-specific submission requirements: cover-art specs, UPC/ISRC, splits setup).
4. **Deduction model** — ✅ `confidence × scoreImpact`, with the honesty cap (never "Ready" on incomplete data).
5. **Compliance rule registry** — ✅ declarative `Condition` AST as versioned JSON.

Status: **approved for Phase 1 implementation.**

---

## 9. Dashboard UX refinements (founder sign-off)

The dashboard must feel like a **release advisor, not a technical audit**. Priority is clarity over style. Required:

1. **Lead with the verdict** — `READY TO RELEASE` / `NEEDS ATTENTION` / `HIGH RISK` is the headline; the numeric score sits beneath it.
2. **"Top issues preventing release"** section directly under the verdict — the blocking/important items in plain language, so the user instantly sees what stands in the way. (Report field: `topIssues`.)
3. **Every finding card shows**: what was found · why it matters · business impact · recommended fix · **estimated fix time** · **score gain if resolved** (e.g. "+4"). (Schema: `estimatedFixMinutes`; report: `scoreGainIfResolved` per prioritized fix.)
4. **Plain-English severity/score labels** alongside numbers: Excellent (≥90) · Good (≥75) · Needs attention (≥60) · High risk (<60) · Not assessed (null). (Report: `scoreLabel` overall, `label` per category.)
5. **Education is expandable, not hidden** — each finding supports `Why this matters ▾`, `How to fix ▾`, `Learn more ▾`. Teach while resolving.
6. **"Not assessed" stays visible** for unbuilt modules. Never generate placeholder or simulated scores — transparency over completeness (reinforces the §3 honesty cap).
7. The whole screen answers one question: *"Can I safely release this today, and if not, exactly what should I fix first?"*
