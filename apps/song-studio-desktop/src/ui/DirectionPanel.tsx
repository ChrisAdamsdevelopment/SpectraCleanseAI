import { formatTime } from '../lib/time';
import type { DirectionCue, ProjectAsset, SongMoment } from '../project/types';
import type { DirectionResolution } from '../project/direction';

// VIDEO-002 — first causal visual direction surface for an audio output.
// The creator adds an artist photo, then assigns it to an existing song moment
// ("show this here"). This panel is deliberately NOT a timeline: no drag
// handles, no manual timing, no transitions. It also stays honest about
// preview: the base preview above shows the cover composition; the EXPORTED MP4
// is where the timed visual change actually happens. We only show a labeled
// still + overlap status, never a simulated temporal animation.
export function DirectionPanel({
  moments, artistPhotos, assetSrc, activeCue, directedMoment, directedAsset, resolution,
  onAddArtistPhoto, onAssign, onRemove,
}: {
  moments: SongMoment[];
  artistPhotos: ProjectAsset[];
  assetSrc: (asset: ProjectAsset) => string | null;
  activeCue: DirectionCue | null;
  directedMoment: SongMoment | null;
  directedAsset: ProjectAsset | null;
  resolution: DirectionResolution; // overlap of the active cue with THIS output
  onAddArtistPhoto: () => void;
  onAssign: (momentId: string, assetId: string) => void;
  onRemove: () => void;
}) {
  const hasPhotos = artistPhotos.length > 0;
  const hasMoments = moments.length > 0;
  const thumb = directedAsset ? assetSrc(directedAsset) : null;

  return (
    <div className="direction-visual">
      <h3>Show a visual at a moment</h3>
      <p className="muted small">
        Pick a song moment and one of your artist photos. In the exported MP4 that photo becomes the
        main visual for that part of the song — your cover shows the rest of the time.
      </p>

      {!hasPhotos && (
        <button className="ghost small" onClick={onAddArtistPhoto}>Add an artist photo</button>
      )}

      {hasPhotos && !activeCue && (
        <div className="direction-assign">
          {!hasMoments && <div className="muted small">Load the song to get moments you can direct.</div>}
          {hasMoments && moments.map((moment) => (
            <div className="direction-assign-row" key={moment.id}>
              <span className="direction-assign-moment">
                <b>{moment.label}</b> {formatTime(moment.startSec)}–{formatTime(moment.endSec)}
              </span>
              {/* One eligible photo → one-click; several → a tiny picker. No timeline. */}
              {artistPhotos.length === 1 ? (
                <button className="ghost small" onClick={() => onAssign(moment.id, artistPhotos[0].id)}>Show a visual here</button>
              ) : (
                <select defaultValue="" onChange={(e) => { if (e.target.value) onAssign(moment.id, e.target.value); }}>
                  <option value="" disabled>Show a photo here…</option>
                  {artistPhotos.map((a) => <option key={a.id} value={a.id}>{a.label || 'Artist photo'}</option>)}
                </select>
              )}
            </div>
          ))}
          <button className="ghost small" onClick={onAddArtistPhoto}>Add another artist photo</button>
        </div>
      )}

      {activeCue && (
        <div className="direction-active">
          <div className="direction-active-still">
            {thumb ? <img src={thumb} alt="directed visual" /> : <div className="direction-still-placeholder">▢</div>}
            <div className="direction-active-text">
              <b>
                At {formatTime(activeCue.startSec)}–{formatTime(activeCue.endSec)}
                {directedMoment ? ` (${directedMoment.label})` : ''} this visual will show.
              </b>
              <span className="muted small">{directedAsset?.label || 'Artist photo'} · this is a still, not a live preview.</span>
            </div>
          </div>

          {/* Overlap truth for THIS output — never silently ignored. */}
          {resolution.status === 'ok' && resolution.window && (
            <div className="direction-overlap ok">
              This output shows it from {formatTime(resolution.window.startLocalSec)} to {formatTime(resolution.window.endLocalSec)} into the clip.
            </div>
          )}
          {resolution.status === 'no-overlap' && (
            <div className="direction-overlap warn">
              This output’s clip doesn’t cover this moment, so the directed visual won’t appear here. It stays saved on the project and will show on any output whose clip covers {formatTime(activeCue.startSec)}–{formatTime(activeCue.endSec)}.
            </div>
          )}
          {resolution.status === 'no-asset' && (
            <div className="direction-overlap warn">The assigned photo is missing; re-add it or remove the direction.</div>
          )}

          <p className="muted small">The preview above shows your cover. The timed visual change happens in the exported MP4.</p>
          <button className="ghost small" onClick={onRemove}>Remove directed visual</button>
        </div>
      )}
    </div>
  );
}
