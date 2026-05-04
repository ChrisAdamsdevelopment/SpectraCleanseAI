import { parseBlob } from 'music-metadata-browser';
import ID3Writer from 'browser-id3-writer';

const MARKERS = [
  'suno',
  'udio',
  'midjourney',
  'dall-e',
  'dalle',
  'c2pa',
  'jumbf',
  'stable diffusion',
  'firefly',
  'runway',
  'ai generated',
  'aigc'
];

export async function readFileMetadata(file) {
  let parsed = null;
  try {
    parsed = await parseBlob(file);
  } catch (_error) {
    parsed = null;
  }

  const common = parsed?.common || {};
  const title = common.title || '';
  const artist = common.artist || '';
  const genre = Array.isArray(common.genre) ? common.genre[0] || '' : common.genre || '';
  const format = parsed?.format?.container || file.type || 'Unknown';

  const rawMetadata = JSON.stringify({ common, native: parsed?.native || {}, quality: parsed?.quality || {} }).toLowerCase();
  const filename = file.name.toLowerCase();

  const detectedMarkers = MARKERS.filter((marker) => rawMetadata.includes(marker) || filename.includes(marker));

  return {
    title,
    artist,
    genre,
    format,
    risk: detectedMarkers.length > 0 ? 'HIGH' : 'Low',
    detectedMarkers
  };
}

export async function writeMP3Metadata(file, metadata) {
  const buffer = await file.arrayBuffer();
  const writer = new ID3Writer(buffer);

  writer.setFrame('TIT2', metadata.title || '');
  writer.setFrame('TPE1', [metadata.artist || '']);
  writer.setFrame('TALB', metadata.album || '');
  writer.setFrame('TCON', [metadata.genre || '']);

  if (metadata.comment) {
    writer.setFrame('COMM', {
      description: 'comment',
      text: metadata.comment,
      language: 'eng'
    });
  }

  if (metadata.lyrics) {
    writer.setFrame('USLT', {
      description: 'lyrics',
      lyrics: metadata.lyrics,
      language: 'eng'
    });
  }

  if (metadata.year) {
    writer.setFrame('TYER', String(metadata.year));
  }

  writer.addTag();
  return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
}
