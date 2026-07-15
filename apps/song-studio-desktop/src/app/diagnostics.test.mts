// ALPHA-001 §14 — diagnostics redaction. Aggressive: exact secret values and
// common provider-key patterns must never survive into the package.
// Run: npm run app:diagnostics:test

import assert from 'node:assert/strict';
import { buildDiagnostics, defaultDiagnosticsOptions, redactPath, redactPathsInText, sanitize } from './diagnostics';
import { defaultAppSettings, setCredentialMeta } from './appSettings';
import { emptyDirectorState, makeEntity, makeScene, makeTake } from '../director/model';

const GOOGLE_KEY = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
const XAI_KEY = 'xai-9f8e7d6c5b4a3210zyxwvutsrqponmlkjihgfedcba';

function sampleInput() {
  const d = emptyDirectorState();
  const artist = makeEntity('Sobelo', 'person', 'lean');
  d.entities.push(artist);
  const scene = makeScene('Chorus', 60, 68);
  d.scenes.push(scene);
  const take = makeTake(scene, { promptDigest: 'p', recipe: 'separate-references', referenceFiles: [], sceneStartSec: 60, sceneEndSec: 68, aspect: '9:16', resolution: '720p', durationSec: 8 }, 'xai-video', {});
  take.providerJob = { ...take.providerJob, jobId: 'xai-req-abc123', phase: 'running', providerId: 'xai-video' };
  take.error = `xAI rejected key ${XAI_KEY} while reading C:\\Users\\jane\\Music\\my secret song.mp3`;
  d.takes.push(take);

  let settings = defaultAppSettings();
  settings = setCredentialMeta(settings, 'xai', { configured: true, storage: 'secure', lastSuccessAt: '2026-07-12T00:00:00Z', lastTestCategory: 'ok' });

  return {
    appVersion: '0.1.0-alpha.1', buildSha: 'abc1234', os: 'Windows 11', arch: 'x86_64',
    installedBuild: true,
    ffmpeg: { found: true, source: 'bundled-sidecar' },
    updater: { status: 'up-to-date', currentVersion: '0.1.0-alpha.1', availableVersion: null },
    settings, director: d, projectSchemaVersion: 5,
    logLines: [
      `[provider] Authorization: Bearer ${XAI_KEY} failed`,
      `[ffmpeg] rendering C:\\Users\\jane\\Videos\\Private Project\\out.mp4`,
      `[google] x-goog-api-key: ${GOOGLE_KEY} rejected`,
      '[director] scene 3 accepted',
    ],
    sceneSummary: `Sobelo walks; lyric "my private words" at 61s; key ${XAI_KEY}`,
    compiledPacket: `PROMPT: secret lyrics here\nkey=${GOOGLE_KEY}`,
    mediaPaths: ['C:\\Users\\jane\\Music\\my secret song.mp3', '/home/jane/videos/take.mp4'],
  };
}

// ── Path redaction ─────────────────────────────────────────────────────────
{
  assert.equal(redactPath('C:\\Users\\jane\\Music\\song.mp3'), 'song.mp3', 'windows path → file name only');
  assert.equal(redactPath('/home/jane/videos/take.mp4'), 'take.mp4', 'posix path → file name only');
  assert.equal(redactPath(''), '', 'empty stays empty');

  const t = redactPathsInText('reading C:\\Users\\jane\\Music\\song.mp3 now');
  assert.ok(!t.includes('jane'), 'user name never survives');
  assert.ok(t.includes('song.mp3'), 'file name kept — still useful for support');
}

// ── The default package: safe by construction ──────────────────────────────
{
  const input = sampleInput();
  const pkg = buildDiagnostics(input, defaultDiagnosticsOptions());
  const all = pkg.files.map((f) => f.content).join('\n') + '\n' + pkg.preview;

  // No secrets, anywhere.
  assert.ok(!all.includes(XAI_KEY), 'xAI key absent from the whole package');
  assert.ok(!all.includes(GOOGLE_KEY), 'Google key absent from the whole package');
  assert.ok(!/AIza[0-9A-Za-z\-_]{20,}/.test(all), 'no Google key PATTERN survives');
  assert.ok(!/xai-[0-9A-Za-z\-_]{16,}/.test(all), 'no xAI key PATTERN survives');

  // No private paths / user names.
  assert.ok(!all.includes('jane'), 'no user name');
  assert.ok(!all.includes('C:\\Users'), 'no windows user path');
  assert.ok(!all.includes('Private Project'), 'no private folder name');

  // Opt-in content excluded by DEFAULT.
  assert.ok(!all.includes('my private words'), 'lyrics excluded by default');
  assert.ok(!all.includes('PROMPT: secret lyrics here'), 'compiled packet excluded by default');
  assert.ok(!pkg.files.some((f) => f.relPath === 'scene-summary.txt'), 'no scene summary by default');
  assert.ok(!pkg.files.some((f) => f.relPath === 'compiled-packet.txt'), 'no compiled packet by default');
  assert.ok(!pkg.files.some((f) => f.relPath === 'media-list.txt'), 'no media list by default');

  // But it IS actually useful.
  const report = JSON.parse(pkg.files.find((f) => f.relPath === 'report.json')!.content);
  assert.equal(report.application.version, '0.1.0-alpha.1');
  assert.equal(report.application.buildSha, 'abc1234');
  assert.equal(report.application.os, 'Windows 11');
  assert.equal(report.runtime.ffmpegFound, true);
  assert.equal(report.runtime.ffmpegSource, 'bundled-sidecar');
  assert.equal(report.runtime.updaterStatus, 'up-to-date');
  assert.equal(report.project.schemaVersion, 5);
  assert.equal(report.project.entities, 1, 'counts only');
  assert.equal(report.project.scenes, 1);
  assert.equal(report.project.takes, 1);
  assert.equal(report.takes[0].jobId, 'xai-req-abc123', 'job id kept — it is not a secret and support needs it');
  assert.equal(report.takes[0].provider, 'xai-video');
  assert.equal(report.takes[0].jobPhase, 'running');
  assert.ok(!report.takes[0].error.includes(XAI_KEY), 'take error is sanitized');
  assert.equal(report.providers[0].provider, 'xai');
  assert.equal(report.providers[0].storage, 'secure', 'storage MODE is safe metadata');
  assert.ok(!JSON.stringify(report.providers).includes(XAI_KEY), 'provider block has no key');

  // Logs are present but scrubbed.
  const logs = pkg.files.find((f) => f.relPath === 'logs.txt')!.content;
  assert.ok(logs.includes('scene 3 accepted'), 'ordinary log lines survive');
  assert.ok(!logs.includes(XAI_KEY) && !logs.includes(GOOGLE_KEY), 'log secrets scrubbed');
  assert.ok(!logs.includes('jane'), 'log paths scrubbed');
  assert.ok(logs.includes('out.mp4'), 'log file names survive');

  // Preview tells the truth before sending.
  assert.match(pkg.preview, /NOT included/, 'preview states exclusions');
  assert.match(pkg.preview, /no keys/i, 'preview reassures about keys');
  assert.match(pkg.preview, /Optional extras: none selected/, 'preview reflects unticked extras');
}

// ── Opt-in extras appear ONLY when ticked — and are still redacted ─────────
{
  const input = sampleInput();
  const pkg = buildDiagnostics(input, { includeSceneSummary: true, includeCompiledPacket: true, includeMediaFiles: true });
  const names = pkg.files.map((f) => f.relPath);
  assert.ok(names.includes('scene-summary.txt'), 'scene summary included when ticked');
  assert.ok(names.includes('compiled-packet.txt'), 'compiled packet included when ticked');
  assert.ok(names.includes('media-list.txt'), 'media list included when ticked');

  const all = pkg.files.map((f) => f.content).join('\n');
  // Opted-in content is present...
  assert.ok(all.includes('my private words'), 'the creator DID ask for the scene summary');
  // ...but secrets are STILL redacted even inside opted-in content.
  assert.ok(!all.includes(XAI_KEY), 'secrets redacted even in opted-in scene summary');
  assert.ok(!all.includes(GOOGLE_KEY), 'secrets redacted even in opted-in compiled packet');
  // Media list is file names only, never full paths.
  const media = pkg.files.find((f) => f.relPath === 'media-list.txt')!.content;
  assert.ok(media.includes('my secret song.mp3') && !media.includes('C:\\Users'), 'media list is file names only');
  assert.match(pkg.preview, /You chose to also include/, 'preview names the opted-in extras');
}

// ── sanitize() composes both redactors ────────────────────────────────────
{
  const s = sanitize(`key ${GOOGLE_KEY} at C:\\Users\\bob\\x.mp4`);
  assert.ok(!s.includes(GOOGLE_KEY) && !s.includes('bob'), 'sanitize removes secrets AND paths');
}

// ── An empty/absent project must not break the package ────────────────────
{
  const input = { ...sampleInput(), director: null, projectSchemaVersion: null, logLines: [] };
  const pkg = buildDiagnostics(input, defaultDiagnosticsOptions());
  const report = JSON.parse(pkg.files.find((f) => f.relPath === 'report.json')!.content);
  assert.equal(report.project.entities, 0, 'no project → zero counts, not a crash');
  assert.equal(report.takes.length, 0);
}

console.log('[diagnostics] PASS — exact secret values + Google/xAI key patterns never survive, private paths reduced to file names, opt-in extras excluded by default and still redacted when included, useful app/runtime/provider/project metadata retained, honest preview.');
