// SECURE API-KEY STORAGE (ALPHA-001 §7).
//
// Two modes, both driven through ONE injected abstraction so tests never need a
// real credential store or real credentials:
//
//   REMEMBER SECURELY ON THIS COMPUTER
//     -> the OS credential store (Windows Credential Manager via the Rust
//        `keyring` crate, exposed as Tauri commands). Survives restart.
//        Removable from Settings.
//
//   USE FOR THIS SESSION ONLY
//     -> held in memory in this module only. Gone when the process exits.
//
// The key NEVER touches: ReleaseProject, settings.json, localStorage, packets,
// diagnostics, logs. `appSettings.providers.credentials[id]` records only
// metadata (configured / storage mode / last success), never the secret.

export type KeyMode = 'secure' | 'session';

/** The injectable boundary. The Tauri host implements this over the OS
 * credential store; tests implement it in memory. */
export interface SecureStore {
  /** Persist a secret under a provider id. */
  set(providerId: string, secret: string): Promise<void>;
  /** Read a persisted secret, or null when absent/unavailable. */
  get(providerId: string): Promise<string | null>;
  /** Remove a persisted secret. Must succeed even when absent. */
  remove(providerId: string): Promise<void>;
  /** True when the platform credential store is usable at all. */
  available(): Promise<boolean>;
}

/** An in-memory SecureStore — used by tests AND as the honest fallback when the
 * OS credential store is unavailable (the UI then only offers session-only). */
export function createMemorySecureStore(): SecureStore & { readonly size: number } {
  const map = new Map<string, string>();
  return {
    get size() { return map.size; },
    async set(id, secret) { map.set(id, secret); },
    async get(id) { return map.get(id) ?? null; },
    async remove(id) { map.delete(id); },
    async available() { return true; },
  };
}

/** Session-only secrets. Deliberately module-scoped and never serialized:
 * closing the application loses them, which is the promise we make. */
const sessionKeys = new Map<string, string>();

export function setSessionKey(providerId: string, secret: string): void {
  if (secret.trim()) sessionKeys.set(providerId, secret.trim());
}
export function getSessionKey(providerId: string): string | null {
  return sessionKeys.get(providerId) ?? null;
}
export function clearSessionKey(providerId: string): void {
  sessionKeys.delete(providerId);
}
/** Simulates process shutdown for tests; also used on explicit sign-out. */
export function clearAllSessionKeys(): void {
  sessionKeys.clear();
}

/** The resolver every provider adapter uses: session first (most explicit and
 * most recent), then the secure store, then the dev environment variable.
 * Returns null when the provider is simply not connected — callers surface a
 * clear blocked reason instead of pretending to work. */
export async function resolveKey(providerId: string, store: SecureStore | null, envFallback?: () => string | null): Promise<string | null> {
  const session = getSessionKey(providerId);
  if (session) return session;
  if (store) {
    try {
      const secret = await store.get(providerId);
      if (secret) return secret;
    } catch { /* credential store unavailable — fall through honestly */ }
  }
  const env = envFallback?.();
  return env && env.trim() ? env.trim() : null;
}

/** Store a key in the requested mode. Returns the metadata the app settings may
 * record (never the secret). */
export async function rememberKey(providerId: string, secret: string, mode: KeyMode, store: SecureStore | null): Promise<{ ok: boolean; storage: KeyMode | 'none'; error?: string }> {
  const clean = secret.trim();
  if (!clean) return { ok: false, storage: 'none', error: 'No key provided.' };
  if (mode === 'session') { setSessionKey(providerId, clean); return { ok: true, storage: 'session' }; }
  if (!store) return { ok: false, storage: 'none', error: 'Secure storage is unavailable on this computer. You can still use the key for this session only.' };
  try {
    await store.set(providerId, clean);
    // Mirror into the session so the current run works without a re-read.
    setSessionKey(providerId, clean);
    return { ok: true, storage: 'secure' };
  } catch (e) {
    return { ok: false, storage: 'none', error: redactSecret(e instanceof Error ? e.message : String(e)) };
  }
}

/** Forget a key everywhere (session + secure store). */
export async function forgetKey(providerId: string, store: SecureStore | null): Promise<void> {
  clearSessionKey(providerId);
  if (store) { try { await store.remove(providerId); } catch { /* already gone */ } }
}

// ── Redaction (§7: "Redact secrets from every error path") ──────────────────

/** Replace anything that looks like a provider key with a placeholder. Applied
 * to every provider error before it reaches the UI, a log, or diagnostics. */
export function redactSecret(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, 'AIza…[redacted]')
    .replace(/xai-[0-9A-Za-z\-_]{16,}/g, 'xai-…[redacted]')
    .replace(/sk-[0-9A-Za-z\-_]{16,}/g, 'sk-…[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]{12,}=*/gi, '$1…[redacted]')
    .replace(/(x-goog-api-key["':\s]+)[A-Za-z0-9\-_]{12,}/gi, '$1…[redacted]')
    .replace(/("?(?:api[_-]?key|apiKey|token|secret|password)"?\s*[:=]\s*"?)[A-Za-z0-9\-._~+/]{12,}=*"?/gi, '$1…[redacted]');
}
