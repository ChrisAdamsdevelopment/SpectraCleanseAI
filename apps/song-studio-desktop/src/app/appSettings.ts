// APP-GLOBAL SETTINGS (ALPHA-001 §4) — device-level preferences, strictly
// separate from ReleaseProject.
//
// ReleaseProject = creative project truth (scenes, entities, takes, direction).
// AppSettings    = this device's preferences (onboarding, last project, update
//                  channel, provider preferences, credential METADATA, consent).
//
// HARD RULE: no API key, secret, or token ever lives here. Only harmless
// credential metadata (configured / storage mode / last success date). Secrets
// live in the OS credential store or in memory (see secureStore.ts).
//
// Pure module: no IO, no React, no Tauri. Normalization + migration are total —
// a partially written or older file always yields a usable settings object.

export const APP_SETTINGS_SCHEMA_VERSION = 1;

/** A provider preference per creative role. 'auto' lets Song Studio choose from
 * declared capabilities; 'manual' always means the export/import package path. */
export type ProviderPreference = string; // 'auto' | 'manual' | provider id

export type CredentialStorageMode = 'secure' | 'session' | 'none';

/** Harmless, non-secret record of a provider credential's state. */
export interface CredentialMeta {
  configured: boolean;
  storage: CredentialStorageMode;
  lastSuccessAt: string | null;
  /** Last connection-test outcome category (never a raw provider error body). */
  lastTestCategory: string | null;
}

export interface OnboardingState {
  /** App version that completed (or skipped) onboarding. Non-null = never show
   * again. Updating the app does NOT reset this (§5). */
  completedVersion: string | null;
  completedAt: string | null;
  /** True when the creator skipped rather than finished — still counts as done. */
  skipped: boolean;
}

export interface AppSettings {
  schemaVersion: number;
  onboarding: OnboardingState;
  /** Absolute path of the last opened project (offer to reopen at launch). */
  lastProjectPath: string | null;
  update: {
    channel: 'alpha' | 'stable';
    autoCheck: boolean;
    lastCheckedAt: string | null;
  };
  providers: {
    /** Preferred provider per role; 'auto' = choose by capability. */
    preferred: {
      text: ProviderPreference;
      image: ProviderPreference;
      video: ProviderPreference;
      repair: ProviderPreference;
      lipSync: ProviderPreference;
    };
    /** provider id -> metadata ONLY. Never the key itself. */
    credentials: Record<string, CredentialMeta>;
  };
  diagnostics: {
    /** Explicit consent for a local redacted event log (§13). Off by default. */
    localEventLog: boolean;
  };
  ui: {
    /** Reveals internal/developer tools (Canvas lab, raw provider status). */
    developerMode: boolean;
    /** Alpha-only experiments visible in the normal interface. */
    alphaFeatures: boolean;
  };
}

export function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    onboarding: { completedVersion: null, completedAt: null, skipped: false },
    lastProjectPath: null,
    update: { channel: 'alpha', autoCheck: true, lastCheckedAt: null },
    providers: {
      preferred: { text: 'auto', image: 'auto', video: 'auto', repair: 'auto', lipSync: 'auto' },
      credentials: {},
    },
    diagnostics: { localEventLog: false },
    ui: { developerMode: false, alphaFeatures: true },
  };
}

// ── Normalization (total: any input → a usable AppSettings) ─────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const str = (v: unknown, fb: string | null = null): string | null => (typeof v === 'string' ? v : fb);
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fb;

/** Keys that must NEVER appear in the settings file. If a older/broken build
 * ever wrote one, normalization strips it (defense in depth, §7). */
const FORBIDDEN_CREDENTIAL_KEYS = ['apiKey', 'key', 'secret', 'token', 'password', 'credential'];

function normalizeCredentialMeta(v: unknown): CredentialMeta {
  if (!isRecord(v)) return { configured: false, storage: 'none', lastSuccessAt: null, lastTestCategory: null };
  return {
    configured: bool(v.configured, false),
    storage: oneOf(v.storage, ['secure', 'session', 'none'] as const, 'none'),
    lastSuccessAt: str(v.lastSuccessAt),
    lastTestCategory: str(v.lastTestCategory),
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const base = defaultAppSettings();
  if (!isRecord(value)) return base;

  const onboarding = isRecord(value.onboarding) ? value.onboarding : {};
  const update = isRecord(value.update) ? value.update : {};
  const providers = isRecord(value.providers) ? value.providers : {};
  const preferred = isRecord(providers.preferred) ? providers.preferred : {};
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};
  const ui = isRecord(value.ui) ? value.ui : {};

  const credentials: Record<string, CredentialMeta> = {};
  if (isRecord(providers.credentials)) {
    for (const [pid, meta] of Object.entries(providers.credentials)) {
      const m = normalizeCredentialMeta(meta);
      // Strip any secret-looking field that should never have been written.
      if (isRecord(meta)) {
        for (const k of Object.keys(meta)) {
          if (FORBIDDEN_CREDENTIAL_KEYS.includes(k)) { m.configured = m.configured || Boolean((meta as Record<string, unknown>)[k]); }
        }
      }
      credentials[pid] = m;
    }
  }

  const pref = (k: unknown): ProviderPreference => (typeof k === 'string' && k ? k : 'auto');

  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    onboarding: {
      completedVersion: str(onboarding.completedVersion),
      completedAt: str(onboarding.completedAt),
      skipped: bool(onboarding.skipped, false),
    },
    lastProjectPath: str(value.lastProjectPath),
    update: {
      channel: oneOf(update.channel, ['alpha', 'stable'] as const, 'alpha'),
      autoCheck: bool(update.autoCheck, true),
      lastCheckedAt: str(update.lastCheckedAt),
    },
    providers: {
      preferred: {
        text: pref(preferred.text), image: pref(preferred.image), video: pref(preferred.video),
        repair: pref(preferred.repair), lipSync: pref(preferred.lipSync),
      },
      credentials,
    },
    diagnostics: { localEventLog: bool(diagnostics.localEventLog, false) },
    ui: { developerMode: bool(ui.developerMode, false), alphaFeatures: bool(ui.alphaFeatures, true) },
  };
}

/** Migrate an older settings payload forward. Each step is additive and
 * lossless; unknown/newer versions normalize defensively rather than throw. */
export function migrateAppSettings(value: unknown): { settings: AppSettings; migratedFrom: number | null } {
  const from = isRecord(value) && typeof value.schemaVersion === 'number' ? value.schemaVersion : null;
  // v0 (unversioned/absent) -> v1: normalization supplies every new field.
  const settings = normalizeAppSettings(value);
  return { settings, migratedFrom: from !== null && from !== APP_SETTINGS_SCHEMA_VERSION ? from : null };
}

// ── Onboarding rules (§5) ───────────────────────────────────────────────────

/** Onboarding shows ONLY when it has never been completed or skipped. An app
 * update never resets this: we check for the PRESENCE of completedVersion, not
 * equality with the current version. */
export function shouldShowOnboarding(s: AppSettings): boolean {
  return s.onboarding.completedVersion === null;
}

/** Mark onboarding done. `skipped` records how it ended; both count as done, so
 * the introduction never reappears. */
export function completeOnboarding(s: AppSettings, appVersion: string, skipped: boolean, at: string): AppSettings {
  return { ...s, onboarding: { completedVersion: appVersion, completedAt: at, skipped } };
}

/** Explicit creator action from Settings ("Show introduction again"). */
export function resetOnboarding(s: AppSettings): AppSettings {
  return { ...s, onboarding: { completedVersion: null, completedAt: null, skipped: false } };
}

// ── Credential metadata helpers (never touches the secret itself) ────────────

export function setCredentialMeta(s: AppSettings, providerId: string, meta: Partial<CredentialMeta>): AppSettings {
  const prev = s.providers.credentials[providerId] ?? { configured: false, storage: 'none' as const, lastSuccessAt: null, lastTestCategory: null };
  return {
    ...s,
    providers: { ...s.providers, credentials: { ...s.providers.credentials, [providerId]: { ...prev, ...meta } } },
  };
}

export function clearCredentialMeta(s: AppSettings, providerId: string): AppSettings {
  const credentials = { ...s.providers.credentials };
  delete credentials[providerId];
  return { ...s, providers: { ...s.providers, credentials } };
}

export function setPreferredProvider(s: AppSettings, role: keyof AppSettings['providers']['preferred'], providerId: ProviderPreference): AppSettings {
  return { ...s, providers: { ...s.providers, preferred: { ...s.providers.preferred, [role]: providerId } } };
}
