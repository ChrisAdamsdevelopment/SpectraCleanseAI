// A song project is the central object of Song Studio: one song and the inputs
// used to generate promotional assets from it. Stored as local JSON (no DB).

export interface SongProject {
  schemaVersion: 1;
  title: string;
  artist: string;
  audioPath: string | null;
  coverPath: string | null;
  presetId: string;
  outputDir: string | null;
  updatedAt: string;
}

export function emptyProject(): SongProject {
  return {
    schemaVersion: 1,
    title: '',
    artist: '',
    audioPath: null,
    coverPath: null,
    presetId: 'vertical_promo',
    outputDir: null,
    updatedAt: new Date().toISOString(),
  };
}
