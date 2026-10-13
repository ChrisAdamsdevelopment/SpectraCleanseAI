import { describe, expect, it } from 'vitest';
const { validateMetadata, metadataProvider } = require('../server/readiness/providers/metadata');
const { generateReport } = require('../server/readiness/report');
const { getEnabledProviders } = require('../server/readiness/providers');
require('../server/readiness/registerProviders');

const ids = (findings: any[]) => findings.map((f) => f.id);

describe('metadata validation provider', () => {
  it('flags missing required fields as criticals', () => {
    const out = validateMetadata({ metadata: {} });
    expect(ids(out)).toEqual(expect.arrayContaining(['metadata.missing_title', 'metadata.missing_artist']));
    const criticals = out.filter((f: any) => f.severity === 'critical');
    expect(criticals.length).toBe(2);
    expect(criticals.every((f: any) => f.status === 'fail')).toBe(true);
  });

  it('clean, complete metadata produces no findings', () => {
    const out = validateMetadata({ metadata: {
      title: 'Midnight Drive', artist: 'Nova', albumArtist: 'Nova',
      copyright: '© 2026 Nova', genre: 'house', tags: 'house, night',
    } });
    expect(out).toEqual([]);
  });

  it('detects featured-in-title and placeholder titles', () => {
    expect(ids(validateMetadata({ metadata: { title: 'Song (feat. X)', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' } })))
      .toContain('metadata.featured_in_title');
    expect(ids(validateMetadata({ metadata: { title: 'untitled', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' } })))
      .toContain('metadata.placeholder_title');
  });

  it('detects leading/trailing and doubled whitespace from the raw value', () => {
    expect(ids(validateMetadata({ metadata: { title: ' My Song ', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' } })))
      .toContain('metadata.whitespace_title');
    expect(ids(validateMetadata({ metadata: { title: 'My  Song', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' } })))
      .toContain('metadata.whitespace_title');
    // clean, single-spaced values do not trip the check
    expect(ids(validateMetadata({ metadata: { title: 'My Song', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' } })))
      .not.toContain('metadata.whitespace_title');
  });

  it('surfaces AI markers from file analysis with reduced confidence', () => {
    const out = validateMetadata({ metadata: { title: 'T', artist: 'A', copyright: '© 2026 A', genre: 'g', tags: 't' }, analysis: { detectedMarkers: ['Suno'] } });
    const marker = out.find((f: any) => f.id === 'metadata.ai_provenance_markers');
    expect(marker).toBeTruthy();
    expect(marker.confidence).toBeLessThan(1);
  });

  it('every finding carries the teaching + risk fields', () => {
    for (const f of validateMetadata({ metadata: {} })) {
      expect(f.what && f.why && f.howToFix && f.businessImpact).toBeTruthy();
      expect(typeof f.scoreImpact).toBe('number');
      expect(typeof f.estimatedFixMinutes).toBe('number');
    }
  });

  it('lights up a real report end to end', async () => {
    const report = await generateReport({ releaseId: 1, context: { metadata: {} }, providers: [metadataProvider] });
    expect(report.verdict.status).toBe('high_risk'); // missing title + artist
    const meta = report.categoryScores.find((c: any) => c.category === 'metadata');
    expect(meta.status).not.toBe('not_assessed');
    expect(report.prioritizedFixes[0].severity).toBe('critical');
    expect(report.prioritizedFixes[0].scoreGainIfResolved).toBeGreaterThan(0);
  });

  it('is registered and gated by the metadata_validation flag', () => {
    expect(getEnabledProviders({ FEATURES: 'metadata_validation' }).some((p: any) => p.category === 'metadata')).toBe(true);
    expect(getEnabledProviders({ FEATURES: '' }).some((p: any) => p.category === 'metadata')).toBe(false);
  });
});
