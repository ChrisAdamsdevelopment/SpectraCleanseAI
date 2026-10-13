"use strict";

/**
 * Provider registry. Each module (metadata, rights, ai, platform, distribution)
 * registers a CheckProvider here. The framework runs only the providers whose
 * feature flag is enabled, so unbuilt/disabled modules simply don't contribute.
 * See release-readiness-spec.md §6.
 *
 * CheckProvider shape:
 *   { category, featureFlag, evaluate(context) -> Finding[] | Promise<Finding[]> }
 */

const { isFeatureEnabled } = require('../featureFlags');

const registry = [];

function registerProvider(provider) {
  if (!provider || !provider.category || !provider.featureFlag || typeof provider.evaluate !== 'function') {
    throw new Error('invalid provider: requires category, featureFlag, evaluate()');
  }
  registry.push(provider);
  return provider;
}

/** Providers whose feature flag is enabled for the given env. */
function getEnabledProviders(env = process.env) {
  return registry.filter((p) => isFeatureEnabled(p.featureFlag, env));
}

function _reset() { registry.length = 0; } // test helper

module.exports = { registerProvider, getEnabledProviders, _registry: registry, _reset };
