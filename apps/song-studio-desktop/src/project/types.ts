// A song project is the central object of Song Studio: one song and the inputs
// used to generate promotional assets from it. Stored as local JSON (no DB).

export interface SongProject {
  schemaVersion: 2;
  title: string;
  artist: string;
  audioPath: string | null;
  coverPath: string | null;
  outputDir: string | null;
  // creative selection
  functionId: string;        // what to make
  recipeId: string;          // which style/recipe
  // clip selection (stored as user-entered strings; parsed at render time)
  clipStart: string;         // e.g. "0:42" or "42"
  clipDuration: string;      // e.g. "15"
  updatedAt: string;
}

export function emptyProject(): SongProject {
  return {
    schemaVersion: 2,
    title: '',
    artist: '',
    audioPath: null,
    coverPath: null,
    outputDir: null,
    functionId: 'make_canvas',
    recipeId: 'clean_canvas',
    clipStart: '0:00',
    clipDuration: '6',
    updatedAt: new Date().toISOString(),
  };
}
