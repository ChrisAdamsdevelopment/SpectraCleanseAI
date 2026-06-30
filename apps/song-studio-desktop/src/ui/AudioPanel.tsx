import { useRef, useState } from 'react';
import { formatTime } from '../lib/time';
import type { SongAnalysis, SongMoment } from '../project/types';

// Basic song awareness: play/pause, scrub, duration, suggested moments, and
// "use current time as the clip start". Not a waveform timeline.
export function AudioPanel({
  audioSrc, audioName, required, analysis, selectedMomentId, onMetadata, onSelectMoment, onUseCurrentTime,
}: {
  audioSrc: string | null;
  audioName: string;
  required: boolean;
  analysis: SongAnalysis | null;
  selectedMomentId: string | null;
  onMetadata: (durationSec: number) => void;
  onSelectMoment: (moment: SongMoment) => void;
  onUseCurrentTime: (sec: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  const selectedSection = analysis?.moments.find((m) => m.id === selectedMomentId) ?? null;

  if (!audioName) {
    return <div className="audio-panel muted">{required ? 'This function uses song audio. Choose an audio file first.' : 'No audio (this function is silent).'}</div>;
  }

  const toggle = () => {
    const a = ref.current; if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => setError(true)); }
    else { a.pause(); setPlaying(false); }
  };
  const useMoment = (moment: SongMoment) => {
    if (ref.current) {
      ref.current.currentTime = moment.startSec;
      setTime(moment.startSec);
    }
    onSelectMoment(moment);
  };

  return (
    <div className="audio-panel">
      {selectedSection && (
        <div className="audio-using">Using your song: <b>{formatTime(selectedSection.startSec)}–{formatTime(selectedSection.endSec)}</b> · {Math.round(selectedSection.durationSec)}s plays in your MP4</div>
      )}
      <div className="audio-row">
        <button onClick={toggle} className="play" disabled={!audioSrc || error}>{playing ? '❚❚' : '►'}</button>
        <div className="audio-name" title={audioName}>{audioName}</div>
        <div className={`audio-state ${playing ? 'playing' : ''}`}>{audioSrc ? (playing ? 'Playing' : 'Paused') : ''}</div>
        <div className="audio-time">{formatTime(time)} / {duration ? formatTime(duration) : '—:—'}</div>
      </div>
      {audioSrc && (
        <input type="range" min={0} max={duration || 0} step={0.1} value={time}
          onChange={(e) => { const v = Number(e.target.value); if (ref.current) ref.current.currentTime = v; setTime(v); }} />
      )}
      <div className="audio-row">
        <button className="ghost small" onClick={() => onUseCurrentTime(time)} disabled={!audioSrc}>Use current time as clip start</button>
      </div>
      {analysis?.moments.length ? (
        <div className="moment-list">
          <div className="moment-head">Suggested song moments</div>
          {analysis.moments.map((moment) => {
            const active = selectedMomentId === moment.id;
            return (
              <button key={moment.id} className={`moment-card${active ? ' selected' : ''}`} onClick={() => useMoment(moment)}>
                <span className="moment-main"><b>{moment.label}</b><span>{formatTime(moment.startSec)}–{formatTime(moment.endSec)}</span></span>
                <span className="moment-reason">{moment.reason}</span>
                <span className="moment-foot"><span>Strength {Math.round(moment.confidence * 100)}%</span><span>{active ? 'Using this part' : 'Use this part'}</span></span>
              </button>
            );
          })}
        </div>
      ) : audioSrc ? <div className="muted small">Load the audio preview to generate deterministic moment suggestions.</div> : null}
      {error && <div className="muted small err">Audio selected but could not be previewed.</div>}
      {audioSrc && (
        <audio
          ref={ref} src={audioSrc} preload="metadata" style={{ display: 'none' }}
          onLoadedMetadata={(e) => { const d = (e.target as HTMLAudioElement).duration || 0; setDuration(d); onMetadata(d); }}
          onTimeUpdate={(e) => setTime((e.target as HTMLAudioElement).currentTime || 0)}
          onEnded={() => setPlaying(false)}
          onError={() => setError(true)}
        />
      )}
    </div>
  );
}
