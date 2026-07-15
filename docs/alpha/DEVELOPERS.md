# Song Studio Alpha — developer / agent notes

Architecture boundaries introduced by ALPHA-001. Read this before touching settings,
credentials, providers, recovery, or packaging.

---

## 1. Two kinds of state — never mix them

| | `ReleaseProject` | `AppSettings` |
|---|---|---|
| Holds | creative truth: scenes, entities, references, takes, direction, lyrics | this device's preferences |
| Lives in | the user's `.ssproj` file (their chosen location) | `settings.json` in the Tauri **app-data dir** |
| Module | `src/project/*`, `src/director/*` | `src/app/appSettings.ts` |
| Travels between machines | yes (it's the creative work) | no |
| May contain a secret | **never** | **never** |

`AppSettings` owns: onboarding completion, last project path, update channel/auto-check,
per-role provider preferences, credential **metadata**, diagnostics consent, developer mode.

Both are **versioned + normalized on load**. `normalizeAppSettings` is *total*: any input
(null, garbage, truncated, older) yields a usable object. `migrateAppSettings` carries older
payloads forward — and critically **preserves onboarding completion**, so an update never
re-onboards a user.

Writes go through `settingsStore.saveAppSettings` → temp file + rename (**atomic**). A crashed
write leaves the previous file intact (tested).

---

## 2. Secure-store boundary (the hard rule)

**An API key may exist in exactly two places:**

1. the **OS credential store** (Windows Credential Manager via the Rust `keyring` crate,
   exposed as the `secure_set` / `secure_get` / `secure_remove` / `secure_available` commands);
2. **process memory** for the session (`secureStore.ts`, module-scoped `sessionKeys` map).

It must **never** appear in: `ReleaseProject`, `settings.json`, `localStorage`, generation
packages, diagnostics, logs, crash messages, updater metadata, or Git.

- `appSettings.providers.credentials[id]` stores **only** `{ configured, storage, lastSuccessAt,
  lastTestCategory }`. `normalizeAppSettings` actively **strips** any secret-looking field, and
  `settingsContainsSecretLike()` is the guard.
- Every provider error passes through `redactSecret()` before reaching a user, a log, or
  diagnostics.
- Tests inject `createMemorySecureStore()` — **never** require real credentials.

If you add a provider, add its key pattern to `redactSecret()` **and** to the assertions in
`security.test.mts` / `diagnostics.test.mts`.

---

## 3. Provider architecture

Unchanged from DEC-003: canonical direction → conditioning compiler → `GenerationPacket` →
a capability-described adapter. **Grok is a peer of Google, not a fork** — it consumes the same
packet.

```
src/director/providers/
  types.ts        VideoProviderAdapter / ImageProviderAdapter / ProviderCapabilities / ProviderIo
  registry.ts     PROVIDERS + IMAGE_PROVIDERS + capability-based `auto` resolution
  omniFlash.ts    Google Gemini Omni (default video)
  googleVideo.ts  Google Veo (specialist)
  geminiImage.ts  Google image
  xai.ts          Grok text + image + video
  mock*.ts        deterministic test adapters
src/app/providerRuntime.ts   accounts, key resolution, connection tests, error mapping
```

Rules:

- **Capabilities are declared from documented facts only.** Anything not in the provider's
  official docs is `false` — see `xaiVideoCapabilities.sourceVideoEditing`. Never guess.
- **No silent mutation.** Readiness (`providerReadiness.ts`) *blocks* and offers executable
  resolutions; adapters send the creator's exact duration/references.
- `resolveRepairProvider('auto', …)` only picks a provider that declares
  `sourceVideoEditing` — so `auto` can never quietly turn a repair into a regeneration.
- Every adapter takes an injected `ProviderIo`. **No global monkey-patching, no `fetch` at
  module scope.**

Adding a provider = capabilities + adapter + registry entry + an account in
`providerRuntime.ACCOUNTS` + error mapping + tests. Nothing in the UI should branch on a
provider name.

---

## 4. Autosave / recovery (`src/app/recovery.ts`)

Pure logic + an injected `RecoveryFs`; the Node harness and the Tauri host share it.

- **Debounce:** `shouldWrite()` fires when an edit settles for `DEBOUNCE_MS` (1.5s) *or* when
  we've deferred for `MAX_DEFER_MS` (10s) under constant typing.
- **Atomic:** `atomicWrite()` = temp + rename. A crash never truncates a project.
- **Snapshots:** zero-padded names so lexicographic == chronological; rolling window of
  `MAX_SNAPSHOTS` (5); `loadNewestValidSnapshot()` skips corrupt files and **preserves them**.
- **Unclean shutdown:** a `session.open` marker is written at launch and removed on clean exit.
- **`decideLaunchOffer()`** is pure — recovery outranks reopen-last; nothing is auto-applied.
- **`autosaveTarget()`**: a never-saved project autosaves **only** into the recovery area. We do
  not pretend it has a permanent home, and we never overwrite a user's file with partial JSON.
- Recovery **never deletes generated media**.

---

## 5. Updater (`src/app/updater.ts`)

The official Tauri updater plugin does the real work (download + **minisign verification** +
install). This module is the testable seam:

- `UpdaterPort` = `{ check, downloadAndInstall, relaunch }` — the host implements it over
  `@tauri-apps/plugin-updater`; tests use a mock.
- Pure state machine: `checkForUpdate` → `downloadUpdate` → `restartIntoUpdate`.
- `restartIntoUpdate` **refuses while `generating` or `rendering`** → `restart-deferred`.
- `mapUpdaterError` turns every failure into plain language and always states the current
  install is untouched. Signature failure says *explicitly* that nothing was installed.
- Do **not** reimplement signature verification here.

Config: `bundle.createUpdaterArtifacts: true`, `plugins.updater.{endpoints,pubkey,windows.installMode}`.
`pubkey` must be filled in before updates can verify (see the operator guide).

---

## 6. FFmpeg sidecar

- `scripts/stage-ffmpeg.mjs` copies the `ffmpeg-static` binary into
  `src-tauri/binaries/ffmpeg-<target-triple>[.exe]` — the name Tauri's `externalBin` requires.
  It asks `rustc -vV` for the host tuple.
- Wired into `build:release`, which is `beforeBuildCommand` — **a bundle cannot be produced
  without its video engine**.
- The ~79 MB binary is **git-ignored**. Never commit it; CI stages it at build time.
- Resolution (`resolve_ffmpeg()` in `src-tauri/src/lib.rs`) is **mode-dependent**:
  - **release build → the bundled sidecar ONLY.** No node_modules fallback, no PATH fallback.
    A missing sidecar is a packaging fault and is reported as one.
  - **debug build →** `SONG_STUDIO_FFMPEG` → sidecar → `node_modules/ffmpeg-static` → PATH.
- `health_check` reports app-data writability (probed with a real file), FFmpeg presence +
  source, credential-store availability, and the version.

---

## 7. Diagnostics redaction (`src/app/diagnostics.ts`)

- **Default = safe.** `buildDiagnostics()` emits versions, runtime health, provider/job metadata,
  project **counts**, and scrubbed logs.
- `sanitize()` = `redactSecret()` ∘ `redactPathsInText()`. Applied to **every** free-text field,
  including opted-in extras.
- `redactPath()` reduces any path to its file name — user names and folder layout never leave.
- Opt-in extras (`includeSceneSummary` / `includeCompiledPacket` / `includeMediaFiles`) are
  **false by default** and surfaced in the preview.
- `preview` must always describe exactly what will be exported.

---

## 8. Alpha flags

- `AppSettings.ui.developerMode` — reveals internal tools (Canvas lab, raw provider status,
  compiled-packet inspector). **Off by default**; normal testers never see them.
- `AppSettings.ui.alphaFeatures` — alpha experiments in the normal interface.
- `is_installed_build()` (Rust, `!cfg!(debug_assertions)`) — decides FFmpeg resolution strictness.

Developer-only controls go behind `developerMode` or Diagnostics. Never in the default alpha UI.

---

## 9. Test map

| Script | Covers |
|---|---|
| `app:settings:test` | migration, corruption fallback, atomic write, one-time onboarding, no-secrets boundary |
| `app:security:test` | secure vs session keys, forget, resolution order, broken vault, redaction |
| `app:recovery:test` | debounce, atomic replace, rolling snapshots, corrupt fallback, pending jobs, launch offer |
| `app:diagnostics:test` | secret + path redaction, opt-in defaults, useful metadata |
| `updater:test` | no-update / available / signature failure / download failure / restart blocked |
| `grok:test` | Grok text/image/video lifecycle, error mapping, readiness, no silent mutation |
| `alpha:config:test` | tauri.conf + Cargo version match, icons, sidecar wiring, updater config, workflow, docs |
| `director:*`, `direction:test`, `render:smoke`, … | pre-existing Director Mode + media suite (unchanged) |

Rules: no test may require a real credential, a network call, or a published release.
Do not weaken an existing test to make a new one pass.
