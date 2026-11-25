import { computeRmsEnergyBins, MonoAudioChunker } from './resampleMono16k';
import {
  DEFAULT_AUDIO_CHUNK_SEC,
  ENERGY_BIN_SEC,
  TARGET_ASR_SAMPLE_RATE,
  type AudioChunk,
  type AudioExtractionProgress,
} from './types';

export interface FfmpegAudioFallbackOptions {
  file: File;
  durationSec: number;
  signal?: AbortSignal;
  onProgress?: (progress: AudioExtractionProgress) => void;
}

/**
 * Lazy-loads @ffmpeg/ffmpeg to extract 16 kHz mono PCM when WebCodecs AudioDecoder
 * is unavailable or cannot decode the input track.
 */
export async function extractAudioWithFfmpegFallback(
  options: FfmpegAudioFallbackOptions,
): Promise<{ chunks: AudioChunk[]; energyBins: number[] }> {
  const { file, durationSec, signal, onProgress } = options;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);

  const ffmpeg = new FFmpeg();
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

  ffmpeg.on('progress', ({ progress }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    onProgress?.({
      stage: 'extracting',
      progress: clamped,
      processedSec: clamped * durationSec,
      totalSec: durationSec,
    });
  });

  const abortHandler = () => {
    try {
      ffmpeg.terminate();
    } catch {
      // ignore termination failure
    }
  };
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const inputMountDir = '/input';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.mp4';
    let inputPath = `${inputMountDir}/${safeName}`;
    let mounted = false;

    try {
      await ffmpeg.createDir(inputMountDir);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ffmpeg.mount('WORKERFS' as any, { files: [file] }, inputMountDir);
      mounted = true;
    } catch {
      // Guard against copying massive >300MB files into WASM MEMFS when WORKERFS is unavailable
      if (file.size > 300 * 1024 * 1024) {
        throw new Error(
          'WORKERFS unavailable for >300 MB file in ffmpeg.wasm audio fallback. Please use Chrome/Edge with WebCodecs enabled.',
        );
      }
      // Fallback if WORKERFS mount is unavailable in this environment
      inputPath = `/${safeName}`;
      const stream = file.stream();
      const reader = stream.getReader();
      const parts: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          parts.push(value);
          total += value.byteLength;
        }
      }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        joined.set(p, offset);
        offset += p.byteLength;
      }
      await ffmpeg.writeFile(inputPath, joined);
    }

    const outputPath = '/audio_16k.f32';
    await ffmpeg.exec([
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(TARGET_ASR_SAMPLE_RATE),
      '-f',
      'f32le',
      outputPath,
    ]);

    const rawBytes = (await ffmpeg.readFile(outputPath)) as Uint8Array;
    const alignedBuffer = rawBytes.slice().buffer;
    const monoSamples = new Float32Array(alignedBuffer);

    const energyBins = computeRmsEnergyBins(monoSamples, TARGET_ASR_SAMPLE_RATE, ENERGY_BIN_SEC);
    const chunker = new MonoAudioChunker(DEFAULT_AUDIO_CHUNK_SEC, TARGET_ASR_SAMPLE_RATE);
    const chunks = chunker.push(monoSamples);
    const tail = chunker.flush();
    if (tail) chunks.push(tail);

    try {
      await ffmpeg.deleteFile(outputPath);
      if (mounted) {
        await ffmpeg.unmount(inputMountDir);
      } else {
        await ffmpeg.deleteFile(inputPath);
      }
    } catch {
      // best-effort cleanup
    }

    return { chunks, energyBins };
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    try {
      ffmpeg.terminate();
    } catch {
      // ignore
    }
  }
}
