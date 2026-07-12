import { useState } from 'react';
import type { DirectorCtx } from './context';
import { directorTimingSuspect } from '../director/model';
import { applyRetime } from '../director/actions';
import { VisualLibrary } from './VisualLibrary';
import { SceneBoard } from './SceneBoard';
import { AssemblyPanel } from './AssemblyPanel';
import { LyricLane } from './LyricLane';
import { ToolStudio } from './ToolStudio';

type Tab = 'library' | 'scenes' | 'lyrics' | 'tools' | 'assembly';

// DIRECTOR WORKSPACE (DEC-003 §4). Tabbed, director-language workspace. All
// business logic lives in director/* (tested); these components only read/write
// canonical DirectorState through ctx.update. The retime gate blocks generation
// and assembly when the song changed under existing timings — never silently.

export function DirectorWorkspace({ ctx, onExit }: { ctx: DirectorCtx; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>('scenes');
  const suspect = directorTimingSuspect(ctx.audioPath, ctx.state);

  // Retime banner wired to the canonical applyRetime transition (§5). None of
  // these leave orphaned takes or pending provider jobs; your visual library is
  // always preserved.
  const retime = (mode: 'keep' | 'retime' | 'clear') => ctx.update(applyRetime(ctx.state, ctx.audioPath, mode));

  return (
    <div className="director-workspace">
      <div className="dir-topbar">
        <div className="dir-brand">Director Mode <span className="muted small">— the artist directs, AI generates the scenes</span></div>
        <div className="dir-tabs">
          {(['library', 'scenes', 'lyrics', 'tools', 'assembly'] as Tab[]).map((t) => (
            <button key={t} className={`dir-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <button className="ghost small" onClick={onExit}>Exit Director Mode</button>
      </div>

      {suspect && (
        <div className="dir-retime-gate">
          <b>The song changed after these scenes were timed.</b>
          <span>Scene and lyric times are song-relative. Choose how to handle them — generation and assembly are paused until you do. Your visual library (characters, references, tools) is kept in every case.</span>
          <div>
            <button className="ghost small" onClick={() => retime('keep')}>The timings still fit — keep them</button>
            <button className="ghost small" onClick={() => retime('retime')}>Re-time scenes (keep scenes & lyrics, drop old takes)</button>
            <button className="ghost small" onClick={() => retime('clear')}>Clear song-relative direction & start over</button>
          </div>
        </div>
      )}

      <div className={`dir-body${suspect ? ' gated' : ''}`}>
        {tab === 'library' && <VisualLibrary ctx={ctx} />}
        {tab === 'scenes' && <SceneBoard ctx={ctx} />}
        {tab === 'lyrics' && <LyricLane ctx={ctx} />}
        {tab === 'tools' && <ToolStudio ctx={ctx} />}
        {tab === 'assembly' && <AssemblyPanel ctx={ctx} />}
      </div>
    </div>
  );
}
