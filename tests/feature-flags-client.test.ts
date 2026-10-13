import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseFeatures, getBuildTimeFeatures, isFeatureEnabled, fetchEnabledFeatures,
} from '../src/utils/featureFlags';

describe('client feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('parseFeatures (mirrors the server)', () => {
    it('returns [] for empty / undefined / null', () => {
      expect(parseFeatures('')).toEqual([]);
      expect(parseFeatures(undefined)).toEqual([]);
      expect(parseFeatures(null)).toEqual([]);
    });
    it('normalizes case/whitespace and ignores unknown names', () => {
      expect(parseFeatures(' Metadata_Validation , release_readiness ,DROP TABLE'))
        .toEqual(['metadata_validation', 'release_readiness']);
    });
    it('de-duplicates', () => {
      expect(parseFeatures('ai_disclosure,ai_disclosure')).toEqual(['ai_disclosure']);
    });
  });

  describe('getBuildTimeFeatures', () => {
    it('returns [] when VITE_FEATURES is unset', () => {
      vi.stubEnv('VITE_FEATURES', '');
      expect(getBuildTimeFeatures()).toEqual([]);
    });
    it('parses VITE_FEATURES with the same rules', () => {
      vi.stubEnv('VITE_FEATURES', ' release_readiness , metadata_validation ');
      expect(getBuildTimeFeatures()).toEqual(['release_readiness', 'metadata_validation']);
      expect(isFeatureEnabled('release_readiness')).toBe(true);
      expect(isFeatureEnabled('rights_verification')).toBe(false);
    });
  });

  describe('fetchEnabledFeatures', () => {
    it('returns parsed features on a 200 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({ features: ['metadata_validation', 'bogus'] }),
      }) as any;
      expect(await fetchEnabledFeatures('http://x')).toEqual(['metadata_validation']);
    });
    it('returns [] on a non-200 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }) as any;
      expect(await fetchEnabledFeatures('http://x')).toEqual([]);
    });
    it('returns [] on a network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network')) as any;
      expect(await fetchEnabledFeatures('http://x')).toEqual([]);
    });
  });
});
