// Conditioning artifact rendering (VIDEO-003B §3). PURE string builders that
// produce REAL .svg image files (a genuine, inspectable image format) for the
// conditioning recipes. Compile.ts emits these alongside the always-separate
// canonical references, so each recipe materializes materially different packet
// contents. No IO — the packet writer materializes the text as a .svg file.

import { POSE_JOINTS, type PoseSequenceData, type PoseKey, type PoseJointId, type LyricEvent, type ScenePlan, type CameraPathData } from './model';

const esc = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));

const BONES: Array<[PoseJointId, PoseJointId]> = [
  ['head', 'neck'], ['neck', 'shoulderL'], ['neck', 'shoulderR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
  ['neck', 'hip'], ['hip', 'kneeL'], ['kneeL', 'footL'], ['hip', 'kneeR'], ['kneeR', 'footR'],
];

function svgDoc(w: number, h: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n<rect width="${w}" height="${h}" fill="#101216"/>\n${body}\n</svg>\n`;
}

/** Labeled, ordered reference panels. Canonical references stay separate; this
 * sheet only NAMES them with their roles so a generator can see the set. */
export function contactSheetSvg(title: string, panels: Array<{ file: string; entity: string; kind: string }>): string {
  const cols = Math.min(3, Math.max(1, panels.length));
  const cw = 260, ch = 200, pad = 16, headH = 40;
  const rows = Math.ceil(panels.length / cols) || 1;
  const w = cols * cw + pad * 2, h = headH + rows * ch + pad * 2;
  const cells = panels.map((p, i) => {
    const x = pad + (i % cols) * cw, y = headH + pad + Math.floor(i / cols) * ch;
    return `<g>
<rect x="${x}" y="${y}" width="${cw - 12}" height="${ch - 12}" fill="#1b1f27" stroke="#3a4150" rx="6"/>
<text x="${x + 12}" y="${y + 26}" fill="#9fb0c9" font-family="sans-serif" font-size="14">panel ${i + 1}</text>
<text x="${x + 12}" y="${y + 48}" fill="#e8edf5" font-family="sans-serif" font-size="15">${esc(p.entity)}</text>
<text x="${x + 12}" y="${y + 70}" fill="#7fd1ff" font-family="sans-serif" font-size="13">role: ${esc(p.kind)}</text>
<text x="${x + 12}" y="${ch - 24 + y}" fill="#6b7688" font-family="monospace" font-size="11">${esc(p.file)}</text>
</g>`;
  }).join('\n');
  return svgDoc(w, h, `<text x="${pad}" y="28" fill="#e8edf5" font-family="sans-serif" font-size="20">Contact sheet — ${esc(title)}</text>\n${cells}`);
}

/** Ordered storyboard panels with timing / action / camera / lyric labels. */
export function storyboardSvg(scene: ScenePlan, lyrics: LyricEvent[]): string {
  const panels: Array<{ label: string; body: string[] }> = [];
  const camLabel = `${scene.cameraDistance !== 'unspecified' ? scene.cameraDistance + ' · ' : ''}${scene.camera || 'camera as directed'}`;
  panels.push({ label: `Begins · ${scene.startSec.toFixed(1)}s`, body: [scene.howItBegins || scene.description || '—', camLabel] });
  panels.push({ label: 'Action', body: [scene.action || '—', scene.movement ? `move: ${scene.movement}` : ''] });
  panels.push({ label: `Ends · ${scene.endSec.toFixed(1)}s`, body: [scene.howItEnds || '—', scene.emotion ? `feel: ${scene.emotion}` : ''] });
  const words = lyrics.map((l) => l.word).join(' ');
  if (words) panels.push({ label: 'Vocal', body: [words.slice(0, 80), lyrics.some((l) => l.mouthVisibility === 'required') ? 'mouth: visible' : ''] });
  const pw = 300, ph = 220, pad = 16, headH = 40;
  const w = panels.length * pw + pad * 2, h = headH + ph + pad * 2;
  const cells = panels.map((p, i) => {
    const x = pad + i * pw, y = headH + pad;
    const lines = p.body.filter(Boolean).map((t, k) => `<text x="${x + 14}" y="${y + 66 + k * 22}" fill="#cfd8e6" font-family="sans-serif" font-size="14">${esc(t.slice(0, 40))}</text>`).join('\n');
    return `<g>
<rect x="${x}" y="${y}" width="${pw - 14}" height="${ph}" fill="#1b1f27" stroke="#3a4150" rx="6"/>
<rect x="${x}" y="${y}" width="${pw - 14}" height="30" fill="#26303f" rx="6"/>
<text x="${x + 14}" y="${y + 20}" fill="#7fd1ff" font-family="sans-serif" font-size="14">${i + 1}. ${esc(p.label)}</text>
${lines}
</g>`;
  }).join('\n');
  return svgDoc(w, h, `<text x="${pad}" y="28" fill="#e8edf5" font-family="sans-serif" font-size="20">Storyboard — ${esc(scene.title)}</text>\n${cells}`);
}

/** A labeled visual pose sheet from the SVG pose data (beat / hold / transition). */
export function poseSheetSvg(ps: PoseSequenceData): string {
  const cw = 140, ch = 220, pad = 16, headH = 40;
  const poses = ps.poses.length > 0 ? ps.poses : [];
  const w = Math.max(1, poses.length) * cw + pad * 2, h = headH + ch + pad * 2;
  const fig = (p: PoseKey, ox: number, oy: number) => {
    const jx = (j: PoseJointId) => ox + p.joints[j].x * (cw - 30) + 8;
    const jy = (j: PoseJointId) => oy + p.joints[j].y * (ch - 70) + 30;
    const bones = BONES.map(([a, b]) => `<line x1="${jx(a)}" y1="${jy(a)}" x2="${jx(b)}" y2="${jy(b)}" stroke="#6ea8fe" stroke-width="2" stroke-linecap="round"/>`).join('');
    const dots = POSE_JOINTS.map((j) => `<circle cx="${jx(j)}" cy="${jy(j)}" r="${j === 'head' ? 5 : 3}" fill="#9fd0ff"/>`).join('');
    return bones + dots;
  };
  const cells = poses.map((p, i) => {
    const x = pad + i * cw, y = headH + pad;
    return `<g>
<rect x="${x}" y="${y}" width="${cw - 12}" height="${ch}" fill="#1b1f27" stroke="#3a4150" rx="6"/>
<text x="${x + 10}" y="${y + 20}" fill="#7fd1ff" font-family="sans-serif" font-size="13">beat ${p.atBeat} · hold ${p.holdBeats}</text>
<text x="${x + 10}" y="${y + ch - 10}" fill="#8b97a8" font-family="sans-serif" font-size="12">${esc(p.transition)}</text>
${fig(p, x, y)}
</g>`;
  }).join('\n');
  return svgDoc(w, h, `<text x="${pad}" y="28" fill="#e8edf5" font-family="sans-serif" font-size="20">Pose sheet — ${poses.length} key pose(s)</text>\n${cells}`);
}

/** A timed vocal performance-score artifact: lyric blocks over the scene, with
 * emphasis height and mouth-visibility markers. */
export function performanceScoreSvg(scene: ScenePlan, lyrics: LyricEvent[]): string {
  const w = 900, h = 240, pad = 20, laneY = 80, laneH = 120;
  const dur = Math.max(0.1, scene.endSec - scene.startSec);
  const blocks = lyrics.map((l) => {
    const x = pad + ((l.startSec - scene.startSec) / dur) * (w - pad * 2);
    const bw = Math.max(6, ((l.endSec - l.startSec) / dur) * (w - pad * 2));
    const bh = 24 + l.emphasis * (laneH - 40);
    const color = l.mouthVisibility === 'required' ? '#ff9f6e' : l.mouthVisibility === 'off-camera' ? '#6b7688' : '#6ea8fe';
    return `<g>
<rect x="${x}" y="${laneY + laneH - bh}" width="${bw}" height="${bh}" fill="${color}" rx="3" opacity="0.85"/>
<text x="${x}" y="${laneY + laneH + 18}" fill="#cfd8e6" font-family="sans-serif" font-size="11">${esc(l.word.slice(0, 10))}</text>
</g>`;
  }).join('\n');
  return svgDoc(w, h, `<text x="${pad}" y="30" fill="#e8edf5" font-family="sans-serif" font-size="20">Performance score — ${esc(scene.title)}</text>
<text x="${pad}" y="52" fill="#8b97a8" font-family="sans-serif" font-size="12">bar height = emphasis · orange = mouth visible · grey = off-camera</text>
<line x1="${pad}" y1="${laneY + laneH}" x2="${w - pad}" y2="${laneY + laneH}" stroke="#3a4150" stroke-width="1"/>
${blocks}`);
}

/** A timed visual motion guide (filmstrip) combining pose keys + camera-path
 * direction over the scene beats — an external generator can inspect it. */
export function motionGuideSvg(scene: ScenePlan, poses: PoseSequenceData | null, cameraPath: CameraPathData | null): string {
  const frames = poses && poses.poses.length > 0 ? poses.poses.length : 4;
  const cw = 170, ch = 240, pad = 16, headH = 44;
  const w = frames * cw + pad * 2, h = headH + ch + pad * 2;
  const cells = Array.from({ length: frames }, (_, i) => {
    const x = pad + i * cw, y = headH + pad;
    const t = frames > 1 ? i / (frames - 1) : 0;
    // camera dot interpolated along the path (start → end), pose beat label
    let cam = '';
    if (cameraPath) {
      const cx = x + 14 + (cameraPath.start.x + (cameraPath.end.x - cameraPath.start.x) * t) * (cw - 40);
      const cy = y + 30 + (cameraPath.start.y + (cameraPath.end.y - cameraPath.start.y) * t) * (ch - 90);
      cam = `<circle cx="${cx}" cy="${cy}" r="5" fill="#4caf50"/><text x="${x + 12}" y="${y + ch - 12}" fill="#8b97a8" font-family="sans-serif" font-size="11">${esc(cameraPath.movement)}</text>`;
    }
    const pose = poses?.poses[i];
    const poseLabel = pose ? `beat ${pose.atBeat}` : `frame ${i + 1}`;
    return `<g>
<rect x="${x}" y="${y}" width="${cw - 12}" height="${ch}" fill="#1b1f27" stroke="#3a4150" rx="6"/>
<text x="${x + 12}" y="${y + 20}" fill="#7fd1ff" font-family="sans-serif" font-size="13">${esc(poseLabel)}</text>
${cam}
</g>`;
  }).join('\n');
  return svgDoc(w, h, `<text x="${pad}" y="30" fill="#e8edf5" font-family="sans-serif" font-size="20">Motion guide — ${esc(scene.title)} (${frames} beats)</text>\n${cells}`);
}
