import { useMemo, useState } from 'react';
import { PRESETS, getPreset } from './render/presets';
import { tauriRenderEngine } from './render/engine';
import type { RenderJob, RenderResult, RenderStatus } from './render/types';
import { emptyProject, type SongProject } from './project/types';
import {
  pickAudioFile, pickCoverImage, pickOutputDir,
  saveProjectToFile, loadProjectFromFile,
} from './project/storage';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);

const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;
const safeName = (s: string) => (s.replace(/[^a-z0-9-_ ]/gi, '_').trim() || 'song');

export default function App() {
  const [project, setProject] = useState<SongProject>(emptyProject());
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = getPreset(project.presetId) ?? PRESETS[0];
  const update = (patch: Partial<SongProject>) => setProject((p) => ({ ...p, ...patch }));
  const addLog = (line: string) => setLogs((l) => [...l, line]);

  const readiness = useMemo(() => {
    if (!project.coverPath) return { ok: false, why: 'Select cover art.' };
    if (preset.audio && !project.audioPath) return { ok: false, why: 'This preset needs a song audio file.' };
    if (!project.outputDir) return { ok: false, why: 'Choose an output folder.' };
    return { ok: true, why: 'Ready to render.' };
  }, [project, preset]);

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
    if (!readiness.ok || !project.coverPath || !project.outputDir) return;
    setBusy(true);
    setStatus('rendering');
    setResult(null);
    setLogs([]);
    const outputPath = joinPath(project.outputDir, `${safeName(project.title)}_${preset.id}.mp4`);
    const job: RenderJob = {
      presetId: preset.id,
      imagePath: project.coverPath,
      audioPath: preset.audio ? project.audioPath : null,
      title: project.title,
      artist: project.artist,
      outputPath,
    };
    addLog(`[render] ${preset.label} -> ${outputPath}`);
    try {
      const res = await tauriRenderEngine.render(job, addLog);
      setResult(res);
      if (res.ok) { setStatus('success'); addLog(`[render] success (${res.bytes ?? 0} bytes)`); }
      else { setStatus('error'); addLog(`[render] failed: ${res.error}`); }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, error: message });
      setStatus('error');
      addLog(`[render] error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    try { const p = await saveProjectToFile(project); if (p) addLog(`[project] saved -> ${p}`); }
    catch (e) { addLog(`[project] save failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function onLoad() {
    try { const p = await loadProjectFromFile(); if (p) { setProject(p); addLog('[project] loaded'); setStatus('ready'); } }
    catch (e) { addLog(`[project] load failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <div className="app">
      <h1>Song Studio</h1>
      <p className="sub">Turn one song into a vertical promotional video. Song → Assets → Content.</p>

      {!IS_TAURI && (
        <div className="banner">
          Running in a plain browser. File selection and rendering need the desktop runtime —
          launch with <code>npm run tauri dev</code> (requires Rust + FFmpeg). See the README.
        </div>
      )}

      <div className="grid">
        <div className="panel">
          <h2>Song project</h2>
          <label>Song title</label>
          <input type="text" value={project.title} placeholder="e.g. Midnight Drive"
            onChange={(e) => update({ title: e.target.value })} />
          <label>Artist name</label>
          <input type="text" value={project.artist} placeholder="e.g. Triple7"
            onChange={(e) => update({ artist: e.target.value })} />

          <label>Cover art (png / jpg / webp)</label>
          <div className="filerow">
            <div className="path">{basename(project.coverPath) || 'none selected'}</div>
            <button onClick={() => choose('cover')} disabled={!IS_TAURI}>Choose…</button>
          </div>

          <label>Song audio (mp3 / wav / m4a / flac){preset.audio ? '' : ' — optional for this preset'}</label>
          <div className="filerow">
            <div className="path">{basename(project.audioPath) || 'none selected'}</div>
            <button onClick={() => choose('audio')} disabled={!IS_TAURI}>Choose…</button>
          </div>

          <label>Output folder</label>
          <div className="filerow">
            <div className="path">{project.outputDir || 'none selected'}</div>
            <button onClick={() => choose('output')} disabled={!IS_TAURI}>Choose…</button>
          </div>

          <div className="row">
            <button className="ghost" onClick={onSave} disabled={!IS_TAURI}>Save project</button>
            <button className="ghost" onClick={onLoad} disabled={!IS_TAURI}>Open project</button>
          </div>
        </div>

        <div className="panel">
          <h2>Output preset</h2>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.id} className={`preset${p.id === preset.id ? ' selected' : ''}`}
                onClick={() => update({ presetId: p.id })}>
                <div className="ttl">{p.label}</div>
                <div className="desc">{p.description}</div>
                <div className="desc">{p.width}×{p.height} · {p.fps}fps · ≤{p.maxDurationSec}s · {p.audio ? 'audio' : 'silent'}</div>
              </button>
            ))}
          </div>

          <div className="mt">
            <span className={`status ${status}`}>● {status}</span>
            <span className="sub" style={{ marginLeft: 10 }}>{readiness.why}</span>
          </div>

          <div className="row">
            <button className="primary" onClick={render} disabled={!IS_TAURI || busy || !readiness.ok}>
              {busy ? 'Rendering…' : 'Render MP4'}
            </button>
          </div>

          {result?.ok && (
            <div className="result">
              ✅ Exported: <code>{result.outputPath}</code> ({Math.round((result.bytes ?? 0) / 1024)} KB)
            </div>
          )}
          {result && !result.ok && (
            <div className="result" style={{ color: 'var(--err)' }}>⛔ {result.error}</div>
          )}
        </div>
      </div>

      <div className="panel mt">
        <h2>Render log</h2>
        <div className="logs">{logs.length ? logs.join('\n') : 'Logs will appear here.'}</div>
      </div>
    </div>
  );
}
