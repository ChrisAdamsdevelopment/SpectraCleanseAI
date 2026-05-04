import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, FileSearch, FileText, LogOut, Sparkles, Upload } from 'lucide-react';
import { readFileMetadata, writeMP3Metadata } from './utils/metadata';

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

type User = { id: number; email: string; plan?: string; role?: string };
type TabKey = 'context' | 'seo' | 'analysis';
type LogLevel = 'info' | 'success' | 'error';

type ProcessedAsset = { url: string; filename: string; source: 'browser' | 'server' };

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('spectra_token'));
  const [user, setUser] = useState<User | null>(JSON.parse(localStorage.getItem('spectra_user') || 'null'));
  const [activeTab, setActiveTab] = useState<TabKey>('context');
  const [file, setFile] = useState<File | null>(null);
  const [metadataAnalysis, setMetadataAnalysis] = useState<any>(null);
  const [context, setContext] = useState({ artist: '', title: '', genre: '', vibe: '', lyrics: '' });
  const [seo, setSeo] = useState({ title: '', description: '', tags: '', lyrics: '' });
  const [usage, setUsage] = useState({ used: 0, limit: 10 });
  const [processedAsset, setProcessedAsset] = useState<ProcessedAsset | null>(null);
  const [forensicReport, setForensicReport] = useState<any>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ ts: string; message: string; level: LogLevel }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string, level: LogLevel = 'info') => {
    setLogs((prev) => [{ ts: new Date().toLocaleTimeString(), message, level }, ...prev].slice(0, 50));
  };

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    return () => {
      if (processedAsset?.url) URL.revokeObjectURL(processedAsset.url);
    };
  }, [processedAsset]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/me`, { headers: authHeader }).then(async (res) => {
      if (res.status === 401) return logout();
      if (res.ok) {
        const me = await res.json();
        setUser(me.user || me);
      }
    });
  }, [token]);

  const logout = () => {
    localStorage.removeItem('spectra_token');
    localStorage.removeItem('spectra_user');
    setToken(null);
    setUser(null);
  };

  const onFile = async (selected: File) => {
    if (processedAsset?.url) URL.revokeObjectURL(processedAsset.url);
    setProcessedAsset(null);
    setForensicReport(null);
    setFile(selected);
    addLog(`Loaded ${selected.name}`);
    const analysis = await readFileMetadata(selected);
    setMetadataAnalysis(analysis);
    setContext((c) => ({ ...c, artist: analysis.artist || c.artist, title: analysis.title || c.title, genre: analysis.genre || c.genre }));
    setActiveTab('analysis');
  };

  const generateSeo = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const promptText = `Artist: ${context.artist}\nTitle: ${context.title}\nGenre: ${context.genre}\nVibe: ${context.vibe}\nLyrics: ${context.lyrics}`;
      const res = await fetch(`${API_BASE}/api/generate-seo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ promptText })
      });
      if (res.status === 401) return logout();
      const data = await res.json();
      setSeo({ title: data.title || '', description: data.description || '', tags: Array.isArray(data.tags) ? data.tags.join(', ') : data.tags || '', lyrics: data.lyrics || context.lyrics });
      setActiveTab('seo');
      addLog('SEO payload generated', 'success');
    } catch {
      addLog('Failed to generate SEO payload', 'error');
    } finally {
      setLoading(false);
    }
  };

  const quickCleanse = async () => {
    if (!file || !file.name.toLowerCase().endsWith('.mp3')) return;
    setLoading(true);
    try {
      const blob = await writeMP3Metadata(file, {
        title: seo.title || context.title,
        artist: context.artist,
        album: 'SpectraCleanse Processed',
        genre: context.genre,
        comment: seo.description,
        lyrics: seo.lyrics,
        year: new Date().getFullYear()
      });
      if (processedAsset?.url) URL.revokeObjectURL(processedAsset.url);
      const url = URL.createObjectURL(blob);
      setProcessedAsset({ url, filename: file.name.replace(/\.mp3$/i, '') + '-cleanse.mp3', source: 'browser' });
      setForensicReport(null);
      addLog('In-browser cleanse complete', 'success');
    } catch {
      addLog('Quick cleanse failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const serverCleanse = async () => {
    if (!file || !token) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', seo.title || context.title);
      form.append('artist', context.artist);
      form.append('genre', context.genre);
      form.append('description', seo.description);
      form.append('tags', seo.tags);
      form.append('lyrics', seo.lyrics || context.lyrics);
      const res = await fetch(`${API_BASE}/api/process`, { method: 'POST', headers: authHeader, body: form });
      if (res.status === 401) return logout();
      if (res.status === 402) return setShowUpgradeModal(true);
      if (!res.ok) throw new Error();
      const used = Number(res.headers.get('X-Usage-This-Month') || usage.used);
      const limit = Number(res.headers.get('X-Usage-Limit') || usage.limit);
      setUsage({ used, limit });
      const blob = await res.blob();
      if (processedAsset?.url) URL.revokeObjectURL(processedAsset.url);
      const url = URL.createObjectURL(blob);
      setProcessedAsset({ url, filename: file.name.replace(/\.(\w+)$/, '') + '-server-cleanse.' + (file.name.split('.').pop() || 'bin'), source: 'server' });
      setForensicReport({ tagsRemoved: metadataAnalysis?.detectedMarkers || [], riskBefore: metadataAnalysis?.risk || 'Low', riskAfter: 'Low', method: 'Full server forensic pipeline' });
      addLog('Server cleanse complete', 'success');
    } catch {
      addLog('Server cleanse failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!token || !user) return <AuthScreen onAuthed={(t, u) => { setToken(t); setUser(u); }} />;

  return <div className="min-h-screen bg-slate-950 text-slate-100 p-6"><div className="max-w-6xl mx-auto space-y-6">
    <header className="flex items-center justify-between"><h1 className="text-2xl font-bold text-cyan-300">SpectraCleanse AI</h1><div className="flex items-center gap-3"><span className="px-3 py-1 rounded bg-slate-800">{(user.plan || 'free').toUpperCase()}</span><span className="text-sm text-slate-300">Usage {usage.used}/{usage.limit}</span><button onClick={logout} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700"><LogOut className="w-4 h-4" /></button></div></header>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[['context','Track Context',AudioLines],['seo','SEO Payload',Sparkles],['analysis','File Analysis',FileSearch]].map((t:any)=><button key={t[0]} onClick={()=>setActiveTab(t[0])} className={`p-3 rounded border transition ${activeTab===t[0]?'bg-cyan-600/20 border-cyan-400':'bg-slate-900 border-slate-700'}`}><t[2] className="inline w-4 h-4 mr-2" />{t[1]}</button>)}</div>
    <section className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f) onFile(f);}} className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center"><Upload className="w-6 h-6 mx-auto mb-2 text-cyan-300" /><p>Drop audio file or <button onClick={()=>fileInputRef.current?.click()} className="text-cyan-400 underline">browse</button></p><p className="text-xs text-slate-400">.mp3 .wav .flac .m4a .mp4</p><input ref={fileInputRef} type="file" className="hidden" accept=".mp3,.wav,.flac,.m4a,.mp4" onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f);}}/></div>
      {activeTab==='context' && <div className="mt-5 grid md:grid-cols-2 gap-3">{['artist','title','genre','vibe'].map((k)=><input key={k} value={(context as any)[k]} onChange={(e)=>setContext({...context,[k]:e.target.value})} placeholder={k} className="bg-slate-800 rounded px-3 py-2"/>)}<textarea value={context.lyrics} onChange={(e)=>setContext({...context,lyrics:e.target.value})} placeholder="lyrics/context" className="md:col-span-2 bg-slate-800 rounded px-3 py-2 h-24"/><button onClick={generateSeo} disabled={loading} className="md:col-span-2 px-4 py-3 rounded bg-cyan-600 hover:bg-cyan-500 font-semibold">Generate AI SEO Payload</button></div>}
      {activeTab==='seo' && <div className="mt-5 space-y-3"><input value={seo.title} onChange={(e)=>setSeo({...seo,title:e.target.value})} placeholder="SEO title" className="w-full bg-slate-800 rounded px-3 py-2"/><textarea value={seo.description} onChange={(e)=>setSeo({...seo,description:e.target.value})} placeholder="SEO description" className="w-full h-20 bg-slate-800 rounded px-3 py-2"/><input value={seo.tags} onChange={(e)=>setSeo({...seo,tags:e.target.value})} placeholder="tags (comma separated)" className="w-full bg-slate-800 rounded px-3 py-2"/><textarea value={seo.lyrics} onChange={(e)=>setSeo({...seo,lyrics:e.target.value})} placeholder="lyrics" className="w-full h-24 bg-slate-800 rounded px-3 py-2"/></div>}
      {activeTab==='analysis' && <div className="mt-5 space-y-2 text-sm"><p>Format: <span className="text-cyan-300">{metadataAnalysis?.format || '—'}</span></p><p>Title: {metadataAnalysis?.title || '—'} | Artist: {metadataAnalysis?.artist || '—'}</p><p>Risk: <span className={metadataAnalysis?.risk==='HIGH'?'text-red-400':'text-emerald-400'}>{metadataAnalysis?.risk || 'Low'}</span></p><p>Detected markers: {(metadataAnalysis?.detectedMarkers || []).length ? metadataAnalysis.detectedMarkers.join(', ') : 'None'}</p></div>}
      <div className="mt-6 grid md:grid-cols-2 gap-3"><button title={file && file.name.toLowerCase().endsWith('.mp3')?'':'Quick cleanse is only available for MP3 files'} disabled={!file || !file.name.toLowerCase().endsWith('.mp3') || loading} onClick={quickCleanse} className="px-4 py-3 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 font-semibold">Quick Cleanse (Browser)</button><button disabled={!file || loading} onClick={serverCleanse} className="px-4 py-3 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 font-semibold">Full Server Cleanse</button></div>
      {processedAsset && <div className="mt-6"><a href={processedAsset.url} download={processedAsset.filename} className="block text-center text-lg font-bold rounded-xl bg-cyan-500 text-slate-950 px-6 py-4 hover:bg-cyan-400">Download Processed File</a></div>}
      {forensicReport && processedAsset?.source==='server' && <div className="mt-6 bg-slate-800 rounded p-4 border border-slate-700"><h3 className="font-semibold mb-2 flex items-center gap-2"><FileText className="w-4 h-4"/>Forensic Report</h3><p>Method: {forensicReport.method}</p><p>Risk before: {forensicReport.riskBefore} / after: {forensicReport.riskAfter}</p><p>Tags removed: {forensicReport.tagsRemoved.length ? forensicReport.tagsRemoved.join(', ') : 'No known markers found'}</p></div>}
      <div className="mt-6 bg-slate-950 border border-slate-700 rounded p-3"><h4 className="font-semibold mb-2">System Log</h4><div className="space-y-1 max-h-48 overflow-auto">{logs.map((l,idx)=><div key={idx} className={`text-xs ${l.level==='error'?'text-red-400':l.level==='success'?'text-emerald-400':'text-slate-300'}`}>[{l.ts}] {l.message}</div>)}</div></div>
    </section>
  </div>{showUpgradeModal && <UpgradeModal onClose={()=>setShowUpgradeModal(false)} />}</div>;
}

function AuthScreen({ onAuthed }: { onAuthed: (token: string, user: User) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    const res = await fetch(`${API_BASE}/api/${isLogin ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Auth failed');
    localStorage.setItem('spectra_token', data.token);
    localStorage.setItem('spectra_user', JSON.stringify(data.user));
    onAuthed(data.token, data.user);
  };
  return <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4"><div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-3"><h2 className="text-xl font-bold">{isLogin ? 'Login' : 'Register'}</h2><input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" className="w-full bg-slate-800 rounded px-3 py-2"/><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" className="w-full bg-slate-800 rounded px-3 py-2"/>{error && <p className="text-red-400 text-sm">{error}</p>}<button onClick={submit} className="w-full bg-cyan-600 hover:bg-cyan-500 rounded px-4 py-2 font-semibold">{isLogin ? 'Login' : 'Create account'}</button><button onClick={()=>setIsLogin(!isLogin)} className="text-cyan-400 text-sm">{isLogin ? 'Need an account?' : 'Already have an account?'}</button></div></div>;
}

function UpgradeModal({ onClose }: { onClose: () => void }) {
  const creatorLink = 'https://buy.stripe.com/6oUdR83GlbTxgJk6XKbV602';
  const studioLink = 'https://buy.stripe.com/6oUeVc90F9Lpbp03LybV603';
  return <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4"><div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg"><h3 className="text-xl font-bold mb-4">Upgrade Required</h3><p className="text-slate-300 mb-4">You reached your free monthly cleanse limit.</p><div className="grid grid-cols-2 gap-3"><a href={creatorLink} className="text-center bg-cyan-600 hover:bg-cyan-500 rounded px-4 py-3 font-semibold">Creator Plan</a><a href={studioLink} className="text-center bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-3 font-semibold">Studio Plan</a></div><button onClick={onClose} className="mt-4 w-full bg-slate-700 hover:bg-slate-600 rounded px-4 py-2">Close</button></div></div>;
}

export default App;
