/**
 * Client types + API + presentation helpers for the Release Readiness dashboard.
 * Mirrors the server report shape (server/readiness/*). Presentation helpers keep
 * the component free of magic strings.
 */

export type Severity = 'critical' | 'warning' | 'info';
export type CheckStatus = 'fail' | 'warn' | 'pass' | 'unknown';
export type VerdictStatus = 'ready' | 'needs_attention' | 'high_risk';
export type Category =
  | 'metadata' | 'rights' | 'ai_disclosure' | 'platform_compliance' | 'distribution_readiness';

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  status: CheckStatus;
  confidence: number;
  title: string;
  what: string;
  why: string;
  businessImpact: string;
  howToFix: string;
  scoreImpact: number;
  estimatedFixMinutes?: number;
  scoreGainIfResolved?: number;
  field?: string;
  learnMoreId?: string;
}

export interface CategoryScore {
  category: Category;
  score: number | null;
  status: 'pass' | 'attention' | 'risk' | 'not_assessed';
  label: string;
  findingCounts: { critical: number; warning: number; info: number };
}

export interface Verdict {
  status: VerdictStatus;
  overallScore: number | null;
  rationale: string[];
  assessedCategories: Category[];
  notAssessed: Category[];
}

export interface TopIssue { id: string; title: string; severity: Severity; category: Category; }

export interface ReadinessReport {
  reportId: string;
  releaseId: number;
  generatedAt: string;
  engineVersion: string;
  overallScore: number | null;
  scoreLabel: string;
  verdict: Verdict;
  categoryScores: CategoryScore[];
  topIssues: TopIssue[];
  prioritizedFixes: Finding[];
  findings: Finding[];
}

export interface ReleaseMetadataInput {
  title?: string; artist?: string; albumArtist?: string; producer?: string;
  copyright?: string; genre?: string; tags?: string;
}

// ── Presentation helpers ──────────────────────────────────────────────────────

export const VERDICT_LABEL: Record<VerdictStatus, string> = {
  ready: 'READY TO RELEASE',
  needs_attention: 'NEEDS ATTENTION',
  high_risk: 'HIGH RISK',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  metadata: 'Metadata',
  rights: 'Rights',
  ai_disclosure: 'AI disclosure',
  platform_compliance: 'Platform compliance',
  distribution_readiness: 'Distribution',
};

const BUSINESS_IMPACT_LABEL: Record<string, string> = {
  rejection: 'May cause rejection',
  takedown: 'Risk of takedown',
  revenue_withheld: 'Royalties may be withheld',
  royalty_loss: 'May affect royalty allocation',
  delay: 'May delay your release',
  account_risk: 'Account risk',
  reduced_reach: 'Limits discovery / reach',
  none: '',
};
export const businessImpactLabel = (key: string): string => BUSINESS_IMPACT_LABEL[key] ?? key;

// ── API ───────────────────────────────────────────────────────────────────────

function authHeaders(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** Error that preserves the HTTP status so callers can react to 401 (expired token). */
export class ReadinessApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ReadinessApiError';
    this.status = status;
  }
}

async function ensureOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = await res.json().catch(() => ({} as { error?: string }));
  throw new ReadinessApiError(body.error || `${fallback} (${res.status})`, res.status);
}

export async function createRelease(
  apiBaseUrl: string, token: string,
  input: { title?: string; platform?: string; metadata: ReleaseMetadataInput; analysis?: unknown },
): Promise<{ id: number }> {
  const res = await fetch(`${apiBaseUrl}/api/releases`, {
    method: 'POST', headers: authHeaders(token, true), body: JSON.stringify(input),
  });
  await ensureOk(res, 'Create failed');
  return (await res.json()).release;
}

export async function checkRelease(apiBaseUrl: string, token: string, releaseId: number): Promise<ReadinessReport> {
  const res = await fetch(`${apiBaseUrl}/api/releases/${releaseId}/check`, {
    method: 'POST', headers: authHeaders(token),
  });
  await ensureOk(res, 'Check failed');
  return (await res.json()).report;
}

/** Create a release from the given metadata, then run a readiness check on it. */
export async function runReadinessCheck(
  apiBaseUrl: string, token: string,
  input: { title?: string; platform?: string; metadata: ReleaseMetadataInput; analysis?: unknown },
): Promise<ReadinessReport> {
  const release = await createRelease(apiBaseUrl, token, input);
  return checkRelease(apiBaseUrl, token, release.id);
}
