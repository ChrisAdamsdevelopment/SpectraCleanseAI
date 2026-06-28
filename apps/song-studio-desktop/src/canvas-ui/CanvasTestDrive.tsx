import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { pickCanvasOutputDir, pickCanvasSourceVideo } from '../project/storage';

type CanvasStatus = 'idle' | 'running' | 'success' | 'error';
type CanvasMethod = 'auto' | 'hard-cut' | 'crossfade' | 'ping-pong' | 'frame-blend';

interface CanvasLabResult {
  ok: boolean;
  error?: string;
  report?: Record<string, unknown>;
  reportPath?: string;
  outputPath?: string;
  workspacePath?: string;
  stdout: string;
  stderr: string;
}

interface CanvasSummary {
  bestCandidate?: { timestampSec?: number; loopDurationSec?: number; rank?: number };
  selectedMethod?: string;
  autoRecommendedMethod?: string;
  readiness?: { rating?: string; readinessScore?: number; recommendedMethod?: string; rationale?: string[] };
  export?: { outputPath?: string; ok?: boolean; bytes?: number; method?: string };
  methodComparison?: Array<{ method?: string; outputPath?: string; ok?: boolean; bytes?: number }>;
}

const methodOptions: CanvasMethod[] = ['auto', 'hard-cut', 'crossfade', 'ping-pong', 'frame-blend'];

function asSummary(report: Record<string, unknown> | undefined): CanvasSummary {
  return (report ?? {}) as CanvasSummary;
}

function formatNum(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

export function CanvasTestDrive({ isTauri, onBack }: { isTauri: boolean; onBack: () => void }) {
  const [inputPath, setInputPath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [anchorTimeSec, setAnchorTimeSec] = useState(0);
  const [minDurationSec, setMinDurationSec] = useState(3);
  const [maxDurationSec, setMaxDurationSec] = useState(8);
  const [topN, setTopN] = useState(5);
  const [minSimilarityScore, setMinSimilarityScore] = useState(0.45);
  const [method, setMethod] = useState<CanvasMethod>('auto');
  const [compareMethods, setCompareMethods] = useState(false);
  const [status, setStatus] = useState<CanvasStatus>('idle');
  const [logs, setLogs] = useState<string[]>(['Canvas Test Drive is local-only. Use Tauri dev mode for file picking and FFmpeg execution.']);
  const [result, setResult] = useState<CanvasLabResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const summary = asSummary(result?.report);
  const canRun = isTauri && inputPath && outputDir && status !== 'running';

  async function chooseSource() {
    const path = await pickCanvasSourceVideo();
    if (path) setInputPath(path);
  }

  async function chooseOutput() {
    const path = await pickCanvasOutputDir();
    if (path) setOutputDir(path);
  }

  async function copyPath(label: string, path?: string) {
    if (!path) return;
    await navigator.clipboard.writeText(path);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1400);
  }

  async function run() {
    if (!canRun) return;
    setStatus('running');
    setResult(null);
    setLogs([
      '[canvas] starting local Canvas lab via Tauri command',
      `[canvas] input: ${inputPath}`,
      `[canvas] output: ${outputDir}`,
      `[canvas] method: ${method}${compareMethods ? ' · compare methods' : ''}`,
    ]);
    try {
      const response = await invoke<CanvasLabResult>('run_canvas_lab', {
        options: { inputPath, outputDir, anchorTimeSec, minDurationSec, maxDurationSec, topN, minSimilarityScore, method, compareMethods },
      });
      setResult(response);
      setStatus(response.ok ? 'success' : 'error');
      setLogs((prev) => [...prev, response.ok ? '[canvas] success' : `[canvas] failed: ${response.error ?? 'unknown error'}`, response.stderr, response.stdout].filter(Boolean));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('error');
      setResult({ ok: false, error: message, stdout: '', stderr: '' });
      setLogs((prev) => [...prev, `[canvas] error: ${message}`]);
    }
  }

  return (
    <div className="studio canvas-drive">
      <div className="topbar">
        <div className="brand">Song Studio</div>
        <span className="canvas-pill">Internal · local-only Canvas Test Drive</span>
        <div className="spacer" />
        <button className="ghost small" onClick={onBack}>← Back to Song Studio</button>
      </div>
      {!isTauri && <div className="banner warn">Canvas Test Drive needs desktop mode: <code>npm run tauri dev</code>. Browser preview cannot pick files or run FFmpeg.</div>}
      <div className="canvas-drive-main">
        <section className="canvas-panel">
          <div className="canvas-panel-head"><span>1</span><div><h2>Load a local video</h2><p>No uploads, no cloud, no paid AI/provider calls. This runs the existing local Canvas lab.</p></div></div>
          <div className="path-row"><button className="primary" onClick={chooseSource} disabled={!isTauri || status === 'running'}>Pick source video</button><code title={inputPath}>{inputPath || 'mp4, mov, m4v, webm'}</code></div>
          <div className="path-row"><button className="primary" onClick={chooseOutput} disabled={!isTauri || status === 'running'}>Pick output folder</button><code title={outputDir}>{outputDir || 'Choose a local workspace/output folder'}</code></div>
        </section>

        <section className="canvas-panel">
          <div className="canvas-panel-head"><span>2</span><div><h2>Controls</h2><p>Small practical controls for judging whether the current loop engine is useful.</p></div></div>
          <div className="canvas-controls-grid">
            <NumberField label="Anchor time seconds" value={anchorTimeSec} onChange={setAnchorTimeSec} step={0.1} />
            <NumberField label="Min duration" value={minDurationSec} onChange={setMinDurationSec} step={0.1} />
            <NumberField label="Max duration" value={maxDurationSec} onChange={setMaxDurationSec} step={0.1} />
            <NumberField label="Top N" value={topN} onChange={setTopN} step={1} />
            <NumberField label="Min similarity" value={minSimilarityScore} onChange={setMinSimilarityScore} step={0.01} />
            <label className="canvas-field"><span>Method</span><select value={method} onChange={(e) => setMethod(e.target.value as CanvasMethod)}>{methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          </div>
          <label className="canvas-check"><input type="checkbox" checked={compareMethods} onChange={(e) => setCompareMethods(e.target.checked)} /> Compare all repair methods</label>
          <button className="primary canvas-run" onClick={run} disabled={!canRun}>{status === 'running' ? 'Running Canvas…' : 'Run Canvas Test Drive'}</button>
        </section>

        <section className="canvas-panel canvas-results">
          <div className="canvas-panel-head"><span>3</span><div><h2>Results</h2><p>Status, report path, best candidate, readiness, and output files from the local run.</p></div></div>
          <span className={`status ${status === 'running' ? 'rendering' : status}`}>● {status}</span>
          <div className="canvas-result-grid">
            <ResultPath label="Report" path={result?.reportPath} copied={copied} onCopy={copyPath} />
            <ResultPath label="Workspace" path={result?.workspacePath} copied={copied} onCopy={copyPath} />
            <ResultPath label="Primary output" path={result?.outputPath ?? summary.export?.outputPath} copied={copied} onCopy={copyPath} />
          </div>
          {result?.report && <div className="canvas-summary">
            <div><span>Best candidate</span><b>{summary.bestCandidate ? `${formatNum(summary.bestCandidate.timestampSec)}s · ${formatNum(summary.bestCandidate.loopDurationSec)}s loop · rank ${summary.bestCandidate.rank ?? '—'}` : '—'}</b></div>
            <div><span>Recommended method</span><b>{summary.autoRecommendedMethod ?? summary.readiness?.recommendedMethod ?? '—'}</b></div>
            <div><span>Selected method</span><b>{summary.selectedMethod ?? summary.export?.method ?? '—'}</b></div>
            <div><span>Readiness</span><b>{summary.readiness?.rating ?? '—'} {typeof summary.readiness?.readinessScore === 'number' ? `(${summary.readiness.readinessScore})` : ''}</b></div>
          </div>}
          {!!summary.methodComparison?.length && <div className="method-list"><h3>Method comparison outputs</h3>{summary.methodComparison.map((item) => <ResultPath key={item.method} label={`${item.method} ${item.ok ? '✓' : 'failed'}`} path={item.outputPath} copied={copied} onCopy={copyPath} />)}</div>}
          {result?.error && <div className="export-notice blocker">{result.error}</div>}
          <div className="logs canvas-log">{logs.join('\n\n') || 'Logs will appear here.'}</div>
        </section>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, step }: { label: string; value: number; onChange: (value: number) => void; step: number }) {
  return <label className="canvas-field"><span>{label}</span><input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function ResultPath({ label, path, copied, onCopy }: { label: string; path?: string; copied: string | null; onCopy: (label: string, path?: string) => void }) {
  return <div className="output-path canvas-output"><span title={path}><b>{label}:</b> {path || '—'}</span>{path && 'clipboard' in navigator && <button className="ghost small" onClick={() => onCopy(label, path)}>{copied === label ? 'Copied' : 'Copy path'}</button>}</div>;
}
