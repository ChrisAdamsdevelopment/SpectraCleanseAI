"use strict";

/**
 * Feature-flag layer for the SpectraCleanse trust/compliance overhaul.
 *
 * Goal: new platform capabilities can ship to production "dark" (deployed but
 * inert) and be turned on per-environment without a redeploy of behaviour. The
 * existing cleanse / billing / auth flows never read these flags, so with no
 * configuration the production app behaves exactly as it does today.
 *
 * Source of truth: the comma-separated `FEATURES` env var.
 *   FEATURES=chain_of_custody,release_readiness
 *
 * Unknown names are ignored (a typo can never silently enable nothing-or-
 * something unexpected). Everything is OFF by default.
 */

// Registry of capabilities introduced by the overhaul. Keep this list as the
// single source of truth; add a flag here before gating code behind it.
const KNOWN_FEATURES = Object.freeze([
  'chain_of_custody',    // persist per-stage hashes + snapshots (audit trail behind the report)
  'metadata_validation', // module 2: detect missing/malformed/conflicting metadata + fixes
  'release_readiness',   // module 4: composed, scored, exportable release report (Phase B umbrella)
  'platform_compliance', // module 5: per-platform rule packs (Spotify/Apple/YouTube/TikTok/distributors)
  'ai_disclosure',       // module 1: creator-affirmed AI usage disclosure record
  'rights_verification'  // module 3: ownership / sample-license checklist
]);

const KNOWN_FEATURE_SET = new Set(KNOWN_FEATURES);

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Parse a raw FEATURES string into a de-duplicated list of *known* enabled
 * feature names. Pure: pass the raw value in so it is trivially testable.
 */
function parseFeatures(rawValue) {
  const seen = new Set();
  for (const part of String(rawValue || '').split(',')) {
    const name = normalizeName(part);
    if (name && KNOWN_FEATURE_SET.has(name)) seen.add(name);
  }
  return [...seen];
}

/** Enabled features for a given env (defaults to process.env). */
function getEnabledFeatures(env = process.env) {
  return parseFeatures(env.FEATURES);
}

/** Whether a single feature is enabled for a given env. */
function isFeatureEnabled(name, env = process.env) {
  return parseFeatures(env.FEATURES).includes(normalizeName(name));
}

module.exports = {
  KNOWN_FEATURES,
  parseFeatures,
  getEnabledFeatures,
  isFeatureEnabled,
};
