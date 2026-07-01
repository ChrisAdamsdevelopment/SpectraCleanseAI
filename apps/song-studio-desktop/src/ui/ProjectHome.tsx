import { CREATIVE_FUNCTIONS, getFunction } from '../render/recipes';
import { outputTypeAction, outputTypeNoun } from './outputTypeLabels';
import type { ProjectOutput, ReleaseProject } from '../project/types';

// Project Home: the front door once a project has song/cover/outputs. A
// release-assistant view — "here is your project, here are the outputs you
// can make from it" — not a technical render/editor panel. Vocabulary is
// unified with the Editor and Start Screen: Project = container, Output =
// video result (see UX-CLARITY-001 / outputTypeLabels.ts).
export function ProjectHome({
  isTauri, releaseProject, coverSrc, onPickCover, onPickAudio, onCreateOutput, onOpenOutput, onBackToStart, onSave,
}: {
  isTauri: boolean;
  releaseProject: ReleaseProject;
  coverSrc: string | null;
  onPickCover: () => void;
  onPickAudio: () => void;
  onCreateOutput: (functionId: string) => void;
  onOpenOutput: (outputId: string) => void;
  onBackToStart: () => void;
  onSave: () => void;
}) {
  const hasCover = Boolean(releaseProject.coverPath);
  const hasAudio = Boolean(releaseProject.audioPath);
  const audioName = basename(releaseProject.audioPath);
  const coverName = basename(releaseProject.coverPath);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-topbar">
          <div className="brand">Song Studio <span className="brand-scope">· Project Home</span></div>
          <div className="spacer" />
          <button className="ghost small" onClick={onBackToStart}>New project</button>
          <button className="ghost small" onClick={onSave} disabled={!isTauri}>Save</button>
        </div>

        <div className="home-head">
          <div className="guide-kicker">Your project</div>
          <h1>{releaseProject.title.trim() || 'Untitled project'}</h1>
          <p>This project holds your song and cover art. Every output below is a separate video made from it.</p>
        </div>

        <div className="home-summary">
          <button className={`home-asset${hasAudio ? ' filled' : ''}`} onClick={onPickAudio} disabled={!isTauri}>
            <div className="ha-ico">♪</div>
            <div>
              <div className="ha-label">{hasAudio ? 'Song loaded' : 'Add your song'}</div>
              <div className="ha-name">{audioName || 'mp3 · wav · m4a · flac'}</div>
            </div>
          </button>
          <button className={`home-asset${hasCover ? ' filled' : ''}`} onClick={onPickCover} disabled={!isTauri}>
            {coverSrc ? <img className="ha-thumb" src={coverSrc} alt="cover" /> : <div className="ha-ico">▢</div>}
            <div>
              <div className="ha-label">{hasCover ? 'Cover art added' : 'Add cover art'}</div>
              <div className="ha-name">{coverName || 'png · jpg · webp'}</div>
            </div>
          </button>
        </div>

        <div className="home-outputs">
          <h3>Outputs in this project</h3>
          {releaseProject.outputs.length === 0 ? (
            <div className="direction-empty">No outputs yet — create your first one below.</div>
          ) : (
            <div className="output-grid">
              {releaseProject.outputs.map((output) => (
                <OutputCard key={output.id} output={output} onOpen={() => onOpenOutput(output.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="home-create">
          <h3>Create a new output</h3>
          <p className="muted small">Each one reuses your song and cover art, styled for a different promo.</p>
          <div className="output-type-grid">
            {CREATIVE_FUNCTIONS.map((f) => {
              const blockedNoCover = !hasCover;
              const blockedNoAudio = f.audio && !hasAudio;
              const disabled = !isTauri || blockedNoCover || blockedNoAudio;
              const hint = blockedNoCover ? 'Add cover art first' : blockedNoAudio ? 'Add a song first' : f.audio ? 'Uses your song' : 'Cover art only';
              return (
                <button key={f.id} className="output-type-card" onClick={() => onCreateOutput(f.id)} disabled={disabled}>
                  <div className="mc-title">{outputTypeAction(f.id, f.label)}</div>
                  <div className="mc-desc">{f.description}</div>
                  <div className={`mc-hint${disabled && (blockedNoCover || blockedNoAudio) ? ' warn' : ''}`}>{hint}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputCard({ output, onOpen }: { output: ProjectOutput; onOpen: () => void }) {
  const fn = getFunction(output.functionId);
  return (
    <button className="output-card" onClick={onOpen}>
      <div className="output-card-top">
        <b>{output.name}</b>
        <span className={`output-status ${output.status}`}>{statusLabel(output.status)}</span>
      </div>
      <div className="output-card-type">{outputTypeNoun(output.functionId, fn?.label ?? output.functionId)}</div>
      <div className="output-card-render">{output.lastRender ? renderSummary(output.lastRender) : 'Not created yet'}</div>
      <span className="output-card-open">Open</span>
    </button>
  );
}

function statusLabel(status: ProjectOutput['status']): string {
  if (status === 'rendered') return 'Created';
  if (status === 'error') return 'Needs attention';
  return 'Draft';
}

function renderSummary(lastRender: NonNullable<ProjectOutput['lastRender']>): string {
  const size = typeof lastRender.bytes === 'number' ? `${Math.max(1, Math.round(lastRender.bytes / 1024))} KB` : '';
  const when = new Date(lastRender.renderedAt);
  const whenLabel = Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
  return [size, whenLabel].filter(Boolean).join(' · ') || 'Created';
}

function basename(p: string | null): string {
  return p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '';
}
