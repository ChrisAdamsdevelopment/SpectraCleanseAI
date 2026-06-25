import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CREATIVE_FUNCTIONS, getFunction, getRecipe, recipesForFunction } from './render/recipes';
import { tauriRenderEngine, getFfmpegStatus } from './render/engine';
import type { RenderJob, RenderResult, RenderStatus, FfmpegStatus } from './render/types';
import { buildRenderPlan } from './render/plan';
import { emptyProject, type SongProject } from './project/types';
import { formatTime } from './lib/time';
import {
  pickAudioFile, pickCoverImage, pickOutputDir,
  saveProjectToFile, loadProjectFromFile,
} from './project/storage';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;

export default function App() {
  const [project, setProject] = useState<SongProject>(emptyProject());
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);

  const fn = getFunction(project.functionId);
  const styleOptions = useMemo(() => (fn ? recipesForFunction(fn) : []), [fn]);
  const plan = useMemo(() => buildRenderPlan(project), [project]);
  const update = (patch: Partial<SongProject>) => setProject((p) => ({ ...p, ...patch }));
  const addLog = (line: string) => setLogs((l) => [...l, line]);

  useEffect(() => {
    if (!IS_TAURI) return;
    getFfmpegStatus().then(setFfmpeg).catch(() => setFfmpeg(null));
  }, []);

  function chooseFunction(id: string) {
    const f = getFunction(id);
    if (!f) return;
    const recipe = getRecipe(f.defaultRecipeId);
    update({
      functionId: f.id,
      recipeId: f.defaultRecipeId,
      clipDuration: String(recipe?.defaultDurationSec ?? 6),
      clipStart: f.audio ? project.clipStart : '0:00',
    });
    if (status === 'idle') setStatus('ready');
  }

  function chooseRecipe(id: string) {
    const recipe = getRecipe(id);
    update({ recipeId: id, clipDuration: String(recipe?.defaultDurationSec ?? (Number(project.clipDuration) || 6)) });
  }

  async function choose(kind: 'audio' | 'cover' | 'output') {
    try {
      if (kind === 'audio') { const p = await pickAudioFile(); if (p) update({ audioPath: p }); }
      if (kind === 'cover') { const p = await pickCoverImage(); if (p) update({ coverPath: p }); }
      if (kind === 'output') { const p = await pickOutputDir(); if (p) update({ outputDir: p }); }
      if (status === 'idle') setStatus('ready');
    } catch (e) {
      addLog(`[error] file selection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function render() {
    if (!plan.ok || !project.coverPath || !project.outputDir) return;
    setBusy(true); setStatus('rendering'); setResult(null); setLogs([]);
    const outputPath = joinPath(project.outputDir, plan.outputName);
    const job: RenderJob = {
      recipeId: project.recipeId,
      functionId: project.functionId,
      imagePath: project.coverPath,
      audioPath: plan.audio ? project.audioPath : null,
      title: project.title,
      artist: project.artist,
      outputPath,
      durationSec: plan.durationSec,
      audioStartSec: plan.audioStartSec,
    };
    addLog(`[render] ${plan.functionLabel} · ${plan.recipeName} -> ${outputPath}`);
    try {
      const res = await tauriRenderEngine.render(job, addLog);
      setResult(res);
      setStatus(res.ok ? 'success' : 'error');
      addLog(res.ok ? `[render] success (${res.bytes ?? 0} bytes)` : `[render] failed: ${res.error}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, error: message }); setStatus('error'); addLog(`[render] error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    try { const p = await saveProjectToFile(project); if (p) addLog(`[project] saved -> ${p}`); }
    catch (e) { addLog(`[project] save failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function onLoad() {
    try { const p = await loadProjectFromFile(); if (p) { setProject({ ...emptyProject(), ...p }); addLog('[project] loaded'); setStatus('ready'); } }
    catch (e) { addLog(`[project] load failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const audioSrc = IS_TAURI && project.audioPath ? safeConvert(project.audioPath) : null;

  return (
    <div className="app">
      <header>
        <h1>Song Studio</h1>
        <p className="sub">You finished the song. Now make the content. Song → Assets → Content.</p>
      </header>

      {!IS_TAURI && (
        <div className="banner warn">
          Running in a plain browser. File selection and rendering need the desktop runtime —
          launch with <code>npm run tauri dev</code>. See the README.
        </div>
      )}
      {IS_TAURI && ffmpeg && (
        <div className={`banner ${ffmpeg.found ? 'ok' : 'err'}`}>
          FFmpeg: {ffmpeg.found ? 'ready' : 'NOT FOUND'} · <code>{ffmpeg.path || '(none)'}</code> <span className="muted">({ffmpeg.source})</span>
          {!ffmpeg.found && <> — install FFmpeg or set <code>SONG_STUDIO_FFMPEG</code>.</>}
        </div>
      )}

      {/* 1 + 2: Song project + assets */}
      <section className="panel">
        <h2>1 · Song project</h2>
        <div className="two">
          <div>
            <label>Song title</label>
            <input type="text" value={project.title} placeholder="e.g. Del Trap Al Trono"
              onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div>
            <label>Artist name</label>
            <input type="text" value={project.artist} placeholder="e.g. Triple7"
              onChange={(e) => update({ artist: e.target.value })} />
          </div>
        </div>
        <div className="three">
          <FileField label="Cover art (png/jpg/webp)" value={basename(project.coverPath)} onPick={() => choose('cover')} />
          <FileField label="Song audio (mp3/wav/m4a/flac)" value={basename(project.audioPath)} onPick={() => choose('audio')} />
          <FileField label="Output folder" value={project.outputDir} onPick={() => choose('output')} />
        </div>
        <div className="row">
          <button className="ghost" onClick={onSave} disabled={!IS_TAURI}>Save project</button>
          <button className="ghost" onClick={onLoad} disabled={!IS_TAURI}>Open project</button>
        </div>
      </section>

      {/* 3: What to make */}
      <section className="panel">
        <h2>2 · What do you want to make?</h2>
        <div className="cards">
          {CREATIVE_FUNCTIONS.map((f) => (
            <button key={f.id} className={`card${f.id === project.functionId ? ' selected' : ''}`} onClick={() => chooseFunction(f.id)}>
              <div className="ttl">{f.label}</div>
              <div className="desc">{f.description}</div>
              <div className="tag">{f.audio ? 'uses song audio' : 'silent loop'}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 4: Style / preset */}
      <section className="panel">
        <h2>3 · Style</h2>
        <div className="cards">
          {styleOptions.map((r) => (
            <button key={r.id} className={`card${r.id === project.recipeId ? ' selected' : ''}`} onClick={() => chooseRecipe(r.id)}>
              <div className="ttl">{r.name}</div>
              <div className="desc">{r.description}</div>
              <div className="tag">{r.platformTargets.join(' · ')} · {r.colorMood}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 5: Clip selection + audio info */}
      <section className="panel">
        <h2>4 · Clip selection</h2>
        <div className="three">
          {plan.audio && (
            <div>
              <label>Clip start (seconds or m:ss)</label>
              <input type="text" value={project.clipStart} placeholder="0:42" onChange={(e) => update({ clipStart: e.target.value })} />
            </div>
          )}
          <div>
            <label>Duration (seconds, 3–60)</label>
            <input type="text" value={project.clipDuration} placeholder="15" onChange={(e) => update({ clipDuration: e.target.value })} />
          </div>
        </div>
        <div className="audioinfo">
          <div><span className="muted">Audio file:</span> {basename(project.audioPath) || '—'} {plan.audio ? '(required)' : '(not used by this function)'}</div>
          {plan.audio && <div><span className="muted">Section:</span> {formatTime(plan.audioStartSec)}–{formatTime(plan.audioEndSec)} ({plan.durationSec}s)</div>}
          {audioSrc && (
            <audio controls src={audioSrc} className="audioel">your browser cannot preview this audio</audio>
          )}
        </div>
      </section>

      {/* 6: Export summary */}
      <section className="panel summary">
        <h2>5 · What will be created</h2>
        {plan.ok ? (
          <ul>
            <li><b>Function:</b> {plan.functionLabel}</li>
            <li><b>Style:</b> {plan.recipeName} ({plan.templateLabel})</li>
            <li><b>Output:</b> {plan.width}×{plan.height} MP4 · {plan.durationSec}s · {plan.audio ? 'with audio' : 'silent'}</li>
            {plan.audio && <li><b>Audio section:</b> {formatTime(plan.audioStartSec)}–{formatTime(plan.audioEndSec)}</li>}
            <li><b>Visual:</b> {plan.visualSummary}</li>
            <li><b>File:</b> <code>{plan.outputName}</code></li>
          </ul>
        ) : (
          <ul className="errs">{plan.errors.map((e) => <li key={e}>• {e}</li>)}</ul>
        )}
        <div className="row">
          <span className={`status ${status}`}>● {status}</span>
          <button className="primary" onClick={render} disabled={!IS_TAURI || busy || !plan.ok}>
            {busy ? 'Rendering…' : 'Render MP4'}
          </button>
        </div>
        {result?.ok && <div className="result">✅ Exported: <code>{result.outputPath}</code> ({Math.round((result.bytes ?? 0) / 1024)} KB)</div>}
        {result && !result.ok && <div className="result err">⛔ {result.error}</div>}
      </section>

      <section className="panel">
        <h2>Render log</h2>
        <div className="logs">{logs.length ? logs.join('\n') : 'Logs will appear here.'}</div>
      </section>
    </div>
  );
}

function FileField({ label, value, onPick }: { label: string; value: string | null; onPick: () => void }) {
  return (
    <div>
      <label>{label}</label>
      <div className="filerow">
        <div className="path">{value || 'none selected'}</div>
        <button onClick={onPick} disabled={!IS_TAURI}>Choose…</button>
      </div>
    </div>
  );
}

function safeConvert(path: string): string | null {
  try { return convertFileSrc(path); } catch { return null; }
}
