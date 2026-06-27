import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CREATIVE_FUNCTIONS, getFunction, getRecipe, recipesForFunction } from './render/recipes';
import { getTemplate } from './render/templates';
import { recipeToComposition, updateLayer, getLayer, LAYER_LABELS } from './render/composition';
import { tauriRenderEngine, getFfmpegStatus } from './render/engine';
import type { RenderJob, RenderResult, RenderStatus, FfmpegStatus, Composition, Layer } from './render/types';
import { buildRenderPlan } from './render/plan';
import { emptyProject, type SongProject } from './project/types';
import { formatTime, parseTime } from './lib/time';
import { pickAudioFile, pickCoverImage, pickOutputDir, saveProjectToFile, loadProjectFromFile } from './project/storage';
import { Preview } from './ui/Preview';
import { Inspector, type InspectorMode } from './ui/Inspector';
import { AudioPanel } from './ui/AudioPanel';
import { buildSongAnalysis } from './audio/songMoments';
import type { SongMoment } from './project/types';
import { StartScreen } from './ui/StartScreen';
import { buildPromoDirectionCandidates, promoDirectionRecipeLabel, type PromoDirectionCandidate } from './promo/directions';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;
const safeConvert = (path: string): string | null => { try { return convertFileSrc(path); } catch { return null; } };

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
  const [showLogs, setShowLogs] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [view, setView] = useState<'start' | 'editor'>('start');
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('simple');

  const fn = getFunction(project.functionId);
  const styleOptions = useMemo(() => (fn ? recipesForFunction(fn) : []), [fn]);
  const plan = useMemo(() => buildRenderPlan(project), [project]);
  const promoDirections = useMemo(() => buildPromoDirectionCandidates(project), [project]);
  const coverSrc = IS_TAURI && project.coverPath ? safeConvert(project.coverPath) : null;
  const audioSrc = IS_TAURI && project.audioPath ? safeConvert(project.audioPath) : null;
  const selectedLayer = getLayer(composition, selectedId);

  const update = (patch: Partial<SongProject>) => setProject((p) => ({ ...p, ...patch }));
  const updateManualClip = (patch: Partial<Pick<SongProject, 'clipStart' | 'clipDuration'>>) => update({ ...patch, selectedMomentId: null });
  const addLog = (line: string) => setLogs((l) => [...l, line]);

  useEffect(() => { if (IS_TAURI) getFfmpegStatus().then(setFfmpeg).catch(() => setFfmpeg(null)); }, []);

  function applyRecipe(functionId: string, recipeId: string) {
    const f = getFunction(functionId); const recipe = getRecipe(recipeId);
    if (!f || !recipe) return;
    const next: SongProject = { ...project, functionId, recipeId, selectedPromoDirectionId: null, clipDuration: String(recipe.defaultDurationSec), clipStart: f.audio ? project.clipStart : '0:00' };
    setProject(next);
    setComposition(recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: next.title }));
    setSelectedId('cover_art');
    if (status === 'idle') setStatus('ready');
  }
  function startMake(functionId: string) {
    const f = getFunction(functionId);
    if (f) applyRecipe(functionId, f.defaultRecipeId);
    setView('editor');
  }

  function applyPromoDirection(candidate: PromoDirectionCandidate) {
    const f = getFunction(candidate.functionId); const recipe = getRecipe(candidate.recipeId);
    if (!f || !recipe) return;
    const clipStart = f.audio ? (candidate.clipStart ?? project.clipStart) : '0:00';
    const clipDuration = f.audio ? (candidate.clipDuration ?? project.clipDuration) : String(recipe.defaultDurationSec);
    const next: SongProject = {
      ...project,
      functionId: candidate.functionId,
      recipeId: candidate.recipeId,
      clipStart,
      clipDuration,
      selectedMomentId: candidate.momentId ?? project.selectedMomentId,
      selectedPromoDirectionId: candidate.id,
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
  function onAudioMetadata(durationSec: number) {
    if (!project.audioPath) return;
    const analysis = buildSongAnalysis({
      audioPath: project.audioPath,
      durationSec,
      manualStartSec: parseTime(project.clipStart),
      manualDurationSec: parseTime(project.clipDuration),
      selectedMomentId: project.selectedMomentId,
    });
    update({ songAnalysis: analysis });
  }
  function selectMoment(moment: SongMoment) {
    update({
      selectedPromoDirectionId: null,
      selectedMomentId: moment.id,
      songAnalysis: project.songAnalysis ? { ...project.songAnalysis, selectedMomentId: moment.id } : project.songAnalysis,
      clipStart: formatTime(moment.startSec),
      clipDuration: String(moment.durationSec),
    });
  }
  function onInspectorChange(patch: Partial<Layer>) {
    setComposition((c) => updateLayer(c, selectedId, patch));
    if (selectedId === 'title_text' && typeof (patch as { text?: string }).text === 'string') update({ title: (patch as { text: string }).text });
  }
  function onMove(id: string, x: number, y: number) {
    setComposition((c) => updateLayer(c, id, { x, y } as Partial<Layer>));
  }
  async function choose(kind: 'audio' | 'cover' | 'output') {
    try {
      if (kind === 'audio') { const p = await pickAudioFile(); if (p) update({ audioPath: p, selectedMomentId: null, songAnalysis: null }); }
      if (kind === 'cover') { const p = await pickCoverImage(); if (p) update({ coverPath: p }); }
      if (kind === 'output') { const p = await pickOutputDir(); if (p) update({ outputDir: p }); }
      if (status === 'idle') setStatus('ready');
    } catch (e) { addLog(`[error] file selection failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function render() {
    if (!plan.ok || !project.coverPath || !project.outputDir) return;
    setBusy(true); setStatus('rendering'); setResult(null); setLogs([]); setShowLogs(true);
    const outputPath = joinPath(project.outputDir, plan.outputName);
    const job: RenderJob = {
      recipeId: project.recipeId, functionId: project.functionId, imagePath: project.coverPath,
      audioPath: plan.audio ? project.audioPath : null, title: project.title, artist: project.artist,
      outputPath, durationSec: plan.durationSec, audioStartSec: plan.audioStartSec, composition,
    };
    addLog(`[render] ${plan.functionLabel} · ${plan.recipeName} -> ${outputPath}`);
    try {
      const res = await tauriRenderEngine.render(job, addLog);
      setResult(res); setStatus(res.ok ? 'success' : 'error');
      addLog(res.ok ? `[render] success (${res.bytes ?? 0} bytes)` : `[render] failed: ${res.error}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, error: m }); setStatus('error'); addLog(`[render] error: ${m}`);
    } finally { setBusy(false); }
  }
  async function onSave() { try { const p = await saveProjectToFile(project); if (p) addLog(`[project] saved -> ${p}`); } catch (e) { addLog(`save failed: ${e}`); } }
  async function onLoad() {
    try { const p = await loadProjectFromFile(); if (p) { const m = { ...emptyProject(), ...p }; setProject(m); setComposition(compositionFor(m)); setStatus('ready'); setView('editor'); } }
    catch (e) { addLog(`load failed: ${e}`); }
  }

  if (view === 'start') {
    return (
      <StartScreen
        isTauri={IS_TAURI} coverSrc={coverSrc} coverName={basename(project.coverPath)} audioName={basename(project.audioPath)}
        onPickCover={() => choose('cover')} onPickAudio={() => choose('audio')}
        onStart={startMake} onOpenProject={onLoad} onSkip={() => setView('editor')}
      />
    );
  }

  return (
    <div className="studio">
      {/* Top project bar */}
      <div className="topbar">
        <div className="brand">Song Studio</div>
        <input className="t-title" type="text" value={project.title} placeholder="Song title" onChange={(e) => setTitle(e.target.value)} />
        <input className="t-artist" type="text" value={project.artist} placeholder="Artist" onChange={(e) => update({ artist: e.target.value })} />
        <Chip ok={!!project.coverPath} label={project.coverPath ? 'Cover ✓' : 'Cover'} onClick={() => choose('cover')} />
        <Chip ok={!!project.audioPath} label={project.audioPath ? 'Audio ✓' : 'Audio'} onClick={() => choose('audio')} />
        <Chip ok={!!project.outputDir} label={project.outputDir ? 'Output ✓' : 'Output'} onClick={() => choose('output')} />
        <div className="spacer" />
        {IS_TAURI && ffmpeg && <span className={`ff ${ffmpeg.found ? 'ok' : 'err'}`}>FFmpeg {ffmpeg.found ? 'ready' : 'missing'}</span>}
        <button className="ghost small" onClick={() => setView('start')}>← Start</button>
        <button className="ghost small" onClick={onSave} disabled={!IS_TAURI}>Save</button>
      </div>

      {!IS_TAURI && <div className="banner warn">Preview works in the browser, but file selection + rendering need <code>npm run tauri dev</code>.</div>}

      {/* Main 3-column workspace */}
      <div className="main">
        <div className="left">
          <h3>Directions</h3>
          <div className="direction-panel">
            {!project.audioPath && !project.coverPath ? (
              <div className="direction-empty">Add a finished song and cover art to get direction recommendations.</div>
            ) : (
              promoDirections.map((candidate) => (
                <button key={candidate.id} className={`direction-card${candidate.id === project.selectedPromoDirectionId ? ' selected' : ''}`} onClick={() => applyPromoDirection(candidate)}>
                  <span className="direction-top"><b>{candidate.label}</b><span>{Math.round(candidate.fit * 100)}% fit</span></span>
                  <span className="direction-purpose">{candidate.purpose}</span>
                  <span className="direction-recipe">{promoDirectionRecipeLabel(candidate)}</span>
                  <span className="direction-reason">{candidate.reason}</span>
                  {candidate.warnings.length > 0 && <span className="direction-warning">{candidate.warnings[0]}</span>}
                  <span className="direction-source">{candidate.id === project.selectedPromoDirectionId ? 'Using this direction' : 'Audition direction'}</span>
                </button>
              ))
            )}
          </div>
          <h3>Manual fallback</h3>
          {CREATIVE_FUNCTIONS.map((f) => (
            <button key={f.id} className={`opt${f.id === project.functionId ? ' selected' : ''}`} onClick={() => applyRecipe(f.id, f.defaultRecipeId)}>
              <b>{f.label}</b><span>{f.audio ? 'uses audio' : 'silent'}</span>
            </button>
          ))}
          <h3>Style</h3>
          {styleOptions.map((r) => (
            <button key={r.id} className={`opt${r.id === project.recipeId ? ' selected' : ''}`} onClick={() => applyRecipe(project.functionId, r.id)}>
              <b>{r.name}</b><span>{r.colorMood}</span>
            </button>
          ))}
          <h3>Layers</h3>
          {composition.layers.map((l) => (
            <button key={l.id} className={`layer${l.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(l.id)}>
              <span className={`dot${l.visible ? ' on' : ''}`} />{LAYER_LABELS[l.type] ?? l.type}
            </button>
          ))}
        </div>

        <div className="center">
          <Preview composition={composition} coverSrc={coverSrc} selectedId={selectedId} onSelect={setSelectedId} onMove={onMove} />
          <div className="muted small">Click a layer to edit it · drag the cover or title to move it · final MP4 is rendered by FFmpeg.</div>
          <AudioPanel
            audioSrc={audioSrc}
            audioName={basename(project.audioPath)}
            required={plan.audio}
            analysis={project.songAnalysis}
            selectedMomentId={project.selectedMomentId}
            onMetadata={onAudioMetadata}
            onSelectMoment={selectMoment}
            onUseCurrentTime={(s) => updateManualClip({ clipStart: formatTime(s) })}
          />
        </div>

        <div className="right">
          <div className="mode-toggle">
            <button className={inspectorMode === 'simple' ? 'on' : ''} onClick={() => setInspectorMode('simple')}>Simple</button>
            <button className={inspectorMode === 'advanced' ? 'on' : ''} onClick={() => setInspectorMode('advanced')}>Advanced</button>
          </div>
          <Inspector layer={selectedLayer} mode={inspectorMode} onChange={onInspectorChange} />
        </div>
      </div>

      {/* Bottom clip + export + logs */}
      <div className="bottom">
        <div className="clip">
          {plan.audio && <Field label="Clip start" value={project.clipStart} onChange={(v) => updateManualClip({ clipStart: v })} />}
          <Field label="Duration (s)" value={project.clipDuration} onChange={(v) => updateManualClip({ clipDuration: v })} />
          <div className="grow">
            {plan.ok
              ? <span className="muted small">{plan.width}×{plan.height} · {plan.durationSec}s · {plan.audio ? `${formatTime(plan.audioStartSec)}–${formatTime(plan.audioEndSec)}` : 'silent'} · {plan.outputName}</span>
              : <span className="warn small">{plan.errors[0]}</span>}
          </div>
          <span className={`status ${status}`}>● {status}</span>
          <button className="primary" onClick={render} disabled={!IS_TAURI || busy || !plan.ok}>{busy ? 'Rendering…' : 'Render MP4'}</button>
          <button className="ghost small" onClick={() => setShowLogs((v) => !v)}>{showLogs ? 'Hide log' : 'Log'}</button>
        </div>
        {result?.ok && <div className="result small">✅ {result.outputPath} ({Math.round((result.bytes ?? 0) / 1024)} KB)</div>}
        {result && !result.ok && <div className="result err small">⛔ {result.error}</div>}
        {showLogs && <div className="logs">{logs.length ? logs.join('\n') : 'Logs will appear here.'}</div>}
      </div>
    </div>
  );
}

function Chip({ ok, label, onClick }: { ok: boolean; label: string; onClick: () => void }) {
  return <button className={`chip${ok ? ' ok' : ''}`} onClick={onClick} disabled={!IS_TAURI}>{label}</button>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
