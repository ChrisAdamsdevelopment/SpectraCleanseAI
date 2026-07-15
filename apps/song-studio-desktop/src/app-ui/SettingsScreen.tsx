import { useEffect, useState } from 'react';
import type { AppSettings, CredentialStorageMode } from '../app/appSettings';
import { setCredentialMeta, clearCredentialMeta, setPreferredProvider, resetOnboarding } from '../app/appSettings';
import { ACCOUNTS, accountInfo, testAccount, type AccountId } from '../app/providerRuntime';
import { rememberKey, forgetKey, type SecureStore } from '../app/secureStore';
import { PROVIDERS, IMAGE_PROVIDERS } from '../director/providers/registry';
import type { ProviderIo } from '../director/providers/types';
import type { UpdaterState } from '../app/updater';
import type { HealthReport } from '../app/appHost';
import { healthProblems } from '../app/appHost';

// SETTINGS (ALPHA-001 §6/§9/§12). Real provider management — this replaces the
// development window.prompt() key entry entirely. Provider jargon (model ids,
// raw capabilities) lives only in the collapsed Advanced area.

type Tab = 'providers' | 'updates' | 'diagnostics' | 'about';

export interface SettingsDeps {
  settings: AppSettings;
  update: (next: AppSettings) => void;
  secureStore: SecureStore | null;
  io: ProviderIo | null;
  updater: UpdaterState;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onRestart: () => void;
  onExportDiagnostics: () => void;
  health: HealthReport | null;
  appVersion: string;
  onClose: () => void;
  /** Which account card to open first (from onboarding). */
  focusAccount?: AccountId | null;
}

export function SettingsScreen(d: SettingsDeps) {
  const [tab, setTab] = useState<Tab>(d.focusAccount ? 'providers' : 'providers');
  return (
    <div className="settings-screen">
      <div className="settings-head">
        <h2>Settings</h2>
        <div className="settings-tabs">
          {(['providers', 'updates', 'diagnostics', 'about'] as Tab[]).map((t) => (
            <button key={t} className={`dir-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
              {t === 'providers' ? 'AI Providers' : t}
            </button>
          ))}
        </div>
        <button className="ghost small" onClick={d.onClose}>Close</button>
      </div>

      {tab === 'providers' && <ProvidersTab {...d} />}
      {tab === 'updates' && <UpdatesTab {...d} />}
      {tab === 'diagnostics' && <DiagnosticsTab {...d} />}
      {tab === 'about' && <AboutTab {...d} />}
    </div>
  );
}

// ── AI Providers ────────────────────────────────────────────────────────────

function ProvidersTab(d: SettingsDeps) {
  return (
    <div className="settings-body">
      <p className="muted">Song Studio directs; a provider generates. You bring your own key — Song Studio never charges you and never sells credits.</p>

      {ACCOUNTS.map((a) => <AccountCard key={a.id} account={a.id} {...d} />)}

      <div className="prov-card">
        <div className="prov-head">
          <div>
            <h3>Manual generation</h3>
            <span className="chip small ok">Always available</span>
          </div>
        </div>
        <p className="muted small">No API key required. Song Studio exports the exact request — prompt, reference images, timing, identity fingerprints — as a folder. Generate it with any tool you like, then import the returned MP4 and Song Studio reconnects it to the right scene and take.</p>
      </div>

      <PreferredProviders {...d} />
    </div>
  );
}

function AccountCard({ account, settings, update, secureStore, io }: SettingsDeps & { account: AccountId }) {
  const info = accountInfo(account);
  const meta = settings.providers.credentials[account];
  const connected = Boolean(meta?.configured);
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<CredentialStorageMode>('secure');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [vaultAvailable, setVaultAvailable] = useState<boolean | null>(null);

  useEffect(() => { secureStore?.available().then(setVaultAvailable).catch(() => setVaultAvailable(false)); }, [secureStore]);

  // Providers that draw on this account, so the card explains what it powers.
  const videoProviders = PROVIDERS.filter((p) => p.account === account);
  const imageProviders = IMAGE_PROVIDERS.filter((p) => p.account === account);

  const connect = async () => {
    if (!key.trim()) { setBusy('Paste your API key first.'); return; }
    if (!io) { setBusy('Connecting a provider needs the desktop app.'); return; }
    setBusy('Testing the connection…'); setResult(null);

    // Test BEFORE storing, so we never persist a key we know is bad.
    const test = await testAccount(account, key.trim(), io);
    setResult({ ok: test.ok, message: test.message, detail: test.detail });
    if (!test.ok) {
      setBusy('');
      update(setCredentialMeta(settings, account, { lastTestCategory: test.category }));
      return;
    }
    const stored = await rememberKey(account, key.trim(), mode === 'secure' ? 'secure' : 'session', secureStore);
    if (!stored.ok) { setBusy(stored.error ?? 'Could not store the key.'); return; }
    update(setCredentialMeta(settings, account, {
      configured: true, storage: stored.storage as CredentialStorageMode,
      lastSuccessAt: new Date().toISOString(), lastTestCategory: 'ok',
    }));
    setKey('');                       // never keep the secret in component state
    setBusy(stored.storage === 'secure' ? 'Connected. The key is stored in Windows Credential Manager.' : 'Connected for this session only. The key is forgotten when you close Song Studio.');
  };

  const test = async () => {
    if (!io) return;
    setBusy('Testing the connection…'); setResult(null);
    const { keyForAccount } = await import('../app/providerRuntime');
    const existing = await keyForAccount(account, secureStore);
    if (!existing) { setBusy(''); setResult({ ok: false, message: 'No key is connected for this provider yet.' }); return; }
    const r = await testAccount(account, existing, io);
    setResult({ ok: r.ok, message: r.message, detail: r.detail });
    setBusy('');
    update(setCredentialMeta(settings, account, {
      lastTestCategory: r.category, ...(r.ok ? { lastSuccessAt: new Date().toISOString() } : {}),
    }));
  };

  const forget = async () => {
    await forgetKey(account, secureStore);
    update(clearCredentialMeta(settings, account));
    setResult(null); setBusy('Key forgotten. This provider is disconnected.');
  };

  return (
    <div className={`prov-card${connected ? ' connected' : ''}`}>
      <div className="prov-head">
        <div>
          <h3>{info.label}</h3>
          <span className={`chip small ${connected ? 'ok' : ''}`}>{connected ? `Connected · ${meta!.storage === 'secure' ? 'remembered securely' : 'this session only'}` : 'Not connected'}</span>
          {meta?.lastSuccessAt && <span className="muted small"> last worked {new Date(meta.lastSuccessAt).toLocaleDateString()}</span>}
        </div>
      </div>

      <p className="muted small"><b>Used for:</b> {info.usedFor}</p>
      <p className="muted small">{info.billing}</p>

      {!connected && (
        <div className="prov-connect">
          <label className="dir-field">
            <span>API key <span className="muted small">— {info.keyHint}</span></span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" autoComplete="off" spellCheck={false} />
          </label>
          <div className="prov-mode">
            <label><input type="radio" checked={mode === 'secure'} disabled={vaultAvailable === false} onChange={() => setMode('secure')} /> Remember securely on this computer</label>
            <label><input type="radio" checked={mode === 'session'} onChange={() => setMode('session')} /> Use for this session only</label>
          </div>
          {vaultAvailable === false && <p className="dir-warn small">Windows Credential Manager is unavailable, so the key cannot be remembered. You can still use it for this session.</p>}
          <p className="muted small">{info.keySource}</p>
          <button className="primary small" onClick={connect} disabled={!io}>Connect &amp; test</button>
        </div>
      )}

      {connected && (
        <div className="prov-actions">
          <button className="ghost small" onClick={test}>Test connection</button>
          <button className="ghost small" onClick={forget}>Forget key</button>
        </div>
      )}

      {busy && <div className="dir-busy small">{busy}</div>}
      {result && (
        <div className={`dir-conflict ${result.ok ? '' : 'blocking'}`}>
          <b>{result.message}</b>
          {result.detail && (
            <details className="prov-advanced"><summary>Technical detail</summary><pre className="dir-pre">{result.detail}</pre></details>
          )}
        </div>
      )}

      {/* Provider jargon lives here and nowhere else (§9). */}
      <details className="prov-advanced" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
        <summary>Advanced</summary>
        <div className="muted small">
          <p><b>Credential storage:</b> {connected ? (meta!.storage === 'secure' ? 'Windows Credential Manager' : 'memory (session only)') : 'not stored'}</p>
          <p><b>Last connection test:</b> {meta?.lastTestCategory ?? 'never tested'}</p>
          {videoProviders.map((p) => (
            <p key={p.id}><b>{p.label}</b> — max {p.capabilities.maxDurationSec ?? 'provider-inferred'}s · {p.capabilities.referenceImages} refs · source-video edit: {p.capabilities.sourceVideoEditing ? 'yes' : 'no'} · audio input: {p.capabilities.audioInput ? 'yes' : 'no'}</p>
          ))}
          {imageProviders.map((p) => (
            <p key={p.id}><b>{p.label}</b> — up to {p.capabilities.maxOutputs} variants · {p.capabilities.referenceImages} reference images · editing: {p.capabilities.editing ? 'yes' : 'no'}</p>
          ))}
        </div>
      </details>
    </div>
  );
}

const ROLES: Array<{ key: keyof AppSettings['providers']['preferred']; label: string; help: string }> = [
  { key: 'text', label: 'Directing assistant', help: 'Explaining conflicts and building custom directing tools.' },
  { key: 'image', label: 'Reference images', help: 'Generating character/object reference variants.' },
  { key: 'video', label: 'Scene video', help: 'Generating the moving scenes.' },
  { key: 'repair', label: 'Video repair', help: 'Editing an existing clip instead of regenerating it.' },
  { key: 'lipSync', label: 'Lip-sync repair', help: 'Syncing mouth movement to the vocal.' },
];

function PreferredProviders({ settings, update }: SettingsDeps) {
  const choicesFor = (role: string) => {
    const base = [{ id: 'auto', label: 'Auto — Song Studio chooses' }];
    const list = role === 'image'
      ? IMAGE_PROVIDERS.map((p) => ({ id: p.id, label: p.label }))
      : PROVIDERS.map((p) => ({ id: p.id, label: p.label }));
    return [...base, ...list];
  };
  return (
    <div className="prov-card">
      <h3>Which provider for what</h3>
      <p className="muted small">Auto picks the best connected provider using what each one actually supports. Providers are not interchangeable — Song Studio will not send a request a provider cannot honour.</p>
      {ROLES.map((r) => (
        <label key={r.key} className="prov-role">
          <span><b>{r.label}</b><br /><span className="muted small">{r.help}</span></span>
          <select value={settings.providers.preferred[r.key]} onChange={(e) => update(setPreferredProvider(settings, r.key, e.target.value))}>
            {choicesFor(r.key).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

// ── Updates ─────────────────────────────────────────────────────────────────

function UpdatesTab({ updater, settings, update, onCheckUpdates, onDownloadUpdate, onRestart }: SettingsDeps) {
  return (
    <div className="settings-body">
      <div className="prov-card">
        <h3>Updates</h3>
        <p><b>Current version:</b> {updater.currentVersion} <span className="chip small">Alpha</span></p>
        <p><b>Status:</b> {updater.status === 'available' && updater.available ? `Song Studio ${updater.available.version} is available` : updater.status.replace(/-/g, ' ')}</p>
        {updater.message && <p className="muted">{updater.message}</p>}
        {updater.status === 'downloading' && (
          <div className="upd-progress"><div className="upd-bar" style={{ width: `${Math.round(updater.progress * 100)}%` }} /></div>
        )}
        {updater.available && (
          <div className="upd-notes">
            <h4>What&rsquo;s new in {updater.available.version}</h4>
            <pre className="dir-pre">{updater.available.notes}</pre>
          </div>
        )}
        <div className="prov-actions">
          <button className="ghost small" onClick={onCheckUpdates} disabled={updater.status === 'checking' || updater.status === 'downloading'}>Check for updates</button>
          {updater.status === 'available' && <button className="primary small" onClick={onDownloadUpdate}>Download update</button>}
          {(updater.status === 'ready-to-restart' || updater.status === 'restart-deferred') && <button className="primary small" onClick={onRestart}>Restart into the new version</button>}
        </div>
        <label className="prov-role">
          <span><b>Check automatically at startup</b><br /><span className="muted small">Runs quietly in the background; never interrupts your work.</span></span>
          <input type="checkbox" checked={settings.update.autoCheck} onChange={(e) => update({ ...settings, update: { ...settings.update, autoCheck: e.target.checked } })} />
        </label>
        {settings.update.lastCheckedAt && <p className="muted small">Last checked {new Date(settings.update.lastCheckedAt).toLocaleString()}</p>}
      </div>
    </div>
  );
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

function DiagnosticsTab({ health, onExportDiagnostics, settings, update }: SettingsDeps) {
  const problems = healthProblems(health);
  return (
    <div className="settings-body">
      <div className="prov-card">
        <h3>Help us fix a problem</h3>
        <p className="muted small">Song Studio builds a small package and shows you exactly what is in it before you send it. It never includes your API keys, your song, your images, your video, your lyrics, your prompts, your project title, or your folder paths unless you explicitly tick a box.</p>
        <button className="primary small" onClick={onExportDiagnostics}>Export diagnostics…</button>
      </div>

      <div className="prov-card">
        <h3>Runtime health</h3>
        {problems.length === 0 && health && <p className="chip small ok">Everything Song Studio needs is working.</p>}
        {problems.map((p) => <div key={p} className="dir-conflict blocking"><b>{p}</b></div>)}
        {health && (
          <div className="muted small">
            <p>Video engine: {health.ffmpeg.found ? `found (${health.ffmpeg.source})` : 'MISSING'}</p>
            <p>Settings folder: {health.appDataOk ? 'writable' : 'NOT writable'}</p>
            <p>Secure key storage: {health.secureStore ? 'available' : 'unavailable'}</p>
            <p>Build: {health.installedBuild ? 'installed' : 'development'} · {health.targetTriple}</p>
          </div>
        )}
      </div>

      <div className="prov-card">
        <h3>Internal tools</h3>
        <label className="prov-role">
          <span><b>Developer mode</b><br /><span className="muted small">Shows internal validation tools and raw provider details. Not needed for normal testing.</span></span>
          <input type="checkbox" checked={settings.ui.developerMode} onChange={(e) => update({ ...settings, ui: { ...settings.ui, developerMode: e.target.checked } })} />
        </label>
      </div>
    </div>
  );
}

// ── About ───────────────────────────────────────────────────────────────────

function AboutTab({ appVersion, settings, update }: SettingsDeps) {
  return (
    <div className="settings-body">
      <div className="prov-card">
        <h3>Song Studio <span className="chip small">Alpha</span></h3>
        <p className="muted">Version {appVersion}</p>
        <p className="muted small">The artist directs. AI generates the moving scenes. Song Studio remembers, coordinates, repairs, and assembles the work.</p>
      </div>

      <div className="prov-card">
        <h3>Introduction</h3>
        <p className="muted small">The welcome introduction is shown once. You can bring it back.</p>
        <button className="ghost small" onClick={() => update(resetOnboarding(settings))}>Show introduction again</button>
      </div>

      <div className="prov-card">
        <h3>Known alpha limitations</h3>
        <ul className="dir-list muted small">
          <li>Windows x64 only. The installer is unsigned, so SmartScreen warns on first run.</li>
          <li>You bring your own API key; provider costs are yours. Video is far more expensive than images.</li>
          <li>Grok cannot repair an existing video — xAI does not document source-video editing, so repairs route to Google or to a manual package.</li>
          <li>Grok clips are capped at 15s and Veo at 8s. Song Studio blocks a longer scene and offers to split it rather than shortening your direction.</li>
          <li>No provider offers true audio-driven lip-sync yet; the manual package is the most faithful route.</li>
          <li>The portable ZIP does not auto-update.</li>
        </ul>
      </div>
    </div>
  );
}
