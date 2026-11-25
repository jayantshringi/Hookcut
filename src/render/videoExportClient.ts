import { exportClipWithFfmpegFallback } from './ffmpegExportFallback';
import {
  RESOLUTION_MAP,
  type ExportClipRequest,
  type ExportProgress,
  type ExportResult,
} from './types';
import type { VideoExportWorkerResponse } from '../workers/videoExport.worker';

export interface RenderExportOptions {
  request: ExportClipRequest;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Renders a 9:16 clip using Mediabunny + WebCodecs inside a Web Worker,
 * automatically falling back to lazy-loaded ffmpeg.wasm if WebCodecs is unavailable.
 */
export async function renderAndExportClip(options: RenderExportOptions): Promise<ExportResult> {
  const { request, signal, onProgress } = options;

  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }

  if (request.videoEngine === 'ffmpeg-wasm') {
    return exportClipWithFfmpegFallback({ request, signal, onProgress });
  }

  return new Promise<ExportResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/videoExport.worker.ts', import.meta.url),
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
      reject(new DOMException('Export cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = async (event: MessageEvent<VideoExportWorkerResponse>) => {
      if (settled) return;
      const msg = event.data;

      switch (msg.type) {
        case 'PROGRESS':
          onProgress?.({
            phase: msg.phase,
            progress: msg.progress,
            engine: 'mediabunny-webcodecs',
          });
          break;

        case 'COMPLETE': {
          settled = true;
          cleanup();
          resolve({
            blob: new Blob([msg.buffer], { type: 'video/mp4' }),
            mimeType: 'video/mp4',
            durationSec: msg.durationSec,
            width: msg.width,
            height: msg.height,
            engine: 'mediabunny-webcodecs',
          });
          break;
        }

        case 'FALLBACK_REQUIRED': {
          settled = true;
          cleanup();
          try {
            const fallbackResult = await exportClipWithFfmpegFallback({
              request,
              signal,
              onProgress,
            });
            resolve(fallbackResult);
          } catch (err) {
            reject(err);
          }
          break;
        }

        case 'CANCELLED':
          settled = true;
          cleanup();
          reject(new DOMException('Export cancelled', 'AbortError'));
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
      reject(new Error(err.message || 'Video export worker failed.'));
    };

    worker.postMessage({
      type: 'EXPORT',
      file: request.file,
      startSec: request.startSec,
      endSec: request.endSec,
      resolution: request.resolution,
      reframeKeyframes: request.reframeKeyframes,
      captions: request.captions,
      targetFps: request.targetFps,
    });
  });
}

export function getDimensionsForResolution(resolution: ExportClipRequest['resolution']) {
  return RESOLUTION_MAP[resolution];
}
