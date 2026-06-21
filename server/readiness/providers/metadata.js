"use strict";

/**
 * Metadata validation provider (Module 2 / Phase 2).
 *
 * A CheckProvider that inspects the release metadata (and optional file analysis)
 * and emits findings in the shared schema. Findings are authored as RISK, not
 * technical nitpicks: each carries a businessImpact, a plain-English why, a
 * concrete fix, an estimated fix time, and a score impact.
 *
 * Pure logic lives in validateMetadata() so it is unit-testable without the
 * registry or HTTP layer.
 */

const { CATEGORY, SEVERITY, BUSINESS_IMPACT, CHECK_STATUS } = require('../findings');

const PLACEHOLDER_TITLES = ['untitled', 'track', 'new recording', 'audio', 'final', 'master', 'mixdown'];
const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F]");
const FEATURED = /\b(feat\.?|featuring|ft\.?)\b/i;

const clean = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

function f(over) {
  return {
    category: CATEGORY.METADATA,
    status: CHECK_STATUS.WARN,
    confidence: 1,
    ...over,
  };
}

function validateMetadata(context = {}) {
  const m = context.metadata || {};
  const analysis = context.analysis || null;
  const findings = [];

  const title = clean(m.title);
  const artist = clean(m.artist);
  const albumArtist = clean(m.albumArtist);
  const copyright = clean(m.copyright);
  const genre = clean(m.genre);
  const tags = clean(m.tags);

  // ── Required fields (revenue / distribution risk) ───────────────────────────
  if (!title) {
    findings.push(f({
      id: 'metadata.missing_title', severity: SEVERITY.CRITICAL, status: CHECK_STATUS.FAIL,
      title: 'No track title', what: 'The release has no title.',
      why: 'Stores reject submissions without a title, and the release will not be findable.',
      businessImpact: BUSINESS_IMPACT.REJECTION, howToFix: 'Enter the exact title as it should appear on streaming services.',
      scoreImpact: 40, estimatedFixMinutes: 1, field: 'title',
    }));
  }
  if (!artist) {
    findings.push(f({
      id: 'metadata.missing_artist', severity: SEVERITY.CRITICAL, status: CHECK_STATUS.FAIL,
      title: 'No artist name', what: 'No primary artist is credited.',
      why: 'Distributors withhold royalties and may reject releases with no primary artist credited.',
      businessImpact: BUSINESS_IMPACT.REVENUE_WITHHELD, howToFix: 'Enter the primary artist exactly as it appears on your other releases.',
      scoreImpact: 40, estimatedFixMinutes: 1, field: 'artist',
    }));
  }

  // ── Placeholder / formatting (distribution risk) ────────────────────────────
  if (title) {
    const lower = title.toLowerCase();
    if (PLACEHOLDER_TITLES.includes(lower) || /^track\s*\d+$/i.test(title)) {
      findings.push(f({
        id: 'metadata.placeholder_title', severity: SEVERITY.WARNING, confidence: 0.85,
        title: 'Title looks like a placeholder', what: `The title "${title}" looks like a working name.`,
        why: 'Placeholder titles get flagged in manual review and look unprofessional on stores.',
        businessImpact: BUSINESS_IMPACT.REJECTION, howToFix: 'Replace it with the real title of the song.',
        scoreImpact: 15, estimatedFixMinutes: 1, field: 'title',
      }));
    }
    if (FEATURED.test(title)) {
      findings.push(f({
        id: 'metadata.featured_in_title', severity: SEVERITY.WARNING, confidence: 0.9,
        title: 'Featured artist is inside the title', what: 'The title contains "feat." / "featuring".',
        why: 'Most stores require featured artists in a separate credit field; putting it in the title can cause rejection.',
        businessImpact: BUSINESS_IMPACT.REJECTION, howToFix: 'Move the featured artist into the artist/credits field and remove "feat." from the title.',
        scoreImpact: 15, estimatedFixMinutes: 2, field: 'title',
      }));
    }
    if (title.length > 2 && title === title.toUpperCase() && /[A-Z]/.test(title)) {
      findings.push(f({
        id: 'metadata.allcaps_title', severity: SEVERITY.INFO,
        title: 'Title is in all caps', what: 'The title is entirely uppercase.',
        why: 'Several stores auto-correct or reject all-caps titles under their style guides.',
        businessImpact: BUSINESS_IMPACT.DELAY, howToFix: 'Use normal capitalization unless the styling is intentional.',
        scoreImpact: 0, estimatedFixMinutes: 1, field: 'title',
      }));
    }
  }

  for (const [field, value] of [['title', title], ['artist', artist], ['copyright', copyright]]) {
    if (!value) continue;
    if (value !== clean(m[field]) || /\s{2,}/.test(value)) {
      findings.push(f({
        id: `metadata.whitespace_${field}`, severity: SEVERITY.WARNING,
        title: `${field} has irregular spacing`, what: `The ${field} has leading, trailing, or doubled spaces.`,
        why: 'Stray spaces cause duplicate artist/title pages and failed metadata matching across platforms.',
        businessImpact: BUSINESS_IMPACT.REDUCED_REACH, howToFix: `Trim and single-space the ${field}.`,
        scoreImpact: 8, estimatedFixMinutes: 1, field,
      }));
    }
    if (CONTROL_CHARS.test(value)) {
      findings.push(f({
        id: `metadata.control_chars_${field}`, severity: SEVERITY.WARNING,
        title: `${field} contains hidden characters`, what: `The ${field} contains invisible control characters.`,
        why: 'Invisible characters break ingestion at some distributors and corrupt search indexing.',
        businessImpact: BUSINESS_IMPACT.REJECTION, howToFix: `Retype the ${field} in plain text.`,
        scoreImpact: 10, estimatedFixMinutes: 1, field,
      }));
    }
  }

  // ── Consistency ─────────────────────────────────────────────────────────────
  if (artist && albumArtist) {
    const a = artist.toLowerCase();
    const b = albumArtist.toLowerCase();
    if (a !== b && !a.includes(b) && !b.includes(a)) {
      findings.push(f({
        id: 'metadata.artist_albumartist_mismatch', severity: SEVERITY.INFO,
        title: 'Artist and album artist differ', what: `Artist "${artist}" and album artist "${albumArtist}" do not match.`,
        why: 'A mismatch is fine for compilations/features but otherwise splits your catalog across two artist pages.',
        businessImpact: BUSINESS_IMPACT.REDUCED_REACH, howToFix: 'Make album artist match the primary artist unless this is deliberately a various-artists release.',
        scoreImpact: 0, estimatedFixMinutes: 1, field: 'albumArtist',
      }));
    }
  }

  // ── Rights / copyright (revenue risk) ───────────────────────────────────────
  if (!copyright) {
    findings.push(f({
      id: 'metadata.missing_copyright', severity: SEVERITY.WARNING,
      title: 'No copyright line', what: 'The release has no copyright line.',
      why: 'A missing copyright weakens your ownership claim and is required by some distributors.',
      businessImpact: BUSINESS_IMPACT.ROYALTY_LOSS,
      howToFix: artist ? `Add a line like "© ${new Date().getUTCFullYear()} ${artist}".` : 'Add a copyright line, e.g. "© <year> <your name or label>".',
      scoreImpact: 12, estimatedFixMinutes: 1, field: 'copyright',
    }));
  } else if (!/©|\(c\)|copyright/i.test(copyright)) {
    findings.push(f({
      id: 'metadata.copyright_format', severity: SEVERITY.INFO,
      title: 'Copyright line has no © symbol', what: 'The copyright field is present but not in a recognizable format.',
      why: 'Stores expect a recognizable copyright format; without it the field may be ignored.',
      businessImpact: BUSINESS_IMPACT.ROYALTY_LOSS, howToFix: 'Format it as "© <year> <owner>".',
      scoreImpact: 3, estimatedFixMinutes: 1, field: 'copyright',
    }));
  }

  // ── Discoverability ─────────────────────────────────────────────────────────
  if (!genre) {
    findings.push(f({
      id: 'metadata.missing_genre', severity: SEVERITY.INFO,
      title: 'No genre set', what: 'The release has no genre.',
      why: 'Genre drives playlist placement and recommendations; leaving it blank limits reach.',
      businessImpact: BUSINESS_IMPACT.REDUCED_REACH, howToFix: 'Pick the closest primary genre for the track.',
      scoreImpact: 4, estimatedFixMinutes: 1, field: 'genre',
    }));
  }
  if (!tags) {
    findings.push(f({
      id: 'metadata.missing_tags', severity: SEVERITY.INFO,
      title: 'No tags or keywords', what: 'No descriptive tags were provided.',
      why: 'Tags help search and "fans also like" surfaces; an empty set leaves discovery on the table.',
      businessImpact: BUSINESS_IMPACT.REDUCED_REACH, howToFix: 'Add a few comma-separated tags for mood, genre, and similar artists.',
      scoreImpact: 3, estimatedFixMinutes: 2, field: 'tags',
    }));
  }

  // ── AI provenance residue (reuses existing analysis) ────────────────────────
  const markers = analysis && Array.isArray(analysis.detectedMarkers) ? analysis.detectedMarkers : [];
  if (markers.length > 0) {
    findings.push(f({
      id: 'metadata.ai_provenance_markers', severity: SEVERITY.WARNING, confidence: 0.7,
      title: 'AI-tool markers found in the file', what: `Embedded markers detected: ${markers.slice(0, 5).join(', ')}.`,
      why: 'AI-tool residue in the file can trigger automated AI flags at distributors and platforms.',
      businessImpact: BUSINESS_IMPACT.ACCOUNT_RISK,
      howToFix: 'Decide deliberately: disclose the AI use (AI credits builder) or clean the markers before release.',
      scoreImpact: 12, estimatedFixMinutes: 5, field: 'file',
    }));
  } else if (analysis && analysis.parseError) {
    findings.push(f({
      id: 'metadata.parse_fallback', severity: SEVERITY.INFO,
      title: 'Some metadata could not be read', what: 'The parser fell back to defaults for some fields.',
      why: 'When fields fall back to defaults, real values may be missing without you noticing.',
      businessImpact: BUSINESS_IMPACT.DELAY, howToFix: 'Double-check the fields above against your source file.',
      scoreImpact: 2, estimatedFixMinutes: 2, field: 'file',
    }));
  }

  return findings;
}

const metadataProvider = {
  category: CATEGORY.METADATA,
  featureFlag: 'metadata_validation',
  evaluate: (context) => validateMetadata(context),
};

module.exports = { metadataProvider, validateMetadata };
