"use strict";
const { exiftool } = require('exiftool-vendored');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MARKER_RULES, isBenign, isAllowedInjected } = require('./metadataRules');

const ZERO_QUICKTIME_DATE = '0000:00:00 00:00:00';
const QUICKTIME_TIMESTAMP_FIELDS = [
  'QuickTime:CreateDate',
  'QuickTime:ModifyDate',
  'TrackCreateDate',
  'TrackModifyDate',
  'MediaCreateDate',
  'MediaModifyDate',
];
const QUICKTIME_TIMESTAMP_READ_KEYS = ['CreateDate', 'ModifyDate', 'TrackCreateDate', 'TrackModifyDate', 'MediaCreateDate', 'MediaModifyDate'];

function unsupportedCleanseError(message, detail) {
  const err = new Error(message);
  err.statusCode = 422;
  err.publicDetail = detail;
  err.reason = 'unsupported_file_type';
  return err;
}

function exiftoolFailureError(detail) {
  const err = new Error('Server metadata processing failed');
  err.statusCode = 500;
  err.publicDetail = detail;
  err.reason = 'exiftool_failure';
  return err;
}

function detectMarkers(tags = {}) { const hits = []; for (const [tag, raw] of Object.entries(tags)) { const value = raw == null ? '' : String(raw); for (const rule of MARKER_RULES) { const source = rule.valueOnly ? [value] : [tag, value]; if (rule.patterns.some((p) => source.some((s) => p.test(s)))) hits.push({ ruleId: rule.id, category: rule.category, severity: rule.severity, matchedTag: tag, matchedValue: value.substring(0, 120) }); } } return hits; }

function verifyFinalState(tags = {}) {
  const filtered = {};
  const unexpectedDescriptive = [];
  for (const [tag, value] of Object.entries(tags)) {
    if (isBenign(tag) || isAllowedInjected(tag)) continue;
    filtered[tag] = value;
    if (!tag.startsWith('Unknown')) unexpectedDescriptive.push(tag);
  }
  const detected = detectMarkers(filtered);
  const suspiciousResidual = detected.map((h) => ({ tag: h.matchedTag, markerCategory: h.category, severity: h.severity }));
  return { passed: suspiciousResidual.length === 0, suspiciousResidual, unexpectedDescriptive: [...new Set(unexpectedDescriptive)] };
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().substring(0, maxLength);
}

function buildMetaToWrite(platform, metadata = {}) {
  const safeTitle = cleanText(metadata.title || 'Untitled', 255);
  const safeArtist = cleanText(metadata.artist, 255);
  const contextText = [metadata.title, metadata.description, metadata.tags, metadata.lyrics].flat().filter(Boolean).join(' ');
  const inferredProducer = /\bTriple7\b/i.test(contextText) ? 'Triple7' : '';
  const safeProducer = cleanText(metadata.producer || inferredProducer, 255);
  const safeDescription = cleanText(metadata.description, 1000);
  const safeGenre = cleanText(metadata.genre, 100);
  const safeCopyright = cleanText(metadata.copyright, 500);
  const safeLyrics = cleanText(metadata.lyrics, 5000);
  const year = new Date().getUTCFullYear();
  const tagsArray = (Array.isArray(metadata.tags) ? metadata.tags : String(metadata.tags || '').split(','))
    .map((t) => cleanText(t, 100))
    .filter(Boolean);
  const copyright = safeCopyright || (safeArtist ? `© ${year} ${safeArtist}` : '');
  const metaToWrite = {
    'ItemList:Title': safeTitle,
    'QuickTime:Title': safeTitle,
    'Keys:Title': safeTitle,
    'Keys:DisplayName': safeTitle,
  };
  if (safeArtist) {
    metaToWrite['ItemList:Artist'] = safeArtist;
    metaToWrite['QuickTime:Artist'] = safeArtist;
    metaToWrite['ItemList:Author'] = safeArtist;
    metaToWrite['ItemList:AlbumArtist'] = safeArtist;
    metaToWrite['Keys:Artist'] = safeArtist;
    metaToWrite['Keys:Author'] = safeArtist;
  }
  if (safeProducer) {
    metaToWrite['ItemList:Producer'] = safeProducer;
    metaToWrite['Keys:Producer'] = safeProducer;
  }
  if (copyright) {
    metaToWrite['ItemList:Copyright'] = copyright;
    metaToWrite['QuickTime:Copyright'] = copyright;
    metaToWrite['Keys:Copyright'] = copyright;
  }
  if (tagsArray.length) {
    metaToWrite['ItemList:Keyword'] = tagsArray;
    metaToWrite['Keys:Keywords'] = tagsArray;
  }
  if (safeGenre) {
    metaToWrite['ItemList:Genre'] = safeGenre;
    metaToWrite['QuickTime:Genre'] = safeGenre;
    metaToWrite['Keys:Genre'] = safeGenre;
  }
  switch (platform) {
    case 'YouTube':
      if (safeDescription) {
        metaToWrite['ItemList:Description'] = safeDescription;
        metaToWrite['ItemList:Comment'] = safeDescription;
        metaToWrite['QuickTime:Description'] = safeDescription;
        metaToWrite['QuickTime:Comment'] = safeDescription;
        metaToWrite['Keys:Description'] = safeDescription;
        metaToWrite['Keys:Comment'] = safeDescription;
      }
      break;
    case 'Spotify':
    case 'Apple Music':
      if (safeDescription) {
        metaToWrite['ItemList:Description'] = safeDescription;
        metaToWrite['QuickTime:Description'] = safeDescription;
        metaToWrite['Keys:Description'] = safeDescription;
      }
      metaToWrite['ItemList:Album'] = safeTitle;
      metaToWrite['ItemList:ContentCreateDate'] = String(year);
      if (safeLyrics) metaToWrite['ItemList:Lyrics'] = safeLyrics;
      break;
    case 'TikTok': {
      const comment = `${safeTitle} ${tagsArray.map((t) => `#${t.replace(/\s/g, '')}`).join(' ')}`.trim();
      if (comment) {
        const safeComment = comment.substring(0, 300);
        metaToWrite['ItemList:Comment'] = safeComment;
        metaToWrite['QuickTime:Comment'] = safeComment;
        metaToWrite['Keys:Comment'] = safeComment;
      }
      break;
    }
    default:
      if (safeDescription) {
        metaToWrite['ItemList:Description'] = safeDescription;
        metaToWrite['ItemList:Comment'] = safeDescription;
        metaToWrite['QuickTime:Description'] = safeDescription;
        metaToWrite['QuickTime:Comment'] = safeDescription;
        metaToWrite['Keys:Description'] = safeDescription;
        metaToWrite['Keys:Comment'] = safeDescription;
      }
  }
  return metaToWrite;
}

function formatQuickTimeTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function stringifyValue(value) {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value || '');
}

function buildMetadataSnapshot(tags = {}) {
  return {
    Title: tags.Title,
    Artist: tags.Artist,
    Producer: tags.Producer,
    Copyright: tags.Copyright,
    Genre: tags.Genre,
    Keyword: tags.Keyword,
    Keywords: tags.Keywords,
    Description: tags.Description,
    Comment: tags.Comment,
  };
}

function sha256Text(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function redactLongTextField(value) {
  const text = stringifyValue(value);
  return { length: text.length, sha256: sha256Text(text) };
}

function hasDescriptiveMetadata(snapshot = {}) {
  return Boolean(snapshot.Title || snapshot.Artist || snapshot.Producer || snapshot.Copyright || snapshot.Genre || snapshot.Keyword || snapshot.Keywords || snapshot.Description || snapshot.Comment);
}

function classifyMetadataPersistenceStage(snapshots = {}, hashes = {}) {
  const hasAfterWrite = hasDescriptiveMetadata(snapshots.after_descriptive_metadata_write);
  const hasAfterXmp = hasDescriptiveMetadata(snapshots.after_xmp_cleanup);
  const hasFinal = hasDescriptiveMetadata(snapshots.after_timestamp_write_final);
  if (!hasAfterWrite) return 'metadata_missing_after_descriptive_write';
  if (hasAfterWrite && !hasAfterXmp) return 'metadata_removed_by_xmp_cleanup';
  if (hasAfterXmp && !hasFinal) return 'metadata_removed_by_timestamp_write';
  const mismatch = hashes.after_xmp_cleanup && hashes.after_timestamp_write_final && hashes.after_xmp_cleanup !== hashes.after_timestamp_write_final && hasAfterXmp && hasFinal;
  if (mismatch) return 'metadata_present_in_snapshots_but_report_or_download_mismatch';
  return 'metadata_present_and_verified';
}

async function deepSnapshot(stage, outputPath, runId, exiftoolVersion) {
  const stats = await fs.promises.stat(outputPath);
  // Prefer readRaw for deep diagnostics with explicit ExifTool args. If unavailable in older exiftool-vendored versions,
  // fallback to read() so diagnostics remain functional.
  const raw = typeof exiftool.readRaw === 'function'
    ? await exiftool.readRaw(outputPath, ['-a', '-u', '-ee3', '-api', 'RequestAll=3', '-G1', '-s'])
    : await exiftool.read(outputPath);
  const lines = Array.isArray(raw) ? raw.map((line) => String(line)) : String(raw || '').split(/\r?\n/);
  const includePrefixes = ['ItemList:', 'Keys:', 'UserData:', 'QuickTime:', 'Track1:', 'Track2:', 'XMP-', 'XMP:'];
  const includeFields = ['Title', 'DisplayName', 'Artist', 'AlbumArtist', 'Author', 'Producer', 'Copyright', 'Genre', 'Keyword', 'Keywords', 'Description', 'Comment', 'CreateDate', 'ModifyDate', 'TrackCreateDate', 'TrackModifyDate', 'MediaCreateDate', 'MediaModifyDate', 'XMPToolkit', 'Image::ExifTool'];
  const selectedMetadata = [];
  for (const line of lines) {
    if (!line || !line.includes(':')) continue;
    const isMatch = includePrefixes.some((p) => line.includes(p)) || includeFields.some((f) => line.includes(f));
    if (!isMatch || /lyrics/i.test(line)) continue;
    if (/Description|Comment/.test(line)) {
      const [, rawValue = ''] = line.split(/:\s+(.+)/);
      selectedMetadata.push(`${line.split(/:\s+/)[0]}: [redacted length=${rawValue.length} sha256=${sha256Text(rawValue)}]`);
      continue;
    }
    selectedMetadata.push(line);
  }
  return {
    runId,
    stage,
    outputBasename: path.basename(outputPath),
    exiftoolVersion,
    sha256: await sha256File(outputPath),
    fileStats: { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, inode: stats.ino ?? null },
    selectedMetadata,
  };
}

function readAnyTag(tags, keys) {
  for (const key of keys) if (tags[key] != null && tags[key] !== '') return tags[key];
  return '';
}

function valuesContain(tags, needle) {
  return Object.values(tags).some((value) => stringifyValue(value).includes(needle));
}

function buildQualityVerification(tags = {}, metadata = {}, timestampWriteWarnings = []) {
  const failures = [];
  const warnings = timestampWriteWarnings.map((field) => ({ code: 'timestamp_write_skipped', field, message: `${field} could not be updated safely by ExifTool.` }));
  const expected = {
    title: cleanText(metadata.title || 'Untitled', 255),
    artist: cleanText(metadata.artist, 255),
    producer: cleanText(metadata.producer, 255),
    copyright: cleanText(metadata.copyright, 500) || (cleanText(metadata.artist, 255) ? `© ${new Date().getUTCFullYear()} ${cleanText(metadata.artist, 255)}` : ''),
  };
  if (tags.XMPToolkit) failures.push({ code: 'xmp_toolkit_present', field: 'XMPToolkit', message: 'XMPToolkit remains in final output.' });
  if (valuesContain(tags, 'Image::ExifTool')) failures.push({ code: 'exiftool_trace_present', message: 'An Image::ExifTool trace value remains in final output.' });
  const artist = stringifyValue(readAnyTag(tags, ['Artist', 'ItemList:Artist']));
  const producer = stringifyValue(readAnyTag(tags, ['Producer', 'ItemList:Producer', 'Keys:Producer']));
  const copyright = stringifyValue(readAnyTag(tags, ['Copyright', 'ItemList:Copyright']));
  if (expected.artist && expected.artist !== 'Creator' && artist === 'Creator') failures.push({ code: 'generic_artist_injected', field: 'Artist', message: 'Generic Creator artist remains despite user-provided artist metadata.' });
  if ((expected.artist && expected.artist !== 'Creator') || (expected.copyright && expected.copyright !== `© ${new Date().getUTCFullYear()} Creator`)) {
    if (copyright === `© ${new Date().getUTCFullYear()} Creator`) failures.push({ code: 'generic_copyright_injected', field: 'Copyright', message: 'Generic Creator copyright remains despite user-provided metadata.' });
  }
  for (const field of QUICKTIME_TIMESTAMP_READ_KEYS) {
    if (stringifyValue(tags[field]).includes(ZERO_QUICKTIME_DATE)) failures.push({ code: 'zero_quicktime_timestamp', field, message: `${field} is still zeroed.` });
  }
  if (expected.title && !stringifyValue(readAnyTag(tags, ['Title']))) failures.push({ code: 'expected_title_missing', field: 'Title', message: 'Expected title is missing.' });
  if (expected.artist && !artist) failures.push({ code: 'expected_artist_missing', field: 'Artist', message: 'Expected artist is missing.' });
  if (expected.copyright && !copyright) failures.push({ code: 'expected_copyright_missing', field: 'Copyright', message: 'Expected copyright is missing.' });
  if (expected.producer && !producer) failures.push({ code: 'expected_producer_missing', field: 'Producer', message: 'Expected producer is missing.' });
  return { passed: failures.length === 0, failures, warnings, expected };
}

async function writeQuickTimeTimestamps(outputPath, timestamp) {
  const warnings = [];
  const timestampMap = Object.fromEntries(QUICKTIME_TIMESTAMP_FIELDS.map((field) => [field, timestamp]));
  try {
    await exiftool.write(outputPath, timestampMap, ['-overwrite_original']);
  } catch {
    warnings.push(...QUICKTIME_TIMESTAMP_FIELDS);
  }
  return warnings;
}

async function processMediaFile({ outputPath, platform = 'General', metadata = {} }) {
  const runId = crypto.randomUUID();
  const exiftoolVersion = await exiftool.version();
  console.info('[process] start', { runId, outputBasename: path.basename(outputPath), exiftoolVersion });
  const fileHashesByStage = {};
  const deepSnapshotsByStage = {};
  fileHashesByStage.before = await sha256File(outputPath);
  deepSnapshotsByStage.before = await deepSnapshot('before', outputPath, runId, exiftoolVersion);
  const beforeTags = await exiftool.read(outputPath);
  const beforeKeys = Object.keys(beforeTags);
  const beforeMarkers = detectMarkers(beforeTags);
  try { await exiftool.write(outputPath, {}, ['-all=', '-XMP:all=', '-IPTC:all=', '-overwrite_original']); } catch { throw unsupportedCleanseError('Server cleanse unsupported for this format', 'This file format cannot be safely metadata-wiped on the server. Use Quick Cleanse (Browser) for MP3 or try MP4/M4A/WAV/FLAC for Full Server Cleanse.'); }
  const wipeTags = await exiftool.read(outputPath);
  const wipeMarkers = detectMarkers(wipeTags);
  const wipeVerificationPassed = wipeMarkers.length === 0;
  const metaToWrite = buildMetaToWrite(platform, metadata);
  const metaToWriteWithoutLyrics = Object.fromEntries(Object.entries(metaToWrite).filter(([key]) => !/lyrics/i.test(key)));
  console.info('[process] metadata write map', metaToWriteWithoutLyrics);
  let afterMetadataWriteSnapshot = {};
  let afterXmpCleanupSnapshot = {};
  try {
    await exiftool.write(outputPath, metaToWrite, ['-overwrite_original']);
    const afterMetadataWriteTags = await exiftool.read(outputPath);
    afterMetadataWriteSnapshot = buildMetadataSnapshot(afterMetadataWriteTags);
    afterMetadataWriteSnapshot.Description = afterMetadataWriteSnapshot.Description == null ? undefined : redactLongTextField(afterMetadataWriteSnapshot.Description);
    afterMetadataWriteSnapshot.Comment = afterMetadataWriteSnapshot.Comment == null ? undefined : redactLongTextField(afterMetadataWriteSnapshot.Comment);
    fileHashesByStage.after_descriptive_metadata_write = await sha256File(outputPath);
    deepSnapshotsByStage.after_descriptive_metadata_write = await deepSnapshot('after_descriptive_metadata_write', outputPath, runId, exiftoolVersion);
    console.info('[process] after metadata write snapshot', afterMetadataWriteSnapshot);
    await exiftool.write(outputPath, {}, ['-XMP:all=', '-XMP:XMPToolkit=', '-overwrite_original']);
    const afterXmpCleanupTags = await exiftool.read(outputPath);
    const preservedAfterXmpCleanup = hasDescriptiveMetadata(buildMetadataSnapshot(afterXmpCleanupTags));
    if (!preservedAfterXmpCleanup) {
      await exiftool.write(outputPath, metaToWrite, ['-overwrite_original']);
      await exiftool.write(outputPath, {}, ['-XMP-dc:all=', '-XMP-pdf:all=', '-XMP-tiff:all=', '-XMP-xmpDM:all=', '-XMP-x:XMPToolkit=', '-overwrite_original']);
    }
    const finalXmpCleanupTags = preservedAfterXmpCleanup ? afterXmpCleanupTags : await exiftool.read(outputPath);
    afterXmpCleanupSnapshot = buildMetadataSnapshot(finalXmpCleanupTags);
    afterXmpCleanupSnapshot.Description = afterXmpCleanupSnapshot.Description == null ? undefined : redactLongTextField(afterXmpCleanupSnapshot.Description);
    afterXmpCleanupSnapshot.Comment = afterXmpCleanupSnapshot.Comment == null ? undefined : redactLongTextField(afterXmpCleanupSnapshot.Comment);
    fileHashesByStage.after_xmp_cleanup = await sha256File(outputPath);
    deepSnapshotsByStage.after_xmp_cleanup = await deepSnapshot('after_xmp_cleanup', outputPath, runId, exiftoolVersion);
    console.info('[process] after XMP cleanup snapshot', afterXmpCleanupSnapshot);
  } catch {
    throw exiftoolFailureError('Server metadata rewrite failed while applying sanitized fields.');
  }
  const exportTimestamp = formatQuickTimeTimestamp();
  const timestampWriteWarnings = await writeQuickTimeTimestamps(outputPath, exportTimestamp);
  const finalTags = await exiftool.read(outputPath);
  const finalMetadataSnapshot = buildMetadataSnapshot(finalTags);
  finalMetadataSnapshot.Description = finalMetadataSnapshot.Description == null ? undefined : redactLongTextField(finalMetadataSnapshot.Description);
  finalMetadataSnapshot.Comment = finalMetadataSnapshot.Comment == null ? undefined : redactLongTextField(finalMetadataSnapshot.Comment);
  fileHashesByStage.after_timestamp_write_final = await sha256File(outputPath);
  deepSnapshotsByStage.after_timestamp_write_final = await deepSnapshot('after_timestamp_write_final', outputPath, runId, exiftoolVersion);
  console.info('[process] final metadata snapshot', finalMetadataSnapshot);
  const finalMarkers = detectMarkers(finalTags);
  const verification = verifyFinalState(finalTags);
  const qualityVerification = buildQualityVerification(finalTags, metadata, timestampWriteWarnings);
  if (!finalMetadataSnapshot.Artist || !finalMetadataSnapshot.Producer || !finalMetadataSnapshot.Copyright) {
    qualityVerification.failures.push({
      code: 'final_metadata_snapshot_missing_required_fields',
      message: 'Final metadata snapshot is missing Artist, Producer, or Copyright.',
      fields: {
        Artist: finalMetadataSnapshot.Artist || '',
        Producer: finalMetadataSnapshot.Producer || '',
        Copyright: finalMetadataSnapshot.Copyright || '',
      },
    });
    qualityVerification.passed = false;
  }
  const removedTags = beforeKeys.filter((k) => !(k in finalTags));
  const removedCount = beforeMarkers.length;
  const status = (!wipeVerificationPassed || finalMarkers.length > 0 || !qualityVerification.passed)
    ? 'review_required'
    : (verification.unexpectedDescriptive.length > 0 || qualityVerification.warnings.length > 0 ? 'clean_with_notes' : 'clean');
  const seo = '';
  const summary = status === 'review_required'
    ? `Residual provenance or metadata-quality issues detected. Manual review required.${seo}`
    : status === 'clean_with_notes'
      ? `${removedCount} marker(s) removed. Some non-standard tags or timestamp-write notes remain.${seo}`
      : `${removedCount} forensic marker(s) removed. Verification passed.${seo}`;
  const metadataPersistenceStage = classifyMetadataPersistenceStage({
    after_descriptive_metadata_write: afterMetadataWriteSnapshot,
    after_xmp_cleanup: afterXmpCleanupSnapshot,
    after_timestamp_write_final: finalMetadataSnapshot,
  }, fileHashesByStage);
  // Future fallback options (diagnostics-first): GPAC/MP4Box (strong candidate for descriptive QT/iTunes tags incl. producer),
  // AtomicParsley (good iTunes-style coverage, producer may be limited), FFmpeg mdta remux (easy but mapping can vary),
  // Bento4 (low-level ISO BMFF control via custom sidecar strategy).
  return { report: { runId, exiftoolVersion, fileHashesByStage, deepSnapshotsByStage, metadataPersistenceStage, removedCount, removedTags, timestamp: new Date().toISOString(), exportTimestamp, status, summary, wipeVerificationPassed, finalVerificationPassed: verification.passed && qualityVerification.passed, detectedMarkersBefore: beforeMarkers, detectedMarkersFinal: finalMarkers, suspiciousResidual: verification.suspiciousResidual, unexpectedDescriptive: verification.unexpectedDescriptive, qualityVerification, verificationFindings: [...qualityVerification.failures, ...qualityVerification.warnings], afterMetadataWriteSnapshot, afterXmpCleanupSnapshot, finalMetadataSnapshot, allowedInjectedTags: Object.keys(metaToWrite).map((tag) => tag.replace(/^.*:/, '')).filter(isAllowedInjected), rewrittenTags: [...Object.keys(metaToWrite), ...QUICKTIME_TIMESTAMP_FIELDS] } };
}

module.exports = { processMediaFile, detectMarkers, verifyFinalState, buildMetaToWrite, buildQualityVerification, formatQuickTimeTimestamp, unsupportedCleanseError, classifyMetadataPersistenceStage };
