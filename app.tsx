import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck, Upload, Trash2, Zap, FileText,
  CheckCircle2, RefreshCw, AlertCircle, Download, XCircle,
  LogOut, User, Lock, Mail, Eye, EyeOff, Sparkles,
  ArrowUpCircle, Crown, Star, X,
} from 'lucide-react';
import { readFileMetadata, writeMP3Metadata } from './src/utils/metadata';
import {
  DEFAULT_RELEASE_ARTIST,
  DEFAULT_RELEASE_PRODUCER,
  DEFAULT_RELEASE_COPYRIGHT,
  RELEASE_DEFAULTS_STORAGE_KEY,
  cleanMetadataField,
  getSavedReleaseDefaults,
  getInitialReleaseMetadata,
  resolveReleaseMetadata,
  type ReleaseMetadata,
  type SavedReleaseDefaults,
} from './src/utils/releaseDefaults';
import ReleaseReadiness from './src/components/ReleaseReadiness';
import { fetchEnabledFeatures, type FeatureName } from './src/utils/featureFlags';

// When the frontend and API are served from the same origin (the default
// single-service Render/Docker deployment), an empty base URL means requests
// are made relative to the current origin. Only set VITE_API_URL when the API
// is hosted on a different origin than the frontend.
const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '');
const PLATFORMS = ['General', 'YouTube', 'Spotify', 'Apple Music', 'TikTok'] as const;
type Platform = typeof PLATFORMS[number];
type ItemStatus = 'pending' | 'analyzing' | 'processing' | 'done' | 'error';
type RiskLevel = 'High' | 'Low';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AuthUser {
  id: number;
  email: string;
  plan: 'free' | 'creator' | 'studio' | 'enterprise';
  emailVerified?: boolean;
}

interface UsageState {
  thisMonth: number;
  limit: number | null; // null = unlimited
}

interface MarkerHit { ruleId: string; category: string; severity: 'critical' | 'high' | 'medium'; matchedTag: string; matchedValue: string; }
interface ResidualTag { tag: string; markerCategory: string; severity: string; }
interface QualityFinding { code: string; field?: string; message: string; }
interface QualityVerification { passed: boolean; failures: QualityFinding[]; warnings: QualityFinding[]; expected?: Record<string, string>; }
interface ForensicReport {
  removedCount: number; removedTags: string[]; timestamp: string; exportTimestamp?: string;
  status?: 'clean' | 'clean_with_notes' | 'review_required'; summary?: string;
  wipeVerificationPassed?: boolean; finalVerificationPassed?: boolean;
  detectedMarkersBefore?: MarkerHit[]; detectedMarkersFinal?: MarkerHit[];
  suspiciousResidual?: ResidualTag[]; unexpectedDescriptive?: string[];
  qualityVerification?: QualityVerification; verificationFindings?: QualityFinding[];
  allowedInjectedTags?: string[]; rewrittenTags?: string[];
}

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  seo: ReleaseMetadata;
  downloadUrl: string | null;
  downloadName: string | null;
  report: ForensicReport | null;
  error: string | null;
  analysis: { format: string; title: string; artist: string; producer?: string; copyright?: string; genre: string; lyrics?: string; provenanceRisk: RiskLevel; detectedMarkers: string[]; parseError?: string | null } | null;
  logs: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan display helpers
// ─────────────────────────────────────────────────────────────────────────────
const PLAN_META: Record<string, { label: string; color: string; bg: string }> = {
  free:       { label: 'Free',       color: 'text-slate-300',  bg: 'bg-slate-700' },
  creator:    { label: 'Creator',    color: 'text-cyan-300',   bg: 'bg-cyan-900/60' },
  studio:     { label: 'Studio',     color: 'text-violet-300', bg: 'bg-violet-900/60' },
  enterprise: { label: 'Enterprise', color: 'text-amber-300',  bg: 'bg-amber-900/60' },
};

function PlanBadge({ plan }: { plan: string }) {
  const meta = PLAN_META[plan] ?? PLAN_META.free;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

const keepUserOrApplyParsed = (current: string, parsed: string | undefined | null, defaultValue = '') => {
  const parsedValue = cleanMetadataField(parsed);
  if (!parsedValue) return current;
  const currentValue = cleanMetadataField(current);
  if (!currentValue || (defaultValue && currentValue === defaultValue)) return parsedValue;
  return current;
};

// ─────────────────────────────────────────────────────────────────────────────
// Usage meter (shown in sidebar header for free users)
// ─────────────────────────────────────────────────────────────────────────────
function UsageMeter({ usage, onUpgrade }: { usage: UsageState; onUpgrade: () => void }) {
  if (usage.limit === null) return null; // paid user – no meter
  const pct  = Math.min((usage.thisMonth / usage.limit) * 100, 100);
  const full  = usage.thisMonth >= usage.limit;
  return (
    <div className={`mx-3 mb-3 p-3 rounded-xl border ${full ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/60 bg-slate-900/40'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${full ? 'text-amber-400' : 'text-slate-500'}`}>
          Monthly usage
        </span>
        <span className={`text-[10px] font-mono ${full ? 'text-amber-400' : 'text-slate-400'}`}>
          {usage.thisMonth}/{usage.limit}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${full ? 'bg-amber-500' : pct >= 66 ? 'bg-yellow-500' : 'bg-cyan-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {full && (
        <button
          onClick={onUpgrade}
          className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold rounded-lg transition-colors"
        >
          <ArrowUpCircle size={12} /> Upgrade to unlock
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade modal – shown when a 402 is received or user clicks upgrade
// ─────────────────────────────────────────────────────────────────────────────
function UpgradeModal({
  onClose,
  onCheckout,
  loading,
}: {
  onClose: () => void;
  onCheckout: (plan: 'creator' | 'studio') => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500" />

        <div className="p-6">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Crown className="text-white w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-slate-100">Upgrade your plan</h2>
              <p className="text-xs text-slate-500">You've reached the free tier limit (3 files/month)</p>
            </div>
          </div>

          {/* Plan cards */}
          <div className="space-y-3 mb-6">
            {/* Creator */}
            <div className="relative border-2 border-cyan-500/60 bg-cyan-500/5 rounded-xl p-4">
              <div className="absolute -top-2.5 left-4">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-cyan-600 text-white px-2 py-0.5 rounded-md">
                  Most popular
                </span>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-cyan-300 flex items-center gap-2">
                    <Star size={14} className="fill-cyan-400 text-cyan-400" /> Creator
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> Unlimited file processing</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> Batch processing up to 20 files</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> All platform presets</li>
                  </ul>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="text-xl font-bold text-slate-100">$9.99</p>
                  <p className="text-[10px] text-slate-500">/ month</p>
                </div>
              </div>
              <button
                onClick={() => onCheckout('creator')}
                disabled={loading}
                className="mt-3 w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                Upgrade to Creator
              </button>
            </div>

            {/* Studio */}
            <div className="border border-slate-700 bg-slate-800/40 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-violet-300 flex items-center gap-2">
                    <Zap size={14} className="fill-violet-400 text-violet-400" /> Studio
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> Everything in Creator</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> Deep Audio Cleanse</li>
                    <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> API access</li>
                  </ul>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="text-xl font-bold text-slate-100">$29.99</p>
                  <p className="text-[10px] text-slate-500">/ month</p>
                </div>
              </div>
              <button
                onClick={() => onCheckout('studio')}
                disabled={loading}
                className="mt-3 w-full py-2.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                Upgrade to Studio
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-slate-600">
            Secure checkout via Stripe · Cancel anytime
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout success/cancelled banner
// ─────────────────────────────────────────────────────────────────────────────
function CheckoutBanner({
  type,
  onDismiss,
}: {
  type: 'success' | 'cancelled' | 'mock';
  onDismiss: () => void;
}) {
  if (type === 'mock') {
    return (
      <div className="flex items-center gap-3 px-5 py-3 bg-cyan-500/10 border-b border-cyan-500/20 text-sm text-cyan-300">
        <Sparkles size={15} className="shrink-0" />
        Local mock checkout completed (Stripe not configured). Production billing is unchanged.
        <button onClick={onDismiss} className="ml-auto text-cyan-700 hover:text-cyan-300"><X size={14} /></button>
      </div>
    );
  }
  if (type === 'cancelled') {
    return (
      <div className="flex items-center gap-3 px-5 py-3 bg-slate-800 border-b border-slate-700 text-sm text-slate-400">
        <AlertCircle size={15} className="text-slate-500 shrink-0" />
        Checkout cancelled – your plan hasn't changed.
        <button onClick={onDismiss} className="ml-auto text-slate-600 hover:text-slate-300"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-emerald-500/10 border-b border-emerald-500/20 text-sm text-emerald-400">
      <CheckCircle2 size={15} className="shrink-0" />
      <span>
        <strong>Upgrade successful!</strong> Your plan has been updated. Welcome to the next level.
      </span>
      <button onClick={onDismiss} className="ml-auto text-emerald-700 hover:text-emerald-400"><X size={14} /></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Token storage helpers
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'spectra_token';
const USER_KEY  = 'spectra_user';

function saveSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function loadSession(): { token: string; user: AuthUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw   = localStorage.getItem(USER_KEY);
    if (!token || !raw) return null;
    return { token, user: JSON.parse(raw) };
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Download helper
// ─────────────────────────────────────────────────────────────────────────────
const triggerDownload = (url: string, fileName: string) => {
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); }, 1000);
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth Screen (unchanged from previous version)
// ─────────────────────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, resetToken, onResetConsumed }: { onAuth: (token: string, user: AuthUser) => void; resetToken?: string | null; onResetConsumed?: () => void }) {
  const [mode, setMode]       = useState<'login' | 'signup'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [info, setInfo]       = useState<string | null>(null);
  const [fadeIn, setFadeIn]   = useState(false);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => { requestAnimationFrame(() => setFadeIn(true)); }, []);
  useEffect(() => { if (resetToken) { setMode('login'); setInfo('Enter a new password to complete your reset.'); } }, [resetToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const endpoint = mode === 'login' ? '/api/login' : '/api/register';
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (mode === 'signup') {
          console.error('Register request failed response body:', data);
        }
        setError(data.error || 'Something went wrong.');
        return;
      }
      onAuth(data.token, data.user);
      if (mode === 'signup' && data.verificationNotice) setInfo(data.verificationNotice);
    } catch {
      setError('Cannot reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-950 flex items-center justify-center p-4"
      style={{ transition: 'opacity 0.4s ease', opacity: fadeIn ? 1 : 0 }}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[200px] bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center mb-10">
          <img
            src="/assets/spectracleanse-login-emblem.svg"
            alt="SpectraCleanseAI emblem"
            className="mb-4 w-24 sm:w-28 md:w-32 lg:w-36 h-auto object-contain rounded-2xl shadow-[0_0_30px_rgba(34,211,238,0.18)]"
          />
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            SpectraCleanse <span className="text-cyan-400">AI</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {mode === 'login' ? 'Welcome back' : 'Create your free account'}
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <div className="flex bg-slate-800/60 rounded-xl p-1 mb-8 gap-1">
            {(['login', 'signup'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  mode === m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-slate-200'
                }`}>
                {m === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {resetToken && (
              <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-200 text-sm space-y-2">
                <p className="text-xs">Reset password token detected.</p>
                <input
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password (min 8 characters)"
                  className="w-full bg-slate-950/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-all"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setError(null);
                    setInfo(null);
                    const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: resetToken, newPassword }),
                    });
                    const data = await res.json();
                    if (!res.ok) return setError(data.error || 'Password reset failed.');
                    setInfo(data.message || 'Password reset successful. You can now sign in.');
                    setNewPassword('');
                    onResetConsumed?.();
                  }}
                  className="w-full py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg"
                >
                  Set New Password
                </button>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                <input type="email" required autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                  className="w-full bg-slate-950/80 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Password {mode === 'signup' && <span className="text-slate-600 normal-case font-normal">(min 8 characters)</span>}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                <input type={showPw ? 'text' : 'password'} required minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full bg-slate-950/80 border border-slate-700 rounded-xl pl-10 pr-11 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all" />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
              </div>
            )}
            {info && <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-300 text-sm">{info}</div>}
            {mode === 'login' && (
              <button
                type="button"
                className="text-xs text-cyan-500 hover:text-cyan-400"
                onClick={async () => {
                  setError(null);
                  const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email.trim() }),
                  });
                  const data = await res.json();
                  if (!res.ok) return setError(data.error || 'Unable to start password reset.');
                  setInfo(data.message || 'If an account exists, a reset link was sent.');
                }}
              >
                Forgot password?
              </button>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10 mt-2">
              {loading
                ? <><RefreshCw className="animate-spin w-4 h-4" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
                : mode === 'login' ? <><User size={16} /> Sign In</> : <><Sparkles size={16} /> Create Free Account</>}
            </button>
          </form>

          <p className="text-center text-slate-600 text-xs mt-6">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(null); }}
              className="text-cyan-500 hover:text-cyan-400 font-semibold transition-colors">
              {mode === 'login' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { plan: 'Free',    detail: '3 jobs / mo',       color: 'text-slate-400' },
            { plan: 'Creator', detail: 'Unlimited · $9.99', color: 'text-cyan-400' },
            { plan: 'Studio',  detail: 'API access · $29.99', color: 'text-violet-400' },
          ].map(t => (
            <div key={t.plan} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3">
              <p className={`text-xs font-bold ${t.color}`}>{t.plan}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">{t.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing status overlay — shown in main panel while analyzing/processing
// ─────────────────────────────────────────────────────────────────────────────
const PROCESSING_STEPS: Record<ItemStatus, { label: string; sub: string } | null> = {
  analyzing: { label: 'Analyzing file…', sub: 'Reading metadata and scanning for provenance markers' },
  processing: { label: 'Cleansing file…', sub: 'Wiping AI markers and injecting SEO metadata' },
  pending:    null,
  done:       null,
  error:      null,
};

function ProcessingStatusBanner({ status, fileName }: { status: ItemStatus; fileName: string }) {
  const step = PROCESSING_STEPS[status];
  if (!step) return null;

  return (
    <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-6 flex flex-col items-center justify-center gap-5 text-center">
      {/* Animated ring */}
      <div className="relative w-16 h-16">
        <svg
          className="animate-spin w-16 h-16 text-cyan-500"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="32" cy="32" r="28"
            stroke="currentColor"
            strokeWidth="4"
            strokeOpacity="0.15"
          />
          <path
            d="M60 32a28 28 0 0 0-28-28"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <ShieldCheck className="text-cyan-400 w-6 h-6" />
        </div>
      </div>

      {/* Label */}
      <div>
        <p className="text-base font-bold text-slate-100">{step.label}</p>
        <p className="text-sm text-slate-400 mt-1 max-w-xs">{step.sub}</p>
      </div>

      {/* File name pill */}
      <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5 max-w-full">
        <FileText size={12} className="text-slate-500 shrink-0" />
        <span className="text-[11px] text-slate-400 font-mono truncate max-w-[260px]">{fileName}</span>
      </div>

      {/* Animated step dots */}
      <div className="flex items-center gap-2">
        {(['analyzing', 'processing', 'done'] as const).map((s, i) => {
          const isActive = s === status;
          const isDone   = (s === 'analyzing' && status === 'processing') || s === 'done';
          return (
            <React.Fragment key={s}>
              <div className={`
                w-2 h-2 rounded-full transition-all duration-300
                ${isActive ? 'bg-cyan-400 scale-125 shadow-[0_0_6px_rgba(34,211,238,0.6)]' : ''}
                ${isDone   ? 'bg-emerald-500' : ''}
                ${!isActive && !isDone ? 'bg-slate-700' : ''}
              `} />
              {i < 2 && (
                <div className={`h-px w-6 transition-all duration-300 ${isDone ? 'bg-emerald-500/60' : 'bg-slate-700'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-600">This may take a few seconds depending on file size</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [authToken,    setAuthToken]    = useState<string | null>(null);
  const [currentUser,  setCurrentUser]  = useState<AuthUser | null>(null);
  const [usage,        setUsage]        = useState<UsageState>({ thisMonth: 0, limit: 3 });
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<'success' | 'cancelled' | 'mock' | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [queue,      setQueue]      = useState<QueueItem[]>([]);
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [platform,   setPlatform]   = useState<Platform>('General');
  const [isBatching, setIsBatching] = useState(false);
  const [cancelRef]  = useState({ cancelled: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<FeatureName[]>([]);
  const [activeView, setActiveView] = useState<'cleanse' | 'readiness'>('cleanse');
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ id: number; filename: string; platform: string; forensic_status: string | null; markers_removed: number | null; created_at: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const activeItem = queue.find(f => f.id === activeId) ?? null;
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verifyToken');
  const resetToken = params.get('resetToken');

  // ── Session restore + Stripe return handling ────────────────────────────────
  useEffect(() => {
    if (verifyToken) {
      fetch(`${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
        .then(async (r) => ({ ok: r.ok, data: await r.json() }))
        .then(({ ok, data }) => setAuthNotice(ok ? 'Email verified successfully.' : (data.error || 'Email verification failed.')))
        .finally(() => window.history.replaceState({}, '', window.location.pathname));
    }
  }, []);

  // Discover which overhaul features are live in this environment (off by default).
  useEffect(() => {
    if (!authToken) { setEnabledFeatures([]); setActiveView('cleanse'); return; }
    fetchEnabledFeatures(API_BASE_URL).then(setEnabledFeatures).catch(() => {});
  }, [authToken]);

  useEffect(() => {
    const session = loadSession();
    if (!session) return;

    setAuthToken(session.token);
    setCurrentUser(session.user);

    // Check if we're returning from Stripe Checkout
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const mockCheckout = params.get('mockCheckout');

    if (checkout === 'success') {
      setCheckoutBanner(mockCheckout === '1' ? 'mock' : 'success');
      // Re-fetch /api/me so the plan badge updates immediately after upgrade
      fetch(`${API_BASE_URL}/api/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
        .then(r => r.json())
        .then(data => {
          if (data.user) {
            const updatedUser = { ...session.user, plan: data.user.plan } as AuthUser;
            saveSession(session.token, updatedUser);
            setCurrentUser(updatedUser);
            setUsage({
              thisMonth: data.usage?.thisMonth ?? 0,
              limit:     data.usage?.limit ?? null,
            });
          }
        })
        .catch(() => {});
      // Clean up the URL so refreshing doesn't re-trigger this
      window.history.replaceState({}, '', window.location.pathname);
    } else if (checkout === 'cancelled') {
      setCheckoutBanner('cancelled');
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      // Normal session restore – fetch fresh usage count
      fetchUsage(session.token);
    }

    // First-run onboarding (one-shot, persisted in localStorage)
    if (!localStorage.getItem('onboarding_seen')) {
      const t = window.setTimeout(() => setOnboardingStep(1), 500);
      return () => window.clearTimeout(t);
    }
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      queue.forEach(item => { if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl); });
    };
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function fetchUsage(token: string) {
    try {
      const res  = await fetch(`${API_BASE_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.usage) {
        setUsage({
          thisMonth: data.usage.thisMonth,
          limit:     data.usage.limit,
        });
      }
      if (data.user) {
        setCurrentUser(prev => prev ? { ...prev, plan: data.user.plan } : prev);
      }
    } catch {}
  }

  const handleAuth = (token: string, user: AuthUser) => {
    saveSession(token, user);
    setAuthToken(token);
    setCurrentUser(user);
    fetchUsage(token);
  };

  const handleLogout = () => {
    clearSession();
    setAuthToken(null);
    setCurrentUser(null);
    setQueue([]);
    setActiveId(null);
    setUsage({ thisMonth: 0, limit: 3 });
  };

  // Opens Stripe Checkout for the given plan
  const handleCheckout = async (plan: 'creator' | 'studio') => {
    if (!authToken) return;
    setUpgradeLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/api/create-checkout-session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      if (data.url) window.location.href = data.url; // redirect to Stripe
    } catch (err: any) {
      alert(`Checkout error: ${err.message}`);
    } finally {
      setUpgradeLoading(false);
    }
  };

  // ── Render guard ─────────────────────────────────────────────────────────────
  if (!authToken || !currentUser) {
    return <AuthScreen onAuth={handleAuth} resetToken={resetToken} onResetConsumed={() => window.history.replaceState({}, '', window.location.pathname)} />;
  }

  // ── Queue helpers ─────────────────────────────────────────────────────────────
  const updateItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const addFiles = (files: FileList | File[]) => {
    const validExt = /\.(mp3|m4a|mp4)$/i;
    const savedDefaults = getSavedReleaseDefaults();
    const newItems: QueueItem[] = Array.from(files)
      .filter(f => validExt.test(f.name))
      .slice(0, 20 - queue.length)
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        status: 'pending' as ItemStatus,
        seo: getInitialReleaseMetadata(file, savedDefaults),
        downloadUrl: null, downloadName: null, report: null, error: null, analysis: null, logs: [],
      }));
    if (newItems.length === 0) return;
    setQueue(prev => [...prev, ...newItems].slice(0, 20));
    setActiveId(prev => prev ?? newItems[0].id);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragActive) setIsDragActive(true);
  };
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) addFiles(dropped);
  };

  const loadHistory = async () => {
    if (!authToken) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobs`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.jobs || []);
      }
    } catch {} finally { setHistoryLoading(false); }
  };

  const removeItem = (id: string) => {
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
      return prev.filter(i => i.id !== id);
    });
    setActiveId(prev => prev === id ? null : prev);
  };

  const addLog = (id: string, message: string) => {
    const stamp = new Date().toLocaleTimeString();
    updateItem(id, { logs: [...(queue.find(i => i.id === id)?.logs || []), `[${stamp}] ${message}`] });
  };

  const saveReleaseDefaults = (metadata: ReleaseMetadata) => {
    const defaultsToSave: SavedReleaseDefaults = {
      artist: cleanMetadataField(metadata.artist),
      albumArtist: cleanMetadataField(metadata.albumArtist),
      producer: cleanMetadataField(metadata.producer),
      copyright: cleanMetadataField(metadata.copyright),
      genre: cleanMetadataField(metadata.genre),
      description: cleanMetadataField(metadata.description),
      comment: cleanMetadataField(metadata.comment),
      tags: cleanMetadataField(metadata.tags),
    };
    localStorage.setItem(RELEASE_DEFAULTS_STORAGE_KEY, JSON.stringify(defaultsToSave));
  };

  const withOperationTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  };

  const analyzeFile = async (item: QueueItem): Promise<Partial<QueueItem>> => {
    try {
      const parsed = await readFileMetadata(item.file);
      return {
        seo: {
          ...item.seo,
          title: keepUserOrApplyParsed(item.seo.title, parsed.title),
          artist: keepUserOrApplyParsed(item.seo.artist, parsed.artist, DEFAULT_RELEASE_ARTIST),
          producer: keepUserOrApplyParsed(item.seo.producer, parsed.producer, DEFAULT_RELEASE_PRODUCER),
          copyright: keepUserOrApplyParsed(item.seo.copyright, parsed.copyright, DEFAULT_RELEASE_COPYRIGHT),
          genre: keepUserOrApplyParsed(item.seo.genre, parsed.genre),
          tags: cleanMetadataField(item.seo.tags) ? item.seo.tags : (parsed.genre || ''),
          lyrics: keepUserOrApplyParsed(item.seo.lyrics, parsed.lyrics),
        },
        analysis: { format: parsed.format, title: parsed.title, artist: parsed.artist, producer: parsed.producer, copyright: parsed.copyright, genre: parsed.genre, lyrics: parsed.lyrics, provenanceRisk: parsed.provenanceRisk, detectedMarkers: parsed.detectedMarkers, parseError: parsed.parseError || null },
      };
    } catch { return {}; }
  };

  const runBatch = async () => {
    const snapshot = queue.filter(i => i.status !== 'done');
    if (snapshot.length === 0) return;
    const getExt = (name: string) => {
      const i = name.lastIndexOf('.');
      return i >= 0 ? name.slice(i).toLowerCase() : '';
    };
    const unsupportedItems = snapshot.filter(item => {
      const ext = getExt(item.file.name);
      return ext !== '.mp4' && ext !== '.m4a';
    });
    if (unsupportedItems.length > 0) {
      unsupportedItems.forEach((item) => {
        const extension = getExt(item.file.name) || '(none)';
        console.warn("[client] blocked unsupported server cleanse format", { fileName: item.file.name, extension });
        updateItem(item.id, {
          status: 'error',
          error: extension === '.mp3'
            ? 'MP3 files use Quick Cleanse (Browser). Full Server Cleanse currently supports MP4/M4A only.'
            : (extension === '.wav' || extension === '.flac')
              ? 'WAV/FLAC server cleanse is currently not enabled. Convert to M4A/MP4 for Full Server Cleanse.'
              : 'Full Server Cleanse currently supports MP4/M4A only.',
        });
      });
      return;
    }

    setIsBatching(true);
    cancelRef.cancelled = false;

    for (const item of snapshot) {
      if (cancelRef.cancelled) break;

      updateItem(item.id, { status: 'analyzing', error: null });
      addLog(item.id, 'Reading local metadata for analysis');
      const analyzed = await analyzeFile(item);
      if (cancelRef.cancelled) break;

      updateItem(item.id, { ...analyzed, status: 'processing' });
      addLog(item.id, 'Starting server cleanse via /api/process');

      // Grab the latest editable release metadata from state (user may have edited it)
      const currentSeo = await new Promise<QueueItem['seo']>(resolve => {
        setQueue(prev => {
          const current = prev.find(i => i.id === item.id);
          resolve(current?.seo ?? item.seo);
          return prev;
        });
      });
      const metadataPayload = resolveReleaseMetadata(currentSeo);

      try {
        const extension = getExt(item.file.name);
        if (extension !== '.mp4' && extension !== '.m4a') {
          console.warn("[client] blocked unsupported server cleanse format", { fileName: item.file.name, extension: extension || '(none)' });
          updateItem(item.id, {
            status: 'error',
            error: extension === '.mp3'
              ? 'MP3 files use Quick Cleanse (Browser). Full Server Cleanse currently supports MP4/M4A only.'
              : (extension === '.wav' || extension === '.flac')
                ? 'WAV/FLAC server cleanse is currently not enabled. Convert to M4A/MP4 for Full Server Cleanse.'
                : 'Full Server Cleanse currently supports MP4/M4A only.',
          });
          continue;
        }
        const formData = new FormData();
        formData.append('file',        item.file);
        formData.append('title',       metadataPayload.title);
        formData.append('artist',      metadataPayload.artist);
        formData.append('producer',    metadataPayload.producer);
        formData.append('copyright',   metadataPayload.copyright);
        formData.append('genre',       metadataPayload.genre);
        formData.append('description', metadataPayload.description);
        formData.append('tags',        metadataPayload.tags);
        formData.append('lyrics',      metadataPayload.lyrics);
        formData.append('platform',    platform);
        console.info('[process] metadata payload', {
          title: metadataPayload.title,
          artist: metadataPayload.artist,
          producer: metadataPayload.producer,
          copyright: metadataPayload.copyright,
          genre: metadataPayload.genre,
          hasDescription: Boolean(metadataPayload.description),
          hasTags: Boolean(metadataPayload.tags),
          hasLyrics: Boolean(metadataPayload.lyrics),
          platform,
        });

        const res = await fetch(`${API_BASE_URL}/api/process`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body:    formData,
        });

        // ── Token expired ──────────────────────────────────────────────────
        if (res.status === 401) { handleLogout(); return; }

        // ── Usage limit hit (402 Payment Required) ─────────────────────────
        if (res.status === 402) {
          const body = await res.json().catch(() => ({}));
          updateItem(item.id, {
            status: 'error',
            error:  body.detail || `You've used your 3 free cleanses this month. Upgrade to Creator for unlimited cleanses and batch processing — starting at $9.99/month.`,
          });
          setShowUpgrade(true);
          // Abort remaining items in this batch
          cancelRef.cancelled = true;
          break;
        }

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(errBody.detail || errBody.error || `Server error ${res.status}`);
        }

        const blob         = await res.blob();
        const downloadUrl  = URL.createObjectURL(blob);
        const downloadName = `cleansed_${item.file.name}`;

        const removedCount   = parseInt(res.headers.get('X-Forensic-Removed') || '0', 10);
        const removedTagsRaw = res.headers.get('X-Forensic-Tags') || '[]';
        let   removedTags: string[] = [];
        try { removedTags = JSON.parse(removedTagsRaw); } catch {}

        // Update local usage counter from response headers
        const usedNow     = parseInt(res.headers.get('X-Usage-This-Month') || '0', 10);
        const limitHeader = res.headers.get('X-Usage-Limit');
        const newLimit    = limitHeader === 'unlimited' ? null : parseInt(limitHeader || '3', 10);
        setUsage({ thisMonth: usedNow, limit: newLimit });

        const reportHeader = res.headers.get('X-Forensic-Report');
        let report: ForensicReport = { removedCount, removedTags, timestamp: new Date().toLocaleTimeString() };
        try { if (reportHeader) report = JSON.parse(reportHeader); } catch {}

        updateItem(item.id, {
          status: 'done',
          downloadUrl,
          downloadName,
          report,
        });

      } catch (err: any) {
        updateItem(item.id, { status: 'error', error: err.message });
      }
    }

    setIsBatching(false);
  };

  const cancelBatch = () => { cancelRef.cancelled = true; };

  const doneCount = queue.filter(i => i.status === 'done').length;
  const progress  = queue.length > 0 ? Math.round((doneCount / queue.length) * 100) : 0;
  const getExt = (name: string) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
  };
  const activeExt = activeItem ? getExt(activeItem.file.name) : '';
  const isMp3 = activeExt === '.mp3';
  const isServerSupportedFormat = activeExt === '.mp4' || activeExt === '.m4a';
  const quickDisabledReason = !activeItem ? 'Select a file first.' : !isMp3 ? 'Quick Cleanse supports MP3 files only.' : '';
  const seoDisabledReason = !activeItem ? 'Select a file to provide context first.' : '';
  const pendingItems = queue.filter(i => i.status !== 'done');
  const hasUnsupportedPending = pendingItems.some((item) => {
    const ext = getExt(item.file.name);
    return ext !== '.mp4' && ext !== '.m4a';
  });
  const serverDisabledReason = isBatching
    ? 'Server cleanse already running.'
    : queue.length === 0
      ? 'Add at least one file first.'
      : queue.every(i => i.status === 'done')
        ? 'All files are already completed.'
        : hasUnsupportedPending
          ? (activeExt === '.mp3'
            ? 'MP3 files use Quick Cleanse (Browser). Full Server Cleanse currently supports MP4/M4A only.'
            : (activeExt === '.wav' || activeExt === '.flac')
              ? 'WAV/FLAC server cleanse is currently not enabled. Convert to M4A/MP4 for Full Server Cleanse.'
              : 'Full Server Cleanse currently supports MP4/M4A only.')
          : !activeItem
            ? 'Select a file first.'
            : !isServerSupportedFormat
              ? 'Full Server Cleanse currently supports MP4/M4A only.'
              : '';
  const resultSource = activeItem?.downloadName?.startsWith('quick_cleansed_') ? 'Browser Quick Cleanse' : 'Full Server Cleanse';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-x-hidden">
      {authNotice && <div className="fixed top-2 left-1/2 -translate-x-1/2 z-30 text-xs bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-lg">{authNotice}</div>}
      {!currentUser.emailVerified && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-30 text-xs bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-lg">
          Email not verified.
          <button className="ml-2 underline" onClick={async () => {
            const res = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` } });
            const data = await res.json();
            setAuthNotice(data.message || 'If eligible, a verification email has been sent.');
          }}>Verify email</button>
        </div>
      )}

      {/* Upgrade modal */}
      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          onCheckout={handleCheckout}
          loading={upgradeLoading}
        />
      )}

      {/* First-run onboarding */}
      {onboardingStep !== null && (() => {
        const dismiss = () => {
          localStorage.setItem('onboarding_seen', '1');
          setOnboardingStep(null);
          // Focus the upload zone on close so the user can immediately upload.
          setTimeout(() => fileInputRef.current?.focus(), 100);
        };
        type OnboardingStep = { title: string; body: string; visual?: React.ReactNode; footnote?: string };
        const steps: OnboardingStep[] = [
          {
            title: 'Strip AI Fingerprints. Own Your Release.',
            body: 'AI music tools like Suno, Udio, and ElevenLabs embed metadata markers in every file they export — C2PA content credentials, synthetic content flags, and AI brand tags. These markers can get your tracks flagged on streaming platforms. SpectraCleanse removes them and injects real, platform-optimized metadata.',
            visual: (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-red-300 font-bold">Before</p>
                  <p className="text-2xl font-extrabold text-red-300 mt-1">14 markers</p>
                </div>
                <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">After</p>
                  <p className="text-2xl font-extrabold text-emerald-300 mt-1">0 markers</p>
                </div>
              </div>
            ),
          },
          {
            title: 'How It Works',
            body: 'Three steps, every time.',
            visual: (
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="text-center">
                  <Upload size={28} className="mx-auto text-cyan-400 mb-2" />
                  <p className="text-xs text-slate-300">Upload your MP3, MP4, or M4A</p>
                </div>
                <div className="text-center">
                  <Sparkles size={28} className="mx-auto text-violet-400 mb-2" />
                  <p className="text-xs text-slate-300">We strip AI markers and inject real metadata</p>
                </div>
                <div className="text-center">
                  <Download size={28} className="mx-auto text-emerald-400 mb-2" />
                  <p className="text-xs text-slate-300">Download your clean, attribution-ready file</p>
                </div>
              </div>
            ),
            footnote: 'Your audio is never stored. Files are processed in memory and immediately deleted.',
          },
          {
            title: "You're Ready",
            body: 'You have 3 free cleanses this month. No credit card required.',
          },
        ];
        const current = steps[onboardingStep - 1];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500" />
              <button onClick={dismiss} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"><X size={18} /></button>
              <div className="p-6">
                <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mb-2">Step {onboardingStep} of {steps.length}</p>
                <h2 className="text-xl font-extrabold text-slate-100 mb-2">{current.title}</h2>
                <p className="text-sm text-slate-400 leading-relaxed">{current.body}</p>
                {current.visual}
                {current.footnote && (
                  <p className="mt-4 text-[11px] text-slate-500 italic">{current.footnote}</p>
                )}

                <div className="mt-6 flex items-center justify-between gap-3">
                  <button
                    onClick={() => setOnboardingStep((s) => (s && s > 1 ? s - 1 : s))}
                    disabled={onboardingStep === 1}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-slate-100 disabled:opacity-30"
                  >Back</button>
                  {onboardingStep < steps.length ? (
                    <button
                      onClick={() => setOnboardingStep((s) => (s ? s + 1 : 1))}
                      className="px-4 py-2 text-sm font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg"
                    >Next →</button>
                  ) : (
                    <button
                      onClick={dismiss}
                      className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                    >Start Cleansing →</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* History modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl max-h-[80vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="font-bold text-slate-100 text-base flex items-center gap-2"><FileText size={16} className="text-cyan-400" /> Processing history</h2>
              <button onClick={() => setHistoryOpen(false)} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  <FileText size={28} className="mx-auto mb-2 opacity-30" />
                  <p>No files processed yet.</p>
                  <p className="text-xs mt-1 opacity-70">Upload your first file to start your history.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2 font-bold">File</th>
                      <th className="text-left px-4 py-2 font-bold">Date</th>
                      <th className="text-left px-4 py-2 font-bold">Status</th>
                      <th className="text-right px-4 py-2 font-bold">Markers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {history.map(row => {
                      const status = row.forensic_status || '—';
                      const pill = status === 'clean'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : status === 'clean_with_notes'
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : status === 'review_required'
                            ? 'bg-red-500/15 text-red-300 border-red-500/30'
                            : 'bg-slate-700/30 text-slate-400 border-slate-700/40';
                      return (
                        <tr key={row.id} className="hover:bg-slate-800/30">
                          <td className="px-4 py-2 truncate max-w-[20rem]" title={row.filename}>{row.filename}</td>
                          <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                          <td className="px-4 py-2"><span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded border ${pill}`}>{status}</span></td>
                          <td className="px-4 py-2 text-right font-mono text-slate-300">{row.markers_removed ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between items-center">
              <span>Showing the most recent 50 cleanses.</span>
              <button onClick={loadHistory} className="text-cyan-400 hover:text-cyan-300 underline">Refresh</button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout return banner */}
      {checkoutBanner && (
        <CheckoutBanner type={checkoutBanner} onDismiss={() => setCheckoutBanner(null)} />
      )}

      {/* Navbar */}
      <nav className="min-h-[4.5rem] border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-6 py-3 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <ShieldCheck className="text-white w-5 h-5" />
          </div>
          <span className="font-bold tracking-tight">
            SpectraCleanse <span className="text-cyan-400">AI</span>
          </span>
        </div>

        <div className="w-full lg:w-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {enabledFeatures.includes('release_readiness') && (
            <div className="flex bg-slate-800/60 rounded-lg p-0.5 gap-0.5">
              <button onClick={() => setActiveView('cleanse')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeView === 'cleanse' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Cleanse</button>
              <button onClick={() => setActiveView('readiness')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeView === 'readiness' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Readiness</button>
            </div>
          )}
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value as Platform)}
            className="bg-slate-800/90 border border-slate-700 text-xs px-3 py-2.5 rounded-lg outline-none focus:border-cyan-500 min-w-[140px]"
          >
            {PLATFORMS.map(p => <option key={p} value={p}>{p} Preset</option>)}
          </select>

          {/* User identity strip */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <span className="hidden sm:block text-xs text-slate-400 max-w-[140px] truncate">
              {currentUser.email}
            </span>

            <PlanBadge plan={currentUser.plan} />

            {/* Upgrade button for free users (in navbar) */}
            {currentUser.plan === 'free' && (
              <button
                onClick={() => setShowUpgrade(true)}
                className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 px-2.5 py-1.5 rounded-lg transition-all"
              >
                <ArrowUpCircle size={12} /> Upgrade
              </button>
            )}

            <button
              onClick={() => { setHistoryOpen(true); loadHistory(); }}
              title="Processing history"
              className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <FileText size={15} />
            </button>
            <button
              onClick={() => { localStorage.removeItem('onboarding_seen'); setOnboardingStep(1); }}
              title="Show intro again"
              className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Sparkles size={15} />
            </button>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>

          {isBatching ? (
            <button
              onClick={cancelBatch}
              className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
            >
              <XCircle className="w-4 h-4" /> Cancel
            </button>
          ) : (
            <button
              onClick={runBatch}
              disabled={queue.length === 0 || queue.every(i => i.status === 'done')}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
            >
              <Zap className="w-4 h-4" />
              Run Batch ({queue.filter(i => i.status !== 'done').length} pending)
            </button>
          )}
        </div>
      </nav>

      {/* Progress bar */}
      {queue.length > 0 && (
        <div className="h-1 bg-slate-800 w-full">
          <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}

      {activeView === 'readiness' ? (
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-950">
          <ReleaseReadiness
            apiBaseUrl={API_BASE_URL}
            authToken={authToken}
            initialMetadata={activeItem ? {
              title: activeItem.seo.title, artist: activeItem.seo.artist, albumArtist: activeItem.seo.albumArtist,
              producer: activeItem.seo.producer, copyright: activeItem.seo.copyright, genre: activeItem.seo.genre, tags: activeItem.seo.tags,
            } : undefined}
            initialAnalysis={activeItem?.analysis ? {
              format: activeItem.analysis.format, detectedMarkers: activeItem.analysis.detectedMarkers,
              provenanceRisk: activeItem.analysis.provenanceRisk, parseError: activeItem.analysis.parseError,
            } : undefined}
            onAuthExpired={handleLogout}
          />
        </main>
      ) : (
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)] overflow-hidden">

        {/* Sidebar */}
        <aside className="xl:w-auto border-b xl:border-b-0 xl:border-r border-slate-800 bg-slate-900/30 flex flex-col max-h-[42vh] xl:max-h-none">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Queue ({queue.length}/20)
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={queue.length >= 20}
              className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
              title="Add files"
            >
              <Upload size={14} />
            </button>
            <input
              type="file" multiple ref={fileInputRef} className="hidden"
              accept=".mp3,.m4a,.mp4,audio/mpeg,audio/mp4,audio/x-m4a,video/mp4"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>

          {/* Usage meter – sits just below the queue header for free users */}
          <UsageMeter usage={usage} onUpgrade={() => setShowUpgrade(true)} />

          <div className="flex-1 overflow-y-auto min-h-0">
            {queue.length === 0 ? (
              <div
                className="p-8 text-center text-slate-600 text-sm cursor-pointer hover:text-slate-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto mb-2 opacity-30" size={32} />
                <p>Click to add files</p>
                <p className="text-[11px] mt-2 text-slate-700">
                  Tip: add multiple files, then run one batch.
                </p>
              </div>
            ) : (
              queue.map(item => (
                <div
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`p-3 border-b border-slate-800/50 cursor-pointer flex items-center gap-2 transition-colors group ${
                    activeId === item.id
                      ? 'bg-cyan-500/10 border-l-2 border-l-cyan-500'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="shrink-0 w-5">
                    {item.status === 'done'
                      ? <CheckCircle2 className="text-emerald-500" size={16} />
                      : item.status === 'processing' || item.status === 'analyzing'
                        ? <RefreshCw className="animate-spin text-cyan-400" size={16} />
                        : item.status === 'error'
                          ? <AlertCircle className="text-red-400" size={16} />
                          : <FileText className="text-slate-500" size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.file.name}</p>
                    <p className={`text-[10px] uppercase mt-0.5 font-medium ${
                      item.status === 'processing' || item.status === 'analyzing'
                        ? 'text-cyan-400'
                        : item.status === 'done'
                          ? 'text-emerald-400'
                          : item.status === 'error'
                            ? 'text-red-400'
                            : 'text-slate-500'
                    }`}>
                      {item.status === 'analyzing' ? 'analyzing…' :
                       item.status === 'processing' ? 'processing…' :
                       item.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.status === 'done' && item.downloadUrl && (
                      <button
                        onClick={e => { e.stopPropagation(); triggerDownload(item.downloadUrl!, item.downloadName!); }}
                        className="p-1 text-cyan-400 hover:bg-cyan-500/10 rounded" title="Download"
                      >
                        <Download size={12} />
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeItem(item.id); }}
                      className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded" title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main panel */}
        <main
          className={`flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-950 relative transition-colors ${
            isDragActive ? 'ring-2 ring-cyan-400/70 ring-inset bg-cyan-500/5' : ''
          }`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {!activeItem ? (
            <div
              className="h-full flex flex-col items-center justify-center text-slate-600 cursor-pointer hover:text-slate-500 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={48} className="mb-3 opacity-30" />
              <p className="text-lg">Drag files here, or click to browse</p>
              <p className="text-sm mt-1 opacity-60">MP3 · M4A · MP4 · up to 20 files</p>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <FileText className="text-cyan-400" size={20} />
                <h1 className="font-bold text-lg truncate">{activeItem.file.name}</h1>
                <span className="ml-auto text-xs text-slate-500">
                  {(activeItem.file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>

              {/* ── Processing status banner ── */}
              {(activeItem.status === 'analyzing' || activeItem.status === 'processing') && (
                <ProcessingStatusBanner status={activeItem.status} fileName={activeItem.file.name} />
              )}

              {/* Error – with special upgrade CTA for limit errors */}
              {activeItem.error && (
                <div className={`p-4 rounded-xl border text-sm ${
                  activeItem.error.includes('limit') || activeItem.error.includes('Upgrade')
                    ? 'bg-amber-500/8 border-amber-500/30 text-amber-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                      {activeItem.error}
                      {(activeItem.error.includes('limit') || activeItem.error.includes('Upgrade')) && (
                        <button
                          onClick={() => setShowUpgrade(true)}
                          className="mt-2 flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          <ArrowUpCircle size={13} /> Upgrade now to continue →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className={`transition-opacity duration-300 ${
                activeItem.status === 'analyzing' || activeItem.status === 'processing'
                  ? 'opacity-40 pointer-events-none select-none'
                  : 'opacity-100'
              }`}>
              {/* SEO config */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xl shadow-black/20">
                <h2 className="font-bold flex items-center gap-2">
                  <Zap size={16} className="text-yellow-400" /> SEO Configuration
                </h2>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Title</label>
                  <input type="text" value={activeItem.seo.title}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, title: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Artist</label>
                    <input type="text" value={activeItem.seo.artist}
                      onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, artist: e.target.value } })}
                      placeholder="Your artist name"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Album Artist</label>
                    <input type="text" value={activeItem.seo.albumArtist}
                      onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, albumArtist: e.target.value } })}
                      placeholder="Your artist name or group"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Producer</label>
                    <input type="text" value={activeItem.seo.producer}
                      onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, producer: e.target.value } })}
                      placeholder="Producer / label name"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Copyright</label>
                    <input type="text" value={activeItem.seo.copyright}
                      onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, copyright: e.target.value } })}
                      placeholder="© 2026 Your Name or Label"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Genre</label>
                    <input type="text" value={activeItem.seo.genre}
                      onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, genre: e.target.value } })}
                      placeholder="trap, hip-hop, latin urban"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      saveReleaseDefaults(resolveReleaseMetadata(activeItem.seo));
                      addLog(activeItem.id, 'Release defaults saved.');
                    }}
                    className="px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 rounded-lg"
                  >Save as My Defaults</button>
                  <button
                    onClick={() => {
                      localStorage.removeItem(RELEASE_DEFAULTS_STORAGE_KEY);
                      addLog(activeItem.id, 'Release defaults cleared.');
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg"
                  >Clear Saved Defaults</button>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Description</label>
                  <textarea rows={3} value={activeItem.seo.description}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, description: e.target.value } })}
                    placeholder="Short release description"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Comment</label>
                  <textarea rows={2} value={activeItem.seo.comment}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, comment: e.target.value } })}
                    placeholder="Optional comment / credits"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none resize-none" />
                </div>
                <button onClick={async ()=>{
                  try {
                    const res = await fetch(`${API_BASE_URL}/api/generate-seo`, {
                      method:'POST',
                      headers:{'Content-Type':'application/json', Authorization:`Bearer ${authToken}`},
                      body: JSON.stringify({
                        title: activeItem.seo.title,
                        artist: activeItem.seo.artist || activeItem.analysis?.artist || '',
                        genre: activeItem.seo.genre || activeItem.analysis?.genre || '',
                        description: activeItem.seo.description || '',
                        tags: activeItem.seo.tags || '',
                        platform,
                      }),
                    });

                    const payload = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      const errorMessage = payload?.error || `SEO generation failed (${res.status})`;
                      updateItem(activeItem.id, { error: errorMessage });
                      addLog(activeItem.id, `SEO generation failed: ${errorMessage}`);
                      return;
                    }

                    updateItem(activeItem.id, {
                      error: null,
                      seo: {
                        ...activeItem.seo,
                        title: payload.title || activeItem.seo.title,
                        description: payload.description || activeItem.seo.description,
                        tags: payload.tags || activeItem.seo.tags,
                      },
                    });
                    addLog(activeItem.id, 'SEO payload generated');
                  } catch {
                    const errorMessage = 'Unable to generate SEO payload right now.';
                    updateItem(activeItem.id, { error: errorMessage });
                    addLog(activeItem.id, `SEO generation failed: ${errorMessage}`);
                  }
                }} disabled={!activeItem} className="px-3 py-1.5 text-xs bg-violet-700 hover:bg-violet-600 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg">Generate AI SEO Payload</button>
                {seoDisabledReason && <p className="text-[11px] text-slate-500">{seoDisabledReason}</p>}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tags (comma-separated)</label>
                  <input type="text" value={activeItem.seo.tags}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, tags: e.target.value } })}
                    placeholder="comma-separated tags"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Lyrics</label>
                  <textarea rows={3} value={activeItem.seo.lyrics}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, lyrics: e.target.value } })}
                    placeholder="Optional lyrics"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none resize-none" />
                </div>
              </div>


              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xl shadow-black/20">
                <h3 className="font-bold">Cleanse Workflow</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <button
                    onClick={async () => {
                      if (!activeItem.file.name.toLowerCase().endsWith('.mp3')) { updateItem(activeItem.id, { error: 'Quick Cleanse supports MP3 only.' }); return; }
                      const itemId = activeItem.id;
                      const file = activeItem.file;
                      const previousDownloadUrl = activeItem.downloadUrl;
                      updateItem(itemId, { error: null, status: 'processing' });
                      addLog(itemId, 'Starting browser quick cleanse');
                      console.info('[quick-cleanse] start', { fileName: file.name, size: file.size, type: file.type });
                      const timeoutMessage = 'Quick Cleanse timed out while processing this MP3. Try a smaller file or use a freshly exported MP3.';

                      try {
                        const quickBlob = await withOperationTimeout((async () => {
                          addLog(itemId, 'Reading MP3 file into memory');
                          try {
                            await file.arrayBuffer();
                          } catch (err) {
                            console.error('[quick-cleanse] failed while reading file into memory', err);
                            throw new Error(`Unable to read MP3 in browser: ${err instanceof Error ? err.message : String(err)}`);
                          }

                          addLog(itemId, 'Parsing existing metadata');
                          try {
                            await readFileMetadata(file);
                          } catch (err) {
                            console.error('[quick-cleanse] failed while parsing existing metadata', err);
                            throw new Error(`Unable to parse MP3 metadata: ${err instanceof Error ? err.message : String(err)}`);
                          }

                          addLog(itemId, 'Removing/replacing metadata');
                          let rewrittenBlob: Blob;
                          try {
                            const { blob, frameReport } = await writeMP3Metadata(file, {
                              title: activeItem.seo.title,
                              artist: activeItem.seo.artist || activeItem.analysis?.artist || '',
                              albumArtist: activeItem.seo.albumArtist || activeItem.seo.artist || activeItem.analysis?.artist || '',
                              producer: activeItem.seo.producer,
                              copyright: activeItem.seo.copyright,
                              genre: activeItem.seo.genre || activeItem.analysis?.genre || '',
                              description: activeItem.seo.description,
                              comment: activeItem.seo.comment,
                              lyrics: activeItem.seo.lyrics || activeItem.analysis?.lyrics || '',
                              tags: activeItem.seo.tags,
                              publisher: activeItem.seo.producer || '',
                            });
                            rewrittenBlob = blob;
                            addLog(itemId, `ID3 frames written: ${frameReport.writtenFrames.join(', ') || 'none'}${frameReport.skippedFrames.length ? ` | skipped: ${frameReport.skippedFrames.join(', ')}` : ''}`);
                          } catch (err) {
                            console.error('[quick-cleanse] failed while removing/replacing metadata', err);
                            throw new Error(`Unable to rewrite MP3 metadata: ${err instanceof Error ? err.message : String(err)}`);
                          }

                          addLog(itemId, 'Creating cleansed MP3 blob');
                          return rewrittenBlob;
                        })(), 30_000, timeoutMessage);

                        addLog(itemId, 'Creating download URL');
                        const url = URL.createObjectURL(quickBlob);
                        if (previousDownloadUrl) URL.revokeObjectURL(previousDownloadUrl);
                        updateItem(itemId, {
                          downloadUrl: url,
                          downloadName: `quick_cleansed_${file.name}`,
                          report: { removedCount: 0, removedTags: ['ID3 metadata rewritten locally', 'Core frames attempted: TIT2,TPE1,TPE2,TCON,COMM,USLT,TCOP'], timestamp: new Date().toLocaleTimeString() },
                          status: 'done',
                          error: null,
                        });
                        addLog(itemId, 'Quick cleanse complete');
                        console.info('[quick-cleanse] complete', { fileName: file.name, outputSize: quickBlob.size });
                      } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        console.error('[quick-cleanse] failed', err);
                        addLog(itemId, `Quick cleanse failed: ${message}`);
                        updateItem(itemId, { status: 'error', error: message });
                      }
                    }}
                    disabled={!!quickDisabledReason || isBatching}
                    className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg text-sm font-bold"
                  >Quick Cleanse (Browser)</button>
                    <p className="mt-2 text-xs text-emerald-200/80">MP3-only • local metadata rewrite • no server usage counted.</p>
                    {quickDisabledReason && <p className="mt-1 text-[11px] text-amber-300">{quickDisabledReason}</p>}
                  </div>
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
                    <button onClick={runBatch} disabled={!!serverDisabledReason} className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg text-sm font-bold">Full Server Cleanse</button>
                    <p className="mt-2 text-xs text-cyan-200/80">Recommended for MP4/M4A • usage-counted • free plan allowed up to monthly limit.</p>
                    {serverDisabledReason && <p className="mt-1 text-[11px] text-amber-300">{serverDisabledReason}</p>}
                  </div>
                </div>
                {activeItem && (activeExt === '.wav' || activeExt === '.flac') && (
                  <p className="text-[11px] text-amber-300">
                    WAV/FLAC server cleanse is currently not enabled. Convert to M4A/MP4 for Full Server Cleanse.
                  </p>
                )}
                {activeItem.downloadUrl && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-cyan-300 font-bold mb-1">Result Source: {resultSource}</p>
                    <a href={activeItem.downloadUrl} download={activeItem.downloadName || `cleansed_${activeItem.file.name}`} className="inline-flex items-center gap-2 text-cyan-200 text-base font-bold underline break-all">Manual Download Link</a>
                  </div>
                )}
              </div>
              </div>{/* end opacity wrapper */}

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h3 className="font-bold mb-3">Analysis</h3>
                {activeItem.analysis?.parseError && (
                  <div className="mb-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                    Metadata parser used fallback values for some fields.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Format</span><p>{activeItem.analysis?.format || '—'}</p></div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Title</span><p>{activeItem.analysis?.title || '—'}</p></div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Artist</span><p>{activeItem.analysis?.artist || '—'}</p></div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Genre</span><p>{activeItem.analysis?.genre || '—'}</p></div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Provenance Risk</span><p className={activeItem.analysis?.provenanceRisk === 'High' ? 'text-rose-400 font-bold' : 'text-emerald-300'}>{activeItem.analysis?.provenanceRisk || 'Low'}{activeItem.analysis?.provenanceRisk === 'Low' ? ' (lower risk, not guaranteed)' : ''}</p></div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800"><span className="text-slate-500 text-xs uppercase">Detected Markers</span><p>{(activeItem.analysis?.detectedMarkers || []).join(', ') || 'None detected'}</p></div>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6"><h3 className="font-bold mb-2">System Log</h3><div className="text-xs space-y-1.5 max-h-48 overflow-y-auto">{activeItem.logs.map((l, i) => { const isErr = /failed|error/i.test(l); const isSuccess = /complete|generated|starting server cleanse/i.test(l); const m = l.match(/^\[(.*?)\]\s*(.*)$/); return <div key={i} className={`font-mono text-[11px] sm:text-xs px-2 py-1.5 rounded border break-words ${isErr ? 'text-red-300 border-red-500/30 bg-red-500/10' : isSuccess ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-300 border-slate-700 bg-slate-800/40'}`}><span className="text-slate-500 mr-2">{m ? m[1] : '--:--:--'}</span><span>{m ? m[2] : l}</span></div>; })}</div></div>

              {/* Forensic report */}
              {activeItem.report && (() => {
                const removed = activeItem.report.removedCount ?? 0;
                const headline = removed > 0
                  ? `${removed} AI marker${removed === 1 ? '' : 's'} removed — your file is clean.`
                  : 'No AI markers found — your file was already clean.';
                const status = activeItem.report.status || 'clean';
                const statusPill = status === 'review_required'
                  ? { label: '⚑ Review Required', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
                  : status === 'clean_with_notes'
                    ? { label: '⚠ Clean with Notes', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
                    : { label: '✓ Clean', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
                const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
                  'Just stripped AI metadata from my track using SpectraCleanse — clean metadata, real attribution. Try it free: https://spectracleanse.com #IndependentArtist #AIMusic'
                )}`;
                return (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-emerald-400 font-bold flex items-center gap-2">
                      <CheckCircle2 size={16} /> Sanitization Complete
                    </h3>
                    <span className="text-[10px] text-slate-500 font-mono">{activeItem.report.timestamp}</span>
                  </div>

                  <p className="text-2xl sm:text-3xl font-extrabold text-emerald-300 leading-snug">{headline}</p>
                  <span className={`inline-flex text-[11px] font-bold px-2.5 py-1 rounded-full border ${statusPill.cls}`}>{statusPill.label}</span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Tags Removed</p>
                      <p className="text-emerald-400 font-mono font-bold text-lg">{removed}</p>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Platform Preset</p>
                      <p className="text-cyan-400 font-mono">{platform}</p>
                    </div>
                  </div>
                  {activeItem.report.removedTags.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Purged Tag Keys</p>
                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                        {activeItem.report.removedTags.map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-red-500/15 text-red-300 rounded text-[10px] font-mono border border-red-500/20">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => triggerDownload(activeItem.downloadUrl!, activeItem.downloadName!)}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download size={16} /> Download Cleansed File
                  </button>

                  <div className="pt-2 border-t border-emerald-500/10 space-y-2">
                    <p className="text-xs text-slate-400">Cleaned with SpectraCleanse. Share your release with confidence.</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText('https://spectracleanse.com').catch(() => {});
                          setAuthNotice('Link copied to clipboard.');
                          setTimeout(() => setAuthNotice(null), 2500);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                      >Copy Link to SpectraCleanse</button>
                      <a
                        href={tweetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg"
                      >Tweet This</a>
                    </div>
                  </div>

                  {currentUser.plan === 'free' && (
                    <div className="pt-3 border-t border-emerald-500/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <p className="text-xs text-slate-300">Process unlimited files + batch upload with Creator plan. <span className="font-bold text-cyan-300">$9.99/month.</span></p>
                      <button
                        onClick={() => setShowUpgrade(true)}
                        className="px-3 py-1.5 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 rounded-lg flex items-center justify-center gap-1.5"
                      >
                        <ArrowUpCircle size={13} /> Upgrade to Creator
                      </button>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  );
}
