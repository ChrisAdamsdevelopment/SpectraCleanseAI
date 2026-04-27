import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck, Upload, Trash2, Zap, FileText,
  CheckCircle2, RefreshCw, AlertCircle, Download, XCircle,
  LogOut, User, Lock, Mail, Eye, EyeOff, Sparkles,
  ArrowUpCircle, Crown, Star, X,
} from 'lucide-react';
import * as mm from 'music-metadata';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const PLATFORMS = ['General', 'YouTube', 'Spotify', 'Apple Music', 'TikTok'] as const;
type Platform = typeof PLATFORMS[number];
type ItemStatus = 'pending' | 'analyzing' | 'processing' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AuthUser {
  id: number;
  email: string;
  plan: 'free' | 'creator' | 'studio' | 'enterprise';
}

interface UsageState {
  thisMonth: number;
  limit: number | null; // null = unlimited
}

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  seo: { title: string; description: string; tags: string };
  downloadUrl: string | null;
  downloadName: string | null;
  report: { removedCount: number; removedTags: string[]; timestamp: string } | null;
  error: string | null;
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
  type: 'success' | 'cancelled';
  onDismiss: () => void;
}) {
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
function AuthScreen({ onAuth }: { onAuth: (token: string, user: AuthUser) => void }) {
  const [mode, setMode]       = useState<'login' | 'signup'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fadeIn, setFadeIn]   = useState(false);

  useEffect(() => { requestAnimationFrame(() => setFadeIn(true)); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const endpoint = mode === 'login' ? '/api/login' : '/api/register';
    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      onAuth(data.token, data.user);
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
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-cyan-500/25 mb-4">
            <ShieldCheck className="text-white w-8 h-8" />
          </div>
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
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [authToken,    setAuthToken]    = useState<string | null>(null);
  const [currentUser,  setCurrentUser]  = useState<AuthUser | null>(null);
  const [usage,        setUsage]        = useState<UsageState>({ thisMonth: 0, limit: 3 });
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<'success' | 'cancelled' | null>(null);

  const [queue,      setQueue]      = useState<QueueItem[]>([]);
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [platform,   setPlatform]   = useState<Platform>('General');
  const [isBatching, setIsBatching] = useState(false);
  const [cancelRef]  = useState({ cancelled: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeItem = queue.find(f => f.id === activeId) ?? null;

  // ── Session restore + Stripe return handling ────────────────────────────────
  useEffect(() => {
    const session = loadSession();
    if (!session) return;

    setAuthToken(session.token);
    setCurrentUser(session.user);

    // Check if we're returning from Stripe Checkout
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');

    if (checkout === 'success') {
      setCheckoutBanner('success');
      // Re-fetch /api/me so the plan badge updates immediately after upgrade
      fetch(`${BACKEND_URL}/api/me`, {
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
      const res  = await fetch(`${BACKEND_URL}/api/me`, {
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
      const res  = await fetch(`${BACKEND_URL}/api/create-checkout-session`, {
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
    return <AuthScreen onAuth={handleAuth} />;
  }

  // ── Queue helpers ─────────────────────────────────────────────────────────────
  const updateItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const addFiles = (files: FileList | File[]) => {
    const validExt = /\.(mp3|wav|flac|m4a|mp4)$/i;
    const newItems: QueueItem[] = Array.from(files)
      .filter(f => validExt.test(f.name))
      .slice(0, 20 - queue.length)
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        status: 'pending' as ItemStatus,
        seo: { title: file.name.replace(/\.[^.]+$/, ''), description: '', tags: '' },
        downloadUrl: null, downloadName: null, report: null, error: null,
      }));
    if (newItems.length === 0) return;
    setQueue(prev => [...prev, ...newItems].slice(0, 20));
    setActiveId(prev => prev ?? newItems[0].id);
  };

  const removeItem = (id: string) => {
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
      return prev.filter(i => i.id !== id);
    });
    setActiveId(prev => prev === id ? null : prev);
  };

  const analyzeFile = async (item: QueueItem): Promise<Partial<QueueItem>> => {
    try {
      const parsed = await mm.parseBlob(item.file);
      return {
        seo: {
          title:       parsed.common.title || item.file.name.replace(/\.[^.]+$/, ''),
          description: parsed.common.comment?.[0]?.text || '',
          tags:        parsed.common.genre?.[0] || '',
        },
      };
    } catch { return {}; }
  };

  const runBatch = async () => {
    const snapshot = queue.filter(i => i.status !== 'done');
    if (snapshot.length === 0) return;

    setIsBatching(true);
    cancelRef.cancelled = false;

    for (const item of snapshot) {
      if (cancelRef.cancelled) break;

      updateItem(item.id, { status: 'analyzing', error: null });
      const analyzed = await analyzeFile(item);
      if (cancelRef.cancelled) break;

      updateItem(item.id, { ...analyzed, status: 'processing' });

      // Grab the latest SEO values from state (user may have edited them)
      const currentSeo = await new Promise<QueueItem['seo']>(resolve => {
        setQueue(prev => {
          const current = prev.find(i => i.id === item.id);
          resolve(current?.seo ?? item.seo);
          return prev;
        });
      });

      try {
        const formData = new FormData();
        formData.append('file',        item.file);
        formData.append('title',       currentSeo.title);
        formData.append('description', currentSeo.description);
        formData.append('tags',        currentSeo.tags);
        formData.append('platform',    platform);

        const res = await fetch(`${BACKEND_URL}/api/process`, {
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
            error:  body.detail || 'Monthly limit reached. Upgrade to continue.',
          });
          setShowUpgrade(true);
          // Abort remaining items in this batch
          cancelRef.cancelled = true;
          break;
        }

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(errBody.error || `Server error ${res.status}`);
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

        updateItem(item.id, {
          status: 'done',
          downloadUrl,
          downloadName,
          report: { removedCount, removedTags, timestamp: new Date().toLocaleTimeString() },
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">

      {/* Upgrade modal */}
      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          onCheckout={handleCheckout}
          loading={upgradeLoading}
        />
      )}

      {/* Checkout return banner */}
      {checkoutBanner && (
        <CheckoutBanner type={checkoutBanner} onDismiss={() => setCheckoutBanner(null)} />
      )}

      {/* Navbar */}
      <nav className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <ShieldCheck className="text-white w-5 h-5" />
          </div>
          <span className="font-bold tracking-tight">
            SpectraCleanse <span className="text-cyan-400">AI</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value as Platform)}
            className="bg-slate-800 border border-slate-700 text-xs px-3 py-2 rounded-lg outline-none focus:border-cyan-500"
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

      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar */}
        <aside className="w-72 border-r border-slate-800 bg-slate-900/30 flex flex-col">
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
              accept=".mp3,.wav,.flac,.m4a,.mp4,audio/*,video/mp4"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>

          {/* Usage meter – sits just below the queue header for free users */}
          <UsageMeter usage={usage} onUpgrade={() => setShowUpgrade(true)} />

          <div className="flex-1 overflow-y-auto">
            {queue.length === 0 ? (
              <div
                className="p-8 text-center text-slate-600 text-sm cursor-pointer hover:text-slate-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto mb-2 opacity-30" size={32} />
                Click to add files
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
                    <p className="text-[10px] text-slate-500 uppercase mt-0.5">{item.status}</p>
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
        <main className="flex-1 overflow-y-auto p-6 bg-slate-950">
          {!activeItem ? (
            <div
              className="h-full flex flex-col items-center justify-center text-slate-600 cursor-pointer hover:text-slate-500 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={48} className="mb-3 opacity-30" />
              <p className="text-lg">Add files to get started</p>
              <p className="text-sm mt-1 opacity-60">MP3 · WAV · FLAC · M4A · MP4 · up to 20 files</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <FileText className="text-cyan-400" size={20} />
                <h1 className="font-bold text-lg truncate">{activeItem.file.name}</h1>
                <span className="ml-auto text-xs text-slate-500">
                  {(activeItem.file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>

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

              {/* SEO config */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h2 className="font-bold flex items-center gap-2">
                  <Zap size={16} className="text-yellow-400" /> SEO Configuration
                </h2>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Title</label>
                  <input type="text" value={activeItem.seo.title}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, title: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Description</label>
                  <textarea rows={3} value={activeItem.seo.description}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, description: e.target.value } })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tags (comma-separated)</label>
                  <input type="text" value={activeItem.seo.tags}
                    onChange={e => updateItem(activeItem.id, { seo: { ...activeItem.seo, tags: e.target.value } })}
                    placeholder="trap, heavy metal, original…"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors" />
                </div>
              </div>

              {/* Forensic report */}
              {activeItem.report && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-emerald-400 font-bold flex items-center gap-2">
                      <CheckCircle2 size={16} /> Sanitization Complete
                    </h3>
                    <span className="text-[10px] text-slate-500 font-mono">{activeItem.report.timestamp}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Tags Removed</p>
                      <p className="text-emerald-400 font-mono font-bold text-lg">{activeItem.report.removedCount}</p>
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
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}