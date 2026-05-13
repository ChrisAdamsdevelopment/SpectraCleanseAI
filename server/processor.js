"use strict";
const { exiftool } = require('exiftool-vendored');
const { MARKER_RULES, isBenign, isAllowedInjected } = require('./metadataRules');

function unsupportedCleanseError(message, detail) {
  const err = new Error(message);
  err.statusCode = 422;
  err.publicDetail = detail;
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

function buildMetaToWrite(platform, metadata = {}) {
  const { title, description, tags, artist, genre, lyrics } = metadata;
  const safeArtist = (artist || 'Creator').substring(0, 255);
  const safeTitle = (title || 'Untitled').substring(0, 255);
  const safeDescription = (description || '').substring(0, 1000);
  const safeGenre = (genre || '').substring(0, 100);
  const year = new Date().getFullYear();
  const tagsArray = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map((t) => String(t).trim()).filter(Boolean);
  const metaToWrite = { Title: safeTitle, Artist: safeArtist, Copyright: `© ${year} ${safeArtist}`, Keywords: tagsArray, Genre: safeGenre };
  switch (platform) { case 'YouTube': metaToWrite.Description = safeDescription; metaToWrite.Comment = safeDescription; break; case 'Spotify': case 'Apple Music': metaToWrite.Description = safeDescription; metaToWrite.Album = safeTitle; metaToWrite.Year = year; if (lyrics) metaToWrite['Lyrics-eng'] = String(lyrics).substring(0, 5000); break; case 'TikTok': metaToWrite.Comment = `${safeTitle} ${tagsArray.map((t) => `#${t.replace(/\s/g, '')}`).join(' ')}`.substring(0, 300); break; default: metaToWrite.Description = safeDescription; metaToWrite.Comment = safeDescription; }
  return metaToWrite;
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
  await exiftool.write(outputPath, metaToWrite, ['-overwrite_original']);
  const finalTags = await exiftool.read(outputPath);
  const finalMarkers = detectMarkers(finalTags);
  const verification = verifyFinalState(finalTags);
  const removedTags = beforeKeys.filter((k) => !(k in finalTags));
  const removedCount = beforeMarkers.length;
  const status = (!wipeVerificationPassed || finalMarkers.length > 0) ? 'review_required' : (verification.unexpectedDescriptive.length > 0 ? 'clean_with_notes' : 'clean');
  const seo = '';
  const summary = status === 'review_required' ? `Residual provenance markers detected. Manual review required.${seo}` : status === 'clean_with_notes' ? `${removedCount} marker(s) removed. Some non-standard tags remain (not provenance).${seo}` : `${removedCount} forensic marker(s) removed. Verification passed.${seo}`;
  return { report: { removedCount, removedTags, timestamp: new Date().toISOString(), status, summary, wipeVerificationPassed, finalVerificationPassed: verification.passed, detectedMarkersBefore: beforeMarkers, detectedMarkersFinal: finalMarkers, suspiciousResidual: verification.suspiciousResidual, unexpectedDescriptive: verification.unexpectedDescriptive, allowedInjectedTags: Object.keys(metaToWrite).filter(isAllowedInjected), rewrittenTags: Object.keys(metaToWrite) } };
}

module.exports = { processMediaFile, detectMarkers, verifyFinalState, buildMetaToWrite, unsupportedCleanseError };
