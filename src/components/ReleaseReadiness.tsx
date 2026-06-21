import React, { useState } from 'react';
import {
  ShieldCheck, AlertTriangle, AlertOctagon, CheckCircle2, ChevronDown, ChevronRight,
  Clock, TrendingUp, RefreshCw, ListChecks,
} from 'lucide-react';
import {
  runReadinessCheck, businessImpactLabel, VERDICT_LABEL, CATEGORY_LABEL,
  type ReadinessReport, type Finding, type CategoryScore, type Severity, type VerdictStatus,
} from '../utils/readinessClient';

const ALL_CATEGORIES = ['metadata', 'rights', 'ai_disclosure', 'platform_compliance', 'distribution_readiness'] as const;

const VERDICT_STYLE: Record<VerdictStatus, { ring: string; text: string; bg: string; Icon: typeof ShieldCheck }> = {
  ready:           { ring: 'border-emerald-500/40', text: 'text-emerald-400', bg: 'bg-emerald-500/10', Icon: CheckCircle2 },
  needs_attention: { ring: 'border-amber-500/40',   text: 'text-amber-400',   bg: 'bg-amber-500/10',   Icon: AlertTriangle },
  high_risk:       { ring: 'border-rose-500/40',    text: 'text-rose-400',    bg: 'bg-rose-500/10',    Icon: AlertOctagon },
};

const SEVERITY_META: Record<Severity, { label: string; dot: string; pill: string }> = {
  critical: { label: 'Must fix',  dot: 'bg-rose-400',  pill: 'bg-rose-500/15 text-rose-300' },
  warning:  { label: 'Should fix', dot: 'bg-amber-400', pill: 'bg-amber-500/15 text-amber-300' },
  info:     { label: 'Consider',  dot: 'bg-slate-400', pill: 'bg-slate-500/15 text-slate-300' },
};

function barColor(status: CategoryScore['status']): string {
  if (status === 'pass') return 'bg-emerald-500';
  if (status === 'attention') return 'bg-amber-500';
  if (status === 'risk') return 'bg-rose-500';
  return 'bg-slate-700';
}

const FIELD = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors';
const LABEL = 'block text-[10px] font-bold text-slate-500 uppercase mb-1';

function ExpandRow({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors">
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {label}
    </button>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState<{ why: boolean; how: boolean; more: boolean }>({ why: true, how: false, more: false });
  const sev = SEVERITY_META[finding.severity];
  const impact = businessImpactLabel(finding.businessImpact);
  return (
    <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60">
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="font-medium text-slate-100 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sev.dot} shrink-0`} /> {finding.title}
        </p>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${sev.pill}`}>{sev.label}</span>
      </div>
      {finding.what && <p className="text-[13px] text-slate-300 mb-2">{finding.what}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-slate-400">
        {impact && <span className="inline-flex items-center gap-1 text-amber-300/90">{impact}</span>}
        {typeof finding.estimatedFixMinutes === 'number' && (
          <span className="inline-flex items-center gap-1"><Clock size={11} /> ~{finding.estimatedFixMinutes} min to fix</span>
        )}
        {typeof finding.scoreGainIfResolved === 'number' && finding.scoreGainIfResolved > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-300"><TrendingUp size={11} /> +{finding.scoreGainIfResolved} if resolved</span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <ExpandRow open={open.why} onClick={() => setOpen(o => ({ ...o, why: !o.why }))} label="Why this matters" />
          {open.why && finding.why && <p className="mt-1 text-[13px] text-slate-400 pl-4">{finding.why}</p>}
        </div>
        <div>
          <ExpandRow open={open.how} onClick={() => setOpen(o => ({ ...o, how: !o.how }))} label="How to fix" />
          {open.how && finding.howToFix && <p className="mt-1 text-[13px] text-slate-400 pl-4">{finding.howToFix}</p>}
        </div>
        {finding.learnMoreId && (
          <div>
            <ExpandRow open={open.more} onClick={() => setOpen(o => ({ ...o, more: !o.more }))} label="Learn more" />
            {open.more && <p className="mt-1 text-[13px] text-slate-400 pl-4">Guidance: {finding.learnMoreId}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReadinessReport }) {
  const v = VERDICT_STYLE[report.verdict.status];
  const scoreByCat = new Map(report.categoryScores.map(c => [c.category, c]));
  const hasFindings = report.findings.length > 0;

  return (
    <div className="space-y-6">
      {/* Verdict first, score beneath */}
      <div className={`rounded-2xl border ${v.ring} ${v.bg} p-6 text-center`}>
        <v.Icon className={`mx-auto mb-2 ${v.text}`} size={32} />
        <p className={`text-2xl font-bold tracking-wide ${v.text}`}>{VERDICT_LABEL[report.verdict.status]}</p>
        <p className="mt-2 text-slate-300">
          {report.overallScore == null ? 'Score pending — enable modules to assess this release' : (
            <><span className="text-3xl font-bold text-slate-100">{report.overallScore}</span><span className="text-slate-500">/100 · {report.scoreLabel}</span></>
          )}
        </p>
      </div>

      {/* Top issues preventing release */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="font-bold flex items-center gap-2 mb-3"><ListChecks size={16} className="text-amber-400" /> Top issues preventing release</h3>
        {report.topIssues.length === 0 ? (
          <p className="text-sm text-slate-400">No blocking issues found in the assessed categories.{report.verdict.notAssessed.length > 0 ? ' Some categories are not assessed yet (below).' : ''}</p>
        ) : (
          <ul className="space-y-1.5">
            {report.topIssues.map(issue => (
              <li key={issue.id} className="flex items-center gap-2 text-sm text-slate-300">
                <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_META[issue.severity].dot}`} />
                {issue.title}
                <span className="text-[11px] text-slate-500">· {CATEGORY_LABEL[issue.category]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Category scores — not assessed stays visible */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="font-bold mb-4">Category scores</h3>
        <div className="space-y-3">
          {ALL_CATEGORIES.map(cat => {
            const cs = scoreByCat.get(cat);
            const notAssessed = !cs || cs.status === 'not_assessed';
            return (
              <div key={cat} className="flex items-center gap-3">
                <span className="w-36 text-[13px] text-slate-400 shrink-0">{CATEGORY_LABEL[cat]}</span>
                <div className={`flex-1 h-2 rounded-full overflow-hidden ${notAssessed ? 'border border-dashed border-slate-700' : 'bg-slate-800'}`}>
                  {!notAssessed && <div className={`h-full ${barColor(cs!.status)}`} style={{ width: `${cs!.score ?? 0}%` }} />}
                </div>
                <span className="w-28 text-right text-[12px] shrink-0 text-slate-400">
                  {notAssessed ? <span className="text-slate-600">Not assessed</span> : <>{cs!.score} · {cs!.label}</>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prioritized fixes */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="font-bold mb-3">Fix these first</h3>
        {report.prioritizedFixes.length === 0 ? (
          <p className="text-sm text-slate-400">
            {hasFindings ? 'Nothing actionable — everything checked is in good shape.' : 'No checks have run against this release yet. As modules are enabled, findings and fixes will appear here.'}
          </p>
        ) : (
          <div className="space-y-3">
            {report.prioritizedFixes.map(f => <FindingCard key={f.id} finding={f} />)}
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-slate-600">
        Checked {new Date(report.generatedAt).toLocaleString()} · engine {report.engineVersion}
        {report.verdict.notAssessed.length > 0 && ' · verdict is capped until all required categories are assessed'}
      </p>
    </div>
  );
}

export default function ReleaseReadiness({
  apiBaseUrl, authToken, initialMetadata, onAuthExpired,
}: {
  apiBaseUrl: string;
  authToken: string;
  initialMetadata?: Partial<{ title: string; artist: string; albumArtist: string; producer: string; copyright: string; genre: string; tags: string }>;
  onAuthExpired?: () => void;
}) {
  const [meta, setMeta] = useState({
    title: initialMetadata?.title || '', artist: initialMetadata?.artist || '',
    albumArtist: initialMetadata?.albumArtist || '', producer: initialMetadata?.producer || '',
    copyright: initialMetadata?.copyright || '', genre: initialMetadata?.genre || '', tags: initialMetadata?.tags || '',
  });
  const [platform, setPlatform] = useState('General');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);

  const set = (k: keyof typeof meta) => (e: React.ChangeEvent<HTMLInputElement>) => setMeta(m => ({ ...m, [k]: e.target.value }));

  const runCheck = async () => {
    setLoading(true); setError(null);
    try {
      const r = await runReadinessCheck(apiBaseUrl, authToken, { title: meta.title, platform, metadata: meta });
      setReport(r);
    } catch (err: any) {
      if (/401/.test(err?.message || '')) { onAuthExpired?.(); return; }
      setError(err?.message || 'Readiness check failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="text-cyan-400" size={22} />
        <div>
          <h1 className="font-bold text-lg">Release readiness</h1>
          <p className="text-xs text-slate-500">Can I safely release this today — and if not, what should I fix first?</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
        <p className="text-sm text-slate-400">Enter the facts about your release, then run a readiness check.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className={LABEL}>Title</label><input className={FIELD} value={meta.title} onChange={set('title')} placeholder="Song title" /></div>
          <div><label className={LABEL}>Artist</label><input className={FIELD} value={meta.artist} onChange={set('artist')} placeholder="Primary artist" /></div>
          <div><label className={LABEL}>Album artist</label><input className={FIELD} value={meta.albumArtist} onChange={set('albumArtist')} placeholder="Album artist" /></div>
          <div><label className={LABEL}>Producer</label><input className={FIELD} value={meta.producer} onChange={set('producer')} placeholder="Producer / label" /></div>
          <div><label className={LABEL}>Copyright</label><input className={FIELD} value={meta.copyright} onChange={set('copyright')} placeholder="© 2026 your name" /></div>
          <div><label className={LABEL}>Genre</label><input className={FIELD} value={meta.genre} onChange={set('genre')} placeholder="e.g. trap" /></div>
          <div><label className={LABEL}>Tags</label><input className={FIELD} value={meta.tags} onChange={set('tags')} placeholder="comma, separated" /></div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Target platform</label>
            <select className={FIELD} value={platform} onChange={e => setPlatform(e.target.value)}>
              {['General', 'YouTube', 'Spotify', 'Apple Music', 'TikTok'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        {error && <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{error}</div>}
        <button onClick={runCheck} disabled={loading}
          className="w-full sm:w-auto px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors">
          {loading ? <><RefreshCw size={15} className="animate-spin" /> Checking…</> : <><ShieldCheck size={15} /> Run readiness check</>}
        </button>
      </div>

      {report && <ReportView report={report} />}
    </div>
  );
}
