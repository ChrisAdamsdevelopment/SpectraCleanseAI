// ALPHA-001 §14 — release/packaging configuration validity. This is the guard
// that a production Windows alpha is actually buildable and correctly described,
// without needing to run a 20-minute bundle.
// Run: npm run alpha:config:test

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '..', '..');

const conf = JSON.parse(readFileSync(join(APP, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
const cargo = readFileSync(join(APP, 'src-tauri', 'Cargo.toml'), 'utf8');

// ── Product identity / metadata (§1) ───────────────────────────────────────
{
  assert.equal(conf.productName, 'Song Studio', 'product name');
  assert.equal(conf.identifier, 'com.spectracleanse.songstudio', 'stable Windows application identifier');
  assert.match(conf.version, /^\d+\.\d+\.\d+-alpha\.\d+$/, 'semantic ALPHA version (e.g. 0.1.0-alpha.1)');
  assert.equal(conf.bundle.publisher, 'SpectraCleanse', 'publisher metadata present');
  assert.ok(conf.bundle.copyright?.includes('SpectraCleanse'), 'copyright metadata present');
  assert.ok(conf.bundle.shortDescription?.length > 10, 'short description present');
  assert.ok(conf.bundle.longDescription?.length > 30, 'long description present');
  assert.ok(conf.bundle.homepage?.startsWith('https://'), 'project URL present');
  assert.equal(conf.bundle.category, 'Video');

  // The Cargo version must track the bundle version or Windows metadata lies.
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  assert.equal(cargoVersion, conf.version, 'Cargo.toml version matches tauri.conf.json version');
}

// ── License file actually exists at the configured path ────────────────────
{
  const licPath = resolve(join(APP, 'src-tauri'), conf.bundle.licenseFile);
  assert.ok(existsSync(licPath), `bundle.licenseFile resolves to a real file (${licPath})`);
}

// ── Icons exist ────────────────────────────────────────────────────────────
{
  assert.ok(Array.isArray(conf.bundle.icon) && conf.bundle.icon.length > 0, 'icons configured');
  for (const rel of conf.bundle.icon) {
    assert.ok(existsSync(join(APP, 'src-tauri', rel)), `icon exists: ${rel}`);
  }
  assert.ok(conf.bundle.icon.some((i: string) => i.endsWith('.ico')), 'a Windows .ico is present');
  assert.equal(conf.bundle.windows.nsis.installerIcon, 'icons/icon.ico', 'NSIS installer icon set');
  assert.ok(existsSync(join(APP, 'src-tauri', conf.bundle.windows.nsis.installerIcon)), 'NSIS installer icon file exists');
}

// ── Windows installer targets (§1) ─────────────────────────────────────────
{
  assert.ok(Array.isArray(conf.bundle.targets), 'explicit bundle targets (not "all")');
  assert.ok(conf.bundle.targets.includes('nsis'), 'NSIS installer is the primary artifact');
  assert.equal(conf.bundle.active, true);
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser', 'per-user install needs no admin rights for testers');

  // MSI is deliberately excluded: a REAL `tauri build` proved WiX rejects a
  // semver pre-release identifier ("must be numeric-only"), so 'msi' + an
  // -alpha.N version cannot both be true. We keep the honest version and ship
  // NSIS + portable ZIP. This assertion locks the decision so nobody re-adds
  // 'msi' without also moving off the alpha version and re-testing.
  if (/-alpha\./.test(conf.version)) {
    assert.ok(!conf.bundle.targets.includes('msi'),
      'MSI must not be a target while the version carries a semver pre-release tag (WiX rejects it — see bundle.windows._msiNote)');
    assert.ok(typeof conf.bundle.windows._msiNote === 'string' && conf.bundle.windows._msiNote.includes('numeric-only'),
      'the MSI exclusion is documented in the config');
  }
}

// ── FFmpeg sidecar (§1/§8) ─────────────────────────────────────────────────
{
  assert.ok(Array.isArray(conf.bundle.externalBin), 'externalBin configured');
  assert.ok(conf.bundle.externalBin.includes('binaries/ffmpeg'), 'ffmpeg registered as a Tauri sidecar');

  // The staging script must be wired into the production build, or a bundle
  // could ship without its video engine.
  assert.ok(pkg.scripts['stage:ffmpeg'], 'stage:ffmpeg script exists');
  assert.ok(pkg.scripts['build:release']?.includes('stage-ffmpeg'), 'build:release stages the sidecar');
  assert.equal(conf.build.beforeBuildCommand, 'npm run build:release', 'the Tauri build runs the staging step first');
  assert.ok(existsSync(join(APP, 'scripts', 'stage-ffmpeg.mjs')), 'the staging script exists on disk');

  // The huge binary must never be committed.
  const ignore = readFileSync(join(APP, '.gitignore'), 'utf8');
  assert.ok(/^src-tauri\/binaries\/$/m.test(ignore), 'the staged sidecar directory is git-ignored');

  // A real `tauri build` (2026-07-15) generated an NSIS script containing:
  //   File /a "/oname=ffmpeg.exe" "...\binaries\ffmpeg-x86_64-pc-windows-msvc.exe"
  // i.e. the sidecar is installed NEXT TO the app exe with the target triple
  // STRIPPED. The Rust resolver must therefore probe the stripped name, or an
  // installed build would never find its own video engine.
  const libRs = readFileSync(join(APP, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.ok(/fn sidecar_candidates/.test(libRs), 'a sidecar resolver exists');
  assert.ok(/ffmpeg_exe_name\(\)\.to_string\(\)/.test(libRs),
    'the resolver probes the STRIPPED sidecar name (ffmpeg.exe) — the name NSIS actually installs');
  assert.ok(/format!\("ffmpeg-\{\}\{\}", current_target_triple\(\)/.test(libRs),
    'and also the triple-suffixed name, so resolution is correct either way');
  assert.ok(/is_installed_build\(\)[\s\S]{0,400}?bundled-sidecar/.test(libRs)
    || /No silent developer-machine fallback|no silent developer-machine fallback/i.test(libRs),
    'an installed build resolves the bundled sidecar ONLY — no dev/PATH fallback');
}

// ── Updater (§3) ───────────────────────────────────────────────────────────
{
  assert.equal(conf.bundle.createUpdaterArtifacts, true, 'updater artifacts are produced at build time');
  const u = conf.plugins?.updater;
  assert.ok(u, 'updater plugin configured');
  assert.ok(Array.isArray(u.endpoints) && u.endpoints.length > 0, 'an update endpoint is configured');
  assert.ok(u.endpoints[0].startsWith('https://'), 'updates are fetched over HTTPS only');
  assert.ok(u.endpoints[0].includes('latest.json'), 'endpoint points at an update manifest');
  assert.equal(typeof u.pubkey, 'string', 'pubkey field present');
  assert.equal(u.windows.installMode, 'passive', 'passive install shows progress without prompting');

  // Rust + JS updater deps must both be present or the plugin cannot work.
  assert.ok(/tauri-plugin-updater/.test(cargo), 'tauri-plugin-updater in Cargo.toml');
  assert.ok(/tauri-plugin-process/.test(cargo), 'tauri-plugin-process in Cargo.toml (relaunch)');
  assert.ok(pkg.dependencies['@tauri-apps/plugin-updater'], '@tauri-apps/plugin-updater in package.json');
  assert.ok(pkg.dependencies['@tauri-apps/plugin-process'], '@tauri-apps/plugin-process in package.json');
  assert.ok(pkg.scripts['updater:keygen'], 'a documented key-generation command exists');
}

// ── Secure storage dependency (§7) ─────────────────────────────────────────
{
  assert.ok(/^keyring\s*=/m.test(cargo), 'keyring crate present for the OS credential store');
  assert.ok(/windows-native/.test(cargo), 'Windows Credential Manager backend enabled for the alpha target');
}

// ── The asset protocol feature must match the config, or cargo check fails ──
{
  assert.equal(conf.app.security.assetProtocol.enable, true, 'asset protocol enabled (previews)');
  assert.ok(/tauri\s*=\s*\{[^}]*protocol-asset/.test(cargo), 'the protocol-asset feature is declared to match');
}

// ── GitHub release workflow (§2) ───────────────────────────────────────────
{
  const wfPath = join(REPO, '.github', 'workflows', 'song-studio-alpha-release.yml');
  assert.ok(existsSync(wfPath), 'the alpha release workflow exists');
  const wf = readFileSync(wfPath, 'utf8');

  assert.ok(/workflow_dispatch:/.test(wf), 'manual dispatch supported');
  assert.ok(/tags:/.test(wf) && /song-studio-v/.test(wf), 'tag-triggered alpha releases supported');
  assert.ok(/windows-latest/.test(wf), 'builds on a Windows runner');
  assert.ok(/x86_64-pc-windows-msvc/.test(wf), 'targets Windows x64');
  assert.ok(/stage:ffmpeg|stage-ffmpeg/.test(wf), 'the workflow stages FFmpeg during the build');
  assert.ok(/typecheck/.test(wf), 'typecheck runs before packaging');
  assert.ok(/prerelease:\s*true/.test(wf), 'publishes as a PRERELEASE (alpha)');
  assert.ok(/tauri-apps\/tauri-action/.test(wf), 'uses the official Tauri action');
  assert.ok(/TAURI_SIGNING_PRIVATE_KEY/.test(wf), 'updater signing key wired in CI');
  assert.ok(/sha256|checksum/i.test(wf), 'checksums produced');

  // Secrets must be referenced, never inlined.
  assert.ok(/\$\{\{\s*secrets\./.test(wf), 'secrets are referenced via the secrets context');
  assert.ok(!/AIza[0-9A-Za-z\-_]{20,}/.test(wf), 'no Google key hardcoded');
  assert.ok(!/xai-[0-9A-Za-z\-_]{16,}/.test(wf), 'no xAI key hardcoded');
  assert.ok(!/-----BEGIN/.test(wf), 'no private key material inlined');
}

// ── Release docs exist (§13) ───────────────────────────────────────────────
{
  for (const d of ['docs/alpha/TESTERS.md', 'docs/alpha/RELEASE-OPERATOR.md', 'docs/alpha/DEVELOPERS.md']) {
    assert.ok(existsSync(join(REPO, d)), `release documentation exists: ${d}`);
  }
}

console.log('[release-config] PASS — product/version/publisher/copyright/URL metadata, matching Cargo version, real license + icon files, NSIS per-user target (MSI correctly excluded while the version carries an -alpha tag), FFmpeg sidecar registered + staged by build:release + git-ignored, updater artifacts/endpoint/pubkey/installMode + both plugin deps + keygen command, keyring secure storage, protocol-asset feature matches config, Windows x64 release workflow (dispatch + tag, typecheck, prerelease, official action, signing secrets, checksums, no inlined secrets), and all three release docs.');
