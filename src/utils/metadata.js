import ID3Writer from 'browser-id3-writer';

const AI_MARKERS = ['ai','generated','suno','udio','boomy','aiva','soundraw','mubert','stable audio','provenance','c2pa','content credentials','watermark','synthetic','elevenlabs'];
const MARKER_REGEX_CACHE = new Map();

let parseBlobLoader = null;

async function getParseBlob() {
  if (parseBlobLoader) return parseBlobLoader;
  parseBlobLoader = import('music-metadata-browser').then((mod) => {
    const fn = mod?.parseBlob || mod?.default?.parseBlob;
    if (typeof fn !== 'function') {
      throw new Error('music-metadata-browser parseBlob export not found');
    }
    return fn;
  });
  return parseBlobLoader;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerToRegex(marker) {
  if (MARKER_REGEX_CACHE.has(marker)) return MARKER_REGEX_CACHE.get(marker);
  const escaped = escapeRegex(marker);
  const regex = marker.length <= 2
    ? new RegExp(`\\b${escaped}\\b`, 'i')
    : new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i');
  MARKER_REGEX_CACHE.set(marker, regex);
  return regex;
}

function collectStrings(metadata, fileName = '') {
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
  if (fileName) values.push(String(fileName));
  return values.join(' | ').toLowerCase();
}

export async function readFileMetadata(file) {
  let parsed = null;
  let parseError = null;

  try {
    const parseBlob = await getParseBlob();
    parsed = await parseBlob(file);
  } catch (error) {
    parseError = error;
  }

  const searchable = collectStrings(parsed, file?.name || '');
  const detectedMarkers = AI_MARKERS.filter((marker) => markerToRegex(marker).test(searchable));
  return {
    format: parsed?.format?.container || file.type || 'unknown',
    title: parsed?.common?.title || file.name.replace(/\.[^.]+$/, ''),
    artist: parsed?.common?.artist || '',
    genre: parsed?.common?.genre?.[0] || '',
    detectedMarkers,
    provenanceRisk: detectedMarkers.length > 0 ? 'High' : 'Low',
    raw: parsed,
    parseError: parseError ? String(parseError?.message || parseError) : null,
  };
}

export async function writeMP3Metadata(file, metadata) {
  const buffer = await file.arrayBuffer();
  const writer = new ID3Writer(buffer);
  writer.removeTag();

  const safeText = (value) => {
    if (typeof value !== 'string') return '';
    return value.replace(/\u0000/g, '').trim().slice(0, 500);
  };

  const title = safeText(metadata?.title);
  const artist = safeText(metadata?.artist);
  const genre = safeText(metadata?.genre);

  if (title) writer.setFrame('TIT2', title);
  if (artist) writer.setFrame('TPE1', [artist]);
  if (genre) writer.setFrame('TCON', [genre]);
  if (title || artist || genre) writer.setFrame('TENC', 'SpectraCleanseAI Browser Quick Cleanse');
  writer.addTag();
  return new Blob([writer.getBlob()], { type: 'audio/mpeg' });
}
