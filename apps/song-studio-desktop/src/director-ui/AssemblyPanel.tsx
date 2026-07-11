import { useMemo, useState } from 'react';
import type { DirectorCtx } from './context';
import { planWorkprint, buildWorkprintArgs } from '../director/assembly';
import { markWorkprintBuilt } from '../director/actions';
import { formatTime } from '../lib/time';

// WORKPRINT / ASSEMBLY (DEC-003 §12). Shows coverage, gaps, staleness; builds a
// real song-synchronized MP4 from accepted takes. FINAL is gated on full
// coverage (or explicit accept-gaps); an incomplete assembly is never labeled a
// finished video.

export function AssemblyPanel({ ctx }: { ctx: DirectorCtx }) {
  const { state, update, host } = ctx;
  const dur = ctx.songDurationSec ?? 0;
  const [busy, setBusy] = useState('');
  const [outPath, setOutPath] = useState<string | null>(null);
  const [acceptGaps, setAcceptGaps] = useState(false);

  const plan = useMemo(() => planWorkprint(state, dur, (id) => ctx.assetPath(id)), [state, dur, ctx]);
  const stale = state.workprint.stale;

  const build = async (mode: 'workprint' | 'final') => {
    if (!ctx.audioPath || !ctx.outputDir) { setBusy('Add a song and choose a save folder first.'); return; }
    if (mode === 'final' && !plan.finalReady && !acceptGaps) { setBusy('Final needs every song range covered, or accept the gaps.'); return; }
    const outputPath = `${ctx.outputDir}/workprint_${mode}_${Date.now().toString(36)}.mp4`;
    const args = buildWorkprintArgs(plan, { songAudioPath: ctx.audioPath, width: ctx.width, height: ctx.height, fps: ctx.fps, outputPath, mode });
    setBusy(`Assembling ${mode}…`);
    try {
      const bytes = await host.runFfmpeg(args);
      if (bytes > 0) { setOutPath(outputPath); setBusy(`${mode === 'final' ? 'Final' : 'Workprint'} assembled (${Math.round(bytes / 1024)} KB).`); update(markWorkprintBuilt(state)); }
      else setBusy('Assembly produced no output. Check the render log.');
    } catch (e) { setBusy(`Assembly failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <div className="dir-assembly">
      <h3>Assemble the song</h3>
      <div className="dir-coverage">
        <div className="dir-coverage-bar">
          {plan.scenes.map((s) => (
            <div key={s.sceneId} className="cov-scene" title={s.title} style={{ left: `${(s.startSec / (dur || 1)) * 100}%`, width: `${((s.endSec - s.startSec) / (dur || 1)) * 100}%` }} />
          ))}
          {plan.gaps.map((g, i) => (
            <div key={i} className="cov-gap" style={{ left: `${(g.startSec / (dur || 1)) * 100}%`, width: `${((g.endSec - g.startSec) / (dur || 1)) * 100}%` }} />
          ))}
        </div>
        <div className="muted small">
          {plan.scenes.length} accepted scene{plan.scenes.length === 1 ? '' : 's'} · {formatTime(plan.coveredSec)} of {formatTime(dur)} covered
          {plan.gaps.length > 0 && <> · {plan.gaps.length} uncovered gap{plan.gaps.length === 1 ? '' : 's'}</>}
          {stale && <> · <b className="dir-warn">workprint is out of date</b></>}
        </div>
      </div>

      {plan.gaps.length > 0 && (
        <div className="dir-gaps">
          {plan.gaps.map((g, i) => <span key={i} className="chip small warn">gap {formatTime(g.startSec)}–{formatTime(g.endSec)}</span>)}
          <label className="dir-accept-gaps"><input type="checkbox" checked={acceptGaps} onChange={(e) => setAcceptGaps(e.target.checked)} /> I accept the uncovered ranges as black in a final export</label>
        </div>
      )}

      <div className="dir-assembly-actions">
        <button className="ghost small" onClick={() => build('workprint')} disabled={plan.scenes.length === 0}>Build workprint</button>
        <button className="primary small" onClick={() => build('final')} disabled={plan.scenes.length === 0 || (!plan.finalReady && !acceptGaps)}>Build final</button>
      </div>
      <p className="muted small">The song is always the audio. Generated-clip audio is discarded. Uncovered ranges show black in a workprint and are labeled — an incomplete assembly is never presented as a finished video.</p>
      {busy && <div className="dir-busy small">{busy}</div>}
      {outPath && host.toSrc(outPath) && <video className="dir-workprint-preview" src={host.toSrc(outPath) ?? undefined} controls />}
    </div>
  );
}
