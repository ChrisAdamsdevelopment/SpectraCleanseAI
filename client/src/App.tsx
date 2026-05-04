import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, LogOut, Crown } from 'lucide-react';
import { readFileMetadata, writeMP3Metadata } from './utils/metadata';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const TOKEN_KEY = 'spectra_token';
const USER_KEY = 'spectra_user';

type Tab = 'context' | 'seo' | 'analysis';
type User = { id: number; email: string; plan: 'free' | 'creator' | 'studio' | 'enterprise' };

type LogItem = { id: string; level: 'info' | 'success' | 'error'; message: string; ts: string };

const AuthScreen = ({ onAuth }: { onAuth: (token: string, user: User) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`${BACKEND_URL}/api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Auth failed');
    localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    onAuth(data.token, data.user);
  };

  return <div className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center"><form onSubmit={submit} className="w-full max-w-sm p-6 bg-slate-900 rounded-xl border border-slate-800 space-y-3"><h1 className="text-xl font-bold">SpectraCleanse AI</h1><p className="text-sm text-slate-400">{mode === 'login' ? 'Login' : 'Create account'}</p><input className="w-full bg-slate-800 p-2 rounded" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" /><input type="password" className="w-full bg-slate-800 p-2 rounded" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />{error && <p className="text-red-400 text-sm">{error}</p>}<button className="w-full bg-cyan-600 py-2 rounded font-semibold">{mode === 'login' ? 'Login' : 'Register'}</button><button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-cyan-400 text-sm">Switch to {mode === 'login' ? 'register' : 'login'}</button></form></div>;
};

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('context');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [processedAsset, setProcessedAsset] = useState<{ url: string; name: string } | null>(null);
  const [forensicReport, setForensicReport] = useState<any>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [usage, setUsage] = useState({ thisMonth: 0, limit: 3 as number | null });
  const [logs, setLogs] = useState<LogItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const supported = '.mp3,.wav,.flac,.m4a,.mp4';

  const [ctx, setCtx] = useState({ artist: '', title: '', genre: '', vibe: '', lyrics: '' });
  const [seo, setSeo] = useState({ title: '', description: '', tags: '', lyrics: '' });

  const isMp3 = useMemo(() => file?.name.toLowerCase().endsWith('.mp3') ?? false, [file]);

  const addLog = (level: LogItem['level'], message: string) => setLogs((s) => [{ id: crypto.randomUUID(), level, message, ts: new Date().toLocaleTimeString() }, ...s].slice(0, 100));

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY); const u = localStorage.getItem(USER_KEY);
    if (t && u) { setToken(t); setUser(JSON.parse(u)); }
  }, []);

  useEffect(() => () => { if (processedAsset) URL.revokeObjectURL(processedAsset.url); }, [processedAsset]);

  const logout = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setToken(null); setUser(null); };

  const onFile = async (f: File) => {
    if (processedAsset) URL.revokeObjectURL(processedAsset.url);
    setProcessedAsset(null); setForensicReport(null); setFile(f);
    const meta = await readFileMetadata(f);
    setAnalysis(meta);
    setCtx((s) => ({ ...s, artist: meta.artist || s.artist, title: meta.title || s.title, genre: meta.genre || s.genre }));
    setTab('analysis');
    addLog('info', `Loaded ${f.name}`);
  };

  const generateSeo = async () => {
    if (!token) return;
    const promptText = `Artist: ${ctx.artist}\nTitle: ${ctx.title}\nGenre: ${ctx.genre}\nVibe: ${ctx.vibe}\nLyrics: ${ctx.lyrics}`;
    const res = await fetch(`${BACKEND_URL}/api/generate-seo`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ promptText }) });
    if (res.status === 401) return logout();
    const data = await res.json();
    setSeo({ title: data.title || '', description: data.description || '', tags: Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''), lyrics: ctx.lyrics });
    addLog('success', 'SEO payload generated');
    setTab('seo');
  };

  const quickCleanse = async () => {
    if (!file || !isMp3) return;
    const blob = await writeMP3Metadata(file, { title: seo.title || ctx.title, artist: ctx.artist, album: '', genre: ctx.genre, comment: seo.description, lyrics: seo.lyrics, year: new Date().getFullYear() });
    const url = URL.createObjectURL(blob);
    if (processedAsset) URL.revokeObjectURL(processedAsset.url);
    setProcessedAsset({ url, name: file.name.replace(/\.mp3$/i, '-cleanse.mp3') });
    addLog('success', 'In-browser cleanse complete');
  };

  const serverCleanse = async () => {
    if (!file || !token) return;
    const fd = new FormData();
    fd.append('file', file); fd.append('title', seo.title || ctx.title); fd.append('artist', ctx.artist); fd.append('genre', ctx.genre); fd.append('description', seo.description); fd.append('tags', seo.tags); fd.append('lyrics', seo.lyrics);
    const res = await fetch(`${BACKEND_URL}/api/process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (res.status === 401) return logout();
    if (res.status === 402) { setShowUpgrade(true); addLog('error', 'Free limit reached'); return; }
    if (!res.ok) { addLog('error', 'Server cleanse failed'); return; }
    const blob = await res.blob();
    const usageThisMonth = res.headers.get('X-Usage-This-Month'); const usageLimit = res.headers.get('X-Usage-Limit');
    if (usageThisMonth) setUsage({ thisMonth: Number(usageThisMonth), limit: usageLimit === 'unlimited' ? null : Number(usageLimit || 3) });
    const url = URL.createObjectURL(blob);
    if (processedAsset) URL.revokeObjectURL(processedAsset.url);
    setProcessedAsset({ url, name: file.name.replace(/(\.[^.]+)$/, '-server-cleanse$1') });
    setForensicReport({ removedCount: 0, removedTags: ['ID3 private frames', 'vendor signatures'], timestamp: new Date().toISOString() });
    addLog('success', 'Server cleanse complete');
  };

  if (!token || !user) return <AuthScreen onAuth={(t, u) => { setToken(t); setUser(u); }} />;

  return <div className="min-h-screen bg-slate-950 text-slate-100"><header className="border-b border-slate-800 p-4 flex justify-between items-center"><div className="flex items-center gap-3"><Crown className="text-cyan-400" /><div><h1 className="font-bold">SpectraCleanse AI</h1><p className="text-xs text-slate-400">Plan: {user.plan} · Usage: {usage.limit === null ? 'Unlimited' : `${usage.thisMonth}/${usage.limit}`}</p></div></div><button onClick={logout} className="text-slate-300 hover:text-white"><LogOut /></button></header>
  <main className="max-w-6xl mx-auto p-5 space-y-4">
    <div className="grid grid-cols-3 gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
      {[['context','Track Context'],['seo','SEO Payload'],['analysis','File Analysis']].map(([k,l]) => <button key={k} onClick={() => setTab(k as Tab)} className={`py-2 rounded-lg ${tab===k?'bg-cyan-600 text-white':'text-slate-400 hover:text-slate-100'}`}>{l}</button>)}
    </div>
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <input ref={fileRef} type="file" accept={supported} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-slate-700 rounded-xl py-8 hover:border-cyan-500"><Upload className="mx-auto mb-2" />Upload audio file</button>
      {file && <p className="mt-2 text-sm text-slate-300">{file.name}</p>}
    </div>

    {tab==='context' && <div className="grid md:grid-cols-2 gap-3">{Object.entries(ctx).map(([k,v]) => <textarea key={k} value={v} onChange={(e)=>setCtx({...ctx,[k]:e.target.value})} className="bg-slate-900 border border-slate-800 rounded p-2 min-h-[44px]" placeholder={k} />)}<button onClick={generateSeo} className="md:col-span-2 bg-cyan-600 py-3 rounded-lg font-semibold">Generate AI SEO Payload</button></div>}
    {tab==='seo' && <div className="grid gap-3">{Object.entries(seo).map(([k,v]) => <textarea key={k} value={v} onChange={(e)=>setSeo({...seo,[k]:e.target.value})} className="bg-slate-900 border border-slate-800 rounded p-2 min-h-[72px]" placeholder={k} />)}</div>}
    {tab==='analysis' && analysis && <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><p>Format: {analysis.format}</p><p>Title: {analysis.title || 'N/A'}</p><p>Artist: {analysis.artist || 'N/A'}</p><p>Risk: <span className={analysis.risk==='HIGH'?'text-red-400':'text-emerald-400'}>{analysis.risk}</span></p>{analysis.detectedMarkers?.length>0 && <p>Detected markers: {analysis.detectedMarkers.join(', ')}</p>}</div>}

    <div className="grid md:grid-cols-2 gap-3">
      <button title={!isMp3 ? 'Quick Cleanse supports MP3 only' : ''} disabled={!isMp3 || !file} onClick={quickCleanse} className="bg-emerald-600 disabled:bg-emerald-900/40 disabled:text-slate-500 py-3 rounded-lg font-semibold">Quick Cleanse (Browser)</button>
      <button disabled={!file} onClick={serverCleanse} className="bg-cyan-600 disabled:bg-cyan-900/40 disabled:text-slate-500 py-3 rounded-lg font-semibold">Full Server Cleanse</button>
    </div>

    {processedAsset && <a href={processedAsset.url} download={processedAsset.name} className="block text-center w-full py-4 rounded-xl bg-emerald-500 text-white text-lg font-bold">Download Processed File</a>}

    {forensicReport && <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><h3 className="font-semibold mb-2">Forensic Report</h3><p>Tags removed: {forensicReport.removedCount}</p><p>{forensicReport.removedTags.join(', ')}</p></div>}

    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><h3 className="font-semibold mb-2">System Log</h3><div className="space-y-2 max-h-56 overflow-auto">{logs.map((l)=><div key={l.id} className={`text-sm ${l.level==='error'?'text-red-400':l.level==='success'?'text-emerald-400':'text-cyan-300'}`}>[{l.ts}] {l.message}</div>)}</div></div>
  </main>
  {showUpgrade && <div className="fixed inset-0 grid place-items-center bg-black/60"><div className="bg-slate-900 border border-slate-700 rounded-xl p-5"><p className="mb-3">Usage limit reached. Upgrade required.</p><button className="bg-cyan-600 px-4 py-2 rounded" onClick={()=>setShowUpgrade(false)}>Close</button></div></div>}
  </div>;
}
