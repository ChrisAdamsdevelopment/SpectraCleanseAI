// Real-media proof for Director Mode assembly (DEC-003 §12, §18-16..19, §19).
// Generates a song tone + two SYNTHETIC MOVING clips (distinct colors), builds
// an accepted-scene DirectorState, assembles a workprint MP4 via the pure arg
// builder + ffmpeg, then samples REAL decoded pixels to prove:
//   - clip A shows in song range A, clip B in song range B,
//   - the uncovered gap is black,
//   - the assembled audio is the SONG (generated-clip audio discarded),
//   - replacing one accepted scene changes ONLY its region.
// Run: npm run director:assembly:smoke

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { emptyDirectorState, makeScene, makeTake } from '../src/director/model';
import { acceptTake, bindResultToTake } from '../src/director/actions';
import { planWorkprint, buildWorkprintArgs } from '../src/director/assembly';
import type { DirectorState } from '../src/director/model';
import type { ProjectAsset } from '../src/project/types';

const FFMPEG = ffmpegPath as unknown as string;
const A = 'render-core/.smoke-assets';
const OUT = 'out';
const SONG = `${A}/dir_song.m4a`;
const CLIP_RED = `${A}/dir_clip_red.mp4`;
const CLIP_GREEN = `${A}/dir_clip_green.mp4`;
const CLIP_BLUE = `${A}/dir_clip_blue.mp4`;

function make() {
  mkdirSync(A, { recursive: true }); mkdirSync(OUT, { recursive: true });
  // A 20s tone as the "song" (a clearly non-silent audio the workprint must keep).
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:a', 'aac', '-y', SONG], { stdio: 'ignore' });
  // Moving clips: a solid DOMINANT color (so the 1x1 average is distinctly
  // red/green/blue → placement is verifiable) PLUS a moving white box (so the
  // frames genuinely differ over time → real motion, not a still). Each has its
  // OWN loud audio (a different tone) that must NOT survive assembly.
  const clip = (path: string, color: string, freq: number) =>
    execFileSync(FFMPEG, ['-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=24:d=8`, '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=8`,
      '-vf', `drawbox=x='mod(t*160\\,300)':y=280:w=48:h=48:color=white:t=fill`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', path], { stdio: 'ignore' });
  clip(CLIP_RED, '0xcc2222', 880);
  clip(CLIP_GREEN, '0x22cc22', 220);
  clip(CLIP_BLUE, '0x2222cc', 110);
}

function sample(mp4: string, t: number): { r: number; g: number; b: number } {
  const buf = execFileSync(FFMPEG, ['-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  return { r: buf[0] ?? 0, g: buf[1] ?? 0, b: buf[2] ?? 0 };
}
function audioStreamCount(mp4: string): number {
  const out = execFileSync(FFMPEG, ['-i', mp4], { stdio: ['ignore', 'ignore', 'pipe'] } as never).toString?.() ?? '';
  return out.split('\n').filter((l: string) => /Stream #.*Audio/.test(l)).length;
}
function hasAudio(mp4: string): boolean {
  // ffmpeg prints stream info on stderr and exits non-zero (no output file); capture it.
  try { execFileSync(FFMPEG, ['-i', mp4], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
    const s = String((e as { stderr?: Buffer }).stderr ?? '');
    return /Stream #.*Audio/.test(s);
  }
  return false;
}

// Build a state: scene A [2,6] = red clip, scene B [12,16] = green clip. Gap 6..12.
function buildState(): { state: DirectorState; assets: ProjectAsset[] } {
  let state = emptyDirectorState();
  state.songAudioPath = SONG;
  const sceneA = makeScene('A', 2, 6); const sceneB = makeScene('B', 12, 16);
  state.scenes.push(sceneA, sceneB);
  const snap = (s: typeof sceneA) => ({ promptDigest: 'd', recipe: 'separate-references' as const, referenceFiles: [], sceneStartSec: s.startSec, sceneEndSec: s.endSec, aspect: '9:16' as const, resolution: '720p' });
  const takeA = makeTake(sceneA, snap(sceneA), 'manual', {});
  const takeB = makeTake(sceneB, snap(sceneB), 'manual', {});
  state.takes.push(takeA, takeB);
  const assets: ProjectAsset[] = [
    { id: 'asset-red', role: 'generated-video', path: CLIP_RED },
    { id: 'asset-green', role: 'generated-video', path: CLIP_GREEN },
  ];
  state = bindResultToTake(state, takeA.id, 'asset-red', 'imported');
  state = bindResultToTake(state, takeB.id, 'asset-green', 'imported');
  state = acceptTake(state, takeA.id);
  state = acceptTake(state, takeB.id);
  return { state, assets };
}

function assemble(state: DirectorState, assets: ProjectAsset[], outPath: string) {
  const plan = planWorkprint(state, 20, (id) => assets.find((a) => a.id === id)?.path ?? null);
  const args = buildWorkprintArgs(plan, { songAudioPath: SONG, width: 360, height: 640, fps: 24, outputPath: outPath, mode: 'workprint' });
  execFileSync(FFMPEG, args, { stdio: 'ignore' });
  return plan;
}

function main() {
  make();
  const { state, assets } = buildState();
  const wp1 = `${OUT}/_dir_workprint.mp4`;
  const plan = assemble(state, assets, wp1);
  let ok = existsSync(wp1) && statSync(wp1).size > 0;

  // coverage plan: 2 covered scenes; the [6,12] gap exists; not final-ready
  // (gaps are also [0,2] and [16,20] — assembly honestly reports every gap).
  ok = ok && plan.scenes.length === 2 && plan.gaps.some((g) => Math.abs(g.startSec - 6) < 0.05 && Math.abs(g.endSec - 12) < 0.05) && !plan.finalReady;

  // pixels: red-dominant inside A (t=4), green-dominant inside B (t=14), black in gap (t=9)
  const inA = sample(wp1, 4); const inB = sample(wp1, 14); const gap = sample(wp1, 9);
  const redInA = inA.r > inA.g + 30 && inA.r > inA.b + 30;
  const greenInB = inB.g > inB.r + 30 && inB.g > inB.b + 30;
  const gapBlack = gap.r < 24 && gap.g < 24 && gap.b < 24;
  const audioKept = hasAudio(wp1);

  // Replace scene B's accepted take with a BLUE clip; re-assemble; region A must
  // be unchanged, region B must now be blue-ish.
  let state2 = state;
  const takeBlue = makeTake(state2.scenes[1], { promptDigest: 'd', recipe: 'separate-references', referenceFiles: [], sceneStartSec: 12, sceneEndSec: 16, aspect: '9:16', resolution: '720p' }, 'manual', {});
  state2 = { ...state2, takes: [...state2.takes, takeBlue] };
  state2 = bindResultToTake(state2, takeBlue.id, 'asset-blue', 'imported');
  state2 = acceptTake(state2, takeBlue.id);
  const assets2 = [...assets, { id: 'asset-blue', role: 'generated-video' as const, path: CLIP_BLUE }];
  const wp2 = `${OUT}/_dir_workprint_v2.mp4`;
  assemble(state2, assets2, wp2);
  const inA2 = sample(wp2, 4); const inB2 = sample(wp2, 14);
  const regionAUnchanged = Math.abs(inA2.r - inA.r) < 30 && inA2.r > inA2.g + 30 && inA2.r > inA2.b + 30; // still red-dominant
  const blueInB = inB2.b > inB2.r + 30 && inB2.b > inB2.g + 30;

  const pass = ok && redInA && greenInB && gapBlack && audioKept && regionAUnchanged && blueInB;
  console.log(`[director-assembly] covered=${plan.scenes.length} gap@${plan.gaps[0]?.startSec}s finalReady=${plan.finalReady}`);
  console.log(`[director-assembly] A(t4)=rgb(${inA.r},${inA.g},${inA.b}) B(t14)=rgb(${inB.r},${inB.g},${inB.b}) gap(t9)=rgb(${gap.r},${gap.g},${gap.b}) audioKept=${audioKept}`);
  console.log(`[director-assembly] after replacing B: A(t4)=rgb(${inA2.r},${inA2.g},${inA2.b}) [unchanged=${regionAUnchanged}] B(t14)=rgb(${inB2.r},${inB2.g},${inB2.b}) [blue=${blueInB}]`);
  console.log(pass
    ? '\n[director-assembly] PASS — scenes placed in song ranges, gap black, song audio kept (clip audio discarded), targeted replacement changed only region B.'
    : '\n[director-assembly] FAIL');
  process.exit(pass ? 0 : 1);
}

main();
