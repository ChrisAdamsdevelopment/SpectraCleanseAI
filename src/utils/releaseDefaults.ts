export interface ReleaseMetadata {
  title: string;
  artist: string;
  albumArtist: string;
  producer: string;
  copyright: string;
  genre: string;
  description: string;
  comment: string;
  tags: string;
  lyrics: string;
}

export type SavedReleaseDefaults = Pick<ReleaseMetadata, 'artist' | 'albumArtist' | 'producer' | 'copyright' | 'genre' | 'description' | 'comment' | 'tags'>;

export const DEFAULT_RELEASE_ARTIST = '';
export const RELEASE_DEFAULTS_STORAGE_KEY = 'spectracleanse_release_defaults';
export const DEFAULT_RELEASE_PRODUCER = '';
export const DEFAULT_RELEASE_COPYRIGHT = '';

export const cleanMetadataField = (value: string | undefined | null) => String(value || '').trim();

export const getSavedReleaseDefaults = (): SavedReleaseDefaults | null => {
  try {
    const raw = localStorage.getItem(RELEASE_DEFAULTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedReleaseDefaults>;
    return {
      artist: cleanMetadataField(parsed.artist),
      albumArtist: cleanMetadataField(parsed.albumArtist),
      producer: cleanMetadataField(parsed.producer),
      copyright: cleanMetadataField(parsed.copyright),
      genre: cleanMetadataField(parsed.genre),
      description: cleanMetadataField(parsed.description),
      comment: cleanMetadataField(parsed.comment),
      tags: cleanMetadataField(parsed.tags),
    };
  } catch {
    return null;
  }
};

export const getInitialReleaseMetadata = (file: File, savedDefaults: SavedReleaseDefaults | null): ReleaseMetadata => ({
  title: file.name.replace(/\.[^.]+$/, ''),
  artist: savedDefaults?.artist || DEFAULT_RELEASE_ARTIST,
  albumArtist: savedDefaults?.albumArtist || savedDefaults?.artist || DEFAULT_RELEASE_ARTIST,
  producer: savedDefaults?.producer || DEFAULT_RELEASE_PRODUCER,
  copyright: savedDefaults?.copyright || DEFAULT_RELEASE_COPYRIGHT,
  genre: savedDefaults?.genre || '',
  description: savedDefaults?.description || '',
  comment: savedDefaults?.comment || '',
  tags: savedDefaults?.tags || '',
  lyrics: '',
});

export const resolveReleaseMetadata = (metadata: ReleaseMetadata): ReleaseMetadata => ({
  title: cleanMetadataField(metadata.title) || 'Untitled',
  artist: cleanMetadataField(metadata.artist) || DEFAULT_RELEASE_ARTIST,
  albumArtist: cleanMetadataField(metadata.albumArtist) || cleanMetadataField(metadata.artist) || DEFAULT_RELEASE_ARTIST,
  producer: cleanMetadataField(metadata.producer) || DEFAULT_RELEASE_PRODUCER,
  copyright: cleanMetadataField(metadata.copyright) || DEFAULT_RELEASE_COPYRIGHT,
  genre: cleanMetadataField(metadata.genre),
  description: cleanMetadataField(metadata.description),
  comment: cleanMetadataField(metadata.comment),
  tags: cleanMetadataField(metadata.tags),
  lyrics: cleanMetadataField(metadata.lyrics),
});
