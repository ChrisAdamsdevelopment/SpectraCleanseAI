import { describe, expect, it } from 'vitest';
const { parseFeatures, getEnabledFeatures, isFeatureEnabled, KNOWN_FEATURES } = require('../server/featureFlags');

describe('feature flag parsing', () => {
  it('returns no features for empty / undefined input (production default is off)', () => {
    expect(parseFeatures('')).toEqual([]);
    expect(parseFeatures(undefined)).toEqual([]);
    expect(parseFeatures(null)).toEqual([]);
  });

  it('parses known features and is case/whitespace insensitive', () => {
    expect(parseFeatures(' Chain_Of_Custody , release_readiness ')).toEqual([
      'chain_of_custody',
      'release_readiness',
    ]);
  });

  it('ignores unknown feature names (a typo never enables anything)', () => {
    expect(parseFeatures('chain_of_custody,not_a_real_flag,DROP TABLE')).toEqual([
      'chain_of_custody',
    ]);
  });

  it('de-duplicates repeated names', () => {
    expect(parseFeatures('ai_disclosure,ai_disclosure')).toEqual(['ai_disclosure']);
  });

  it('reads from an injected env object', () => {
    const env = { FEATURES: 'metadata_validation' };
    expect(getEnabledFeatures(env)).toEqual(['metadata_validation']);
    expect(isFeatureEnabled('metadata_validation', env)).toBe(true);
    expect(isFeatureEnabled('rights_verification', env)).toBe(false);
  });

  it('exposes a frozen known-feature registry', () => {
    expect(KNOWN_FEATURES).toContain('chain_of_custody');
    expect(Object.isFrozen(KNOWN_FEATURES)).toBe(true);
  });
});
