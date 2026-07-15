// PROVIDER RUNTIME (ALPHA-001 §6/§8/§9) — the account/credential layer that
// sits between the Settings UI and the provider-neutral adapters.
//
// It owns: which ACCOUNTS are connected, how to test them, and how a
// preference ('auto' | provider id) becomes a concrete adapter. It never stores
// a key itself — secrets come from secureStore (OS vault or session memory).

import type { ProviderIo } from '../director/providers/types';
import { resolveKey, type SecureStore } from './secureStore';
import { testXaiConnection, type ConnectionTestResult, type ProviderErrorCategory } from '../director/providers/xai';
import { redactSecret } from './secureStore';
import type { ConnectedAccounts } from '../director/providers/registry';

/** The two credentialed accounts in the alpha. 'manual' needs no account. */
export type AccountId = 'google' | 'xai';

export const ACCOUNTS: Array<{
  id: AccountId;
  label: string;
  /** Where a tester gets a key — shown verbatim in Settings. */
  keySource: string;
  /** Plain-language billing/credit guidance (§6). */
  billing: string;
  /** What Song Studio uses this account for. */
  usedFor: string;
  keyHint: string;
}> = [
  {
    id: 'google',
    label: 'Google',
    keySource: 'Create an API key at aistudio.google.com → “Get API key”.',
    billing: 'Google bills your own Google account for what you generate. Video is far more expensive than text or images. Song Studio never charges you and never sells credits — you pay Google directly.',
    usedFor: 'Scene video (Gemini Omni Flash, Veo), reference images (Gemini image), and the directing assistant.',
    keyHint: 'Usually starts with “AIza”.',
  },
  {
    id: 'xai',
    label: 'xAI / Grok',
    keySource: 'Create an API key at console.x.ai. IMPORTANT: a Grok or X Premium subscription is NOT the same thing — xAI API access is billed separately and needs its own credits.',
    billing: 'xAI bills your own xAI account for what you generate. A consumer Grok/X subscription does not include API usage. Song Studio never charges you and never sells credits — you pay xAI directly.',
    usedFor: 'Scene video (Grok Imagine, up to 15s), reference images (Grok Imagine image), and the directing assistant (Grok reasoning).',
    keyHint: 'Starts with “xai-”.',
  },
];

export function accountInfo(id: AccountId) {
  return ACCOUNTS.find((a) => a.id === id)!;
}

// ── Connection testing (§8E) ────────────────────────────────────────────────

/** Google's cheapest documented reachability check: list models on the Gemini
 * API. It confirms the key is recognized and the account can call the API
 * without generating anything. */
export async function testGoogleConnection(key: string, io: ProviderIo): Promise<ConnectionTestResult> {
  if (!key.trim()) return { ok: false, category: 'invalid-key', message: 'Enter a Google API key first.' };
  try {
    const res = await io.fetchJson('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key },
    });
    if (res.ok) return { ok: true, category: 'ok', message: 'Connected to Google.' };
    return { ok: false, ...mapGoogleError(res.status, res.text) };
  } catch (e) {
    return { ok: false, category: 'network', message: 'Song Studio could not reach Google. Check your internet connection.', detail: redactSecret(e instanceof Error ? e.message : String(e)) };
  }
}

/** Google error → creator-facing category. Mirrors the xAI mapping shape so the
 * UI treats every provider the same way (§8E). */
export function mapGoogleError(status: number, body: string): { category: ProviderErrorCategory; message: string; detail: string } {
  const detail = redactSecret((body || '').slice(0, 500));
  const lower = (body || '').toLowerCase();
  if (status === 400 && lower.includes('api key not valid')) {
    return { category: 'invalid-key', message: 'That Google API key was not recognized. Check for a copy/paste slip — keys usually start with “AIza”.', detail };
  }
  if (status === 401) return { category: 'invalid-key', message: 'That Google API key was not recognized.', detail };
  if (status === 403) {
    if (lower.includes('billing')) return { category: 'no-credits', message: 'Your Google account was recognized, but billing is not enabled for this API. Enable billing in Google AI Studio / Cloud console, then test again.', detail };
    return { category: 'no-permission', message: 'This Google key does not have permission to use this API. Check the key’s API restrictions.', detail };
  }
  if (status === 404) return { category: 'model-unavailable', message: 'That Google model is not available to this account. It may have been renamed or may need to be enabled.', detail };
  if (status === 429) return { category: 'rate-limited', message: 'Google is rate-limiting this key right now (or you are out of free quota). Wait a moment and try again.', detail };
  if (status === 451) return { category: 'region-restricted', message: 'Google reports this API is not available in your region.', detail };
  if (status >= 500) return { category: 'provider-outage', message: 'Google reported a server-side problem. This is on their end — try again shortly.', detail };
  if (status === 0) return { category: 'network', message: 'Song Studio could not reach Google. Check your internet connection.', detail };
  return { category: 'unknown', message: `Google rejected the request (HTTP ${status}).`, detail };
}

/** Test whichever account, using its own cheapest documented call. */
export async function testAccount(account: AccountId, key: string, io: ProviderIo): Promise<ConnectionTestResult> {
  return account === 'xai' ? testXaiConnection(key, io) : testGoogleConnection(key, io);
}

// ── Key resolution per account ──────────────────────────────────────────────

/** Env fallbacks are DEV-ONLY conveniences; installed builds rely on the vault
 * or session entry. */
function envFor(account: AccountId): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (!env) return null;
  return account === 'xai'
    ? env.XAI_API_KEY ?? null
    : env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY ?? null;
}

export async function keyForAccount(account: AccountId, store: SecureStore | null): Promise<string | null> {
  return resolveKey(account, store, () => envFor(account));
}

/** Which accounts currently have a usable key — drives 'auto' resolution and the
 * honest "not connected" states in the UI. */
export async function connectedAccounts(store: SecureStore | null): Promise<ConnectedAccounts> {
  const [google, xai] = await Promise.all([keyForAccount('google', store), keyForAccount('xai', store)]);
  return { google: Boolean(google), xai: Boolean(xai) };
}
