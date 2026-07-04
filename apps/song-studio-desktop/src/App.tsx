import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CREATIVE_FUNCTIONS, getFunction, getRecipe, recipesForFunction } from './render/recipes';
import { getTemplate } from './render/templates';
import { recipeToComposition, updateLayer, getLayer, LAYER_LABELS, motionIntensityToZoom } from './render/composition';
import { tauriRenderEngine, getFfmpegStatus } from './render/engine';
import type { RenderJob, RenderResult, RenderStatus, FfmpegStatus, Composition, Layer } from './render/types';
import { buildRenderPlan } from './render/plan';
import {
  emptyReleaseProject, emptyOutput, mergeProjectView, isLoopOutputType,
  loopCoreForOutput,
  type LoopCore, type ProjectOutput, type ReleaseProject, type SongProject,
} from './project/types';
import { formatTime, parseTime } from './lib/time';
import { pickAudioFile, pickCoverImage, pickOutputDir, saveReleaseProjectToFile, loadReleaseProjectFromFile, normalizeReleaseProject } from './project/storage';
import { Preview } from './ui/Preview';
import { Inspector } from './ui/Inspector';
import { AudioPanel } from './ui/AudioPanel';
import { buildSongAnalysis, pickDefaultMoment } from './audio/songMoments';
import type { SongMoment } from './project/types';
import { StartScreen } from './ui/StartScreen';
import { ProjectHome } from './ui/ProjectHome';
import { outputTypeNoun } from './ui/outputTypeLabels';
import { resolveContextMode } from './ui/contextMode';
import { buildPromoDirectionCandidates, getSelectedSongMoment, promoDirectionRecipeLabel, type PromoDirectionCandidate } from './promo/directions';
import { buildExportReview } from './export/review';
import { buildExportResultSummary } from './export/result';
import { applyFailedRender, applySuccessfulRender, invalidateOutputRender, invalidateOutputsForSharedInput, type SharedRenderInput } from './project/renderFreshness';
import { effectiveOutputState } from './project/readiness';
import { CanvasTestDrive } from './canvas-ui/CanvasTestDrive';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);
const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;
const safeConvert = (path: string): string | null => { try { return convertFileSrc(path); } catch { return null; } };

function compositionFor(project: SongProject): Composition {
  const recipe = getRecipe(project.recipeId) ?? getRecipe('clean_canvas')!;
  return recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: project.title });
}

export default function App() {
  const [releaseProject, setReleaseProject] = useState<ReleaseProject>(emptyReleaseProject());
  const [composition, setComposition] = useState<Composition>(() => compositionFor(mergeProjectView(emptyReleaseProject(), emptyOutput())));
  const [selectedId, setSelectedId] = useState<string>('cover_art');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [copiedOutputPath, setCopiedOutputPath] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [view, setView] = useState<'start' | 'home' | 'editor' | 'canvas-test-drive'>('start');
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  // Workspace-clarity v1: advanced editing (output type / look / layers /
  // sliders) is a closed-by-default drawer, not a permanently-open rail.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The technical review grid is collapsed by default; blockers stay visible.
  const [reviewDetailsOpen, setReviewDetailsOpen] = useState(false);

  // The output currently open in the editor. ReleaseProject.outputs starts
  // empty (no output exists until the user picks a type); the synthetic
  // fallback below only matters so `project` below always type-checks — it is
  // never rendered, since the editor view is only reached after an output id
  // is set on the release project.
  const activeOutput = useMemo<ProjectOutput>(
    () => releaseProject.outputs.find((o) => o.id === releaseProject.activeOutputId) ?? releaseProject.outputs[0] ?? emptyOutput(),
    [releaseProject],
  );
  // The merged single-output view the renderer/editor/export/promo modules
  // already understand — see project/types.ts mergeProjectView.
  const project: SongProject = useMemo(() => mergeProjectView(releaseProject, activeOutput), [releaseProject, activeOutput]);

  const fn = getFunction(project.functionId);
  const styleOptions = useMemo(() => (fn ? recipesForFunction(fn) : []), [fn]);
  const plan = useMemo(() => buildRenderPlan(project), [project]);
  const promoDirections = useMemo(() => buildPromoDirectionCandidates(project), [project]);
  const selectedMoment = useMemo(() => getSelectedSongMoment(project), [project]);
  const exportReview = useMemo(() => buildExportReview({ project, plan, composition, selectedMoment }), [project, plan, composition, selectedMoment]);
  const exportResult = useMemo(() => result ? buildExportResultSummary({ result, project, plan, selectedMoment }) : null, [result, project, plan, selectedMoment]);
  // Context Engine v1 (UX-006): App-level only, not propagated to children.
  // Today only the canvas-edit bottom summary reacts to this — see below.
  const contextMode = useMemo(
    () => resolveContextMode({ view, activeOutputFunctionId: activeOutput.functionId, hasLoopCore: Boolean(activeOutput.loopCore), hasExportResult: Boolean(exportResult) }),
    [view, activeOutput.functionId, activeOutput.loopCore, exportResult],
  );
  const coverSrc = IS_TAURI && project.coverPath ? safeConvert(project.coverPath) : null;
  const audioSrc = IS_TAURI && project.audioPath ? safeConvert(project.audioPath) : null;
  const selectedLayer = getLayer(composition, selectedId);

  const touch = () => new Date().toISOString();
  function clearStaleRenderResult() {
    setResult(null);
    setCopiedOutputPath(false);
    if (status === 'success' || status === 'error') setStatus('ready');
  }
  function sharedRenderInputFor(patch: Partial<Pick<ReleaseProject, 'title' | 'artist' | 'audioPath' | 'coverPath' | 'outputDir' | 'songAnalysis'>>): SharedRenderInput | null {
    if ('coverPath' in patch) return 'coverPath';
    if ('audioPath' in patch) return 'audioPath';
    if ('title' in patch) return 'title';
    if ('artist' in patch) return 'artist';
    if ('outputDir' in patch) return 'outputDir';
    if ('songAnalysis' in patch) return 'songAnalysis';
    return null;
  }
  const updateShared = (patch: Partial<Pick<ReleaseProject, 'title' | 'artist' | 'audioPath' | 'coverPath' | 'outputDir' | 'songAnalysis'>>) => {
    const sharedInput = sharedRenderInputFor(patch);
    setReleaseProject((rp) => ({
      ...rp,
      ...patch,
      outputs: sharedInput ? invalidateOutputsForSharedInput(rp.outputs, sharedInput) : rp.outputs,
      updatedAt: touch(),
    }));
    if (sharedInput === 'coverPath' || sharedInput === 'audioPath' || sharedInput === 'title') clearStaleRenderResult();
  };
  const synchronizeLoopDuration = (output: ProjectOutput): ProjectOutput => {
    if (!output.loopCore || !isLoopOutputType(output.functionId)) return output;
    const parsedDuration = parseTime(output.clipDuration);
    if (parsedDuration === null || parsedDuration <= 0 || output.loopCore.loopDurationSec === parsedDuration) return output;
    return { ...output, loopCore: { ...output.loopCore, loopDurationSec: parsedDuration } };
  };
  const updateActiveOutput = (patch: Partial<ProjectOutput>, options: { renderAffecting?: boolean } = {}) => {
    setReleaseProject((rp) => ({
      ...rp,
      outputs: rp.outputs.map((o) => {
        if (o.id !== rp.activeOutputId) return o;
        const next = synchronizeLoopDuration({ ...o, ...patch, updatedAt: touch() });
        return options.renderAffecting ? invalidateOutputRender(next) : next;
      }),
      updatedAt: touch(),
    }));
    if (options.renderAffecting) clearStaleRenderResult();
  };

  const refreshSongAnalysis = (base: SongProject, durationSec: number, selectedMomentId: string | null) => {
    if (!base.audioPath) return null;
    return buildSongAnalysis({
      audioPath: base.audioPath,
      durationSec,
      manualStartSec: parseTime(base.clipStart),
      manualDurationSec: parseTime(base.clipDuration),
      selectedMomentId,
    });
  };
  const updateManualClip = (patch: Partial<Pick<SongProject, 'clipStart' | 'clipDuration'>>) => {
    const clipStart = patch.clipStart ?? activeOutput.clipStart;
    const clipDuration = patch.clipDuration ?? activeOutput.clipDuration;
    updateActiveOutput({ clipStart, clipDuration, selectedMomentId: null, selectedPromoDirectionId: null }, { renderAffecting: true });
    if (audioDurationSec !== null) {
      updateShared({ songAnalysis: refreshSongAnalysis({ ...project, clipStart, clipDuration }, audioDurationSec, null) });
    }
  };
  const addLog = (line: string) => setLogs((l) => [...l, line]);

  useEffect(() => { if (IS_TAURI) getFfmpegStatus().then(setFfmpeg).catch(() => setFfmpeg(null)); }, []);

  // Build a fresh output for a creative function, auto-selecting a default
  // song section when the function uses audio (mirrors Song-as-the-spine).
  function buildOutputFor(functionId: string, recipeId?: string): ProjectOutput {
    const f = getFunction(functionId);
    const recipe = getRecipe(recipeId ?? f?.defaultRecipeId ?? 'clean_canvas') ?? getRecipe('clean_canvas')!;
    const output = emptyOutput(functionId, recipe.id, recipe.defaultDurationSec, recipe.name);
    if (f?.audio && releaseProject.audioPath && releaseProject.songAnalysis) {
      const def = pickDefaultMoment(releaseProject.songAnalysis);
      if (def) return { ...output, selectedMomentId: def.id, clipStart: formatTime(def.startSec), clipDuration: String(def.durationSec) };
    }
    return output;
  }

  function openComposition(recipeId: string, title: string, motionIntensity?: number) {
    const recipe = getRecipe(recipeId) ?? getRecipe('clean_canvas')!;
    setComposition(recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title, motionIntensity }));
    setSelectedId('cover_art');
  }

  // Recompute loopCore for a (possibly new) functionId: preserve an existing
  // loopCore when the output is still loop-typed, create a fresh one when it
  // just BECAME loop-typed, or null it out when it's no longer loop-typed —
  // so switching output type via "Change output type"/a promo direction never
  // leaves a stale or missing LoopCore behind.
  function loopCoreFor(functionId: string, loopDurationSec: number, existing: LoopCore | null): LoopCore | null {
    if (!isLoopOutputType(functionId)) return null;
    return loopCoreForOutput(functionId, loopDurationSec, existing);
  }

  // UX-007: the Loop workspace's Continuity/Motion controls. Motion genuinely
  // changes what renders (see recipeToComposition's motionIntensity opt) —
  // it re-derives the background zoom from the SAME template baseline used at
  // creation time and applies it to the live composition immediately, so the
  // Preview updates as the Zoom Motion slider moves. Continuity is retained
  // as data-model intent, but Soft Loop is not exposed as an enabled creative
  // choice until it changes the render.
  function updateLoopCore(patch: Partial<LoopCore>) {
    if (!activeOutput.loopCore) return;
    const nextLoopCore: LoopCore = { ...activeOutput.loopCore, ...patch };
    updateActiveOutput({ loopCore: nextLoopCore }, { renderAffecting: typeof patch.motionIntensity === 'number' });
    const recipe = getRecipe(activeOutput.recipeId);
    if (recipe && typeof patch.motionIntensity === 'number') {
      const template = getTemplate(recipe.visualTemplateId);
      const baseZoom = template.bgZoom ?? (recipe.motionStyle === 'zoom' ? 0.2 : 0);
      const zoom = motionIntensityToZoom(baseZoom, nextLoopCore.motionIntensity);
      setComposition((c) => updateLayer(c, 'background', { zoom } as Partial<Layer>));
    }
  }

  function applyRecipe(functionId: string, recipeId: string) {
    const f = getFunction(functionId); const recipe = getRecipe(recipeId);
    if (!f || !recipe) return;
    let patch: Partial<ProjectOutput> = {
      functionId, recipeId, selectedPromoDirectionId: null,
      clipDuration: String(recipe.defaultDurationSec),
      clipStart: f.audio ? activeOutput.clipStart : '0:00',
      loopCore: loopCoreFor(functionId, recipe.defaultDurationSec, activeOutput.loopCore),
    };
    // Music promos should use the song by default: if analysis is ready and nothing
    // is picked yet, auto-select a sensible section so the song is always in use.
    if (f.audio && project.audioPath && project.songAnalysis && !activeOutput.selectedMomentId) {
      const def = pickDefaultMoment(project.songAnalysis);
      if (def) patch = { ...patch, selectedMomentId: def.id, clipStart: formatTime(def.startSec), clipDuration: String(def.durationSec), loopCore: loopCoreFor(functionId, def.durationSec, activeOutput.loopCore) };
    }
    updateActiveOutput(patch, { renderAffecting: true });
    openComposition(recipeId, project.title, patch.loopCore?.motionIntensity);
    if (status === 'idle') setStatus('ready');
  }

  // Start screen "Make a X" -> creates the project's first output and opens
  // it directly in the editor (the proven fast path; unchanged from before
  // this slice). Returning to / reaching Project Home happens via the new
  // "Project Home" button in the editor topbar, or by opening a saved project.
  function startMake(functionId: string) {
    const output = buildOutputFor(functionId);
    setReleaseProject((rp) => ({ ...rp, outputs: [...rp.outputs, output], activeOutputId: output.id, updatedAt: touch() }));
    openComposition(output.recipeId, releaseProject.title, output.loopCore?.motionIntensity);
    if (status === 'idle') setStatus('ready');
    setView('editor');
  }

  // "Customize manually" -> same default blank output as before, straight to editor.
  function skipToManualEditor() {
    const output = buildOutputFor('make_canvas', 'clean_canvas');
    setReleaseProject((rp) => ({ ...rp, outputs: [...rp.outputs, output], activeOutputId: output.id, updatedAt: touch() }));
    openComposition(output.recipeId, releaseProject.title, output.loopCore?.motionIntensity);
    setView('editor');
  }

  // Project Home "Create another output" -> new output, straight to its editor.
  function createOutput(functionId: string) {
    const output = buildOutputFor(functionId);
    setReleaseProject((rp) => ({ ...rp, outputs: [...rp.outputs, output], activeOutputId: output.id, updatedAt: touch() }));
    openComposition(output.recipeId, releaseProject.title, output.loopCore?.motionIntensity);
    setResult(null); setShowLogs(false); setLogs([]);
    setStatus('ready');
    setView('editor');
  }

  // Project Home "Open" on an existing output card.
  function openOutput(outputId: string) {
    const output = releaseProject.outputs.find((o) => o.id === outputId);
    if (!output) return;
    setReleaseProject((rp) => ({ ...rp, activeOutputId: outputId }));
    openComposition(output.recipeId, releaseProject.title, output.loopCore?.motionIntensity);
    setResult(null); setShowLogs(false); setLogs([]);
    setStatus(effectiveOutputState(output) === 'created' ? 'success' : 'ready');
    setView('editor');
  }

  function applyPromoDirection(candidate: PromoDirectionCandidate) {
    const f = getFunction(candidate.functionId); const recipe = getRecipe(candidate.recipeId);
    if (!f || !recipe) return;
    const clipStart = f.audio ? (candidate.clipStart ?? activeOutput.clipStart) : '0:00';
    const clipDuration = f.audio ? (candidate.clipDuration ?? activeOutput.clipDuration) : String(recipe.defaultDurationSec);
    const loopCore = loopCoreFor(candidate.functionId, parseTime(clipDuration) ?? recipe.defaultDurationSec, activeOutput.loopCore);
    updateActiveOutput({
      functionId: candidate.functionId, recipeId: candidate.recipeId, clipStart, clipDuration,
      selectedMomentId: candidate.momentId ?? activeOutput.selectedMomentId,
      selectedPromoDirectionId: candidate.id,
      loopCore,
    }, { renderAffecting: true });
    openComposition(candidate.recipeId, project.title, loopCore?.motionIntensity);
    if (status === 'idle') setStatus('ready');
  }

  function setTitle(text: string) {
    updateShared({ title: text });
    setComposition((c) => updateLayer(c, 'title_text', { text, visible: text.length > 0 }));
  }
  function onAudioMetadata(durationSec: number) {
    if (!releaseProject.audioPath) return;
    const analysis = buildSongAnalysis({
      audioPath: releaseProject.audioPath,
      durationSec,
      manualStartSec: parseTime(activeOutput.clipStart),
      manualDurationSec: parseTime(activeOutput.clipDuration),
      selectedMomentId: activeOutput.selectedMomentId,
    });
    setAudioDurationSec(durationSec);
    // For a music promo with nothing chosen yet, auto-select a default section so
    // the song is always used and visibly shown (no hunting for the moment picker).
    const f = getFunction(activeOutput.functionId);
    if (f?.audio && !activeOutput.selectedMomentId) {
      const def = pickDefaultMoment(analysis);
      if (def) {
        updateShared({ songAnalysis: analysis });
        updateActiveOutput({ selectedMomentId: def.id, clipStart: formatTime(def.startSec), clipDuration: String(def.durationSec) }, { renderAffecting: true });
        return;
      }
    }
    updateShared({ songAnalysis: analysis });
  }
  function selectMoment(moment: SongMoment) {
    updateActiveOutput({ selectedPromoDirectionId: null, selectedMomentId: moment.id, clipStart: formatTime(moment.startSec), clipDuration: String(moment.durationSec) }, { renderAffecting: true });
  }
  function onInspectorChange(patch: Partial<Layer>) {
    setComposition((c) => updateLayer(c, selectedId, patch));
    updateActiveOutput({}, { renderAffecting: true });
    if (selectedId === 'title_text' && typeof (patch as { text?: string }).text === 'string') updateShared({ title: (patch as { text: string }).text });
  }
  function onMove(id: string, x: number, y: number) {
    setComposition((c) => updateLayer(c, id, { x, y } as Partial<Layer>));
    updateActiveOutput({}, { renderAffecting: true });
  }
  async function choose(kind: 'audio' | 'cover' | 'output') {
    try {
      if (kind === 'audio') {
        const p = await pickAudioFile();
        if (p) { setAudioDurationSec(null); updateShared({ audioPath: p, songAnalysis: null }); updateActiveOutput({ selectedMomentId: null, selectedPromoDirectionId: null }); }
      }
      if (kind === 'cover') {
        const p = await pickCoverImage();
        if (p) { updateShared({ coverPath: p }); updateActiveOutput({ selectedPromoDirectionId: null }); }
      }
      if (kind === 'output') { const p = await pickOutputDir(); if (p) updateShared({ outputDir: p }); }
      if (status === 'idle') setStatus('ready');
    } catch (e) { addLog(`[error] file selection failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function render() {
    if (!plan.ok || !project.coverPath || !project.outputDir) return;
    setBusy(true); setStatus('rendering'); setResult(null); setCopiedOutputPath(false); setLogs([]); setShowLogs(true);
    const outputPath = joinPath(project.outputDir, plan.outputName);
    const job: RenderJob = {
      recipeId: project.recipeId, functionId: project.functionId, imagePath: project.coverPath,
      audioPath: plan.audio ? project.audioPath : null, title: project.title, artist: project.artist,
      outputPath, durationSec: plan.durationSec, audioStartSec: plan.audioStartSec, composition,
    };
    addLog(`[render] ${plan.functionLabel} · ${plan.recipeName} -> ${outputPath}`);
    try {
      const res = await tauriRenderEngine.render(job, addLog);
      setResult(res); setStatus(res.ok ? 'success' : 'error'); setShowLogs(!res.ok);
      addLog(res.ok ? `[render] success (${res.bytes ?? 0} bytes)` : `[render] failed: ${res.error}`);
      // Record the result back onto the active output so it survives switching
      // to a different output and reloading the saved project.
      updateActiveOutput(res.ok
        ? applySuccessfulRender(activeOutput, { outputPath, bytes: res.bytes, renderedAt: new Date().toISOString() })
        : applyFailedRender(activeOutput));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, error: m }); setStatus('error'); addLog(`[render] error: ${m}`);
      updateActiveOutput(applyFailedRender(activeOutput));
    } finally { setBusy(false); }
  }
  function clearExportResult() {
    setResult(null);
    setCopiedOutputPath(false);
    if (status === 'success' || status === 'error') setStatus('ready');
  }
  async function copyOutputPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedOutputPath(true);
      window.setTimeout(() => setCopiedOutputPath(false), 1600);
    } catch (e) {
      addLog(`[export] copy output path failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async function onSave() { try { const p = await saveReleaseProjectToFile(releaseProject); if (p) addLog(`[project] saved -> ${p}`); } catch (e) { addLog(`save failed: ${e}`); } }
  async function onLoad() {
    try {
      const p = await loadReleaseProjectFromFile();
      if (p) {
        const rp = normalizeReleaseProject(p);
        setAudioDurationSec(rp.songAnalysis?.durationSec ?? null);
        setReleaseProject(rp);
        const opened = rp.outputs.find((o) => o.id === rp.activeOutputId) ?? rp.outputs[0];
        if (opened) openComposition(opened.recipeId, rp.title, opened.loopCore?.motionIntensity);
        setStatus('ready');
        setView('home');
      }
    } catch (e) { addLog(`load failed: ${e}`); }
  }

  if (view === 'canvas-test-drive') {
    return <CanvasTestDrive isTauri={IS_TAURI} onBack={() => setView('editor')} />;
  }

  if (view === 'start') {
    return (
      <StartScreen
        isTauri={IS_TAURI} coverSrc={coverSrc} coverName={basename(releaseProject.coverPath)} audioName={basename(releaseProject.audioPath)}
        onPickCover={() => choose('cover')} onPickAudio={() => choose('audio')}
        onStart={startMake} onOpenProject={onLoad} onSkip={skipToManualEditor}
      />
    );
  }

  if (view === 'home') {
    return (
      <ProjectHome
        isTauri={IS_TAURI} releaseProject={releaseProject} coverSrc={coverSrc}
        onPickCover={() => choose('cover')} onPickAudio={() => choose('audio')}
        onCreateOutput={createOutput} onOpenOutput={openOutput}
        onBackToStart={() => setView('start')} onSave={onSave}
      />
    );
  }

  return (
    <div className="studio">
      {/* Top project bar */}
      <div className="topbar">
        <div className="brand">Song Studio <span className="brand-scope">· Editing Output</span></div>
        <input className="t-title" type="text" value={project.title} placeholder="Song title" onChange={(e) => setTitle(e.target.value)} />
        <input className="t-artist" type="text" value={project.artist} placeholder="Artist" onChange={(e) => updateShared({ artist: e.target.value })} />
        <Chip ok={!!project.coverPath} label={project.coverPath ? 'Cover ✓' : 'Cover'} onClick={() => choose('cover')} />
        <Chip ok={!!project.audioPath} label={project.audioPath ? 'Audio ✓' : 'Audio'} onClick={() => choose('audio')} />
        <Chip ok={!!project.outputDir} label={project.outputDir ? 'Save folder ✓' : 'Save folder'} onClick={() => choose('output')} />
        <div className="spacer" />
        {IS_TAURI && ffmpeg && <span className={`ff ${ffmpeg.found ? 'ok' : 'err'}`}>Create MP4 {ffmpeg.found ? 'ready' : 'needs setup'}</span>}
        <button className="ghost small internal-tools-link" title="Owner/dev validation tools — not part of creating a promo MP4" onClick={() => setView('canvas-test-drive')}>Internal tools · dev/test</button>
        <button className="ghost small" onClick={() => setView('home')}>Project Home</button>
        <button className="ghost small" onClick={() => setView('start')}>New project</button>
        <button className="ghost small" onClick={onSave} disabled={!IS_TAURI}>Save</button>
      </div>

      {!IS_TAURI && <div className="banner warn">Preview works in the browser, but choosing files and creating MP4s needs <code>npm run tauri dev</code>.</div>}

      <div className="editor-guide">
        <div className="guide-kicker">{releaseProject.title.trim() || 'Untitled project'} <span className="breadcrumb-sep">›</span> {activeOutput.name}</div>
        <h1>Preview this output</h1>
        {activeOutput.loopCore && (
          <div className="loop-header">
            {plan.durationSec}s silent loop · song reference stays available <span className="breadcrumb-sep">·</span> {activeOutput.loopCore.continuityMode === 'soft-loop' ? 'Soft Loop intent saved, rendering Hard Loop today' : 'Hard Loop'}
          </div>
        )}
      </div>

      {/* Main workspace: eye path is Preview -> Current Output -> Song -> Cover art -> Direction -> Advanced. */}
      <div className="main">
        <div className="left">
          {contextMode.mode === 'canvas-edit' && activeOutput.loopCore ? (
            <>
              <h3>Loop</h3>
              <div className="loop-workspace">
                <div className="loop-row">
                  <span>Loop length</span>
                  <div className="loop-length-field">
                    <input type="text" value={project.clipDuration} onChange={(e) => updateManualClip({ clipDuration: e.target.value })} />
                    <span className="muted small">sec</span>
                  </div>
                </div>
                <div className="loop-row">
                  <span>Continuity</span>
                  <div className="loop-continuity-toggle">
                    <button className={activeOutput.loopCore.continuityMode !== 'soft-loop' ? 'on' : ''} onClick={() => updateLoopCore({ continuityMode: 'hard-loop' })}>Hard Loop</button>
                    <button disabled title="Coming later: Soft Loop will be enabled when it changes the exported render.">Soft Loop · later</button>
                  </div>
                </div>
                {activeOutput.loopCore.continuityMode === 'soft-loop' && (
                  <p className="muted small">This project had Soft Loop saved earlier. It is preserved as future intent, but today's render uses the same hard cut as Hard Loop.</p>
                )}
                <div className="loop-row">
                  <span>Zoom motion <b>{Math.round(activeOutput.loopCore.motionIntensity * 100)}%</b></span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05} value={activeOutput.loopCore.motionIntensity}
                  onChange={(e) => updateLoopCore({ motionIntensity: Number(e.target.value) })}
                />
                <p className="muted small">Canvas export is silent. Spotify plays this looping video while the song plays separately.</p>
              </div>
              <h3>Song reference</h3>
              <AudioPanel
                audioSrc={audioSrc}
                audioName={basename(project.audioPath)}
                required={false}
                analysis={project.songAnalysis}
                selectedMomentId={project.selectedMomentId}
                onMetadata={onAudioMetadata}
                onSelectMoment={selectMoment}
                onUseCurrentTime={(s) => updateManualClip({ clipStart: formatTime(s) })}
                compact
                referenceOnly
              />
            </>
          ) : (
            <>
              <h3>Song</h3>
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
            </>
          )}

          <h3>Cover art</h3>
          <button className="cover-mini" onClick={() => choose('cover')}>
            {coverSrc ? <img className="cover-mini-thumb" src={coverSrc} alt="cover" /> : <div className="cover-mini-thumb placeholder">▢</div>}
            <div className="cover-mini-text">
              <div className="cover-mini-label">{project.coverPath ? 'Cover art added' : 'Add cover art'}</div>
              <div className="cover-mini-name">{basename(project.coverPath) || 'png · jpg · webp'}</div>
            </div>
          </button>

          {contextMode.mode !== 'canvas-edit' && (
            <>
              <h3>Pick a promo vibe</h3>
              <div className="direction-panel">
                {!project.audioPath && !project.coverPath ? (
                  <div className="direction-empty">Add a finished song and cover art to see suggested promo directions.</div>
                ) : (
                  promoDirections.map((candidate) => (
                    <button key={candidate.id} className={`direction-card${candidate.id === project.selectedPromoDirectionId ? ' selected' : ''}`} onClick={() => applyPromoDirection(candidate)}>
                      <span className="direction-top"><b>{candidate.label}</b><span>{Math.round(candidate.fit * 100)}% fit</span></span>
                      <span className="direction-purpose">{candidate.purpose}</span>
                      <span className="direction-recipe">{promoDirectionRecipeLabel(candidate)}</span>
                      <span className="direction-reason">{candidate.reason}</span>
                      {candidate.warnings.length > 0 && <span className="direction-warning">{candidate.warnings[0]}</span>}
                      <span className="direction-source">{candidate.id === project.selectedPromoDirectionId ? 'Using this direction' : 'Try this direction'}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="center">
          <div className="preview-stage">
            <Preview composition={composition} coverSrc={coverSrc} selectedId={selectedId} onSelect={setSelectedId} onMove={onMove} />
          </div>
          {contextMode.mode === 'canvas-edit' ? (
            <div className="loop-span">
              <div className="loop-span-track">
                <span className="loop-span-marker" style={{ left: '0%' }}><b>Start</b>0:00</span>
                <span className="loop-span-marker" style={{ left: '50%' }}><b>Mid</b>{formatTime(plan.durationSec / 2)}</span>
                <span className="loop-span-marker end" style={{ left: '100%' }}><b>End</b>{formatTime(plan.durationSec)}</span>
              </div>
              <p className="muted small">This {plan.durationSec}s visual loop repeats continuously. The exported Canvas MP4 is silent; use Song Reference to judge it against the real music.</p>
            </div>
          ) : plan.audio ? (
            selectedMoment ? (
              <div className="song-usage on">
                <b>Using your song: {formatTime(selectedMoment.startSec)}–{formatTime(selectedMoment.endSec)}</b>
                <span>This section plays in your MP4. Motion is style-based in this version — pick a different section on the left to change what plays.</span>
              </div>
            ) : (
              <div className="song-usage">
                <b>Pick the part of your song to use</b>
                <span>Choose a song section on the left — that part will play in your MP4.</span>
              </div>
            )
          ) : project.audioPath ? (
            <div className="song-usage warn">
              <b>This promo is silent and won’t use your song.</b>
              <span>Switch to a short promo output to use the audio. <button className="link-btn" onClick={() => applyRecipe('make_hook_promo', getFunction('make_hook_promo')?.defaultRecipeId ?? 'vertical_promo')}>Switch to {outputTypeNoun('make_hook_promo', 'Short promo')}</button></span>
            </div>
          ) : null}
          <div className="muted small">Click or drag an element in the preview to customize it.</div>
          <div className="quick-edit">
            <Inspector layer={selectedLayer} section="quick" onChange={onInspectorChange} />
          </div>
        </div>

        <div className="right">
          <div className={`advanced-panel${advancedOpen ? ' open' : ''}`}>
            <button className="advanced-panel-head" onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen}>
              <div>
                <h3>Advanced controls</h3>
                <span className="advanced-summary">{outputTypeNoun(project.functionId, fn?.label ?? project.functionId)} · {getRecipe(project.recipeId)?.name ?? 'Style'}</span>
              </div>
              <span className="advanced-toggle">{advancedOpen ? 'Hide' : 'Show'}</span>
            </button>
            {advancedOpen && (
              <div className="advanced-body">
                <h3>Change output type</h3>
                {CREATIVE_FUNCTIONS.map((f) => (
                  <button key={f.id} className={`opt${f.id === project.functionId ? ' selected' : ''}`} onClick={() => applyRecipe(f.id, f.defaultRecipeId)}>
                    <b>{outputTypeNoun(f.id, f.label)}</b><span>{f.audio ? 'Song clip' : 'No audio needed'}</span>
                  </button>
                ))}
                <h3>Choose a look</h3>
                {styleOptions.map((r) => (
                  <button key={r.id} className={`opt${r.id === project.recipeId ? ' selected' : ''}`} onClick={() => applyRecipe(project.functionId, r.id)}>
                    <b>{r.name}</b><span>{r.colorMood}</span>
                  </button>
                ))}
                <h3>Customize design</h3>
                {composition.layers.map((l) => (
                  <button key={l.id} className={`layer${l.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(l.id)}>
                    <span className={`dot${l.visible ? ' on' : ''}`} />{LAYER_LABELS[l.type] ?? l.type}
                  </button>
                ))}
                <Inspector layer={selectedLayer} section="advanced" onChange={onInspectorChange} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom clip + export + logs */}
      <div className="bottom">
        <div className={`export-review${exportReview.ready ? ' ready' : ' blocked'}`}>
          <div className="export-review-head">
            <div>
              <div className="export-kicker">Before you create MP4</div>
              <h3>{exportReview.title}</h3>
              <p>{exportReview.summary}</p>
            </div>
            <div className="export-review-actions">
              <div className="export-next">Next: {exportReview.nextAction}</div>
              <button className="ghost small" onClick={() => setReviewDetailsOpen((v) => !v)}>{reviewDetailsOpen ? 'Hide details' : 'Details'}</button>
            </div>
          </div>
          {exportReview.blockers.length > 0 && (
            <div className="export-notices">
              {exportReview.blockers.map((blocker) => <div className="export-notice blocker" key={blocker}>Needs: {blocker}</div>)}
            </div>
          )}
          {reviewDetailsOpen && (
            <>
              <div className="export-rows">
                {exportReview.essentials.map((row) => (
                  <div className="export-row" key={row.label}><span>{row.label}</span><b>{row.value}</b></div>
                ))}
              </div>
              {exportReview.warnings.length > 0 && (
                <div className="export-notices">
                  {exportReview.warnings.map((warning) => <div className="export-notice warning" key={warning}>Check: {warning}</div>)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="clip">
          {plan.audio && <Field label="Start at" value={project.clipStart} onChange={(v) => updateManualClip({ clipStart: v })} />}
          <Field label="Length (s)" value={project.clipDuration} onChange={(v) => updateManualClip({ clipDuration: v })} />
          <div className="grow">
            {plan.ok
              ? <span className="muted small">{plan.width}×{plan.height} · {plan.durationSec}s · {plan.audio ? `${formatTime(plan.audioStartSec)}–${formatTime(plan.audioEndSec)}` : 'silent'} · {plan.outputName}</span>
              : <span className="warn small">{plan.errors[0]}</span>}
          </div>
          <span className={`status ${status}`}>● {statusLabel(status)}</span>
          <button className="primary" onClick={render} disabled={!IS_TAURI || busy || !plan.ok}>{busy ? 'Creating MP4…' : 'Create MP4'}</button>
          <button className="ghost small" onClick={() => setShowLogs((v) => !v)}>{showLogs ? 'Hide render log' : 'Render log'}</button>
        </div>
        {exportResult && (
          <div className={`export-result ${exportResult.status}`}>
            <div className="export-result-head">
              <div>
                <div className="export-kicker">Review your video</div>
                <h3>{exportResult.title}</h3>
                <p>{exportResult.summary}</p>
              </div>
              <div className="export-next">Next: {exportResult.nextAction}</div>
            </div>
            <div className="export-result-rows">
              {exportResult.rows.map((row) => (
                <div className="export-row" key={row.label}><span>{row.label}</span><b title={row.value}>{row.value}</b></div>
              ))}
            </div>
            {exportResult.outputPath && (
              <div className="export-success-actions" aria-label="MP4 next actions">
                {exportResult.status === 'success' && safeConvert(exportResult.outputPath) && (
                  <a className="primary small action-link" href={safeConvert(exportResult.outputPath) ?? undefined} target="_blank" rel="noreferrer">Review MP4</a>
                )}
                {'clipboard' in navigator && <button className="ghost small" onClick={() => copyOutputPath(exportResult.outputPath!)}>{copiedOutputPath ? 'Copied' : 'Copy file path'}</button>}
                {exportResult.status === 'success' && <button className="ghost small" onClick={() => setView('home')}>Back to Project Home</button>}
                {exportResult.status === 'success' && <button className="ghost small" onClick={clearExportResult}>Make another promo</button>}
              </div>
            )}
            {exportResult.outputPath && (
              <div className="output-path">
                <div>
                  <strong>Saved file path</strong>
                  <span title={exportResult.outputPath}>{exportResult.outputPath}</span>
                </div>
              </div>
            )}
            {exportResult.warnings.length > 0 && (
              <div className="export-notices">
                {exportResult.warnings.slice(0, 1).map((warning) => <div className="export-notice blocker" key={warning}>{warning}</div>)}
              </div>
            )}
          </div>
        )}
        {showLogs && <div className="logs">{logs.length ? logs.join('\n') : 'Details will appear here.'}</div>}
      </div>
    </div>
  );
}

function statusLabel(status: RenderStatus): string {
  if (status === 'idle') return 'Not started';
  if (status === 'ready') return 'Ready';
  if (status === 'rendering') return 'Creating MP4';
  if (status === 'success') return 'MP4 ready';
  return 'Needs attention';
}

function Chip({ ok, label, onClick }: { ok: boolean; label: string; onClick: () => void }) {
  return <button className={`chip${ok ? ' ok' : ''}`} onClick={onClick} disabled={!IS_TAURI}>{label}</button>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
