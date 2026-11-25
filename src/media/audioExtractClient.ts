import { extractAudioWithFfmpegFallback } from './ffmpegAudioFallback';
import {
  ENERGY_BIN_SEC,
  TARGET_ASR_SAMPLE_RATE,
  type AudioChunk,
  type AudioExtractionProgress,
  type AudioExtractionResult,
  type VideoMetadata,
} from './types';
import { validateSelectedFile } from './validateFile';
import type { AudioExtractWorkerResponse } from '../workers/audioExtract.worker';

export interface ExtractAudioOptions {
  file: File;
  signal?: AbortSignal;
  onMetadata?: (metadata: VideoMetadata) => void;
  onProgress?: (progress: AudioExtractionProgress) => void;
  onChunk?: (chunk: AudioChunk) => void;
}

/**
 * Extracts 16 kHz mono audio chunks and video metadata from a local File in a Web Worker,
 * streaming byte ranges via Mediabunny and falling back to lazy-loaded ffmpeg.wasm if needed.
 */
export async function extractAudioFromVideo(
  options: ExtractAudioOptions,
): Promise<AudioExtractionResult> {
  const { file, signal, onMetadata, onProgress, onChunk } = options;
  validateSelectedFile(file);

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise<AudioExtractionResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/audioExtract.worker.ts', import.meta.url),
      { type: 'module' },
    );

    const chunks: AudioChunk[] = [];
    let metadata: VideoMetadata | null = null;
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      worker.postMessage({ type: 'CANCEL' });
      cleanup();
      reject(new DOMException('Audio extraction cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = async (event: MessageEvent<AudioExtractWorkerResponse>) => {
      if (settled) return;
      const msg = event.data;

      switch (msg.type) {
        case 'METADATA':
          metadata = msg.metadata;
          onMetadata?.(msg.metadata);
          break;

        case 'PROGRESS':
          onProgress?.({
            stage: msg.stage,
            progress: msg.progress,
            processedSec: msg.processedSec,
            totalSec: msg.totalSec,
          });
          break;

        case 'CHUNK':
          chunks.push(msg.chunk);
          onChunk?.(msg.chunk);
          break;

        case 'COMPLETE':
          settled = true;
          cleanup();
          if (!metadata) {
            reject(new Error('Missing video metadata from extraction worker.'));
            return;
          }
          resolve({
            metadata,
            sampleRate: TARGET_ASR_SAMPLE_RATE,
            totalDurationSec: msg.totalDurationSec,
            chunks,
            energyBins: msg.energyBins,
            energyBinSec: msg.energyBinSec || ENERGY_BIN_SEC,
            engine: 'mediabunny',
          });
          break;

        case 'FALLBACK_REQUIRED': {
          settled = true;
          cleanup();
          try {
            const fallback = await extractAudioWithFfmpegFallback({
              file,
              durationSec: msg.metadata.durationSec,
              signal,
              onProgress,
            });
            for (const c of fallback.chunks) {
              onChunk?.(c);
            }
            resolve({
              metadata: msg.metadata,
              sampleRate: TARGET_ASR_SAMPLE_RATE,
              totalDurationSec: msg.metadata.durationSec,
              chunks: fallback.chunks,
              energyBins: fallback.energyBins,
              energyBinSec: ENERGY_BIN_SEC,
              engine: 'ffmpeg-wasm',
            });
          } catch (err) {
            reject(err);
          }
          break;
        }

        case 'CANCELLED':
          settled = true;
          cleanup();
          reject(new DOMException('Audio extraction cancelled', 'AbortError'));
          break;

        case 'ERROR':
          settled = true;
          cleanup();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || 'Audio extraction worker crashed.'));
    };

    worker.postMessage({ type: 'EXTRACT', file });
  });
}
