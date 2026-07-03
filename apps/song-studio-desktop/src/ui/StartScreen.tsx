import { CREATIVE_FUNCTIONS } from '../render/recipes';
import { outputTypeAction } from './outputTypeLabels';

const primaryFunctionId = 'make_hook_promo';

const startStepLabels = ['Add song', 'Add cover art', 'Choose promo', 'Create MP4'];

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
          <div className="brand-lg">Start a project for your song</div>
          <p>Add your audio and cover art, choose a promo vibe, preview the draft, and create a vertical MP4 you can review.</p>
          <div className="start-path" aria-label="First promo path">
            {startStepLabels.map((label, index) => (
              <div className="path-pill" key={label}><span>{index + 1}</span>{label}</div>
            ))}
          </div>
        </div>

        <div className="start-step">
          <div className="step-no">1</div>
          <div className="step-body">
            <div className="step-kicker">Required inputs</div>
            <div className="step-title">Start with your song and cover art</div>
            <p className="step-copy">These two files are enough to make the first ready-to-share promo draft.</p>
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
            <div className="step-kicker">First useful output</div>
            <div className="step-title">Choose your first output</div>
            <p className="step-copy">Start with a music promo video. You can customize after the first draft.</p>
            <div className="make-cards">
              {CREATIVE_FUNCTIONS.map((f) => {
                const blockedNoCover = !hasCover;
                const blockedNoAudio = f.audio && !hasAudio;
                const disabled = !isTauri || blockedNoCover || blockedNoAudio;
                const isPrimary = f.id === primaryFunctionId;
                const hint = blockedNoCover ? 'Add cover art first'
                  : blockedNoAudio ? 'Add a song first'
                  : isPrimary ? 'Recommended first MP4'
                  : f.audio ? 'uses your song' : 'cover art only';
                return (
                  <button key={f.id} className={`make-card${isPrimary ? ' primary-path' : ''}`} onClick={() => onStart(f.id)} disabled={disabled}>
                    {isPrimary && <div className="mc-badge">Start here</div>}
                    <div className="mc-title">{outputTypeAction(f.id, f.label)}</div>
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
          <button className="ghost small" onClick={onSkip}>Customize manually</button>
          {!isTauri && <span className="muted small">Run with <code>npm run tauri dev</code> to choose files and create MP4s.</span>}
        </div>
      </div>
    </div>
  );
}
