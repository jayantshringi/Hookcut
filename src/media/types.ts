export const MAX_VIDEO_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_VIDEO_DURATION_SEC = 30 * 60; // 30 minutes
export const TARGET_ASR_SAMPLE_RATE = 16_000;
export const DEFAULT_AUDIO_CHUNK_SEC = 30;
export const ENERGY_BIN_SEC = 0.25;

export interface VideoMetadata {
  fileName: string;
  fileSizeBytes: number;
  fileFingerprint: string;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface AudioChunk {
  index: number;
  startSec: number;
  endSec: number;
  samples: Float32Array;
}

export interface AudioExtractionResult {
  metadata: VideoMetadata;
  sampleRate: number;
  totalDurationSec: number;
  chunks: AudioChunk[];
  energyBins: number[];
  energyBinSec: number;
  engine: 'mediabunny' | 'ffmpeg-wasm';
}

export interface AudioExtractionProgress {
  stage: 'probing' | 'extracting';
  progress: number; // 0..1
  processedSec: number;
  totalSec: number;
}
