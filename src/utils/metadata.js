import { parseBlob } from 'music-metadata-browser';
import ID3Writer from 'browser-id3-writer';

const AI_MARKERS = ['ai','generated','suno','udio','boomy','aiva','soundraw','mubert','stable audio','provenance','c2pa','content credentials','watermark','synthetic','elevenlabs'];

function collectStrings(metadata) {
  const common = metadata?.common || {};
  const native = metadata?.native || {};
  const values = [common.title,common.artist,common.album,...(common.genre || []),...(common.comment || []),common.encodedby,common.publisher]
    .filter(Boolean).map(v => String(v));
  Object.values(native).forEach((frames) => {
    (frames || []).forEach((frame) => {
      if (frame?.id) values.push(String(frame.id));
      if (typeof frame?.value === 'string') values.push(frame.value);
      if (Array.isArray(frame?.value)) frame.value.forEach(v => values.push(String(v)));
      if (frame?.value && typeof frame.value === 'object') values.push(JSON.stringify(frame.value));
    });
  });
  return values.join(' | ').toLowerCase();
}

export async function readFileMetadata(file) {
  const parsed = await parseBlob(file);
  const searchable = collectStrings(parsed);
  const detectedMarkers = AI_MARKERS.filter(marker => searchable.includes(marker));
  return {
    format: parsed.format?.container || file.type || 'unknown',
    title: parsed.common?.title || file.name.replace(/\.[^.]+$/, ''),
    artist: parsed.common?.artist || '',
    genre: parsed.common?.genre?.[0] || '',
    detectedMarkers,
    provenanceRisk: detectedMarkers.length > 0 ? 'High' : 'Low',
    raw: parsed,
  };
}

export async function writeMP3Metadata(file, metadata) {
  const buffer = await file.arrayBuffer();
  const writer = new ID3Writer(buffer);
  writer.removeTag();
  if (metadata.title) writer.setFrame('TIT2', metadata.title);
  if (metadata.artist) writer.setFrame('TPE1', [metadata.artist]);
  if (metadata.genre) writer.setFrame('TCON', [metadata.genre]);
  writer.setFrame('TENC', 'SpectraCleanseAI Browser Quick Cleanse');
  writer.addTag();
  return new Blob([writer.getBlob()], { type: 'audio/mpeg' });
}
