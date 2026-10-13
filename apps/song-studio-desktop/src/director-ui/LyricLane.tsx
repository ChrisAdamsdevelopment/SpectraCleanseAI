import { useState } from 'react';
import type { DirectorCtx } from './context';
import { makeLyricEvent, type LyricEvent, type MouthVisibility, type VocalRole } from '../director/model';
import { formatTime } from '../lib/time';

// LYRICS AS A VOCAL-PERFORMANCE SCORE (DEC-003 §11). Structured timing/emphasis/
// performer/mouth-visibility — typography is only a view; the data is truth.
// Emphasis drives block weight; mouth-visibility feeds preflight + packets.

export function LyricLane({ ctx }: { ctx: DirectorCtx }) {
  const { state, update } = ctx;
  const [bulk, setBulk] = useState('');

  const setEvent = (id: string, p: Partial<LyricEvent>) => update({ ...state, lyrics: state.lyrics.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const removeEvent = (id: string) => update({ ...state, lyrics: state.lyrics.filter((l) => l.id !== id), scenes: state.scenes.map((s) => ({ ...s, lyricEventIds: s.lyricEventIds.filter((x) => x !== id) })) });

  const importBulk = () => {
    const words = bulk.split(/\s+/).map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return;
    let t = 0; const step = 0.6;
    const events = words.map((w) => { const e = makeLyricEvent(w, t, t + step); t += step; return e; });
    update({ ...state, lyrics: [...state.lyrics, ...events] });
    setBulk('');
  };
  const addWord = () => { const last = state.lyrics[state.lyrics.length - 1]; const t = last ? last.endSec : 0; update({ ...state, lyrics: [...state.lyrics, makeLyricEvent('word', t, t + 0.6)] }); };

  const sorted = [...state.lyrics].sort((a, b) => a.startSec - b.startSec);

  return (
    <div className="dir-lyrics">
      <h3>Lyrics & vocal performance</h3>
      <div className="dir-lyric-import">
        <textarea rows={2} placeholder="Paste lyrics to seed timed words (you can correct timing after)…" value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <div><button className="ghost small" onClick={importBulk}>Seed timed words</button><button className="ghost small" onClick={addWord}>+ word</button></div>
      </div>
      <div className="dir-lyric-lane">
        {sorted.map((l) => (
          <div key={l.id} className="dir-lyric" style={{ fontWeight: 400 + Math.round(l.emphasis * 500) }}>
            <input className="dir-lyric-word" value={l.word} onChange={(e) => setEvent(l.id, { word: e.target.value })} />
            <div className="dir-lyric-times">
              <input type="number" step={0.1} value={l.startSec} onChange={(e) => setEvent(l.id, { startSec: Number(e.target.value) })} />
              <span>–</span>
              <input type="number" step={0.1} value={l.endSec} onChange={(e) => setEvent(l.id, { endSec: Number(e.target.value) })} />
              <span className="muted small">{formatTime(l.startSec)}</span>
            </div>
            <label className="dir-lyric-emph">emphasis<input type="range" min={0} max={1} step={0.05} value={l.emphasis} onChange={(e) => setEvent(l.id, { emphasis: Number(e.target.value) })} /></label>
            <select value={l.performerEntityId ?? ''} onChange={(e) => setEvent(l.id, { performerEntityId: e.target.value || null })}>
              <option value="">— performer —</option>
              {state.entities.filter((en) => en.type === 'person' || en.type === 'character').map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
            </select>
            <select value={l.role} onChange={(e) => setEvent(l.id, { role: e.target.value as VocalRole })}>
              {(['lead', 'background', 'adlib', 'narration', 'dialogue'] as const).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={l.mouthVisibility} onChange={(e) => setEvent(l.id, { mouthVisibility: e.target.value as MouthVisibility })} title="mouth visibility requirement">
              {(['required', 'preferred', 'off-camera', 'none'] as const).map((m) => <option key={m} value={m}>mouth: {m}</option>)}
            </select>
            <button className="ghost small" onClick={() => removeEvent(l.id)}>×</button>
          </div>
        ))}
        {sorted.length === 0 && <div className="muted small">No lyrics yet. These become timed performance direction (and lip-sync requirements) in each scene's generation packet.</div>}
      </div>
    </div>
  );
}
