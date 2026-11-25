export interface WordTimestamp {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
}

export interface Transcript {
  fileFingerprint: string;
  modelId: string;
  language: string;
  durationSec: number;
  text: string;
  words: WordTimestamp[];
  segments: TranscriptSegment[];
  createdAt: number;
}

export interface ModelDownloadProgress {
  file: string;
  status: string;
  loaded: number;
  total: number;
  progress: number; // 0..100
}

export interface TranscriptionProgress {
  phase: 'checking-cache' | 'loading-model' | 'transcribing' | 'cached';
  progress: number; // 0..1
  chunkIndex: number;
  totalChunks: number;
  device?: 'webgpu' | 'wasm';
  download?: ModelDownloadProgress;
}
