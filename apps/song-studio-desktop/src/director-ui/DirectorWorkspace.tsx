import { useState } from 'react';
import type { DirectorCtx } from './context';
import { directorTimingSuspect } from '../director/model';
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

  const acceptRetime = () => ctx.update({ ...ctx.state, songAudioPath: ctx.audioPath });
  const clearTimings = () => ctx.update({ ...ctx.state, scenes: [], lyrics: [], songAudioPath: ctx.audioPath, workprint: { lastBuiltAt: null, builtFromTakeIds: [], stale: false } });

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
          <span>Scene and lyric times are song-relative. Confirm they still line up, or clear them to re-time — generation and assembly are paused until you choose.</span>
          <div>
            <button className="ghost small" onClick={acceptRetime}>The timings still fit — keep them</button>
            <button className="ghost small" onClick={clearTimings}>Clear scenes & lyrics to re-time</button>
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
