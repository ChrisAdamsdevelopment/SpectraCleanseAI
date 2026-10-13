// ALPHA-002 §16 — HOST-LEVEL INTEGRATION TESTS. The independent review found
// isolated unit tests passing while the real WIRING was broken. These traverse
// the SAME boundary the running app uses: createTauriDirectorHost with an
// injected mock ProviderIo + a key resolver over the secure-store service, and
// assert the correct ADAPTER/ENDPOINT and RESOLVED CREDENTIAL for each provider.
// Run: npm run host:integration:test

import assert from 'node:assert/strict';
import { createTauriDirectorHost } from './tauriHost';
import type { ProviderIo } from './providers/types';
import type { GenerationPacket } from './compile';
import { createMemorySecureStore, rememberKey, clearAllSessionKeys } from '../app/secureStore';
import { keyForAccount } from '../app/providerRuntime';
import { XAI_BASE } from './providers/xai';

const GKEY = 'AIzaSyTESTgooglekey000000000000000000000';
const XKEY = 'xai-testxaikey0000000000000000000000000000';
const XBASE_HOST = XAI_BASE; // https://api.x.ai/v1

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A mock ProviderIo that records every request and returns a scripted reply. */
function mockIo(reply: (url: string) => { ok: boolean; status: number; json: unknown }) {
  const calls: Call[] = [];
  const io: ProviderIo & { calls: Call[] } = {
    calls,
    async readBase64() { return 'BASE64'; },
    mimeType() { return 'image/png'; },
    async fetchJson(url, init) {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
      const r = reply(url);
      return { ok: r.ok, status: r.status, text: JSON.stringify(r.json), json: r.json };
    },
    async downloadToFile() { return 4096; },
    async writeBase64ToFile() { return 2048; },
  };
  return io;
}

const packet: GenerationPacket = {
  attemptId: 'a', sceneId: 's', recipe: 'separate-references',
  prompt: 'a scene', negative: 'no captions', promptDigest: 'd',
  references: [], timing: { sceneStartSec: 0, sceneEndSec: 8, durationSec: 8 },
  aspect: '9:16', resolution: '720p', entityFingerprints: {}, preserveRules: [], varyRules: [],
  files: [], manifest: {},
};

function makeHost(io: ProviderIo & { calls: Call[] }, store: ReturnType<typeof createMemorySecureStore>, connected: { google: boolean; xai: boolean }) {
  return createTauriDirectorHost({
    io,
    outputDir: () => '/out',
    keyFor: (account) => keyForAccount(account, store),
    connected: () => connected,
  });
}

// ── A. CREDENTIAL → PROVIDER: the resolved key reaches the correct adapter ────
{
  clearAllSessionKeys();
  const store = createMemorySecureStore();
  await rememberKey('google', GKEY, 'secure', store);
  await rememberKey('xai', XKEY, 'secure', store);

  // Google Omni (default) — request must go to Google with the Google key.
  {
    const io = mockIo(() => ({ ok: true, status: 200, json: { id: 'int-1', status: 'processing' } }));
    const host = makeHost(io, store, { google: true, xai: true });
    host.setProvider('google-omni');
    const out = await host.submitGeneration(packet, { providerId: 'google-omni' });
    assert.equal(out.ok, true, 'google-omni submit ok with a resolved key');
    const c = io.calls[0];
    assert.ok(c.url.includes('generativelanguage.googleapis.com'), 'routed to the GOOGLE endpoint');
    assert.ok(c.url.includes('/interactions'), 'Omni uses the Interactions API');
    assert.equal(c.headers['x-goog-api-key'], GKEY, 'the resolved GOOGLE key is used');
    assert.ok(!JSON.stringify(c.headers).includes(XKEY), 'the xAI key never leaks into a Google request');
  }

  // Google Veo — routes to the Veo predictLongRunning endpoint, Google key.
  {
    const io = mockIo(() => ({ ok: true, status: 200, json: { name: 'operations/veo-1' } }));
    const host = makeHost(io, store, { google: true, xai: true });
    const out = await host.submitGeneration(packet, { providerId: 'google-veo' });
    assert.equal(out.ok, true);
    assert.ok(io.calls[0].url.includes(':predictLongRunning'), 'Veo uses predictLongRunning (NOT Omni)');
    assert.equal(io.calls[0].headers['x-goog-api-key'], GKEY);
  }

  // Grok video — routes to the xAI endpoint with the xAI key (NOT Omni/Google).
  {
    const io = mockIo(() => ({ ok: true, status: 200, json: { request_id: 'req-1', status: 'pending' } }));
    const host = makeHost(io, store, { google: true, xai: true });
    const out = await host.submitGeneration(packet, { providerId: 'xai-video' });
    assert.equal(out.ok, true, 'xai-video submit ok');
    const c = io.calls[0];
    assert.ok(c.url.startsWith(`${XBASE_HOST}`), 'routed to the xAI endpoint, not Google');
    assert.ok(c.url.includes('/videos/generations'), 'Grok video endpoint');
    assert.equal(c.headers.Authorization, `Bearer ${XKEY}`, 'the resolved xAI key is used (Bearer)');
    assert.ok(!JSON.stringify(c).includes('generativelanguage'), 'a Grok job never hits Google');
  }

  // Grok image — routes to the xAI images endpoint.
  {
    const io = mockIo(() => ({ ok: true, status: 200, json: { data: [{ b64_json: 'AAAA' }] } }));
    const host = makeHost(io, store, { google: true, xai: true });
    host.setImageProvider('xai-image');
    const out = await host.submitReferenceGeneration('a portrait', [], 1, '9:16');
    assert.equal(out.ok, true);
    assert.equal(out.providerId, 'xai-image', 'concrete provider returned for take-scoping');
    assert.ok(io.calls[0].url.includes(`${XBASE_HOST}/images/generations`), 'Grok image endpoint');
    assert.equal(io.calls[0].headers.Authorization, `Bearer ${XKEY}`);
  }

  // Google image — routes to the Gemini image interactions endpoint.
  {
    const io = mockIo(() => ({ ok: true, status: 200, json: { id: 'img-int-1', status: 'processing' } }));
    const host = makeHost(io, store, { google: true, xai: true });
    host.setImageProvider('gemini-image');
    const out = await host.submitReferenceGeneration('a portrait', [], 1, '9:16');
    assert.equal(out.ok, true);
    assert.equal(out.providerId, 'gemini-image');
    assert.ok(io.calls[0].url.includes('generativelanguage.googleapis.com'), 'Gemini image endpoint');
    assert.equal(io.calls[0].headers['x-goog-api-key'], GKEY);
  }
}

// ── Credential absence BLOCKS with a clear reason (no silent success) ────────
{
  clearAllSessionKeys();
  const store = createMemorySecureStore();          // nothing connected
  const io = mockIo(() => ({ ok: true, status: 200, json: {} }));
  const host = makeHost(io, store, { google: false, xai: false });

  const g = await host.submitGeneration(packet, { providerId: 'google-omni' });
  assert.equal(g.ok, false, 'no Google key → blocked, not a silent call');
  assert.match(g.blockedReason ?? '', /Google/, 'blocked reason names the account to connect');
  assert.equal(io.calls.length, 0, 'no network request was made without a key');

  const x = await host.submitGeneration(packet, { providerId: 'xai-video' });
  assert.equal(x.ok, false);
  assert.match(x.blockedReason ?? '', /xAI|Grok/, 'blocked reason names xAI');
}

// ── Session-only key works during the session, then blocks after "shutdown" ──
{
  clearAllSessionKeys();
  const store = createMemorySecureStore();
  await rememberKey('google', GKEY, 'session', store);
  assert.equal(await keyForAccount('google', store), GKEY, 'session key usable now');
  const io = mockIo(() => ({ ok: true, status: 200, json: { id: 'i', status: 'processing' } }));
  const host = makeHost(io, store, { google: true, xai: false });
  assert.equal((await host.submitGeneration(packet, { providerId: 'google-omni' })).ok, true, 'usable this session');

  clearAllSessionKeys();                             // == process shutdown
  assert.equal(await keyForAccount('google', store), null, 'session key gone after shutdown');
  const host2 = makeHost(io, store, { google: false, xai: false });
  assert.equal((await host2.submitGeneration(packet, { providerId: 'google-omni' })).ok, false, 'blocked after shutdown');
}

// ── E. AUTO ROUTING resolves by capability + connection through the host ─────
{
  clearAllSessionKeys();
  const store = createMemorySecureStore();
  const io = mockIo(() => ({ ok: true, status: 200, json: { id: 'i', status: 'processing' } }));

  // Google only → Auto resolves to Omni; providerConfigured true.
  {
    await rememberKey('google', GKEY, 'secure', store);
    const host = makeHost(io, store, { google: true, xai: false });
    host.setProvider('auto');
    assert.equal(host.resolvedVideoProviderId(), 'google-omni', 'Auto → Omni when only Google is connected');
    assert.equal(host.providerConfigured(), true);
  }
  // Grok only → Auto resolves to Grok video.
  {
    const store2 = createMemorySecureStore();
    await rememberKey('xai', XKEY, 'secure', store2);
    const host = makeHost(io, store2, { google: false, xai: true });
    host.setProvider('auto');
    assert.equal(host.resolvedVideoProviderId(), 'xai-video', 'Auto → Grok when only xAI is connected');
    assert.equal(host.providerConfigured(), true);
    assert.equal(host.providerCapabilities().maxDurationSec, 15, 'caps reflect the RESOLVED Grok provider');
  }
  // Nothing connected → Auto resolves to manual; not configured.
  {
    const store3 = createMemorySecureStore();
    const host = makeHost(io, store3, { google: false, xai: false });
    host.setProvider('auto');
    assert.equal(host.resolvedVideoProviderId(), 'manual', 'Auto → manual when nothing is connected');
    assert.equal(host.providerConfigured(), false, 'manual is not a live provider');
  }
  // Both connected → Auto prefers Google (declared order), respects an explicit pick.
  {
    const store4 = createMemorySecureStore();
    await rememberKey('google', GKEY, 'secure', store4);
    await rememberKey('xai', XKEY, 'secure', store4);
    const host = makeHost(io, store4, { google: true, xai: true });
    host.setProvider('auto');
    assert.equal(host.resolvedVideoProviderId(), 'google-omni', 'Auto prefers Google when both connected');
    host.setProvider('xai-video');
    assert.equal(host.resolvedVideoProviderId(), 'xai-video', 'an explicit choice overrides Auto');
  }
  clearAllSessionKeys();
}

// ── B. PROVIDER-SCOPED POLLING: each job polls its OWN recorded provider even
// when the UI selection changes ──────────────────────────────────────────────
{
  clearAllSessionKeys();
  const store = createMemorySecureStore();
  await rememberKey('google', GKEY, 'secure', store);
  await rememberKey('xai', XKEY, 'secure', store);

  const io = mockIo((url) => {
    if (url.includes('generativelanguage')) return { ok: true, status: 200, json: { status: 'processing' } };
    return { ok: true, status: 200, json: { status: 'pending' } };
  });
  const host = makeHost(io, store, { google: true, xai: true });

  // The UI is currently on Google — but we poll a GROK job by its recorded id.
  host.setProvider('google-omni');
  io.calls.length = 0;
  await host.pollGeneration('req-grok-1', 'xai-video');
  assert.ok(io.calls[0].url.startsWith(XBASE_HOST), 'a Grok job polls xAI even while the UI is on Google');
  assert.ok(io.calls[0].url.includes('/videos/req-grok-1'), 'polls the recorded job id at the xAI poll endpoint');
  assert.equal(io.calls[0].headers.Authorization, `Bearer ${XKEY}`, 'with the xAI key');

  // And a Google job polls Google even while the UI is on Grok.
  host.setProvider('xai-video');
  io.calls.length = 0;
  await host.pollGeneration('op-google-1', 'google-omni');
  assert.ok(io.calls[0].url.includes('generativelanguage'), 'a Google job polls Google even while the UI is on Grok');
  assert.equal(io.calls[0].headers['x-goog-api-key'], GKEY);
  clearAllSessionKeys();
}

console.log('[host-integration] PASS — credential→correct-adapter routing (Omni/Veo/Grok-video/Grok-image/Gemini-image) with the RESOLVED key and no cross-provider key leak, missing-credential blocks with a clear reason and no network call, session-only key works then blocks after shutdown, Auto resolves by capability+connection through the real host, and polling is take-scoped (a Grok job never polls Google and vice versa).');
