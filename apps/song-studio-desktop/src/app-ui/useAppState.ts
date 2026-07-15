import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  IS_TAURI, appDir, tauriSettingsFs, tauriRecoveryFs, resolveSecureStore,
  healthCheck, createTauriUpdaterPort, unavailableUpdaterPort, healthProblems,
  type HealthReport,
} from '../app/appHost';
import { loadAppSettings, saveAppSettings } from '../app/settingsStore';
import { defaultAppSettings, type AppSettings } from '../app/appSettings';
import type { SecureStore } from '../app/secureStore';
import {
  initialUpdaterState, checkForUpdate, downloadUpdate, restartIntoUpdate, maybeStartupCheck,
  type UpdaterState, type BusyState,
} from '../app/updater';
import {
  RECOVERY_DIR, markSessionOpen, markSessionClean, wasUncleanShutdown,
  loadNewestValidSnapshot, writeSnapshot, decideLaunchOffer, atomicWrite,
  emptyDebounceState, markChanged, markWritten, shouldWrite, autosaveTarget,
  type RecoveryOffer,
} from '../app/recovery';

// APP STATE (ALPHA-001). Owns everything that is NOT the creative project:
// settings, secure store, health, updater, autosave/recovery. Kept out of
// App.tsx so the pure modules stay the tested source of truth.

export interface AppStateApi {
  ready: boolean;
  settings: AppSettings;
  setSettings: (next: AppSettings) => void;
  secureStore: SecureStore | null;
  health: HealthReport | null;
  healthMessages: string[];
  appVersion: string;
  updater: UpdaterState;
  checkUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  restart: (busy: BusyState) => Promise<void>;
  /** Launch offer (reopen last / recover). Cleared by dismissRecovery(). */
  recoveryOffer: RecoveryOffer;
  dismissRecovery: () => void;
  loadRecoverySnapshot: () => Promise<unknown | null>;
  /** Autosave a project payload; explicitPath=null → recovery area only. */
  noteProjectChanged: (json: string, explicitPath: string | null) => void;
  lastAutosaveAt: string | null;
}

export function useAppState(): AppStateApi {
  const [ready, setReady] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings>(defaultAppSettings());
  const [secureStore, setSecureStore] = useState<SecureStore | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [appVersion, setAppVersion] = useState('0.1.0-alpha.1');
  const [updater, setUpdater] = useState<UpdaterState>(initialUpdaterState('0.1.0-alpha.1'));
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryOffer>({ kind: 'none' });
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);

  const dirRef = useRef<string | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const updaterPort = useRef(IS_TAURI ? createTauriUpdaterPort() : unavailableUpdaterPort);

  // Autosave plumbing
  const debounce = useRef(emptyDebounceState());
  const pending = useRef<{ json: string; explicitPath: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!IS_TAURI) { setReady(true); return; }
      try {
        const dir = await appDir();
        dirRef.current = dir;

        const [loaded, store, h, v] = await Promise.all([
          loadAppSettings(dir, tauriSettingsFs),
          resolveSecureStore(),
          healthCheck(),
          getVersion().catch(() => '0.1.0-alpha.1'),
        ]);
        if (cancelled) return;

        setSettingsState(loaded.settings);
        setSecureStore(store);
        setHealth(h);
        setAppVersion(v);
        setUpdater(initialUpdaterState(v));

        // If a migration happened, persist the upgraded shape immediately so the
        // next launch is cheap and the file is never left in an older form.
        if (loaded.migratedFrom !== null || loaded.status !== 'ok') {
          await saveAppSettings(dir, loaded.settings, tauriSettingsFs).catch(() => {});
        }

        // Recovery: was the last session clean, and is there a snapshot?
        const recDir = tauriRecoveryFs.join(dir, RECOVERY_DIR);
        const unclean = await wasUncleanShutdown(recDir, tauriRecoveryFs);
        const snap = await loadNewestValidSnapshot(recDir, tauriRecoveryFs);
        setRecoveryOffer(decideLaunchOffer({
          lastProjectPath: loaded.settings.lastProjectPath,
          uncleanShutdown: unclean,
          newestSnapshot: snap.name,
          // We only claim "newer" when we cannot prove otherwise; an unclean
          // shutdown already forces the recover branch.
          snapshotNewerThanFile: false,
        }));

        // Mark this session open; clear it on a clean exit.
        await markSessionOpen(recDir, tauriRecoveryFs, new Date().toISOString());
        const onClose = () => { void markSessionClean(recDir, tauriRecoveryFs); };
        window.addEventListener('beforeunload', onClose);

        setReady(true);

        // Startup update check — fired WITHOUT awaiting, so launch never blocks.
        void (async () => {
          const next = await maybeStartupCheck(initialUpdaterState(v), updaterPort.current, loaded.settings.update.autoCheck, new Date().toISOString());
          if (next && !cancelled) setUpdater(next);
        })();
      } catch {
        setReady(true);   // never trap the user behind a boot failure
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Settings persistence (atomic, via the tested store) ─────────────────
  const setSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    const dir = dirRef.current;
    if (dir) void saveAppSettings(dir, next, tauriSettingsFs).catch(() => {});
  }, []);

  // ── Autosave loop: the pure debounce decides; this only does IO ─────────
  useEffect(() => {
    if (!IS_TAURI) return;
    timer.current = setInterval(() => {
      const now = Date.now();
      if (!shouldWrite(debounce.current, now) || !pending.current || !dirRef.current) return;
      const { json, explicitPath } = pending.current;
      const recDir = tauriRecoveryFs.join(dirRef.current, RECOVERY_DIR);
      const target = autosaveTarget(explicitPath, recDir);
      debounce.current = markWritten(debounce.current, now);
      void (async () => {
        try {
          // A rolling snapshot ALWAYS happens — that is the crash net.
          await writeSnapshot(recDir, json, tauriRecoveryFs);
          // A project the creator actually saved also updates its own file,
          // atomically. An unsaved project stays in the recovery area only.
          if (target.kind === 'user-file') await atomicWrite(target.path, json, tauriRecoveryFs);
          setLastAutosaveAt(new Date().toISOString());
        } catch { /* autosave must never surface as a crash */ }
      })();
    }, 500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const noteProjectChanged = useCallback((json: string, explicitPath: string | null) => {
    pending.current = { json, explicitPath };
    debounce.current = markChanged(debounce.current, Date.now());
  }, []);

  const loadRecoverySnapshot = useCallback(async () => {
    if (!dirRef.current) return null;
    const recDir = tauriRecoveryFs.join(dirRef.current, RECOVERY_DIR);
    return (await loadNewestValidSnapshot(recDir, tauriRecoveryFs)).value;
  }, []);

  // ── Updater actions ────────────────────────────────────────────────────
  const checkUpdates = useCallback(async () => {
    const at = new Date().toISOString();
    setUpdater((s) => ({ ...s, status: 'checking', message: 'Checking for updates…' }));
    const next = await checkForUpdate(updaterRef(), updaterPort.current, at);
    setUpdater(next);
    setSettings({ ...settingsRef.current, update: { ...settingsRef.current.update, lastCheckedAt: at } });
  }, [setSettings]);

  const updaterStateRef = useRef(updater); updaterStateRef.current = updater;
  const updaterRef = () => updaterStateRef.current;

  const doDownload = useCallback(async () => {
    const next = await downloadUpdate(updaterRef(), updaterPort.current, (mid) => setUpdater(mid));
    setUpdater(next);
  }, []);

  const restart = useCallback(async (busy: BusyState) => {
    const next = await restartIntoUpdate(updaterRef(), updaterPort.current, busy);
    setUpdater(next);
  }, []);

  return {
    ready, settings, setSettings, secureStore, health,
    healthMessages: healthProblems(health),
    appVersion, updater,
    checkUpdates, downloadUpdate: doDownload, restart,
    recoveryOffer, dismissRecovery: () => setRecoveryOffer({ kind: 'none' }),
    loadRecoverySnapshot, noteProjectChanged, lastAutosaveAt,
  };
}
