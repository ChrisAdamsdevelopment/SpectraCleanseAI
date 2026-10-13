"use strict";

/**
 * Findings — the atomic unit of the Release Readiness framework.
 * See spectracleanse-engineering/docs/release-readiness-spec.md §1.
 *
 * A finding is designed around a real-world outcome and always teaches:
 * it carries what / why / businessImpact / howToFix.
 */

const SEVERITY = Object.freeze({ CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' });

const CATEGORY = Object.freeze({
  METADATA: 'metadata',
  RIGHTS: 'rights',
  AI_DISCLOSURE: 'ai_disclosure',
  PLATFORM_COMPLIANCE: 'platform_compliance',
  DISTRIBUTION_READINESS: 'distribution_readiness',
});
const CATEGORIES = Object.freeze(Object.values(CATEGORY));

const CHECK_STATUS = Object.freeze({ FAIL: 'fail', WARN: 'warn', PASS: 'pass', UNKNOWN: 'unknown' });

const BUSINESS_IMPACT = Object.freeze({
  REJECTION: 'rejection',
  TAKEDOWN: 'takedown',
  REVENUE_WITHHELD: 'revenue_withheld',
  ROYALTY_LOSS: 'royalty_loss',
  DELAY: 'delay',
  ACCOUNT_RISK: 'account_risk',
  REDUCED_REACH: 'reduced_reach',
  NONE: 'none',
});

// Higher rank = worse real-world consequence. Drives prioritized-fix ordering.
const BUSINESS_IMPACT_RANK = Object.freeze({
  takedown: 7,
  account_risk: 6,
  rejection: 5,
  revenue_withheld: 4,
  royalty_loss: 3,
  delay: 2,
  reduced_reach: 1,
  none: 0,
});

const SEVERITY_RANK = Object.freeze({ critical: 3, warning: 2, info: 1 });

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normalize + validate a raw finding into the canonical shape. Throws on an
 * unknown enum so provider bugs surface in tests rather than silently skewing scores.
 */
function makeFinding(raw = {}) {
  if (!raw.id || typeof raw.id !== 'string') throw new Error('finding.id is required');
  if (!CATEGORIES.includes(raw.category)) throw new Error(`finding.category invalid: ${raw.category}`);
  if (!Object.values(SEVERITY).includes(raw.severity)) throw new Error(`finding.severity invalid: ${raw.severity}`);
  if (!Object.values(CHECK_STATUS).includes(raw.status)) throw new Error(`finding.status invalid: ${raw.status}`);
  const businessImpact = raw.businessImpact || BUSINESS_IMPACT.NONE;
  if (!Object.values(BUSINESS_IMPACT).includes(businessImpact)) throw new Error(`finding.businessImpact invalid: ${businessImpact}`);

  return {
    id: raw.id,
    category: raw.category,
    severity: raw.severity,
    status: raw.status,
    confidence: clampConfidence(raw.confidence == null ? 1 : raw.confidence),
    title: String(raw.title || ''),
    what: String(raw.what || ''),
    why: String(raw.why || ''),
    businessImpact,
    howToFix: String(raw.howToFix || ''),
    scoreImpact: Number.isFinite(Number(raw.scoreImpact)) ? Number(raw.scoreImpact) : 0,
    estimatedFixMinutes: Number.isFinite(Number(raw.estimatedFixMinutes)) ? Number(raw.estimatedFixMinutes) : undefined,
    field: raw.field || undefined,
    evidence: raw.evidence || undefined,
    ruleRef: raw.ruleRef || undefined,
    learnMoreId: raw.learnMoreId || undefined,
  };
}

/** Effective points a finding removes from its category (0 unless fail/warn). */
function effectiveDeduction(finding) {
  if (finding.status !== CHECK_STATUS.FAIL && finding.status !== CHECK_STATUS.WARN) return 0;
  return (finding.scoreImpact || 0) * clampConfidence(finding.confidence);
}

module.exports = {
  SEVERITY, CATEGORY, CATEGORIES, CHECK_STATUS, BUSINESS_IMPACT,
  BUSINESS_IMPACT_RANK, SEVERITY_RANK,
  makeFinding, effectiveDeduction, clampConfidence,
};
