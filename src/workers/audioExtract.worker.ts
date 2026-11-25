import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import {
  computeRmsEnergyBins,
  downmixAndResampleToMono,
  MonoAudioChunker,
} from '../media/resampleMono16k';
import {
  DEFAULT_AUDIO_CHUNK_SEC,
  ENERGY_BIN_SEC,
  TARGET_ASR_SAMPLE_RATE,
  type AudioChunk,
  type VideoMetadata,
} from '../media/types';
import { computeFileFingerprint, validateVideoDuration } from '../media/validateFile';

export type AudioExtractWorkerRequest =
  | { type: 'EXTRACT'; file: File }
  | { type: 'CANCEL' };

export type AudioExtractWorkerResponse =
  | { type: 'METADATA'; metadata: VideoMetadata }
  | { type: 'PROGRESS'; stage: 'probing' | 'extracting'; progress: number; processedSec: number; totalSec: number }
  | { type: 'CHUNK'; chunk: AudioChunk }
  | { type: 'FALLBACK_REQUIRED'; metadata: VideoMetadata; reason: string }
  | { type: 'COMPLETE'; energyBins: number[]; energyBinSec: number; totalDurationSec: number }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string };

let cancelled = false;
let activeInput: Input | null = null;

function post(msg: AudioExtractWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<AudioExtractWorkerRequest>) => {
  const payload = event.data;

  if (payload.type === 'CANCEL') {
    cancelled = true;
    try {
      activeInput?.dispose();
    } catch {
      // ignore dispose errors on cancel
    }
    return;
  }

  if (payload.type !== 'EXTRACT') return;

  cancelled = false;
  const file = payload.file;
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  activeInput = input;

  try {
    post({ type: 'PROGRESS', stage: 'probing', progress: 0.02, processedSec: 0, totalSec: 0 });

    const [canRead, fingerprint, mimeType] = await Promise.all([
      input.canRead(),
      computeFileFingerprint(file),
      input.getMimeType().catch(() => file.type || 'video/mp4'),
    ]);

    if (cancelled) {
      post({ type: 'CANCELLED' });
      return;
    }

    if (!canRead) {
      throw new Error('Unrecognized or corrupt media container.');
    }

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('The selected file contains no video track.');
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    const durationSec = await input.computeDuration();
    validateVideoDuration(durationSec);

    const [width, height, videoCodec, fpsMetrics, audioCodec] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      videoTrack.getCodec(),
      videoTrack.computeFrameRateMetrics({ targetPacketCount: 120 }).catch(() => null),
      audioTrack ? audioTrack.getCodec() : Promise.resolve(null),
    ]);

    const metadata: VideoMetadata = {
      fileName: file.name,
      fileSizeBytes: file.size,
      fileFingerprint: fingerprint,
      mimeType,
      durationSec,
      width,
      height,
      fps: fpsMetrics?.bestGuessFrameRate && Number.isFinite(fpsMetrics.bestGuessFrameRate)
        ? Math.round(fpsMetrics.bestGuessFrameRate * 100) / 100
        : 30,
      hasAudio: Boolean(audioTrack),
      videoCodec,
      audioCodec,
    };

    post({ type: 'METADATA', metadata });

    if (!audioTrack) {
      post({
        type: 'COMPLETE',
        energyBins: [],
        energyBinSec: ENERGY_BIN_SEC,
        totalDurationSec: durationSec,
      });
      return;
    }

    const canDecodeAudio =
      typeof globalThis.AudioDecoder === 'function' && (await audioTrack.canDecode());

    if (!canDecodeAudio) {
      post({
        type: 'FALLBACK_REQUIRED',
        metadata,
        reason: `Browser AudioDecoder cannot decode audio codec "${audioCodec ?? 'unknown'}".`,
      });
      return;
    }

    const sink = new AudioSampleSink(audioTrack);
    const chunker = new MonoAudioChunker(DEFAULT_AUDIO_CHUNK_SEC, TARGET_ASR_SAMPLE_RATE);
    const energyBins: number[] = [];
    const energyAccumulator = new MonoAudioChunker(ENERGY_BIN_SEC, TARGET_ASR_SAMPLE_RATE);

    let lastProgressReport = 0;

    try {
      for await (const sample of sink.samples()) {
        if (cancelled) {
          sample.close();
          post({ type: 'CANCELLED' });
          return;
        }

        try {
          const sizeBytes = sample.allocationSize({ format: 'f32', planeIndex: 0 });
          const buffer = new ArrayBuffer(sizeBytes);
          sample.copyTo(buffer, { format: 'f32', planeIndex: 0 });
          const interleaved = new Float32Array(buffer);

          const mono16k = downmixAndResampleToMono(
            interleaved,
            sample.sampleRate,
            sample.numberOfChannels,
            TARGET_ASR_SAMPLE_RATE,
          );

          const readyEnergyBins = energyAccumulator.push(mono16k);
          for (const binChunk of readyEnergyBins) {
            const [rms] = computeRmsEnergyBins(binChunk.samples, TARGET_ASR_SAMPLE_RATE, ENERGY_BIN_SEC);
            energyBins.push(rms ?? 0);
          }

          const readyChunks = chunker.push(mono16k);
          for (const chunk of readyChunks) {
            post({ type: 'CHUNK', chunk }, [chunk.samples.buffer]);
          }

          const processedSec = Math.min(durationSec, sample.timestamp + sample.duration);
          const now = performance.now();
          if (now - lastProgressReport > 120) {
            lastProgressReport = now;
            post({
              type: 'PROGRESS',
              stage: 'extracting',
              progress: durationSec > 0 ? Math.min(0.99, processedSec / durationSec) : 0.5,
              processedSec,
              totalSec: durationSec,
            });
          }
        } finally {
          sample.close();
        }
      }
    } catch (decodeErr) {
      if (cancelled) {
        post({ type: 'CANCELLED' });
        return;
      }
      const reason = decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
      post({
        type: 'FALLBACK_REQUIRED',
        metadata,
        reason: `WebCodecs audio decode failed (${reason}).`,
      });
      return;
    }

    if (cancelled) {
      post({ type: 'CANCELLED' });
      return;
    }

    const tailEnergy = energyAccumulator.flush();
    if (tailEnergy) {
      const [rms] = computeRmsEnergyBins(tailEnergy.samples, TARGET_ASR_SAMPLE_RATE, ENERGY_BIN_SEC);
      energyBins.push(rms ?? 0);
    }

    const tailChunk = chunker.flush();
    if (tailChunk) {
      post({ type: 'CHUNK', chunk: tailChunk }, [tailChunk.samples.buffer]);
    }

    post({
      type: 'PROGRESS',
      stage: 'extracting',
      progress: 1,
      processedSec: durationSec,
      totalSec: durationSec,
    });
    post({
      type: 'COMPLETE',
      energyBins,
      energyBinSec: ENERGY_BIN_SEC,
      totalDurationSec: durationSec,
    });
  } catch (err) {
    if (cancelled) {
      post({ type: 'CANCELLED' });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'ERROR', message });
    }
  } finally {
    try {
      input.dispose();
    } catch {
      // ignore
    }
    if (activeInput === input) {
      activeInput = null;
    }
  }
};
