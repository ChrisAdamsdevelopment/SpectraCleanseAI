import ID3Writer from 'browser-id3-writer';

const AI_MARKERS = ['ai','generated','suno','udio','boomy','aiva','soundraw','mubert','stable audio','provenance','c2pa','content credentials','watermark','synthetic','elevenlabs'];
const MARKER_REGEX_CACHE = new Map();
const MAX_BROWSER_PARSE_BYTES = 100 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 8000;

let parseBlobLoader = null;

async function getParseBlob() {
  if (parseBlobLoader) return parseBlobLoader;
  parseBlobLoader = import('music-metadata').then((mod) => {
    const fn = mod?.parseBlob || mod?.default?.parseBlob;
    if (typeof fn !== 'function') {
      throw new Error('music-metadata parseBlob export not found');
    }
    return fn;
  });
  return parseBlobLoader;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Metadata parse timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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

function textFromValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return Object.values(value).map(textFromValue).filter(Boolean).join(', ');
  return String(value);
}

function findNativeValue(metadata, patterns) {
  const native = metadata?.native || {};
  for (const frames of Object.values(native)) {
    for (const frame of frames || []) {
      const id = String(frame?.id || '').toLowerCase();
      if (patterns.some((pattern) => pattern.test(id))) {
        const value = textFromValue(frame?.value).trim();
        if (value) return value;
      }
    }
  }
  return '';
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
    if ((file?.size || 0) > MAX_BROWSER_PARSE_BYTES) {
      throw new Error(`File too large for browser metadata analysis (${Math.round(file.size / (1024 * 1024))}MB > ${Math.round(MAX_BROWSER_PARSE_BYTES / (1024 * 1024))}MB)`);
    }
    const parseBlob = await getParseBlob();
    parsed = await withTimeout(parseBlob(file), PARSE_TIMEOUT_MS);
  } catch (error) {
    parseError = error;
  }

  const searchable = collectStrings(parsed, file?.name || '');
  const detectedMarkers = AI_MARKERS.filter((marker) => markerToRegex(marker).test(searchable));
  return {
    format: parsed?.format?.container || file.type || 'unknown',
    title: parsed?.common?.title || file.name.replace(/\.[^.]+$/, ''),
    artist: parsed?.common?.artist || '',
    producer: parsed?.common?.producer || findNativeValue(parsed, [/producer/, /©prd/, /com\.apple\.quicktime\.producer/]),
    copyright: parsed?.common?.copyright || findNativeValue(parsed, [/copyright/, /cprt/, /©cpy/]),
    genre: parsed?.common?.genre?.[0] || '',
    lyrics: parsed?.common?.lyrics || findNativeValue(parsed, [/lyrics/, /lyric/]),
    detectedMarkers,
    provenanceRisk: detectedMarkers.length > 0 ? 'High' : 'Low',
    raw: parsed,
    parseError: parseError ? String(parseError?.message || parseError) : null,
  };
}

export async function writeMP3Metadata(file, metadata) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    throw new Error(`Failed to read MP3 data: ${error?.message || String(error)}`);
  }

  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Error('MP3 file is empty or unreadable.');
  }

  let writer;
  try {
    writer = new ID3Writer(buffer);
    writer.removeTag();
  } catch (error) {
    throw new Error(`Failed to initialize MP3 metadata writer: ${error?.message || String(error)}`);
  }

  const safeText = (value, maxLen = 500) => {
    if (typeof value !== 'string') return '';
    return value.replace(/\u0000/g, '').trim().slice(0, maxLen);
  };

  const title = safeText(metadata?.title);
  const artist = safeText(metadata?.artist);
  const genre = safeText(metadata?.genre);
  const albumArtist = safeText(metadata?.albumArtist) || artist;
  const description = safeText(metadata?.description, 2000);
  const comment = safeText(metadata?.comment, 2000);
  const commentText = comment || description;
  const lyrics = safeText(metadata?.lyrics, 20000);
  const producer = safeText(metadata?.producer);
  const publisher = safeText(metadata?.publisher || metadata?.label);
  const tags = safeText(metadata?.tags, 1000);
  const computedCopyright = safeText(metadata?.copyright) || (artist ? `© ${new Date().getUTCFullYear()} ${artist}` : '');

  const attemptedFrames = [];
  const writtenFrames = [];
  const skippedFrames = [];

  const safeSetFrame = (frameId, value, { optional = false } = {}) => {
    attemptedFrames.push(frameId);
    try {
      writer.setFrame(frameId, value);
      writtenFrames.push(frameId);
      return true;
    } catch (error) {
      skippedFrames.push(frameId);
      console.warn('[quick-cleanse] skipped unsupported ID3 frame', { frameId, optional, error });
      return false;
    }
  };

  try {
    if (title) safeSetFrame('TIT2', title);
    if (artist) safeSetFrame('TPE1', [artist]);
    if (albumArtist) safeSetFrame('TPE2', [albumArtist]);
    if (genre) safeSetFrame('TCON', [genre]);

    let finalComment = commentText;
    if (producer && !finalComment.toLowerCase().includes('producer:')) {
      finalComment = finalComment ? `${finalComment} | Producer: ${producer}` : `Producer: ${producer}`;
    }
    if (tags && !finalComment.toLowerCase().includes('tags:')) {
      finalComment = finalComment ? `${finalComment} | Tags: ${tags}` : `Tags: ${tags}`;
    }

    if (finalComment) {
      safeSetFrame('COMM', {
        description: 'Comment',
        language: 'eng',
        text: finalComment.slice(0, 4000),
      });
    }

    if (lyrics) {
      safeSetFrame('USLT', {
        description: 'Lyrics',
        language: 'eng',
        text: lyrics,
      }, { optional: true });
    }

    if (computedCopyright) safeSetFrame('TCOP', computedCopyright, { optional: true });
    if (publisher) safeSetFrame('TPUB', [publisher], { optional: true });
    if (producer) safeSetFrame('TXXX', { description: 'Producer', value: producer }, { optional: true });

    console.info('[quick-cleanse] mp3 metadata summary', {
      hasLyrics: Boolean(lyrics),
      hasComment: Boolean(commentText),
      hasDescription: Boolean(description),
      hasProducer: Boolean(producer),
      attemptedFrames,
      writtenFrames,
      skippedFrames,
    });

    writer.addTag();
  } catch (error) {
    throw new Error(`Failed while writing ID3 frames: ${error?.message || String(error)}`);
  }

  let cleanedBlob;
  try {
    cleanedBlob = writer.getBlob();
  } catch (error) {
    throw new Error(`Failed to generate cleansed MP3 blob: ${error?.message || String(error)}`);
  }

  if (!cleanedBlob) {
    throw new Error('MP3 metadata rewrite produced no output.');
  }

  return {
    blob: new Blob([cleanedBlob], { type: 'audio/mpeg' }),
    frameReport: { attemptedFrames, writtenFrames, skippedFrames },
  };
}
