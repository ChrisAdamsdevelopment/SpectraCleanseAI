"use strict";
const { exiftool } = require('exiftool-vendored');
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
  const metaToWrite = { 'ItemList:Title': safeTitle };
  if (safeArtist) metaToWrite['ItemList:Artist'] = safeArtist;
  if (safeProducer) {
    metaToWrite['ItemList:Producer'] = safeProducer;
    metaToWrite['Keys:Producer'] = safeProducer;
  }
  if (copyright) metaToWrite['ItemList:Copyright'] = copyright;
  if (tagsArray.length) metaToWrite['ItemList:Keyword'] = tagsArray;
  if (safeGenre) metaToWrite['ItemList:Genre'] = safeGenre;
  switch (platform) {
    case 'YouTube':
      if (safeDescription) { metaToWrite['ItemList:Description'] = safeDescription; metaToWrite['ItemList:Comment'] = safeDescription; }
      break;
    case 'Spotify':
    case 'Apple Music':
      if (safeDescription) metaToWrite['ItemList:Description'] = safeDescription;
      metaToWrite['ItemList:Album'] = safeTitle;
      metaToWrite['ItemList:ContentCreateDate'] = String(year);
      if (safeLyrics) metaToWrite['ItemList:Lyrics'] = safeLyrics;
      break;
    case 'TikTok': {
      const comment = `${safeTitle} ${tagsArray.map((t) => `#${t.replace(/\s/g, '')}`).join(' ')}`.trim();
      if (comment) metaToWrite['ItemList:Comment'] = comment.substring(0, 300);
      break;
    }
    default:
      if (safeDescription) { metaToWrite['ItemList:Description'] = safeDescription; metaToWrite['ItemList:Comment'] = safeDescription; }
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
  for (const field of QUICKTIME_TIMESTAMP_FIELDS) {
    try {
      await exiftool.write(outputPath, { [field]: timestamp }, ['-overwrite_original']);
    } catch {
      warnings.push(field);
    }
  }
  return warnings;
}

async function processMediaFile({ outputPath, platform = 'General', metadata = {} }) {
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
  try {
    await exiftool.write(outputPath, metaToWrite, ['-overwrite_original']);
    await exiftool.write(outputPath, {}, ['-XMP:all=', '-overwrite_original']);
  } catch {
    throw exiftoolFailureError('Server metadata rewrite failed while applying sanitized fields.');
  }
  const exportTimestamp = formatQuickTimeTimestamp();
  const timestampWriteWarnings = await writeQuickTimeTimestamps(outputPath, exportTimestamp);
  const finalTags = await exiftool.read(outputPath);
  const finalMarkers = detectMarkers(finalTags);
  const verification = verifyFinalState(finalTags);
  const qualityVerification = buildQualityVerification(finalTags, metadata, timestampWriteWarnings);
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
  return { report: { removedCount, removedTags, timestamp: new Date().toISOString(), exportTimestamp, status, summary, wipeVerificationPassed, finalVerificationPassed: verification.passed && qualityVerification.passed, detectedMarkersBefore: beforeMarkers, detectedMarkersFinal: finalMarkers, suspiciousResidual: verification.suspiciousResidual, unexpectedDescriptive: verification.unexpectedDescriptive, qualityVerification, verificationFindings: [...qualityVerification.failures, ...qualityVerification.warnings], allowedInjectedTags: Object.keys(metaToWrite).map((tag) => tag.replace(/^.*:/, '')).filter(isAllowedInjected), rewrittenTags: [...Object.keys(metaToWrite), ...QUICKTIME_TIMESTAMP_FIELDS] } };
}

module.exports = { processMediaFile, detectMarkers, verifyFinalState, buildMetaToWrite, buildQualityVerification, formatQuickTimeTimestamp, unsupportedCleanseError };
