import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { drawCaptionOverlay } from '../captions/renderCaptions';
import { composePortraitFrame, sampleReframeAtTime } from '../render/frameComposer';
import { RESOLUTION_MAP, type CaptionRenderSpec, type ReframeKeyframe } from '../render/types';

export interface ThumbnailOptions {
  file: File;
  startSec: number;
  endSec: number;
  reframeKeyframes?: ReframeKeyframe[];
  captions?: CaptionRenderSpec;
  targetSec?: number;
}

export interface ClipThumbnail {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  capturedAtSec: number;
}

export function selectThumbnailTimestamp(startSec: number, endSec: number): number {
  const duration = Math.max(0.1, endSec - startSec);
  return Math.round((startSec + Math.min(1.5, duration * 0.22)) * 1000) / 1000;
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode thumbnail JPEG.'))),
      'image/jpeg',
      0.9,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read thumbnail blob.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Extracts a 9:16 portrait thumbnail at the hook frame, reframed and optionally captioned.
 * Uses Mediabunny CanvasSink when WebCodecs is available, falling back to <video> element seek.
 */
export async function generateClipThumbnail(
  options: ThumbnailOptions,
): Promise<ClipThumbnail> {
  const { width, height } = RESOLUTION_MAP['720p'];
  const capturedAtSec = options.targetSec ?? selectThumbnailTimestamp(options.startSec, options.endSec);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('2D canvas unavailable for thumbnail generation.');
  }

  let drawn = false;
  const input = new Input({
    source: new BlobSource(options.file),
    formats: ALL_FORMATS,
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (videoTrack && typeof globalThis.VideoDecoder === 'function' && (await videoTrack.canDecode())) {
      const sink = new CanvasSink(videoTrack, { fit: 'fill' });
      const wrapped = await sink.getCanvas(capturedAtSec);
      if (wrapped) {
        const srcW = await videoTrack.getDisplayWidth();
        const srcH = await videoTrack.getDisplayHeight();
        const reframe = sampleReframeAtTime(options.reframeKeyframes, capturedAtSec);
        composePortraitFrame(outCtx, wrapped.canvas, srcW, srcH, width, height, reframe);
        drawn = true;
      }
    }
  } catch {
    drawn = false;
  } finally {
    try {
      input.dispose();
    } catch {
      // ignore
    }
  }

  if (!drawn) {
    // HTMLVideoElement fallback when WebCodecs VideoDecoder is absent
    await drawViaVideoElement(options.file, capturedAtSec, outCtx, width, height, options.reframeKeyframes);
  }

  if (options.captions?.enabled && options.captions.words.length > 0) {
    drawCaptionOverlay(outCtx, width, height, capturedAtSec, options.captions);
  }

  const blob = await canvasToBlob(outCanvas);
  const dataUrl = await blobToDataUrl(blob);

  return {
    blob,
    dataUrl,
    width,
    height,
    capturedAtSec,
  };
}

async function drawViaVideoElement(
  file: File,
  targetSec: number,
  outCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  reframeKeyframes?: ReframeKeyframe[],
): Promise<void> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode video frame for thumbnail.'));
      video.src = url;
    });

    await new Promise<void>((resolve) => {
      const onSeeked = () => resolve();
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = Math.min(Math.max(0, targetSec), Math.max(0, video.duration - 0.05));
    });

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const reframe = sampleReframeAtTime(reframeKeyframes, targetSec);
    composePortraitFrame(outCtx, video, srcW, srcH, width, height, reframe);
  } finally {
    video.src = '';
    URL.revokeObjectURL(url);
  }
}
