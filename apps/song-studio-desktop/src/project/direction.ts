// VIDEO-002 — output windowing for project-owned, song-relative direction.
//
// A DirectionCue is stored in ABSOLUTE SONG TIME on the ReleaseProject. Each
// output only sees the slice of the song inside its own clip window
// ([clipStart, clipStart + clipDuration]). These pure functions convert one
// project-owned, song-relative cue into the OUTPUT-LOCAL span (seconds from the
// start of that output's exported clip) it should appear at — or report that it
// does not overlap this output at all. No rendering, no I/O, no React: this is
// the seam the render path and the UI both read, and the unit under test.

import { parseTime } from '../lib/time';
import type { DirectionCue, ProjectAsset, ProjectOutput, ReleaseProject } from './types';

/** Output-local overlap of a song-relative [cueStart,cueEnd] with an output's
 * clip window. Returns null when there is no positive-length overlap. */
export function overlapWindow(
  cueStartSec: number,
  cueEndSec: number,
  clipStartSec: number,
  clipDurationSec: number,
): { startLocalSec: number; endLocalSec: number } | null {
  const clipEndSec = clipStartSec + clipDurationSec;
  const overlapStart = Math.max(cueStartSec, clipStartSec);
  const overlapEnd = Math.min(cueEndSec, clipEndSec);
  if (!(overlapEnd > overlapStart)) return null; // no overlap (incl. edge-touching)
  return { startLocalSec: overlapStart - clipStartSec, endLocalSec: overlapEnd - clipStartSec };
}

export type DirectionResolutionStatus = 'no-cue' | 'no-asset' | 'no-overlap' | 'ok';

export interface DirectedVisualWindow {
  imagePath: string;
  startLocalSec: number;
  endLocalSec: number;
}

export interface DirectionResolution {
  status: DirectionResolutionStatus;
  /** Present only when status === 'ok'. */
  window: DirectedVisualWindow | null;
  /** The cue's absolute song span, echoed for UI display when a cue exists. */
  cueStartSec: number | null;
  cueEndSec: number | null;
}

// VIDEO-002 v1 RUNTIME BOUNDARY. The approved first proof is the audio teaser
// (hook promo) ONLY. The persistence + windowing above are intentionally
// general and reusable, but this predicate is the single gate that decides
// which output type actually consumes a directed visual at render time, so
// the visualizer and Canvas keep their current behavior until a later story
// widens the boundary.
export function isDirectableOutputType(functionId: string): boolean {
  return functionId === 'make_hook_promo';
}

/** Resolve the single active direction cue against one output: find the asset,
 * translate the song-relative span into this output's clip-local span, and
 * report exactly why it does or does not appear. v1 consumes at most one cue. */
export function resolveDirectedVisualForOutput(project: ReleaseProject, output: ProjectOutput): DirectionResolution {
  const cue: DirectionCue | undefined = project.directionCues[0];
  if (!cue) return { status: 'no-cue', window: null, cueStartSec: null, cueEndSec: null };

  // v1 asset invariant enforced at runtime (not UI-only): a directed visual may
  // reference only an artist-photo asset. Any other role resolves to 'no-asset'.
  const asset: ProjectAsset | undefined = project.assets.find((a) => a.id === cue.assetId && a.role === 'artist-photo');
  if (!asset) return { status: 'no-asset', window: null, cueStartSec: cue.startSec, cueEndSec: cue.endSec };

  const clipStartSec = parseTime(output.clipStart) ?? 0;
  const clipDurationSec = parseTime(output.clipDuration) ?? 0;
  const w = overlapWindow(cue.startSec, cue.endSec, clipStartSec, clipDurationSec);
  if (!w) return { status: 'no-overlap', window: null, cueStartSec: cue.startSec, cueEndSec: cue.endSec };

  return {
    status: 'ok',
    window: { imagePath: asset.path, startLocalSec: w.startLocalSec, endLocalSec: w.endLocalSec },
    cueStartSec: cue.startSec,
    cueEndSec: cue.endSec,
  };
}

/** The actual runtime seam the renderer uses: the windowed directed visual(s)
 * for an output, but ONLY when this output type is directable in v1 (audio
 * teaser). Non-directable outputs always get an empty list, so the resolution
 * logic can stay general while the first proof stays audio-teaser-only. */
export function directedVisualsForOutput(project: ReleaseProject, output: ProjectOutput): DirectedVisualWindow[] {
  if (!isDirectableOutputType(output.functionId)) return [];
  const res = resolveDirectedVisualForOutput(project, output);
  return res.status === 'ok' && res.window ? [res.window] : [];
}
