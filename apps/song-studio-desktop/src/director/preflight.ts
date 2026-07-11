// Deterministic conflict preflight (DEC-003 §4C). Runs with NO AI call. Each
// conflict is explained in director language with real choices — the system
// never silently removes a creator requirement. AI-assisted analysis can be
// layered on later; these rules are the dependable floor.

import type { DirectorState, ScenePlan, LyricEvent } from './model';

export interface SceneConflict {
  id: string;
  severity: 'warning' | 'blocking';
  title: string;
  explanation: string;   // director language
  choices: string[];     // real options, including "continue knowingly"
}

const SMALL_DETAIL = /\b(tattoo|ring|jewel|necklace|bracelet|earring|scar|logo on|inscription)\b/i;
const BACK_FACING = /\b(back[- ]?facing|from behind|behind (him|her|them|the artist)|back of)\b/i;
const CHOREO = /\b(danc|choreograph|footwork|body ?roll|full[- ]body)\b/i;

export function preflightScene(scene: ScenePlan, state: DirectorState): SceneConflict[] {
  const conflicts: SceneConflict[] = [];
  const lyrics = scene.lyricEventIds
    .map((id) => state.lyrics.find((l) => l.id === id))
    .filter((l): l is LyricEvent => Boolean(l));
  const mouthRequired = lyrics.some((l) => l.mouthVisibility === 'required');
  const exactCastings = scene.castings.filter((c) => c.relationship === 'exact');
  const hasExactPerson = exactCastings.some((c) => {
    const e = state.entities.find((en) => en.id === c.entityId);
    return e && (e.type === 'person' || e.type === 'character');
  });
  const hasExactSmallDetail = exactCastings.some((c) => {
    const e = state.entities.find((en) => en.id === c.entityId);
    return (e && (e.type === 'tattoo' || e.type === 'jewelry'))
      || c.mustRemain.some((m) => SMALL_DETAIL.test(m));
  });
  const hasPoseSequence = scene.toolOutputs.some((o) =>
    Object.values(o.values).some((v) => typeof v === 'object' && v !== null && 'poses' in (v as object)));
  const wide = scene.cameraDistance === 'wide' || scene.cameraDistance === 'extreme-wide';
  const extremeClose = scene.cameraDistance === 'extreme-close';
  const backFacing = BACK_FACING.test(scene.camera) || BACK_FACING.test(scene.action);

  if (hasExactSmallDetail && wide) {
    conflicts.push({
      id: 'exact-detail-vs-wide', severity: 'warning',
      title: 'An exact detail may not be visible from this distance',
      explanation: 'You asked for an exact small detail (like a tattoo or ring) to stay true, but the camera is far away — the detail may be too small to judge or preserve.',
      choices: ['Move the camera closer', 'Split this into a wide shot and a close-up shot', 'Let the detail vary in this scene', 'Continue knowingly'],
    });
  }
  if (mouthRequired && backFacing) {
    conflicts.push({
      id: 'lipsync-vs-back-facing', severity: 'blocking',
      title: 'Lip sync needs a visible mouth, but the performer faces away',
      explanation: 'These lyrics are marked as needing visible mouth movement, but the scene shows the performer from behind.',
      choices: ['Turn the performer toward camera', 'Mark these lyrics as off-camera vocal', 'Split the scene so the sung line faces camera', 'Continue knowingly'],
    });
  }
  if (mouthRequired && scene.cameraDistance === 'extreme-wide') {
    conflicts.push({
      id: 'lipsync-vs-extreme-wide', severity: 'warning',
      title: 'The mouth will be too small to sync at this distance',
      explanation: 'Precise lip sync cannot be judged in an extreme wide shot.',
      choices: ['Use a closer camera for this line', 'Mark the vocal as off-camera', 'Continue knowingly'],
    });
  }
  if (scene.lightingStyle === 'silhouette' && (hasExactPerson || mouthRequired)) {
    conflicts.push({
      id: 'silhouette-vs-identity', severity: 'warning',
      title: 'Silhouette lighting hides the face you asked to keep exact',
      explanation: 'Silhouette lighting conflicts with facial identity or mouth visibility requirements — the face will not be recognizably visible.',
      choices: ['Use stylized lighting that still shows the face', 'Keep the silhouette and let identity read through body shape only', 'Continue knowingly'],
    });
  }
  if ((hasPoseSequence || CHOREO.test(scene.movement) || CHOREO.test(scene.action)) && extremeClose) {
    conflicts.push({
      id: 'choreography-vs-extreme-close', severity: 'warning',
      title: 'Full-body movement will not fit in an extreme close-up',
      explanation: 'You directed full-body movement, but the camera is framed on a small area.',
      choices: ['Widen the framing', 'Split into a movement shot and a detail shot', 'Continue knowingly'],
    });
  }
  if (hasPoseSequence && scene.cameraMotion === 'unstable') {
    conflicts.push({
      id: 'pose-precision-vs-unstable-camera', severity: 'warning',
      title: 'A shaky camera makes precise movement hard to evaluate',
      explanation: 'You gave exact pose timing, but an unstable camera will make it hard to see whether the movement was followed.',
      choices: ['Use a locked or smooth camera', 'Loosen the pose precision', 'Continue knowingly'],
    });
  }
  if (mouthRequired && lyrics.length > 0 && scene.cameraMotion === 'unstable') {
    conflicts.push({
      id: 'lipsync-vs-motion-blur', severity: 'warning',
      title: 'Heavy camera movement can blur the mouth during sung lines',
      explanation: 'Fast, unstable movement makes mouth shapes hard to read and repair.',
      choices: ['Calm the camera during the sung line', 'Mark the vocal off-camera', 'Continue knowingly'],
    });
  }
  for (const c of exactCastings) {
    if (c.referenceIds.length === 0) {
      const e = state.entities.find((en) => en.id === c.entityId);
      conflicts.push({
        id: `exact-without-references-${c.entityId}`, severity: 'warning',
        title: `"${e?.name ?? 'An element'}" is exact but has no guiding references selected`,
        explanation: 'Exact means "use the same approved identity" — without selected reference images the generator has nothing to hold onto.',
        choices: ['Select approved references for this element', 'Change the relationship to consistent or related', 'Continue knowingly'],
      });
    }
  }
  return conflicts;
}
