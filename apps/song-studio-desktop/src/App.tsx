import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CREATIVE_FUNCTIONS, getFunction, getRecipe, recipesForFunction } from './render/recipes';
import { getTemplate } from './render/templates';
import { recipeToComposition, updateLayer, getLayer, LAYER_LABELS } from './render/composition';
import { tauriRenderEngine, getFfmpegStatus } from './render/engine';
import type { RenderJob, RenderResult, RenderStatus, FfmpegStatus, Composition, Layer } from './render/types';
import { buildRenderPlan } from './render/plan';
import { emptyProject, type SongProject } from './project/types';
import { formatTime } from './lib/time';
import { pickAudioFile, pickCoverImage, pickOutputDir, saveProjectToFile, loadProjectFromFile } from './project/storage';
import { Preview } from './ui/Preview';
import { Inspector } from './ui/Inspector';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;

function compositionFor(project: SongProject): Composition {
  const recipe = getRecipe(project.recipeId) ?? getRecipe('clean_canvas')!;
  return recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: project.title });
}

export default function App() {
  const [project, setProject] = useState<SongProject>(emptyProject());
  const [composition, setComposition] = useState<Composition>(() => compositionFor(emptyProject()));
  const [selectedId, setSelectedId] = useState<string>('cover_art');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);

  const fn = getFunction(project.functionId);
  const styleOptions = useMemo(() => (fn ? recipesForFunction(fn) : []), [fn]);
  const plan = useMemo(() => buildRenderPlan(project), [project]);
  const coverSrc = IS_TAURI && project.coverPath ? safeConvert(project.coverPath) : null;
  const selectedLayer = getLayer(composition, selectedId);

  const update = (patch: Partial<SongProject>) => setProject((p) => ({ ...p, ...patch }));
  const addLog = (line: string) => setLogs((l) => [...l, line]);

  useEffect(() => {
    if (!IS_TAURI) return;
    getFfmpegStatus().then(setFfmpeg).catch(() => setFfmpeg(null));
  }, []);

  // Applying a function/style rebuilds the editable composition (a starting point).
  function applyRecipe(functionId: string, recipeId: string) {
    const f = getFunction(functionId);
    const recipe = getRecipe(recipeId);
    if (!f || !recipe) return;
    const next: SongProject = {
      ...project,
      functionId,
      recipeId,
      clipDuration: String(recipe.defaultDurationSec),
      clipStart: f.audio ? project.clipStart : '0:00',
    };
    setProject(next);
    setComposition(recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: next.title }));
    setSelectedId('cover_art');
    if (status === 'idle') setStatus('ready');
  }

  function setTitle(text: string) {
    update({ title: text });
    setComposition((c) => updateLayer(c, 'title_text', { text, visible: text.length > 0 }));
  }

  function onInspectorChange(patch: Partial<Layer>) {
    setComposition((c) => updateLayer(c, selectedId, patch));
    if (selectedId === 'title_text' && typeof (patch as { text?: string }).text === 'string') {
      update({ title: (patch as { text: string }).text });
    }
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
      composition, // render the edited composition
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
    try {
      const p = await loadProjectFromFile();
      if (p) { const merged = { ...emptyProject(), ...p }; setProject(merged); setComposition(compositionFor(merged)); addLog('[project] loaded'); setStatus('ready'); }
    } catch (e) { addLog(`[project] load failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <div className="app">
      <header>
        <h1>Song Studio</h1>
        <p className="sub">You finished the song. Now make the content. Song → Assets → Content.</p>
      </header>

      {!IS_TAURI && (
        <div className="banner warn">Running in a plain browser. File selection and rendering need <code>npm run tauri dev</code>. The preview still works.</div>
      )}
      {IS_TAURI && ffmpeg && (
        <div className={`banner ${ffmpeg.found ? 'ok' : 'err'}`}>
          FFmpeg: {ffmpeg.found ? 'ready' : 'NOT FOUND'} · <code>{ffmpeg.path || '(none)'}</code> <span className="muted">({ffmpeg.source})</span>
        </div>
      )}

      {/* Project + assets */}
      <section className="panel">
        <h2>1 · Song project</h2>
        <div className="two">
          <div><label>Song title</label><input type="text" value={project.title} placeholder="e.g. Del Trap Al Trono" onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label>Artist name</label><input type="text" value={project.artist} placeholder="e.g. Triple7" onChange={(e) => update({ artist: e.target.value })} /></div>
        </div>
        <div className="three">
          <FileField label="Cover art" value={basename(project.coverPath)} onPick={() => choose('cover')} />
          <FileField label="Song audio" value={basename(project.audioPath)} onPick={() => choose('audio')} />
          <FileField label="Output folder" value={project.outputDir} onPick={() => choose('output')} />
        </div>
        <div className="row"><button className="ghost" onClick={onSave} disabled={!IS_TAURI}>Save project</button><button className="ghost" onClick={onLoad} disabled={!IS_TAURI}>Open project</button></div>
      </section>

      {/* What to make + style */}
      <section className="panel">
        <h2>2 · What do you want to make?</h2>
        <div className="cards">
          {CREATIVE_FUNCTIONS.map((f) => (
            <button key={f.id} className={`card${f.id === project.functionId ? ' selected' : ''}`} onClick={() => applyRecipe(f.id, f.defaultRecipeId)}>
              <div className="ttl">{f.label}</div><div className="desc">{f.description}</div><div className="tag">{f.audio ? 'uses song audio' : 'silent loop'}</div>
            </button>
          ))}
        </div>
        <h2 style={{ marginTop: 16 }}>3 · Style (starting point — fully editable)</h2>
        <div className="cards">
          {styleOptions.map((r) => (
            <button key={r.id} className={`card${r.id === project.recipeId ? ' selected' : ''}`} onClick={() => applyRecipe(project.functionId, r.id)}>
              <div className="ttl">{r.name}</div><div className="desc">{r.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Composer: layers | preview | inspector */}
      <section className="panel composer">
        <h2>4 · Compose (live preview)</h2>
        <div className="composer-grid">
          <div className="layers">
            {composition.layers.map((l) => (
              <button key={l.id} className={`layer${l.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(l.id)}>
                <span className={`dot${l.visible ? ' on' : ''}`} />
                {LAYER_LABELS[l.type] ?? l.type}
              </button>
            ))}
          </div>
          <div className="preview-wrap">
            <Preview composition={composition} coverSrc={coverSrc} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="muted small">Live approximation — final MP4 is rendered by FFmpeg.</div>
          </div>
          <Inspector layer={selectedLayer} onChange={onInspectorChange} />
        </div>
      </section>

      {/* Clip + summary + render */}
      <section className="panel">
        <h2>5 · Clip & export</h2>
        <div className="three">
          {plan.audio && (
            <div><label>Clip start (sec or m:ss)</label><input type="text" value={project.clipStart} placeholder="0:42" onChange={(e) => update({ clipStart: e.target.value })} /></div>
          )}
          <div><label>Duration (3–60s)</label><input type="text" value={project.clipDuration} placeholder="15" onChange={(e) => update({ clipDuration: e.target.value })} /></div>
        </div>
        {plan.ok ? (
          <ul className="summary-list">
            <li><b>Output:</b> {plan.width}×{plan.height} MP4 · {plan.durationSec}s · {plan.audio ? `audio ${formatTime(plan.audioStartSec)}–${formatTime(plan.audioEndSec)}` : 'silent'}</li>
            <li><b>File:</b> <code>{plan.outputName}</code></li>
          </ul>
        ) : (
          <ul className="summary-list errs">{plan.errors.map((e) => <li key={e}>• {e}</li>)}</ul>
        )}
        <div className="row">
          <span className={`status ${status}`}>● {status}</span>
          <button className="primary" onClick={render} disabled={!IS_TAURI || busy || !plan.ok}>{busy ? 'Rendering…' : 'Render MP4'}</button>
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
      <div className="filerow"><div className="path">{value || 'none selected'}</div><button onClick={onPick} disabled={!IS_TAURI}>Choose…</button></div>
    </div>
  );
}
function safeConvert(path: string): string | null {
  try { return convertFileSrc(path); } catch { return null; }
}
