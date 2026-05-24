import { describe, it, expect, beforeEach } from 'vitest';
import {
  RELEASE_DEFAULTS_STORAGE_KEY,
  getSavedReleaseDefaults,
  getInitialReleaseMetadata,
} from '../src/utils/releaseDefaults';

describe('release defaults regression behavior', () => {
  beforeEach(() => localStorage.clear());

  it('returns blank defaults when localStorage has no value', () => {
    expect(getSavedReleaseDefaults()).toBeNull();
    const file = new File(['x'], 'My Track.mp3');
    const initial = getInitialReleaseMetadata(file, null);
    expect(initial.artist).toBe('');
    expect(initial.producer).toBe('');
    expect(initial.copyright).toBe('');
    expect(initial.lyrics).toBe('');
  });

  it('saved defaults ignore lyrics and still derive title from filename', () => {
    localStorage.setItem(RELEASE_DEFAULTS_STORAGE_KEY, JSON.stringify({
      artist: 'Saved Artist',
      albumArtist: 'Saved Album Artist',
      producer: 'Saved Producer',
      copyright: '© Saved',
      genre: 'Pop',
      description: 'Desc',
      comment: 'Comment',
      tags: 'tag1,tag2',
      lyrics: 'should be ignored',
    }));

    const defaults = getSavedReleaseDefaults();
    const file = new File(['x'], 'Derived Name.m4a');
    const initial = getInitialReleaseMetadata(file, defaults);

    expect(defaults).not.toHaveProperty('lyrics');
    expect(initial.title).toBe('Derived Name');
    expect(initial.artist).toBe('Saved Artist');
    expect(initial.lyrics).toBe('');
  });
});
