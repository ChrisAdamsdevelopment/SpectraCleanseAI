// WORKPRINT / FULL-SONG ASSEMBLY (DEC-003 §12). Pure planning + FFmpeg-arg
// generation. Accepted generated scene clips are placed at their SONG-RELATIVE
// ranges over the song audio; generated clip audio is discarded; uncovered
// ranges are honestly shown as neutral (black) in a WORKPRINT and are a hard
// gate for a FINAL export. No IO here — the Node/Tauri harness runs ffmpeg.

import type { DirectorState } from './model';
import { acceptedTakeForScene } from './model';

export type ShortClipPolicy = 'unset' | 'hold-last' | 'loop' | 'shorten-scene' | 'leave-gap';

export interface AssembledScene {
  sceneId: string;
  title: string;
  startSec: number;
  endSec: number;                  // assembled end (may be shortened by policy)
  directedEndSec: number;          // the scene's directed end
  clipPath: string;                // the accepted take's generated-video asset path
  takeId: string;
  clipDurationSec: number | null;  // actual generated clip length (null = unknown)
  policy: ShortClipPolicy;
}

export interface ClipMismatch {
  sceneId: string;
  title: string;
  sceneDurationSec: number;
  clipDurationSec: number;
  policy: ShortClipPolicy;
}

export interface WorkprintPlan {
  scenes: AssembledScene[];        // covered ranges, song-time ordered
  gaps: Array<{ startSec: number; endSec: number }>; // uncovered ranges
  totalSec: number;                // song duration (assembly length)
  coveredSec: number;
  /** Scenes whose accepted clip is shorter than the directed scene (§H6). */
  mismatches: ClipMismatch[];
  /** Mismatches the creator has NOT resolved (policy 'unset') — block FINAL. */
  unresolvedMismatches: ClipMismatch[];
  finalReady: boolean;             // no gaps AND no unresolved short-clip mismatches
}

/** Resolve which scenes have an accepted take with a usable clip, and where the
 * gaps are, across [0, songDurationSec]. assetPath resolves a take's assetId;
 * clipDurationSec (optional) resolves the actual generated clip length so
 * short-clip mismatches can be surfaced before FINAL (never silently held). */
export function planWorkprint(
  state: DirectorState,
  songDurationSec: number,
  assetPath: (assetId: string) => string | null,
  clipDurationSec?: (assetId: string) => number | null,
): WorkprintPlan {
  const scenes: AssembledScene[] = [];
  const mismatches: ClipMismatch[] = [];
  for (const scene of state.scenes) {
    const take = acceptedTakeForScene(state, scene.id);
    if (!take?.assetId) continue;
    const clipPath = assetPath(take.assetId);
    if (!clipPath) continue;
    const clipDur = clipDurationSec ? clipDurationSec(take.assetId) : null;
    const directedEnd = Math.min(songDurationSec, scene.endSec);
    const sceneDur = directedEnd - Math.max(0, scene.startSec);
    const policy = scene.shortClipPolicy;
    let assembledEnd = directedEnd;
    if (clipDur !== null && clipDur + 1e-3 < sceneDur) {
      mismatches.push({ sceneId: scene.id, title: scene.title, sceneDurationSec: sceneDur, clipDurationSec: clipDur, policy });
      if (policy === 'shorten-scene') assembledEnd = Math.max(0, scene.startSec) + clipDur;
      // leave-gap: the clip plays its length; black fills the rest (default arg behavior)
    }
    scenes.push({
      sceneId: scene.id, title: scene.title, startSec: Math.max(0, scene.startSec),
      endSec: assembledEnd, directedEndSec: directedEnd, takeId: take.id, clipPath,
      clipDurationSec: clipDur, policy,
    });
  }
  scenes.sort((a, b) => a.startSec - b.startSec);
  const unresolvedMismatches = mismatches.filter((m) => m.policy === 'unset');

  // Compute uncovered ranges over [0, songDurationSec] from the covered union.
  const gaps: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  let coveredSec = 0;
  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const s of scenes) {
    if (s.endSec <= s.startSec) continue;
    const last = merged[merged.length - 1];
    if (last && s.startSec <= last.endSec) last.endSec = Math.max(last.endSec, s.endSec);
    else merged.push({ startSec: s.startSec, endSec: s.endSec });
  }
  for (const m of merged) {
    if (m.startSec > cursor) gaps.push({ startSec: cursor, endSec: m.startSec });
    coveredSec += Math.max(0, m.endSec - m.startSec);
    cursor = Math.max(cursor, m.endSec);
  }
  if (cursor < songDurationSec) gaps.push({ startSec: cursor, endSec: songDurationSec });

  return {
    scenes, gaps, totalSec: songDurationSec, coveredSec, mismatches, unresolvedMismatches,
    finalReady: gaps.length === 0 && unresolvedMismatches.length === 0,
  };
}

export interface AssemblyInputs {
  songAudioPath: string;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  /** 'workprint' tolerates gaps (black); 'final' requires no gaps. */
  mode: 'workprint' | 'final';
}

/** Build the ffmpeg argument list that renders the workprint. Deterministic and
 * pure; the caller prepends the ffmpeg binary. Generated-clip audio is never
 * mapped — the song is the only audio. */
export function buildWorkprintArgs(plan: WorkprintPlan, io: AssemblyInputs): string[] {
  const { width: W, height: H, fps } = io;
  const total = Math.max(0.1, plan.totalSec);

  // input 0: black base canvas; input 1: song audio; inputs 2..: scene clips.
  const inputs: string[] = [
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${total.toFixed(3)}`,
    '-i', io.songAudioPath,
  ];
  plan.scenes.forEach((s) => { inputs.push('-i', s.clipPath); });

  const chains: string[] = [];
  let last = '0:v';
  plan.scenes.forEach((s, i) => {
    const clipIdx = 2 + i;
    const a = Math.max(0, s.startSec).toFixed(3);
    const b = Math.max(0, s.endSec).toFixed(3);
    const dur = Math.max(0.1, s.endSec - s.startSec);
    // §H6 short-clip policy — NEVER a silent hold. When the clip is shorter than
    // the assembled window, apply the creator's explicit choice:
    //   hold-last: clone the final frame to fill; loop: repeat the clip;
    //   shorten-scene: the plan already trimmed the window to clip length;
    //   leave-gap: play the clip, black fills the remainder (window == clip len).
    const needsFill = s.clipDurationSec !== null && s.clipDurationSec + 1e-3 < dur;
    let src = `[${clipIdx}:v]setpts=PTS-STARTPTS`;
    if (needsFill && s.policy === 'hold-last') src += `,tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)}`;
    else if (needsFill && s.policy === 'loop') src += `,loop=loop=-1:size=1000000:start=0`;
    chains.push(
      `${src},trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS+${a}/TB,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[clip${i}]`,
    );
    const outLabel = i === plan.scenes.length - 1 ? 'vout' : `base${i}`;
    chains.push(`[${last}][clip${i}]overlay=0:0:enable='between(t,${a},${b})'[${outLabel}]`);
    last = outLabel;
  });

  const vmap = plan.scenes.length > 0 ? '[vout]' : '[0:v]';
  const args = [
    ...inputs,
    ...(chains.length > 0 ? ['-filter_complex', chains.join(';')] : []),
    '-map', vmap,
    '-map', '1:a',                 // song audio only
    '-c:a', 'aac', '-b:a', '192k',
    '-t', total.toFixed(3),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-y', io.outputPath,
  ];
  return args;
}
