export interface FileMetadataResult {
  format: string;
  title: string;
  artist: string;
  producer?: string;
  copyright?: string;
  genre: string;
  lyrics?: string;
  detectedMarkers: string[];
  provenanceRisk: 'High' | 'Low';
  raw: unknown;
  parseError?: string | null;
}

export interface MP3FrameReport {
  attemptedFrames: string[];
  writtenFrames: string[];
  skippedFrames: string[];
}

export interface MP3MetadataWriteResult {
  blob: Blob;
  frameReport: MP3FrameReport;
}

export interface MP3MetadataInput {
  title?: string;
  artist?: string;
  albumArtist?: string;
  producer?: string;
  copyright?: string;
  genre?: string;
  description?: string;
  comment?: string;
  lyrics?: string;
  tags?: string;
  publisher?: string;
}

export function readFileMetadata(file: File): Promise<FileMetadataResult>;
export function writeMP3Metadata(file: File, metadata: MP3MetadataInput): Promise<MP3MetadataWriteResult>;
