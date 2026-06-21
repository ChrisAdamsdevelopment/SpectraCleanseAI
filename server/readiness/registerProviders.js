"use strict";

/**
 * Registers all built-in check providers into the registry. Required once at
 * server startup (see server.js). Kept separate from providers.js so the registry
 * mechanism stays free of concrete providers (and tests can register their own).
 *
 * Idempotent: requiring this module more than once will not double-register.
 */

const { registerProvider, _registry } = require('./providers');
const { metadataProvider } = require('./providers/metadata');

const BUILT_IN = [metadataProvider];

let registered = false;
function registerBuiltInProviders() {
  if (registered) return;
  const existing = new Set(_registry.map((p) => p.category + ':' + p.featureFlag));
  for (const provider of BUILT_IN) {
    if (!existing.has(provider.category + ':' + provider.featureFlag)) registerProvider(provider);
  }
  registered = true;
}

registerBuiltInProviders();

module.exports = { registerBuiltInProviders };
