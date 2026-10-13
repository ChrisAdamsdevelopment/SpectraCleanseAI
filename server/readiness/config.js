"use strict";

/**
 * Tunable constants for the Release Readiness engine.
 * Values reflect founder sign-off (release-readiness-spec.md §8): rights-and-
 * compliance-heavy weights, strict verdict thresholds. Change here only.
 */

const { CATEGORY } = require('./findings');

// Bump when scoring/verdict logic changes, so stored reports stay reproducible.
const ENGINE_VERSION = '1.0.0';

// Sum = 1.0. Overall score is a weighted average over ASSESSED categories,
// with weights renormalized over whatever was actually assessed.
const CATEGORY_WEIGHTS = Object.freeze({
  [CATEGORY.RIGHTS]: 0.30,
  [CATEGORY.PLATFORM_COMPLIANCE]: 0.25,
  [CATEGORY.METADATA]: 0.25,
  [CATEGORY.AI_DISCLOSURE]: 0.12,
  [CATEGORY.DISTRIBUTION_READINESS]: 0.08,
});

// Categories that must be assessed before a release can be called "Ready".
// If any is not assessed, the verdict is capped at "needs_attention".
const REQUIRED_CATEGORIES = Object.freeze([
  CATEGORY.METADATA,
  CATEGORY.RIGHTS,
  CATEGORY.PLATFORM_COMPLIANCE,
]);

const THRESHOLDS = Object.freeze({
  highRisk: 60,        // overall score below this => high_risk
  needsAttention: 90,  // overall score below this => needs_attention
  confidenceGate: 0.4, // findings below this confidence don't drive the verdict
});

module.exports = { ENGINE_VERSION, CATEGORY_WEIGHTS, REQUIRED_CATEGORIES, THRESHOLDS };
