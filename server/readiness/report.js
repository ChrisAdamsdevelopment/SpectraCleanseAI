"use strict";

/**
 * Report generator — orchestrates the framework end to end:
 *   providers -> findings -> scoring -> verdict -> ReleaseReadinessReport.
 * See release-readiness-spec.md §4.
 */

const crypto = require('crypto');
const {
  CATEGORIES, SEVERITY_RANK, BUSINESS_IMPACT_RANK, CHECK_STATUS, effectiveDeduction, makeFinding,
} = require('./findings');
const { ENGINE_VERSION, CATEGORY_WEIGHTS } = require('./config');
const { scoreFindings } = require('./scoring');
const { decideVerdict } = require('./verdict');

function categoryStatus(score) {
  if (score == null) return 'not_assessed';
  if (score >= 90) return 'pass';
  if (score >= 60) return 'attention';
  return 'risk';
}

// Plain-English label for a score (spec §4 refinement). Honest about unknowns.
function scoreBandLabel(score) {
  if (score == null) return 'Not assessed';
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Needs attention';
  return 'High risk';
}

function countBySeverity(findings) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** Sort actionable findings so the most consequential fix is first. */
function prioritize(findings) {
  return findings
    .filter((f) => f.status === CHECK_STATUS.FAIL || f.status === CHECK_STATUS.WARN)
    .sort((a, b) =>
      (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) ||
      (BUSINESS_IMPACT_RANK[b.businessImpact] - BUSINESS_IMPACT_RANK[a.businessImpact]) ||
      (effectiveDeduction(b) - effectiveDeduction(a)) ||
      ((CATEGORY_WEIGHTS[b.category] || 0) - (CATEGORY_WEIGHTS[a.category] || 0)));
}

/**
 * @param {object} input
 * @param {string|number} input.releaseId
 * @param {object} input.context  ReleaseContext
 * @param {Array}  input.providers enabled CheckProviders
 * @param {string} [input.ruleRegistryVersion]
 * @param {Date}   [input.now]
 * @returns {Promise<object>} ReleaseReadinessReport
 */
async function generateReport({ releaseId, context = {}, providers = [], ruleRegistryVersion = 'none', now = new Date() }) {
  const findings = [];
  const assessed = new Set();
  for (const provider of providers) {
    assessed.add(provider.category);
    const produced = await provider.evaluate(context);
    for (const raw of produced || []) findings.push(makeFinding(raw));
  }
  const assessedCategories = [...assessed];

  const { categoryScores, overallScore } = scoreFindings(findings, assessedCategories);
  const scoreByCategory = Object.fromEntries(categoryScores.map((c) => [c.category, c.score]));
  const verdict = decideVerdict({ findings, overallScore, assessedCategories });

  const categoryBreakdown = CATEGORIES.map((category) => {
    const score = category in scoreByCategory ? scoreByCategory[category] : null;
    const catFindings = findings.filter((f) => f.category === category);
    return {
      category,
      score,
      status: categoryStatus(score),
      label: scoreBandLabel(score),
      findingCounts: countBySeverity(catFindings),
    };
  });

  // Each fix carries the score it would return if resolved, so the UI can show "+4".
  const prioritizedFixes = prioritize(findings).map((f) => ({
    ...f,
    scoreGainIfResolved: Math.round(effectiveDeduction(f)),
  }));

  // "Top issues preventing release": the actionable, consequential ones, short form.
  const topIssues = prioritizedFixes
    .filter((f) => f.severity === 'critical' || f.severity === 'warning')
    .map((f) => ({ id: f.id, title: f.title, severity: f.severity, category: f.category }));

  return {
    reportId: crypto.randomUUID(),
    releaseId,
    generatedAt: now.toISOString(),
    engineVersion: ENGINE_VERSION,
    ruleRegistryVersion,
    verdict,
    overallScore,
    scoreLabel: scoreBandLabel(overallScore),
    categoryScores: categoryBreakdown,
    topIssues,
    prioritizedFixes,
    findings,
    inputsSnapshot: context,
  };
}

module.exports = { generateReport, prioritize };
