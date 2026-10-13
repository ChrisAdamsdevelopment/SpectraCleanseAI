/**
 * Frontend feature-flag helper for the trust/compliance overhaul.
 *
 * Two complementary sources, both OFF by default so production renders exactly
 * as it does today until a flag is deliberately enabled:
 *
 *  1. Build-time:  import.meta.env.VITE_FEATURES (mirrors the VITE_API_URL pattern)
 *  2. Runtime:     GET /api/features (lets the server turn a feature on without
 *                  a frontend rebuild). Use fetchEnabledFeatures() for this.
 *
 * Keep KNOWN_FEATURES aligned with server/featureFlags.js.
 */

export const KNOWN_FEATURES = [
  'chain_of_custody',
  'metadata_validation',
  'release_readiness',
  'platform_compliance',
  'ai_disclosure',
  'rights_verification',
] as const;

export type FeatureName = typeof KNOWN_FEATURES[number];

const KNOWN_FEATURE_SET = new Set<string>(KNOWN_FEATURES);

const normalize = (value: string): string => value.trim().toLowerCase();

/** Parse a comma-separated FEATURES string into de-duplicated known names. */
export function parseFeatures(rawValue: string | undefined | null): FeatureName[] {
  const seen = new Set<FeatureName>();
  for (const part of String(rawValue || '').split(',')) {
    const name = normalize(part);
    if (name && KNOWN_FEATURE_SET.has(name)) seen.add(name as FeatureName);
  }
  return [...seen];
}

/** Build-time enabled features from VITE_FEATURES. */
export function getBuildTimeFeatures(): FeatureName[] {
  return parseFeatures(import.meta.env.VITE_FEATURES as string | undefined);
}

/** Whether a feature is enabled at build time. */
export function isFeatureEnabled(
  name: FeatureName,
  enabled: FeatureName[] = getBuildTimeFeatures(),
): boolean {
  return enabled.includes(name);
}

/**
 * Fetch server-enabled features at runtime. Returns [] on any failure so the UI
 * degrades to "everything off" rather than throwing.
 */
export async function fetchEnabledFeatures(apiBaseUrl: string): Promise<FeatureName[]> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/features`);
    if (!res.ok) return [];
    const data = await res.json();
    return parseFeatures(Array.isArray(data?.features) ? data.features.join(',') : '');
  } catch {
    return [];
  }
}
