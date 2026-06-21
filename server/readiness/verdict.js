"use strict";

/**
 * Verdict engine. Status is driven by BOTH score and severity, so a single
 * critical issue dominates even when the arithmetic looks fine.
 * See release-readiness-spec.md §3.
 */

const { SEVERITY, CHECK_STATUS } = require('./findings');
const { THRESHOLDS, REQUIRED_CATEGORIES } = require('./config');

const STATUS = Object.freeze({ READY: 'ready', NEEDS_ATTENTION: 'needs_attention', HIGH_RISK: 'high_risk' });

function isActionable(f) {
  return f.status === CHECK_STATUS.FAIL || f.status === CHECK_STATUS.WARN;
}

/**
 * @param {object} input
 * @param {Array}  input.findings
 * @param {number|null} input.overallScore
 * @param {string[]} input.assessedCategories
 * @param {string[]} [input.requiredCategories]
 * @param {object} [input.thresholds]
 * @returns {{status,overallScore,rationale,assessedCategories,notAssessed}}
 */
function decideVerdict({
  findings = [],
  overallScore = null,
  assessedCategories = [],
  requiredCategories = REQUIRED_CATEGORIES,
  thresholds = THRESHOLDS,
} = {}) {
  const gate = thresholds.confidenceGate;
  const criticals = findings.filter(
    (f) => f.severity === SEVERITY.CRITICAL && f.status === CHECK_STATUS.FAIL && f.confidence >= gate,
  );
  const warnings = findings.filter(
    (f) => f.severity === SEVERITY.WARNING && isActionable(f) && f.confidence >= gate,
  );
  const notAssessed = requiredCategories.filter((c) => !assessedCategories.includes(c));

  const rationale = [];
  let status;

  if (criticals.length > 0) {
    status = STATUS.HIGH_RISK;
    rationale.push(`${criticals.length} critical issue${criticals.length > 1 ? 's' : ''} must be fixed before release.`);
  } else if (overallScore != null && overallScore < thresholds.highRisk) {
    status = STATUS.HIGH_RISK;
    rationale.push(`Overall score ${overallScore} is below the high-risk threshold (${thresholds.highRisk}).`);
  } else if (
    warnings.length > 0 ||
    notAssessed.length > 0 ||
    (overallScore != null && overallScore < thresholds.needsAttention)
  ) {
    status = STATUS.NEEDS_ATTENTION;
    if (warnings.length > 0) rationale.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''} to review.`);
    if (overallScore != null && overallScore < thresholds.needsAttention) {
      rationale.push(`Overall score ${overallScore} is below the ready threshold (${thresholds.needsAttention}).`);
    }
  } else {
    status = STATUS.READY;
    rationale.push('No blocking issues found in the assessed categories.');
  }

  // Honesty cap: never declare "Ready" when a required category was not assessed.
  if (status === STATUS.READY && notAssessed.length > 0) {
    status = STATUS.NEEDS_ATTENTION;
  }
  if (notAssessed.length > 0) {
    rationale.push(`Not fully assessed yet: ${notAssessed.join(', ')}.`);
  }

  return { status, overallScore, rationale, assessedCategories, notAssessed };
}

module.exports = { decideVerdict, STATUS };
