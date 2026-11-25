import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny';
import { buildCaptionCues } from '../captions/captionTiming';
import { getCaptionPreset } from '../captions/presets';
import { drawCaptionOverlay } from '../captions/renderCaptions';
import { composePortraitFrame, sampleReframeAtTime } from '../render/frameComposer';
import {
  RESOLUTION_MAP,
  type CaptionRenderSpec,
  type ReframeKeyframe,
  type RenderResolution,
} from '../render/types';

export type VideoExportWorkerRequest =
  | {
      type: 'EXPORT';
      file: File;
      startSec: number;
      endSec: number;
      resolution: RenderResolution;
      reframeKeyframes?: ReframeKeyframe[];
      captions?: CaptionRenderSpec;
      targetFps?: number;
    }
  | { type: 'CANCEL' };

export type VideoExportWorkerResponse =
  | { type: 'PROGRESS'; phase: 'preparing' | 'rendering' | 'finalizing'; progress: number }
  | { type: 'COMPLETE'; buffer: ArrayBuffer; width: number; height: number; durationSec: number }
  | { type: 'FALLBACK_REQUIRED'; reason: string }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string };

let cancelled = false;
let activeInput: Input | null = null;
let activeOutput: Output | null = null;

function post(msg: VideoExportWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<VideoExportWorkerRequest>) => {
  const payload = event.data;

  if (payload.type === 'CANCEL') {
    cancelled = true;
    try {
      activeInput?.dispose();
    } catch {
      // ignore
    }
    try {
      await activeOutput?.cancel();
    } catch {
      // ignore
    }
    return;
  }

  if (payload.type !== 'EXPORT') return;

  cancelled = false;
  const { width, height } = RESOLUTION_MAP[payload.resolution];
  const clipDuration = Math.max(0.1, payload.endSec - payload.startSec);
  const targetFps = payload.targetFps ?? 30;
  const minFrameInterval = 1 / targetFps;

  const input = new Input({
    source: new BlobSource(payload.file),
    formats: ALL_FORMATS,
  });
  activeInput = input;

  let output: Output<Mp4OutputFormat, BufferTarget> | null = null;

  try {
    post({ type: 'PROGRESS', phase: 'preparing', progress: 0.02 });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found in input file.');
    }

    const canDecodeVideo =
      typeof globalThis.VideoDecoder === 'function' &&
      typeof globalThis.VideoEncoder === 'function' &&
      (await videoTrack.canDecode());

    if (!canDecodeVideo) {
      post({
        type: 'FALLBACK_REQUIRED',
        reason: 'WebCodecs VideoDecoder/VideoEncoder unavailable for this stream.',
      });
      return;
    }

    const srcWidth = await videoTrack.getDisplayWidth();
    const srcHeight = await videoTrack.getDisplayHeight();

    // Intermediate canvas stores decoded frame in display pixel space so 2D drawImage can crop/blur cleanly
    const sourceCanvas = new OffscreenCanvas(srcWidth, srcHeight);
    const sourceCtx = sourceCanvas.getContext('2d');
    const outCanvas = new OffscreenCanvas(width, height);
    const outCtx = outCanvas.getContext('2d');

    if (!sourceCtx || !outCtx) {
      throw new Error('Could not acquire 2D OffscreenCanvas contexts in worker.');
    }

    const target = new BufferTarget();
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    activeOutput = output;

    const videoSource = new CanvasSource(outCanvas, {
      codec: 'avc',
      quality: new Quality(payload.resolution === '1080p' ? 'high' : 'medium'),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: targetFps });

    const audioTrack = await input.getPrimaryAudioTrack();
    const canProcessAudio =
      Boolean(audioTrack) &&
      typeof globalThis.AudioDecoder === 'function' &&
      typeof globalThis.AudioEncoder === 'function' &&
      (await audioTrack!.canDecode());

    const audioSource = canProcessAudio
      ? new AudioSampleSource({
          codec: 'aac',
          quality: new Quality('medium'),
        })
      : null;

    if (audioSource) {
      output.addAudioTrack(audioSource);
    }

    await output.start();

    if (cancelled) {
      await output.cancel();
      post({ type: 'CANCELLED' });
      return;
    }

    // 1. Decode, crop/reframe, overlay captions, and encode video frames
    const videoSink = new VideoSampleSink(videoTrack);
    const captionCues =
      payload.captions?.enabled && payload.captions.words.length > 0
        ? buildCaptionCues(
            payload.captions.words,
            getCaptionPreset(payload.captions.presetId),
            payload.captions.emphasisKeywords ?? [],
          )
        : undefined;
    let lastEncodedRelTs = -Infinity;
    let lastProgressReport = 0;

    for await (const sample of videoSink.samples(payload.startSec, payload.endSec)) {
      if (cancelled) {
        sample.close();
        await output.cancel();
        post({ type: 'CANCELLED' });
        return;
      }

      try {
        const relTs = Math.max(0, sample.timestamp - payload.startSec);
        if (relTs - lastEncodedRelTs < minFrameInterval * 0.85) {
          continue;
        }
        lastEncodedRelTs = relTs;

        sourceCtx.clearRect(0, 0, srcWidth, srcHeight);
        sample.draw(sourceCtx, 0, 0, srcWidth, srcHeight);

        const reframe = sampleReframeAtTime(payload.reframeKeyframes, sample.timestamp);
        composePortraitFrame(
          outCtx,
          sourceCanvas,
          srcWidth,
          srcHeight,
          width,
          height,
          reframe,
        );

        if (payload.captions?.enabled) {
          drawCaptionOverlay(outCtx, width, height, sample.timestamp, payload.captions, captionCues);
        }

        const frameDur = Math.max(minFrameInterval, sample.duration || minFrameInterval);
        await videoSource.add(relTs, frameDur);

        const now = performance.now();
        if (now - lastProgressReport > 100) {
          lastProgressReport = now;
          const frac = Math.min(1, relTs / clipDuration);
          post({
            type: 'PROGRESS',
            phase: 'rendering',
            progress: 0.05 + frac * (audioSource ? 0.72 : 0.88),
          });
        }
      } finally {
        sample.close();
      }
    }

    videoSource.close();

    // 2. Trim & re-encode AAC audio track aligned to 0..clipDuration
    if (audioTrack && audioSource) {
      const audioSink = new AudioSampleSink(audioTrack);
      for await (const audioSample of audioSink.samples(payload.startSec, payload.endSec)) {
        if (cancelled) {
          audioSample.close();
          await output.cancel();
          post({ type: 'CANCELLED' });
          return;
        }

        let trimmedSample = audioSample;
        try {
          const sampleStart = audioSample.timestamp;
          const sampleEnd = sampleStart + audioSample.duration;

          const clipStartOffset = Math.max(0, payload.startSec - sampleStart);
          const clipEndOffset = Math.max(0, sampleEnd - payload.endSec);

          const startFrame = Math.min(
            audioSample.numberOfFrames,
            Math.floor(clipStartOffset * audioSample.sampleRate),
          );
          const endFrame = Math.max(
            startFrame,
            audioSample.numberOfFrames - Math.floor(clipEndOffset * audioSample.sampleRate),
          );

          if (endFrame > startFrame) {
            if (startFrame > 0 || endFrame < audioSample.numberOfFrames) {
              trimmedSample = audioSample.trim(startFrame, endFrame);
            }
            const relAudioTs = Math.max(0, trimmedSample.timestamp - payload.startSec);
            trimmedSample.setTimestamp(relAudioTs);
            await audioSource.add(trimmedSample);
          }
        } finally {
          if (trimmedSample !== audioSample) {
            trimmedSample.close();
          }
          audioSample.close();
        }
      }
      audioSource.close();
    }

    if (cancelled) {
      await output.cancel();
      post({ type: 'CANCELLED' });
      return;
    }

    post({ type: 'PROGRESS', phase: 'finalizing', progress: 0.94 });
    await output.finalize();

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('MP4 output buffer was empty after finalization.');
    }

    post({ type: 'PROGRESS', phase: 'finalizing', progress: 1 });
    post(
      {
        type: 'COMPLETE',
        buffer,
        width,
        height,
        durationSec: clipDuration,
      },
      [buffer],
    );
  } catch (err) {
    try {
      await output?.cancel();
    } catch {
      // ignore
    }
    if (cancelled) {
      post({ type: 'CANCELLED' });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      if (/VideoEncoder|AudioEncoder|isConfigSupported|WebCodecs/i.test(message)) {
        post({ type: 'FALLBACK_REQUIRED', reason: message });
      } else {
        post({ type: 'ERROR', message });
      }
    }
  } finally {
    try {
      input.dispose();
    } catch {
      // ignore
    }
    if (activeInput === input) activeInput = null;
    if (activeOutput === output) activeOutput = null;
  }
};
