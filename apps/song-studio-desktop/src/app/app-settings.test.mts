// ALPHA-001 §14 — app-global settings: migration, corruption fallback, atomic
// writes, one-time onboarding, and the hard "no secrets in settings" boundary.
// Run: npm run app:settings:test

import assert from 'node:assert/strict';
import {
  defaultAppSettings, normalizeAppSettings, migrateAppSettings, shouldShowOnboarding,
  completeOnboarding, resetOnboarding, setCredentialMeta, clearCredentialMeta,
  setPreferredProvider, APP_SETTINGS_SCHEMA_VERSION,
} from './appSettings';
import { loadAppSettings, saveAppSettings, settingsContainsSecretLike, SETTINGS_FILE, type SettingsFs } from './settingsStore';

// ── An in-memory SettingsFs that can simulate a crash mid-write ─────────────
function memFs() {
  const files = new Map<string, string>();
  let failNextWrite = false;
  const fs: SettingsFs & { files: Map<string, string>; crashNextWrite(): void } = {
    files,
    crashNextWrite() { failNextWrite = true; },
    async readText(p) { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    async writeText(p, c) {
      if (failNextWrite) { failNextWrite = false; throw new Error('simulated crash mid-write'); }
      files.set(p, c);
    },
    async exists(p) { return files.has(p); },
    async rename(a, b) { const v = files.get(a); if (v === undefined) throw new Error('ENOENT'); files.set(b, v); files.delete(a); },
    async remove(p) { files.delete(p); },
    async mkdir() { /* no-op */ },
    join: (...parts) => parts.join('/'),
  };
  return fs;
}

// ── Defaults ────────────────────────────────────────────────────────────────
{
  const d = defaultAppSettings();
  assert.equal(d.schemaVersion, APP_SETTINGS_SCHEMA_VERSION);
  assert.equal(d.onboarding.completedVersion, null, 'fresh install has not completed onboarding');
  assert.equal(d.update.channel, 'alpha', 'test users are on the alpha channel');
  assert.equal(d.providers.preferred.video, 'auto', 'Auto by default');
  assert.equal(d.diagnostics.localEventLog, false, 'no local logging without consent');
}

// ── Normalization is TOTAL: junk in, usable settings out ────────────────────
{
  assert.deepEqual(normalizeAppSettings(null), defaultAppSettings(), 'null → defaults');
  assert.deepEqual(normalizeAppSettings('nonsense'), defaultAppSettings(), 'garbage → defaults');
  assert.deepEqual(normalizeAppSettings(42), defaultAppSettings(), 'number → defaults');
  const partial = normalizeAppSettings({ update: { channel: 'bogus' }, ui: { developerMode: 'yes' } });
  assert.equal(partial.update.channel, 'alpha', 'unknown enum falls back safely');
  assert.equal(partial.ui.developerMode, false, 'non-boolean falls back safely');
  assert.equal(partial.providers.preferred.text, 'auto', 'missing sections are filled');
}

// ── Migration: unversioned/older payload → current, lossless ────────────────
{
  const legacy = {
    // no schemaVersion at all (pre-ALPHA-001 shape)
    onboarding: { completedVersion: '0.1.0-alpha.1', completedAt: '2026-07-01T00:00:00Z', skipped: true },
    lastProjectPath: 'C:/songs/demo.ssproj',
  };
  const { settings, migratedFrom } = migrateAppSettings(legacy);
  assert.equal(settings.schemaVersion, APP_SETTINGS_SCHEMA_VERSION, 'migrated to the current version');
  assert.equal(migratedFrom, null, 'unversioned payload reports no prior numeric version');
  assert.equal(settings.onboarding.completedVersion, '0.1.0-alpha.1', 'onboarding completion PRESERVED across migration');
  assert.equal(settings.lastProjectPath, 'C:/songs/demo.ssproj', 'last project preserved');
  assert.equal(settings.update.channel, 'alpha', 'new fields defaulted');

  const older = migrateAppSettings({ schemaVersion: 0, onboarding: { completedVersion: '0.0.9' } });
  assert.equal(older.migratedFrom, 0, 'numeric older version reported');
  assert.equal(older.settings.onboarding.completedVersion, '0.0.9', 'still not re-onboarded after migration');
}

// ── §7 boundary: no API key may ever live in settings ───────────────────────
{
  // Even if a broken build wrote a key, normalization strips it and the guard
  // reports the file as clean.
  const poisoned = {
    providers: { credentials: { google: { configured: true, storage: 'secure', apiKey: 'AIzaSyDUMMYKEY1234567890abcdefg' } } },
  };
  const s = normalizeAppSettings(poisoned);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('AIzaSyDUMMYKEY1234567890abcdefg'), 'a stray key is stripped by normalization');
  assert.equal(s.providers.credentials.google.configured, true, 'harmless metadata survives');
  assert.equal(settingsContainsSecretLike(s), false, 'normalized settings contain no secret-like value');

  // The guard actually detects real key shapes when handed a poisoned object.
  const fake = { ...defaultAppSettings() } as unknown as Record<string, unknown>;
  fake.stray = 'xai-abcdefghijklmnopqrstuvwxyz012345';
  assert.equal(settingsContainsSecretLike(fake as never), true, 'guard detects an xAI key shape');
}

// ── Persistence: atomic write + round-trip ──────────────────────────────────
{
  const fs = memFs();
  const s = setCredentialMeta(defaultAppSettings(), 'xai', { configured: true, storage: 'secure', lastSuccessAt: '2026-07-12T00:00:00Z' });
  await saveAppSettings('/appdata', s, fs);
  assert.ok(fs.files.has('/appdata/' + SETTINGS_FILE), 'settings written to the app-data dir');
  assert.ok(!fs.files.has('/appdata/' + SETTINGS_FILE + '.tmp'), 'temp file renamed away (atomic replace)');

  const loaded = await loadAppSettings('/appdata', fs);
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.settings.providers.credentials.xai.configured, true, 'credential METADATA round-trips');
  assert.equal(loaded.settings.providers.credentials.xai.storage, 'secure');
  assert.equal(settingsContainsSecretLike(loaded.settings), false, 'still no secret on disk');
}

// ── First run: missing file is not an error ─────────────────────────────────
{
  const fs = memFs();
  const loaded = await loadAppSettings('/appdata', fs);
  assert.equal(loaded.status, 'missing', 'first launch reports missing, not failure');
  assert.equal(loaded.settings.onboarding.completedVersion, null, 'and onboarding will show');
}

// ── Corruption fallback: partial/torn file recovers, bad file preserved ─────
{
  const fs = memFs();
  fs.files.set('/appdata/settings.json', '{"schemaVersion":1,"onboarding":{"completed');  // truncated
  const loaded = await loadAppSettings('/appdata', fs);
  assert.equal(loaded.status, 'recovered', 'corrupt settings recover instead of crashing');
  assert.deepEqual(loaded.settings, defaultAppSettings(), 'falls back to defaults');
  assert.ok(fs.files.has('/appdata/settings.json.corrupt'), 'the bad file is preserved for diagnosis, not deleted');
}

// ── Atomic write: a crash mid-write leaves the OLD file intact ──────────────
{
  const fs = memFs();
  await saveAppSettings('/appdata', defaultAppSettings(), fs);
  const good = fs.files.get('/appdata/settings.json');
  const next = setPreferredProvider(defaultAppSettings(), 'video', 'xai-video');
  fs.crashNextWrite();
  await assert.rejects(() => saveAppSettings('/appdata', next, fs), 'the write throws');
  assert.equal(fs.files.get('/appdata/settings.json'), good, 'the previous settings file is UNTOUCHED after a crashed write');
}

// ── §5/§6: onboarding shows once, never again ──────────────────────────────
{
  let s = defaultAppSettings();
  assert.equal(shouldShowOnboarding(s), true, 'shows on first launch');

  // Completing hides it forever.
  s = completeOnboarding(s, '0.1.0-alpha.1', false, '2026-07-12T10:00:00Z');
  assert.equal(shouldShowOnboarding(s), false, 'does not show after completion');

  // Restart == reload from disk: still hidden.
  const fs = memFs();
  await saveAppSettings('/appdata', s, fs);
  const reopened = await loadAppSettings('/appdata', fs);
  assert.equal(shouldShowOnboarding(reopened.settings), false, 'does not show after restart');

  // An app UPDATE must not reset it — we check presence, not version equality.
  const afterUpdate = migrateAppSettings({ ...reopened.settings, schemaVersion: 0 }).settings;
  assert.equal(shouldShowOnboarding(afterUpdate), false, 'does not show after a version update / settings migration');

  // Skipping ALSO counts as done.
  let skipped = completeOnboarding(defaultAppSettings(), '0.1.0-alpha.1', true, '2026-07-12T10:00:00Z');
  assert.equal(shouldShowOnboarding(skipped), false, 'skip counts as completed — never shown again');
  assert.equal(skipped.onboarding.skipped, true, 'but we remember it was a skip');

  // Interrupted onboarding (closed before choosing) = never marked complete, so
  // it resumes at next launch. This is the documented rule.
  const interrupted = defaultAppSettings();
  assert.equal(shouldShowOnboarding(interrupted), true, 'closing during onboarding resumes it next launch');

  // Explicit reset from Settings brings it back — the only way.
  const reset = resetOnboarding(skipped);
  assert.equal(shouldShowOnboarding(reset), true, '"Show introduction again" works');
  assert.equal(reset.onboarding.completedAt, null);
}

// ── Credential metadata add/remove ─────────────────────────────────────────
{
  let s = setCredentialMeta(defaultAppSettings(), 'google', { configured: true, storage: 'session' });
  assert.equal(s.providers.credentials.google.storage, 'session');
  s = clearCredentialMeta(s, 'google');
  assert.equal(s.providers.credentials.google, undefined, 'forgetting a key removes its metadata');
}

console.log('[app-settings] PASS — defaults, total normalization, migration (onboarding survives), no-secrets boundary, atomic write + crash safety, corruption fallback, one-time onboarding across restart/update/reset, credential metadata.');
