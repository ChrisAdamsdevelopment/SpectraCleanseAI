import { useState } from 'react';
import type { AppSettings } from '../app/appSettings';

// ONE-TIME ONBOARDING (ALPHA-001 §5/§6). Three short stages. Skippable at every
// step. Never asks for a song, a photo, clothing, tattoos, jewellery, or a
// provider. Shown only when appSettings.onboarding.completedVersion is null —
// completing OR skipping sets it forever, and an app update never clears it.

export type OnboardingStage = 'welcome' | 'providers' | 'begin';
export type OnboardingExit = 'skip' | 'complete';
export type BeginChoice = 'new-project' | 'open-project' | 'explore';

export function Onboarding({ onConnect, onFinish }: {
  settings: AppSettings;
  /** Opens Settings → AI Providers. Onboarding itself never takes a key. */
  onConnect: (account: 'google' | 'xai') => void;
  /** `how` records whether this was a skip; `begin` is the chosen next step. */
  onFinish: (how: OnboardingExit, begin: BeginChoice | null) => void;
}) {
  const [stage, setStage] = useState<OnboardingStage>('welcome');

  // Skipping is always one click away and always counts as done (§5).
  const skip = () => onFinish('skip', null);

  return (
    <div className="onb-backdrop">
      <div className="onb-card" role="dialog" aria-label="Welcome to Song Studio">
        <div className="onb-steps" aria-hidden>
          {(['welcome', 'providers', 'begin'] as OnboardingStage[]).map((s, i) => (
            <span key={s} className={`onb-dot${stage === s ? ' on' : ''}`}>{i + 1}</span>
          ))}
        </div>

        {stage === 'welcome' && (
          <>
            <h2>Welcome to Song Studio</h2>
            <p className="onb-lead">Song Studio helps you direct AI-generated moving scenes around your music.</p>
            <p className="muted">You describe who is on screen, what happens, and how it should feel. The AI generates the scenes. Song Studio remembers your characters, keeps them consistent, repairs what needs fixing, and assembles everything to your song.</p>
            <div className="onb-actions">
              <button className="ghost" onClick={skip}>Skip and start creating</button>
              <button className="primary" onClick={() => setStage('providers')}>Continue</button>
            </div>
          </>
        )}

        {stage === 'providers' && (
          <>
            <h2>Connect an AI provider</h2>
            <p className="onb-lead">To generate through Song Studio, connect a provider. You can also do this later in Settings, or use manual generation packages.</p>
            <div className="onb-providers">
              <button className="onb-provider" onClick={() => onConnect('google')}>
                <b>Google</b>
                <span className="muted small">Gemini Omni &amp; Veo — scene video, reference images</span>
              </button>
              <button className="onb-provider" onClick={() => onConnect('xai')}>
                <b>xAI / Grok</b>
                <span className="muted small">Grok Imagine — scene video, reference images, reasoning</span>
              </button>
            </div>
            <p className="muted small">You bring your own API key. Song Studio never charges you and never sells credits — you pay the provider directly. No key? Manual packages work without one.</p>
            <div className="onb-actions">
              <button className="ghost" onClick={skip}>Skip for now</button>
              <button className="primary" onClick={() => setStage('begin')}>Continue</button>
            </div>
          </>
        )}

        {stage === 'begin' && (
          <>
            <h2>You&rsquo;re ready</h2>
            <p className="onb-lead">Add a song, create one scene, and generate. Add characters and references later, only when a scene needs them.</p>
            <div className="onb-providers">
              <button className="onb-provider" onClick={() => onFinish('complete', 'new-project')}><b>Create a release project</b><span className="muted small">Start from a song</span></button>
              <button className="onb-provider" onClick={() => onFinish('complete', 'open-project')}><b>Open an existing project</b><span className="muted small">Pick a .ssproj file</span></button>
              <button className="onb-provider" onClick={() => onFinish('complete', 'explore')}><b>Explore Song Studio</b><span className="muted small">Look around first</span></button>
            </div>
            <div className="onb-actions">
              <button className="ghost" onClick={skip}>Skip</button>
            </div>
          </>
        )}

        <p className="onb-foot muted small">This introduction is shown once. You can see it again from Settings.</p>
      </div>
    </div>
  );
}
