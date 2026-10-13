// ALPHA-001 §14 — secure credential storage and secret redaction.
// Uses an INJECTED mock secure store: no real credentials, no OS vault needed.
// Run: npm run app:security:test

import assert from 'node:assert/strict';
import {
  createMemorySecureStore, setSessionKey, getSessionKey, clearSessionKey, clearAllSessionKeys,
  resolveKey, rememberKey, forgetKey, redactSecret,
} from './secureStore';
import { defaultAppSettings, setCredentialMeta } from './appSettings';
import { settingsContainsSecretLike } from './settingsStore';
import { mapXaiError } from '../director/providers/xai';
import { mapGoogleError } from './providerRuntime';

// Representative (fake) key shapes.
const GOOGLE_KEY = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
const XAI_KEY = 'xai-9f8e7d6c5b4a3210zyxwvutsrqponmlkjihgfedcba';

// ── Remember securely: survives a "restart" (a fresh resolve from the store) ──
{
  const store = createMemorySecureStore();
  const r = await rememberKey('xai', XAI_KEY, 'secure', store);
  assert.equal(r.ok, true); assert.equal(r.storage, 'secure');
  assert.equal(await store.get('xai'), XAI_KEY, 'secret is in the vault');

  // Simulate app restart: session memory is gone, vault persists.
  clearAllSessionKeys();
  assert.equal(getSessionKey('xai'), null, 'session memory cleared on restart');
  assert.equal(await resolveKey('xai', store), XAI_KEY, 'a remembered key survives restart');
}

// ── Session-only: NEVER persisted, disappears on shutdown ───────────────────
{
  const store = createMemorySecureStore();
  const r = await rememberKey('google', GOOGLE_KEY, 'session', store);
  assert.equal(r.ok, true); assert.equal(r.storage, 'session');
  assert.equal(await store.get('google'), null, 'session-only key NEVER touches the vault');
  assert.equal(await resolveKey('google', store), GOOGLE_KEY, 'usable during the session');

  clearAllSessionKeys();  // == application closed
  assert.equal(await resolveKey('google', store), null, 'session-only key is GONE after shutdown');
}

// ── Forget removes from both places ─────────────────────────────────────────
{
  const store = createMemorySecureStore();
  await rememberKey('xai', XAI_KEY, 'secure', store);
  assert.equal(await resolveKey('xai', store), XAI_KEY);
  await forgetKey('xai', store);
  assert.equal(getSessionKey('xai'), null, 'forget clears session');
  assert.equal(await store.get('xai'), null, 'forget clears the vault');
  assert.equal(await resolveKey('xai', store), null, 'provider is disconnected again');
  await forgetKey('xai', store); // idempotent — forgetting twice must not throw
}

// ── Resolution order: session beats vault (most recent explicit entry wins) ──
{
  const store = createMemorySecureStore();
  await store.set('xai', 'xai-oldstoredkeyoldstoredkeyoldstored');
  setSessionKey('xai', XAI_KEY);
  assert.equal(await resolveKey('xai', store), XAI_KEY, 'session entry takes precedence');
  clearSessionKey('xai');
  assert.equal(await resolveKey('xai', store), 'xai-oldstoredkeyoldstoredkeyoldstored', 'falls back to the vault');
  clearAllSessionKeys();
}

// ── Unavailable vault: honest failure, session still offered ────────────────
{
  const r = await rememberKey('xai', XAI_KEY, 'secure', null);
  assert.equal(r.ok, false, 'cannot remember securely with no vault');
  assert.match(r.error!, /session only/i, 'and says so in plain language');
  const s = await rememberKey('xai', XAI_KEY, 'session', null);
  assert.equal(s.ok, true, 'session-only still works without a vault');
  clearAllSessionKeys();
}

// ── A broken vault must not crash key resolution ────────────────────────────
{
  const broken = { async set() { throw new Error('vault down'); }, async get() { throw new Error('vault down'); }, async remove() { throw new Error('vault down'); }, async available() { return false; } };
  assert.equal(await resolveKey('xai', broken), null, 'a throwing vault resolves to "not connected", not a crash');
  const r = await rememberKey('xai', XAI_KEY, 'secure', broken);
  assert.equal(r.ok, false, 'a vault write failure is reported');
  assert.ok(!r.error!.includes(XAI_KEY), 'and the error does not leak the key');
}

// ── Redaction: exact secret values never survive ────────────────────────────
{
  assert.ok(!redactSecret(`key=${XAI_KEY}`).includes(XAI_KEY), 'xAI key redacted');
  assert.ok(!redactSecret(`x-goog-api-key: ${GOOGLE_KEY}`).includes(GOOGLE_KEY), 'Google key redacted');
  assert.ok(!redactSecret(`Authorization: Bearer ${XAI_KEY}`).includes(XAI_KEY), 'bearer token redacted');
  assert.ok(!redactSecret(`{"apiKey":"${GOOGLE_KEY}"}`).includes(GOOGLE_KEY), 'json apiKey field redacted');
  assert.ok(!redactSecret(`{"token": "${XAI_KEY}"}`).includes(XAI_KEY), 'json token field redacted');
  assert.ok(!redactSecret('sk-abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghijklmnopqrstuvwxyz'), 'openai-style key redacted');
  // Redaction must keep the message useful.
  assert.match(redactSecret(`invalid key ${XAI_KEY} for model grok-4.5`), /grok-4\.5/, 'surrounding context survives');
  // Non-secret text is untouched.
  assert.equal(redactSecret('scene 3 failed: duration 12s exceeds 8s'), 'scene 3 failed: duration 12s exceeds 8s');
}

// ── Provider error paths are redacted (§7 "every error path") ───────────────
{
  const x = mapXaiError(401, `{"error":"invalid api key: ${XAI_KEY}"}`);
  assert.equal(x.category, 'invalid-key');
  assert.ok(!x.detail.includes(XAI_KEY), 'xAI error detail is redacted');
  assert.ok(!x.message.includes(XAI_KEY), 'xAI user message never contains the key');

  const g = mapGoogleError(400, `{"error":{"message":"API key not valid: ${GOOGLE_KEY}"}}`);
  assert.equal(g.category, 'invalid-key');
  assert.ok(!g.detail.includes(GOOGLE_KEY), 'Google error detail is redacted');
}

// ── Settings can never carry a secret ──────────────────────────────────────
{
  const s = setCredentialMeta(defaultAppSettings(), 'xai', { configured: true, storage: 'secure', lastSuccessAt: '2026-07-12T00:00:00Z', lastTestCategory: 'ok' });
  const json = JSON.stringify(s);
  assert.ok(!json.includes(XAI_KEY) && !json.includes(GOOGLE_KEY), 'no key in settings JSON');
  assert.equal(settingsContainsSecretLike(s), false, 'guard agrees');
  assert.ok(json.includes('"storage": "secure"') || json.includes('"storage":"secure"'), 'only harmless metadata is recorded');
}

console.log('[security] PASS — secure remember survives restart, session-only dies on shutdown, forget clears both, resolution order, vault-unavailable + broken-vault handled honestly, exact secret values redacted from all error paths, settings provably secret-free.');
