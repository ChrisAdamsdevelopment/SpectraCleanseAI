import { describe, it, expect } from 'vitest';
import { buildMetaToWrite, buildQualityVerification, classifyMetadataPersistenceStage } from '../server/processor';

describe('processor metadata helper regressions', () => {
  it('buildMetaToWrite uses ItemList/Keys fields and avoids generic Creator fallback tags', () => {
    const meta = buildMetaToWrite('General', { title: 'Song', artist: 'Artist', producer: 'Producer', copyright: '© 2026 Artist', genre: 'Pop', tags: 'a,b', description: 'Desc' });
    expect(meta['ItemList:Title']).toBe('Song');
    expect(meta['ItemList:Artist']).toBe('Artist');
    expect(meta['ItemList:Producer']).toBe('Producer');
    expect(meta['Keys:Producer']).toBe('Producer');
    expect(meta['ItemList:Copyright']).toBe('© 2026 Artist');
    expect(meta['ItemList:Genre']).toBe('Pop');
    expect(meta['ItemList:Keyword']).toEqual(['a', 'b']);
    expect(meta['ItemList:Description']).toBe('Desc');
    expect(meta['ItemList:Comment']).toBe('Desc');
    ['Title','Artist','Author','AlbumArtist','Producer','Copyright','Genre','Keywords','Description','Comment','Creator'].forEach((k) => expect(Object.prototype.hasOwnProperty.call(meta, k)).toBe(false));
  });
  it('quality verification fails on XMPToolkit, Image::ExifTool and zero QuickTime dates', () => {
    const verification = buildQualityVerification({ XMPToolkit: 'present', SomeField: 'Image::ExifTool 13.0', CreateDate: '0000:00:00 00:00:00', Title: 'T', Artist: 'A', Producer: 'P', Copyright: '©' }, { title: 'T', artist: 'A', producer: 'P', copyright: '©' });
    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.code === 'xmp_toolkit_present')).toBe(true);
    expect(verification.failures.some((f) => f.code === 'exiftool_trace_present')).toBe(true);
    expect(verification.failures.some((f) => f.code === 'zero_quicktime_timestamp')).toBe(true);
  });
  it('classifyMetadataPersistenceStage returns verified with expected final core metadata and ignores internal hash changes', () => {
    const stage = classifyMetadataPersistenceStage({ after_descriptive_metadata_write: { Title: 'T', Artist: 'A', Producer: 'P', Copyright: '©' }, after_xmp_cleanup: { Title: 'T', Artist: 'A', Producer: 'P', Copyright: '©' }, after_timestamp_write_final: { Title: 'T', Artist: 'A', Producer: 'P', Copyright: '©' } }, { before: 'abc', after_descriptive_metadata_write: 'def', after_timestamp_write_final: 'ghi' }, {});
    expect(stage).toBe('metadata_present_and_verified');
  });
});
