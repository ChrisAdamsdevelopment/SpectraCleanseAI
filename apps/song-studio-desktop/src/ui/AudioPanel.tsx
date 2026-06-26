import { useRef, useState } from 'react';
import { formatTime } from '../lib/time';

// Basic song awareness: play/pause, scrub, duration, and "use current time as the
// clip start". Not a waveform timeline. Audio loads via the Tauri asset URL.
export function AudioPanel({
  audioSrc, audioName, required, onUseCurrentTime,
}: {
  audioSrc: string | null;
  audioName: string;
  required: boolean;
  onUseCurrentTime: (sec: number) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  if (!audioName) {
    return <div className="audio-panel muted">{required ? 'This function uses song audio. Choose an audio file first.' : 'No audio (this function is silent).'}</div>;
  }

  const toggle = () => {
    const a = ref.current; if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => setError(true)); }
    else { a.pause(); setPlaying(false); }
  };

  return (
    <div className="audio-panel">
      <div className="audio-row">
        <button onClick={toggle} className="play" disabled={!audioSrc || error}>{playing ? '❚❚' : '►'}</button>
        <div className="audio-name" title={audioName}>{audioName}</div>
        <div className="audio-time">{formatTime(time)} / {duration ? formatTime(duration) : '—:—'}</div>
      </div>
      {audioSrc && (
        <input type="range" min={0} max={duration || 0} step={0.1} value={time}
          onChange={(e) => { const v = Number(e.target.value); if (ref.current) ref.current.currentTime = v; setTime(v); }} />
      )}
      <div className="audio-row">
        <button className="ghost small" onClick={() => onUseCurrentTime(time)} disabled={!audioSrc}>Use current time as clip start</button>
      </div>
      {error && <div className="muted small err">Audio selected but could not be previewed.</div>}
      {audioSrc && (
        <audio
          ref={ref} src={audioSrc} preload="metadata" style={{ display: 'none' }}
          onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration || 0)}
          onTimeUpdate={(e) => setTime((e.target as HTMLAudioElement).currentTime || 0)}
          onEnded={() => setPlaying(false)}
          onError={() => setError(true)}
        />
      )}
    </div>
  );
}
