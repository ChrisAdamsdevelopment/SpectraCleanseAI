export interface FileMetadataResult {
  format: string;
  title: string;
  artist: string;
  genre: string;
  detectedMarkers: string[];
  provenanceRisk: 'High' | 'Low';
  raw: unknown;
}

export function readFileMetadata(file: File): Promise<FileMetadataResult>;
export function writeMP3Metadata(file: File, metadata: { title?: string; artist?: string; genre?: string }): Promise<Blob>;
