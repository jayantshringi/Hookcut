import type { WordTimestamp } from '../transcribe/types';

export type RenderResolution = '720p' | '1080p';

export interface RenderDimensions {
  width: number;
  height: number;
}

export const RESOLUTION_MAP: Record<RenderResolution, RenderDimensions> = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
};

export type ReframeLayoutMode = 'face-follow' | 'blurred-background';

export interface ReframeKeyframe {
  timeSec: number;
  /** Normalized horizontal center [0..1] in source display space */
  centerX: number;
  /** Normalized vertical center [0..1] in source display space */
  centerY: number;
  mode: ReframeLayoutMode;
}

export interface CaptionStylePreset {
  id: string;
  name: string;
  description: string;
  fontFamily: string;
  fontWeight: number;
  fontSizePct: number; // relative to output height
  textColor: string;
  activeWordColor: string;
  activeBgColor?: string;
  strokeColor: string;
  strokeWidthPx: number;
  shadowColor: string;
  uppercase: boolean;
  maxWordsPerLine: number;
  maxLines: number;
  bottomMarginPct: number;
}

export interface CaptionRenderSpec {
  enabled: boolean;
  presetId: string;
  words: WordTimestamp[];
  emphasisKeywords?: string[];
}

export interface ExportClipRequest {
  file: File;
  startSec: number;
  endSec: number;
  resolution: RenderResolution;
  videoEngine: 'mediabunny-webcodecs' | 'ffmpeg-wasm';
  reframeKeyframes?: ReframeKeyframe[];
  captions?: CaptionRenderSpec;
  targetFps?: number;
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finalizing';
  progress: number; // 0..1
  engine: 'mediabunny-webcodecs' | 'ffmpeg-wasm';
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  engine: 'mediabunny-webcodecs' | 'ffmpeg-wasm';
}
