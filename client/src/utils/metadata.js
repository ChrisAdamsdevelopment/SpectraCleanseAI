import { parseBlob } from 'music-metadata-browser';
import ID3Writer from 'browser-id3-writer';

const MARKERS = [
  'suno', 'udio', 'midjourney', 'dall-e', 'dalle', 'c2pa', 'jumbf', 'openai',
  'stability', 'runway', 'synthid', 'elevenlabs', 'ai-generated', 'aigc'
];

export async function readFileMetadata(file) {
  const metadata = await parseBlob(file);
  const common = metadata.common || {};
  const format = metadata.format?.container || file.type || 'Unknown';
  const raw = JSON.stringify(metadata).toLowerCase();
  const filename = file.name.toLowerCase();

  const detectedMarkers = MARKERS.filter((m) => raw.includes(m) || filename.includes(m));

  return {
    title: common.title || '',
    artist: common.artist || '',
    genre: Array.isArray(common.genre) ? (common.genre[0] || '') : (common.genre || ''),
    format,
    risk: detectedMarkers.length > 0 ? 'HIGH' : 'Low',
    detectedMarkers,
  };
}

export async function writeMP3Metadata(file, metadata) {
  const buffer = await file.arrayBuffer();
  const writer = new ID3Writer(buffer);

  writer
    .setFrame('TIT2', metadata.title || '')
    .setFrame('TPE1', [metadata.artist || ''])
    .setFrame('TALB', metadata.album || '')
    .setFrame('TCON', [metadata.genre || ''])
    .setFrame('COMM', {
      description: 'comment',
      text: metadata.comment || '',
    });

  if (metadata.year) writer.setFrame('TYER', String(metadata.year));
  if (metadata.lyrics) {
    writer.setFrame('USLT', {
      description: 'lyrics',
      lyrics: metadata.lyrics,
    });
  }

  writer.addTag();
  return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
}
