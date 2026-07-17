# Song Studio Alpha — release operator guide

Everything needed to cut, publish, verify, and withdraw a Windows alpha release.

---

## 1. Versioning

The version lives in **two files that must always match** (`alpha:config:test` enforces this):

- `apps/song-studio-desktop/src-tauri/tauri.conf.json` → `version`
- `apps/song-studio-desktop/src-tauri/Cargo.toml` → `[package] version`

Format: `MAJOR.MINOR.PATCH-alpha.N` — e.g. `0.1.0-alpha.2`.

The updater compares these versions, so **every release must bump it**. Publishing the same
version twice means existing installs will never see the update.

---

## 2. Required GitHub repository secrets

Settings → Secrets and variables → Actions → **New repository secret**.

| Secret | Required? | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | **Yes, for updates** | The updater private key (contents of the `.key` file from keygen below). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **Yes** | The password you chose at keygen. Set to an empty string if you chose none — the secret must still exist. |
| `WINDOWS_CERTIFICATE` | Optional | Base64-encoded `.pfx` code-signing certificate. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Optional | Password for that `.pfx`. |

`GITHUB_TOKEN` is injected automatically — do **not** create one.

> Without `TAURI_SIGNING_PRIVATE_KEY` the build still succeeds, but the updater artifacts are
> unsigned and **in-app updates will fail verification**. The workflow prints this loudly in the
> job summary.

---

## 3. Updater signing keys (one-time)

```bash
cd apps/song-studio-desktop
npm run updater:keygen         # writes .tauri/songstudio-updater.key + .key.pub
```

Then:

1. Copy the **private** key file's contents into the `TAURI_SIGNING_PRIVATE_KEY` secret.
2. Put the password into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Copy the **public** key (contents of `.key.pub`) into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and commit that.

**The `pubkey` field ships inside the app.** An installed build only trusts updates signed by the
matching private key.

- `.tauri/` and `*.key` are git-ignored. **Never commit the private key.**
- **Back the private key up somewhere safe.** If you lose it you cannot ship updates to existing
  installs — every tester would have to reinstall manually.
- Rotating the key requires shipping a new build with the new `pubkey`, which existing installs
  can only get by reinstalling. Treat rotation as a last resort.

> The `pubkey` is currently **empty** in `tauri.conf.json`, and `bundle.createUpdaterArtifacts`
> is on. A real `tauri build` (2026-07-16) confirmed the build **produces the installer but then
> FAILS at the updater-signing step** when `TAURI_SIGNING_PRIVATE_KEY` is absent. Therefore an
> alpha **release requires** the signing key + a real `pubkey` — the workflow now fails early and
> clearly if either is missing. (You can still run `tauri build` locally to smoke-test the
> UNSIGNED `.exe`, which is produced before the signing step.) This is the single blocking item
> for update delivery.

---

## 4. Windows code signing (optional)

Without a certificate the alpha is **unsigned**:

- SmartScreen shows "Windows protected your PC" on first run;
- testers must click **More info → Run anyway**;
- this is documented for testers in `docs/alpha/TESTERS.md`.

That is acceptable for a private alpha. For a wider release, buy an OV/EV code-signing
certificate, export it as `.pfx`, base64 it, and set `WINDOWS_CERTIFICATE` +
`WINDOWS_CERTIFICATE_PASSWORD`. Reputation with SmartScreen builds over time even when signed.

**Updater signing and Windows code signing are different things.** Updater signing is
mandatory for in-app updates; code signing only affects the SmartScreen warning.

---

## 5. Triggering a build

**Option A — manual (recommended for the first one):**
Actions → *Song Studio Alpha Release* → **Run workflow** → enter the version (must match
`tauri.conf.json`) and release notes → Run.

**Option B — tag:**
```bash
git tag song-studio-v0.1.0-alpha.2
git push origin song-studio-v0.1.0-alpha.2
```

The workflow gates the release on typecheck + the full unit/logic suite + the real-FFmpeg media
smokes, then stages FFmpeg, validates the release config, and builds.

---

## 6. What gets published

A **prerelease** containing:

> **No MSI.** A real `tauri build` proved WiX rejects a semver pre-release identifier
> ("must be numeric-only"), so an `-alpha.N` version and an MSI are mutually exclusive.
> The alpha ships the NSIS installer (the preferred format) plus a portable ZIP. If you
> ever need an MSI, move to a numeric version like `0.1.0` and add `"msi"` back to
> `bundle.targets` — `alpha:config:test` will hold you to that.

| Asset | Purpose |
|---|---|
| `Song-Studio-<v>-Windows-x64-Setup.exe` | NSIS installer — the primary download (also the Tauri v2 updater artifact) |
| `Song-Studio-<v>-Windows-x64-Portable.zip` | Portable build (exe + FFmpeg sidecar), no auto-update |
| `Song-Studio-<v>-Windows-x64-Setup.exe.sig` | Tauri v2 updater signature (there is NO `.nsis.zip` — that was v1) |
| `latest.json` (on the `song-studio-alpha-updater` tag) | The manifest the app polls |
| `SHA256SUMS.txt` | Checksums |

### How the update channel works (prerelease-safe)

GitHub's `/releases/latest` **excludes prereleases**, and every alpha is a prerelease — so the app
does NOT poll `/releases/latest`. Instead it polls a **fixed release tag**
`song-studio-alpha-updater` whose assets the workflow **replaces on every publish**:

- `latest.json` — the manifest (version, notes, signature, and a stable installer URL)
- `Song-Studio-Windows-x64-Setup.exe` — the newest signed installer (stable name)
- `Song-Studio-Windows-x64-Setup.exe.sig` — its updater signature

The endpoint in `tauri.conf.json` is
`.../releases/download/song-studio-alpha-updater/latest.json`. This is independent of GitHub's
prerelease handling and supports alpha.1 → alpha.2 ordering.

**If updater signing is not configured** (`TAURI_SIGNING_PRIVATE_KEY` absent), the workflow still
builds and publishes the installer, but **skips the updater channel** and the job summary says
in-app updates are disabled — it never publishes a fake/unsigned update.

### Windows code signing

Windows code signing is **not performed** by the workflow (setting a certificate env var alone
does not sign anything in Tauri v2 — it needs `bundle.windows.certificateThumbprint`/`signCommand`
plus a certificate import step). The alpha ships **unsigned on purpose**; SmartScreen warns and
that is documented for testers. Updater signing (minisign) is separate and IS required for
in-app updates.

---

## 7. Testing update delivery

You need **two** releases; the updater compares versions.

1. Publish `0.1.0-alpha.1` and install it on a clean Windows machine.
2. Bump to `0.1.0-alpha.2` (both files), publish it.
3. On the test machine: **Settings → Check for updates** → the new version and its notes appear.
4. Download → the app installs it → **Restart** → confirm the version in Settings changed and
   **the introduction did not reappear**.
5. Confirm a restart is refused while a scene is generating.

If verification fails, the app says so and **keeps the current version** — check that `pubkey`
matches the private key you signed with.

---

## 8. Rolling back / withdrawing a bad release

The app always follows the **latest** release, so:

1. **Fastest:** mark the bad release as a **draft** (or delete it) in the GitHub UI. The previous
   prerelease becomes "latest" again and installs stop being offered the bad build.
2. Tell testers in the channel — anyone who already installed it must reinstall the good version
   manually; the updater will not move them *backwards*.
3. Fix forward: bump to a **higher** alpha number and publish. Never re-publish the same version.

A failed update never damages an install: verification/download failures leave the current
version untouched (covered by `updater:test`).

---

## 9. Reading tester diagnostics safely

Diagnostics packages are redacted **by the app, before export** — no keys, media, lyrics,
prompts, project titles, or folder paths, unless the tester explicitly ticked an extra.

- `report.json` — versions, FFmpeg health, provider/model + job phase, sanitized error category,
  project **counts**.
- `logs.txt` — recent logs with secrets and paths stripped.

If you ever see something that looks like a real key in a package, treat it as a **bug in the
redactor** and report it — `app:diagnostics:test` and `app:security:test` are the guards.

---

## 10. Pre-release checklist

- [ ] Version bumped in `tauri.conf.json` **and** `Cargo.toml` (they must match).
- [ ] `plugins.updater.pubkey` contains the real public key.
- [ ] `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set.
- [ ] `npm run alpha:config:test` passes locally.
- [ ] Previous release still installable (rollback path exists).
- [ ] Release notes written for the in-app updater.
