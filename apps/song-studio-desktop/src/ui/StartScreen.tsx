import { CREATIVE_FUNCTIONS } from '../render/recipes';

// Song-first front door. Explains the app in one line, gets the song + cover,
// then lets the user pick what to make — instead of dropping them into a dense
// editor full of empty fields.
export function StartScreen({
  isTauri, coverSrc, coverName, audioName, onPickCover, onPickAudio, onStart, onOpenProject, onSkip,
}: {
  isTauri: boolean;
  coverSrc: string | null;
  coverName: string;
  audioName: string;
  onPickCover: () => void;
  onPickAudio: () => void;
  onStart: (functionId: string) => void;
  onOpenProject: () => void;
  onSkip: () => void;
}) {
  const hasCover = Boolean(coverName);
  const hasAudio = Boolean(audioName);

  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-head">
          <div className="brand-lg">Song Studio</div>
          <p>Turn your finished song into content worth posting — Canvas loops, hooks, and visualizers.</p>
        </div>

        <div className="start-step">
          <div className="step-no">1</div>
          <div className="step-body">
            <div className="step-title">Add your song</div>
            <div className="asset-tiles">
              <button className={`asset-tile${hasAudio ? ' filled' : ''}`} onClick={onPickAudio} disabled={!isTauri}>
                <div className="at-ico">♪</div>
                <div className="at-name">{audioName || 'Choose audio…'}</div>
                <div className="at-sub">mp3 · wav · m4a · flac</div>
              </button>
              <button className={`asset-tile${hasCover ? ' filled' : ''}`} onClick={onPickCover} disabled={!isTauri}>
                {coverSrc ? <img className="at-thumb" src={coverSrc} alt="cover" /> : <div className="at-ico">▢</div>}
                <div className="at-name">{coverName || 'Choose cover art…'}</div>
                <div className="at-sub">png · jpg · webp</div>
              </button>
            </div>
          </div>
        </div>

        <div className="start-step">
          <div className="step-no">2</div>
          <div className="step-body">
            <div className="step-title">What do you want to make?</div>
            <div className="make-cards">
              {CREATIVE_FUNCTIONS.map((f) => {
                const blockedNoCover = !hasCover;
                const blockedNoAudio = f.audio && !hasAudio;
                const disabled = !isTauri || blockedNoCover || blockedNoAudio;
                const hint = blockedNoCover ? 'Add cover art first'
                  : blockedNoAudio ? 'Add a song first'
                  : f.audio ? 'uses your song' : 'silent loop';
                return (
                  <button key={f.id} className="make-card" onClick={() => onStart(f.id)} disabled={disabled}>
                    <div className="mc-title">{f.label}</div>
                    <div className="mc-desc">{f.description}</div>
                    <div className={`mc-hint${disabled && (blockedNoCover || blockedNoAudio) ? ' warn' : ''}`}>{hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="start-foot">
          <button className="ghost small" onClick={onOpenProject} disabled={!isTauri}>Open a saved project</button>
          <button className="ghost small" onClick={onSkip}>Skip to editor</button>
          {!isTauri && <span className="muted small">Run with <code>npm run tauri dev</code> to choose files and render.</span>}
        </div>
      </div>
    </div>
  );
}
