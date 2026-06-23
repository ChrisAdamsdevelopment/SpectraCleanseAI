import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetFrame = vi.fn();
const mockAddTag = vi.fn();
const mockGetBlob = vi.fn(() => new Uint8Array([1, 2, 3]));

vi.mock('browser-id3-writer', () => {
  return {
    // vitest 4 requires a constructable implementation (function/class) for `new`.
    // The writer is used as `new ID3Writer(buffer)` in src/utils/metadata.js.
    default: vi.fn(function ID3Writer() {
      return {
        removeTag: vi.fn(),
        setFrame: mockSetFrame,
        addTag: mockAddTag,
        getBlob: mockGetBlob,
      };
    }),
  };
});

import { writeMP3Metadata } from '../src/utils/metadata';

describe('writeMP3Metadata regression behavior', () => {
  beforeEach(() => {
    mockSetFrame.mockReset();
    mockAddTag.mockReset();
    mockGetBlob.mockClear();
  });

  it('avoids TENC/TSSE and reports frame attempts/writes/skips', async () => {
    const file = { arrayBuffer: async () => new Uint8Array([1,2,3]).buffer } as File;
    mockSetFrame.mockImplementation((id: string) => {
      if (id === 'USLT') throw new Error('unsupported');
    });

    const result = await writeMP3Metadata(file, {
      title: 'Title',
      artist: 'Artist',
      description: 'Desc',
      producer: 'Producer Name',
      tags: 'tag1,tag2',
      lyrics: 'Optional lyrics',
    });

    const attempted = result.frameReport.attemptedFrames;
    const written = result.frameReport.writtenFrames;
    const skipped = result.frameReport.skippedFrames;

    expect(attempted).not.toContain('TENC');
    expect(attempted).not.toContain('TSSE');
    expect(written).not.toContain('TENC');
    expect(written).not.toContain('TSSE');
    expect(skipped).toContain('USLT');
    expect(attempted.length).toBeGreaterThan(0);
  });

  it('defaults albumArtist to artist and comment to description with producer/tags folding', async () => {
    const file = { arrayBuffer: async () => new Uint8Array([1,2,3]).buffer } as File;

    await writeMP3Metadata(file, {
      title: 'Title',
      artist: 'Artist A',
      description: 'Description only',
      producer: 'Prod A',
      tags: 'alpha,beta',
      lyrics: '',
    });

    expect(mockSetFrame).toHaveBeenCalledWith('TPE2', ['Artist A']);
    const commentCall = mockSetFrame.mock.calls.find((c) => c[0] === 'COMM');
    expect(commentCall).toBeTruthy();
    expect(commentCall?.[1]?.text).toContain('Description only');
    expect(commentCall?.[1]?.text).toContain('Producer: Prod A');
    expect(commentCall?.[1]?.text).toContain('Tags: alpha,beta');
    expect(mockSetFrame.mock.calls.some((c) => c[0] === 'USLT')).toBe(false);
  });
});
