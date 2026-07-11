import { useRef, useState } from 'react';
import { POSE_JOINTS, defaultPose, type PoseSequenceData, type PoseKey, type PoseJointId } from '../director/model';

// Real SVG pose-sequence directing input (DEC-003 §5). Draggable joints, multiple
// key poses over beats, hold duration, transition character. Outputs normalized
// PoseSequenceData — it directs the generator; it does not render final motion.

const BONES: Array<[PoseJointId, PoseJointId]> = [
  ['head', 'neck'], ['neck', 'shoulderL'], ['neck', 'shoulderR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
  ['neck', 'hip'], ['hip', 'kneeL'], ['kneeL', 'footL'], ['hip', 'kneeR'], ['kneeR', 'footR'],
];

export function PoseSequenceEditor({ value, onChange }: { value: PoseSequenceData; onChange: (v: PoseSequenceData) => void }) {
  const poses = value.poses.length > 0 ? value.poses : [{ atBeat: 0, holdBeats: 1, transition: 'smooth' as const, joints: defaultPose() }];
  const [active, setActive] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<PoseJointId | null>(null);
  const pose = poses[Math.min(active, poses.length - 1)];

  const commit = (next: PoseKey[]) => onChange({ poses: next });
  const setJoint = (j: PoseJointId, x: number, y: number) => {
    const next = poses.map((p, i) => (i === active ? { ...p, joints: { ...p.joints, [j]: { x, y } } } : p));
    commit(next);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setJoint(dragging, +x.toFixed(3), +y.toFixed(3));
  };
  const addPose = () => {
    const last = poses[poses.length - 1];
    const next = [...poses, { ...last, atBeat: last.atBeat + last.holdBeats, joints: { ...last.joints } }];
    commit(next); setActive(next.length - 1);
  };
  const removePose = () => { if (poses.length <= 1) return; const next = poses.filter((_, i) => i !== active); commit(next); setActive(Math.max(0, active - 1)); };
  const patchPose = (patch: Partial<PoseKey>) => commit(poses.map((p, i) => (i === active ? { ...p, ...patch } : p)));

  return (
    <div className="pose-editor">
      <div className="pose-keys">
        {poses.map((p, i) => (
          <button key={i} className={`pose-key${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>
            Pose {i + 1}<span>beat {p.atBeat}</span>
          </button>
        ))}
        <button className="pose-key add" onClick={addPose}>+ pose</button>
      </div>
      <svg ref={svgRef} className="pose-svg" viewBox="0 0 100 160" onPointerMove={onPointerMove} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
        {BONES.map(([a, b], i) => (
          <line key={i} x1={pose.joints[a].x * 100} y1={pose.joints[a].y * 160} x2={pose.joints[b].x * 100} y2={pose.joints[b].y * 160} stroke="var(--accent, #6ea8fe)" strokeWidth={1.5} strokeLinecap="round" />
        ))}
        {POSE_JOINTS.map((j) => (
          <circle key={j} cx={pose.joints[j].x * 100} cy={pose.joints[j].y * 160} r={j === 'head' ? 4 : 2.6}
            fill={dragging === j ? '#fff' : 'var(--accent, #6ea8fe)'} stroke="#000" strokeWidth={0.4}
            style={{ cursor: 'grab' }} onPointerDown={() => { setDragging(j); }} />
        ))}
      </svg>
      <div className="pose-controls">
        <label>Beat<input type="number" min={0} step={1} value={pose.atBeat} onChange={(e) => patchPose({ atBeat: Number(e.target.value) })} /></label>
        <label>Hold<input type="number" min={0} step={1} value={pose.holdBeats} onChange={(e) => patchPose({ holdBeats: Number(e.target.value) })} /></label>
        <label>Transition
          <select value={pose.transition} onChange={(e) => patchPose({ transition: e.target.value as PoseKey['transition'] })}>
            <option value="smooth">smooth</option><option value="snap">snap</option><option value="lock">lock</option>
          </select>
        </label>
        <button className="ghost small" onClick={removePose} disabled={poses.length <= 1}>Remove pose</button>
      </div>
      <p className="muted small">Drag the joints. This directs the generator toward these positions over the beats — it is not the final animation.</p>
    </div>
  );
}
