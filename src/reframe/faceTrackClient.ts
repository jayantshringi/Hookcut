import type { ReframeKeyframe } from '../render/types';
import type { FaceTrackWorkerResponse } from '../workers/faceTrack.worker';

export interface FaceTrackOptions {
  file: File;
  startSec: number;
  endSec: number;
  sampleFps?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface FaceTrackResult {
  keyframes: ReframeKeyframe[];
  usedFallback: boolean;
}

/**
 * Tracks faces on sampled frames (~4 fps) inside a Web Worker and produces a smoothed
 * 9:16 crop path with blurred-background fallback for wide or multi-speaker shots.
 */
export async function trackFacesForClip(
  options: FaceTrackOptions,
): Promise<FaceTrackResult> {
  const { file, startSec, endSec, sampleFps = 4, signal, onProgress } = options;

  if (signal?.aborted) {
    throw new DOMException('Face tracking cancelled', 'AbortError');
  }

  return new Promise<FaceTrackResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/faceTrack.worker.ts', import.meta.url),
      { type: 'module' },
    );

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
      reject(new DOMException('Face tracking cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<FaceTrackWorkerResponse>) => {
      if (settled) return;
      const msg = event.data;

      switch (msg.type) {
        case 'PROGRESS':
          onProgress?.(msg.progress);
          break;
        case 'COMPLETE':
          settled = true;
          cleanup();
          resolve({ keyframes: msg.keyframes, usedFallback: msg.usedFallback });
          break;
        case 'CANCELLED':
          settled = true;
          cleanup();
          reject(new DOMException('Face tracking cancelled', 'AbortError'));
          break;
        case 'ERROR':
          settled = true;
          cleanup();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        keyframes: [{ timeSec: startSec, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }],
        usedFallback: true,
      });
    };

    worker.postMessage({ type: 'TRACK', file, startSec, endSec, sampleFps });
  });
}
