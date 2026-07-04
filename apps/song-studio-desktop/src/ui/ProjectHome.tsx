import { deriveReleaseReadiness, readinessStatusClass, readinessStatusLabel, type OutputTypeReadiness } from '../project/readiness';
import { getFunction } from '../render/recipes';
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
  const readiness = deriveReleaseReadiness(releaseProject);
  const runNextAction = () => {
    const action = readiness.nextAction;
    if (action.kind === 'add-song') onPickAudio();
    else if (action.kind === 'add-cover') onPickCover();
    else if (action.outputId) onOpenOutput(action.outputId);
    else if (action.functionId) onCreateOutput(action.functionId);
  };

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
          <p>Prepare the shared materials and promotional Outputs for this release. Your song and cover art are reused across every Output you make here.</p>
        </div>

        <div className="readiness-panel">
          <div>
            <div className="guide-kicker">Release Readiness v1</div>
            <h2>Prepare my release</h2>
            <p>Readiness here only reflects Song Studio's current materials and supported Outputs.</p>
          </div>
          <div className="readiness-stats">
            <ReadinessStat value={`${readiness.essentialsAdded}/${readiness.essentialsTotal}`} label="essentials added" />
            <ReadinessStat value={String(readiness.createdOutputs)} label="created Outputs" />
            <ReadinessStat value={String(readiness.draftOutputs)} label="draft Outputs" />
            <ReadinessStat value={String(readiness.needsAttentionOutputs)} label="need attention" />
            <ReadinessStat value={String(readiness.unstartedOutputTypes)} label="types not started" />
          </div>
          <button className="next-action" onClick={runNextAction} disabled={!isTauri}>
            <span>Next best action</span>
            <b>{readiness.nextAction.title}</b>
            <small>{readiness.nextAction.detail}</small>
          </button>
        </div>

        <div className="home-section-heading">
          <h3>Project essentials</h3>
          <p>Shared release materials reused by current Outputs.</p>
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
          <div className="home-section-heading">
            <h3>Output readiness</h3>
            <p>What you have created and what you can make next from this release project.</p>
          </div>
          <div className="output-readiness-list">
            {readiness.outputTypes.map((type) => (
              <OutputTypeRow
                key={type.functionId}
                type={type}
                hasAudio={hasAudio}
                hasCover={hasCover}
                isTauri={isTauri}
                onCreate={() => onCreateOutput(type.functionId)}
                onOpenOutput={onOpenOutput}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadinessStat({ value, label }: { value: string; label: string }) {
  return <div className="readiness-stat"><b>{value}</b><span>{label}</span></div>;
}

function OutputTypeRow({ type, hasAudio, hasCover, isTauri, onCreate, onOpenOutput }: { type: OutputTypeReadiness; hasAudio: boolean; hasCover: boolean; isTauri: boolean; onCreate: () => void; onOpenOutput: (outputId: string) => void }) {
  const blockedNoCover = !hasCover;
  const blockedNoAudio = type.audioRequired && !hasAudio;
  const disabled = !isTauri || blockedNoCover || blockedNoAudio;
  const hint = blockedNoCover ? 'Add cover art first' : blockedNoAudio ? 'Add a song first' : type.audioRequired ? 'Uses your song and cover art' : 'Uses your cover art';
  const primary = type.outputs.find((output) => output.status === 'error') ?? type.outputs.find((output) => output.status === 'draft') ?? type.outputs[0];
  return (
    <div className="output-type-row">
      <div className="output-type-main">
        <div className="output-card-top">
          <b>{outputTypeAction(type.functionId, type.label)}</b>
          <span className={`output-status ${readinessStatusClass(type.state)}`}>{readinessStatusLabel(type.state)}</span>
        </div>
        <div className="output-card-type">{type.description}</div>
        <div className="output-card-render">{type.outputs.length ? `${type.outputs.length} version${type.outputs.length === 1 ? '' : 's'} · ${type.createdCount} created · ${type.draftCount} draft · ${type.needsAttentionCount} need attention` : hint}</div>
        <div className="output-row-actions">
          {primary && <button className="ghost small" onClick={() => onOpenOutput(primary.id)}>{primary.status === 'rendered' ? 'Open' : 'Continue'}</button>}
          <button className="ghost small" onClick={onCreate} disabled={disabled}>{type.outputs.length ? 'Create another' : 'Start'}</button>
        </div>
      </div>
      {type.outputs.length > 0 && (
        <div className="output-variants">
          {type.outputs.map((output) => <OutputCard key={output.id} output={output} onOpen={() => onOpenOutput(output.id)} />)}
        </div>
      )}
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
