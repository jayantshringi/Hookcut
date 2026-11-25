import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import {
  smoothReframePath,
  type FaceDetectionSample,
  type NormalizedFaceBox,
} from '../reframe/cropSmoothing';
import type { ReframeKeyframe } from '../render/types';

export type FaceTrackWorkerRequest =
  | {
      type: 'TRACK';
      file: File;
      startSec: number;
      endSec: number;
      sampleFps?: number;
    }
  | { type: 'CANCEL' };

export type FaceTrackWorkerResponse =
  | { type: 'PROGRESS'; progress: number }
  | { type: 'COMPLETE'; keyframes: ReframeKeyframe[]; usedFallback: boolean }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string };

const MEDIAPIPE_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const BLAZEFACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let cancelled = false;
let activeInput: Input | null = null;
let activeDetector: FaceDetector | null = null;

function post(msg: FaceTrackWorkerResponse): void {
  self.postMessage(msg);
}

async function initDetector(): Promise<FaceDetector> {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
  try {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: BLAZEFACE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.48,
      minSuppressionThreshold: 0.3,
    });
  } catch {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: BLAZEFACE_MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.48,
      minSuppressionThreshold: 0.3,
    });
  }
}

function buildTimestamps(startSec: number, endSec: number, sampleFps: number): number[] {
  const step = 1 / Math.max(1, sampleFps);
  const timestamps: number[] = [];
  for (let t = startSec; t <= endSec + 1e-4; t += step) {
    timestamps.push(Math.min(endSec, Math.round(t * 1000) / 1000));
  }
  if (timestamps.length === 0) {
    timestamps.push(startSec);
  }
  return timestamps;
}

self.onmessage = async (event: MessageEvent<FaceTrackWorkerRequest>) => {
  const payload = event.data;

  if (payload.type === 'CANCEL') {
    cancelled = true;
    try {
      activeInput?.dispose();
    } catch {
      // ignore
    }
    try {
      activeDetector?.close();
    } catch {
      // ignore
    }
    return;
  }

  if (payload.type !== 'TRACK') return;

  cancelled = false;
  const sampleFps = payload.sampleFps ?? 4;

  const input = new Input({
    source: new BlobSource(payload.file),
    formats: ALL_FORMATS,
  });
  activeInput = input;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || typeof globalThis.VideoDecoder !== 'function' || !(await videoTrack.canDecode())) {
      post({
        type: 'COMPLETE',
        keyframes: [{ timeSec: payload.startSec, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }],
        usedFallback: true,
      });
      return;
    }

    let detector: FaceDetector;
    try {
      detector = await initDetector();
      activeDetector = detector;
    } catch {
      post({
        type: 'COMPLETE',
        keyframes: [{ timeSec: payload.startSec, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }],
        usedFallback: true,
      });
      return;
    }

    if (cancelled) {
      post({ type: 'CANCELLED' });
      return;
    }

    const srcWidth = await videoTrack.getDisplayWidth();
    const srcHeight = await videoTrack.getDisplayHeight();
    const detectWidth = Math.min(480, Math.max(160, srcWidth));
    const detectHeight = Math.max(90, Math.round((detectWidth / Math.max(1, srcWidth)) * srcHeight));

    const sink = new CanvasSink(videoTrack, {
      width: detectWidth,
      height: detectHeight,
      fit: 'fill',
      poolSize: 2,
    });

    const timestamps = buildTimestamps(payload.startSec, payload.endSec, sampleFps);
    const samples: FaceDetectionSample[] = [];
    let processed = 0;

    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (cancelled) {
        post({ type: 'CANCELLED' });
        return;
      }

      const tSec = timestamps[processed] ?? payload.startSec;
      processed++;

      if (!wrapped) {
        samples.push({ timeSec: tSec, faces: [] });
        continue;
      }

      const result = detector.detectForVideo(wrapped.canvas, Math.max(0, Math.round(tSec * 1000)));
      const faces: NormalizedFaceBox[] = [];

      for (const det of result.detections ?? []) {
        const box = det.boundingBox;
        if (!box) continue;
        const score = det.categories?.[0]?.score ?? 0.6;
        faces.push({
          cx: (box.originX + box.width / 2) / detectWidth,
          cy: (box.originY + box.height / 2) / detectHeight,
          width: box.width / detectWidth,
          height: box.height / detectHeight,
          score,
        });
      }

      samples.push({ timeSec: tSec, faces });
      post({ type: 'PROGRESS', progress: Math.min(0.98, processed / timestamps.length) });
    }

    const keyframes = smoothReframePath(samples);
    post({ type: 'PROGRESS', progress: 1 });
    post({ type: 'COMPLETE', keyframes, usedFallback: false });
  } catch (err) {
    if (cancelled) {
      post({ type: 'CANCELLED' });
    } else {
      // Fall back gracefully rather than blocking export if MediaPipe CDN is unreachable
      post({
        type: 'COMPLETE',
        keyframes: [{ timeSec: payload.startSec, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }],
        usedFallback: true,
      });
      void err;
    }
  } finally {
    try {
      activeDetector?.close();
    } catch {
      // ignore
    }
    try {
      input.dispose();
    } catch {
      // ignore
    }
    activeDetector = null;
    if (activeInput === input) activeInput = null;
  }
};
