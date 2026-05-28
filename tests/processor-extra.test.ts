import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildMetaToWrite, detectMarkers, verifyFinalState, buildQualityVerification, formatQuickTimeTimestamp } = require('../server/processor');

describe('processor: buildMetaToWrite', () => {
  it('omits Artist/Producer/Copyright tags when those fields are blank', () => {
    const meta = buildMetaToWrite('General', { title: 'Just A Title' });
    expect(meta['ItemList:Title']).toBe('Just A Title');
    expect(meta['ItemList:Artist']).toBeUndefined();
    expect(meta['ItemList:Producer']).toBeUndefined();
    expect(meta['ItemList:Copyright']).toBeUndefined();
  });

  it('synthesizes copyright from artist + current UTC year when copyright omitted', () => {
    const year = new Date().getUTCFullYear();
    const meta = buildMetaToWrite('General', { artist: 'Solo Artist' });
    expect(meta['ItemList:Copyright']).toBe(`© ${year} Solo Artist`);
    expect(meta['QuickTime:Copyright']).toBe(`© ${year} Solo Artist`);
  });

  it('TikTok platform produces a hashtagged comment from title + tags', () => {
    const meta = buildMetaToWrite('TikTok', { title: 'Vibes', tags: 'trap, hip hop' });
    expect(typeof meta['ItemList:Comment']).toBe('string');
    expect(meta['ItemList:Comment']).toContain('Vibes');
    expect(meta['ItemList:Comment']).toContain('#trap');
    expect(meta['ItemList:Comment']).toContain('#hiphop');
  });

  it('Spotify/Apple Music platform copies title to album and writes lyrics when provided', () => {
    const meta = buildMetaToWrite('Spotify', { title: 'Song', lyrics: 'la la la' });
    expect(meta['ItemList:Album']).toBe('Song');
    expect(meta['ItemList:Lyrics']).toBe('la la la');
  });
});

describe('processor: detectMarkers + verifyFinalState', () => {
  it('detectMarkers returns hits for known AI provenance markers', () => {
    const hits = detectMarkers({ XMPToolkit: 'Adobe XMP', 'Image::ExifTool': 'Image::ExifTool 13.0', SunoTag: 'suno-track-id-xyz' });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('detectMarkers returns no hits for empty/benign tag bag', () => {
    expect(detectMarkers({})).toEqual([]);
    expect(detectMarkers({ Title: 'Hello', Artist: 'Joe' })).toEqual([]);
  });

  it('verifyFinalState reports passed=true for benign-only tags', () => {
    const result = verifyFinalState({ Title: 'Hello', Artist: 'Joe' });
    expect(result.passed).toBe(true);
    expect(result.suspiciousResidual).toEqual([]);
  });
});

describe('processor: buildQualityVerification format rejection cues', () => {
  it('flags missing artist/producer/copyright when expected values are supplied', () => {
    const result = buildQualityVerification({}, { title: 'T', artist: 'A', producer: 'P', copyright: '©' });
    expect(result.passed).toBe(false);
    expect(result.failures.map((f: any) => f.code)).toEqual(
      expect.arrayContaining(['expected_artist_missing', 'expected_copyright_missing', 'expected_producer_missing'])
    );
  });
});

describe('processor: formatQuickTimeTimestamp', () => {
  it('formats date as YYYY:MM:DD HH:MM:SS in UTC', () => {
    const stamp = formatQuickTimeTimestamp(new Date('2026-05-27T01:02:03Z'));
    expect(stamp).toBe('2026:05:27 01:02:03');
  });
});
