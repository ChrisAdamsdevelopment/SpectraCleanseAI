"use strict";

/**
 * Scoring engine. Pure: findings + which categories were assessed -> scores.
 * See release-readiness-spec.md §2.
 */

const { CATEGORIES, effectiveDeduction } = require('./findings');
const { CATEGORY_WEIGHTS } = require('./config');

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/**
 * @param {Array} findings
 * @param {string[]} assessedCategories  categories for which a provider actually ran
 * @param {object} [weights]
 * @returns {{ categoryScores: Array<{category,score}>, overallScore: number|null }}
 */
function scoreFindings(findings = [], assessedCategories = [], weights = CATEGORY_WEIGHTS) {
  const assessed = assessedCategories.length
    ? assessedCategories.filter((c) => CATEGORIES.includes(c))
    : [...new Set(findings.map((f) => f.category))];

  const raw = {};
  for (const c of assessed) raw[c] = 100;
  for (const f of findings) {
    if (!(f.category in raw)) continue;
    raw[f.category] -= effectiveDeduction(f);
  }

  const categoryScores = assessed.map((c) => ({
    category: c,
    score: clamp(Math.round(raw[c]), 0, 100),
  }));

  let weightSum = 0;
  let acc = 0;
  for (const { category, score } of categoryScores) {
    const w = weights[category] || 0;
    weightSum += w;
    acc += w * score;
  }
  const overallScore = weightSum > 0 ? Math.round(acc / weightSum) : null;

  return { categoryScores, overallScore };
}

module.exports = { scoreFindings };
