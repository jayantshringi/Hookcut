import type { AudioChunk } from '../media/types';
import { groupWordsIntoSegments } from './normalizeWords';
import { getCachedTranscript, saveCachedTranscript } from './transcriptCache';
import type { Transcript, TranscriptionProgress, WordTimestamp } from './types';
import type { WhisperWorkerResponse } from '../workers/whisper.worker';

export interface TranscribeOptions {
  fileFingerprint: string;
  durationSec: number;
  chunks: AudioChunk[];
  modelId: string;
  device: 'webgpu' | 'wasm';
  language?: string;
  signal?: AbortSignal;
  skipCache?: boolean;
  onProgress?: (progress: TranscriptionProgress) => void;
}

/**
 * Transcribes 16 kHz mono audio chunks in a Web Worker using Whisper (WebGPU with WASM fallback),
 * caching completed transcripts in IndexedDB keyed by fileFingerprint + modelId.
 */
export async function transcribeAudioChunks(options: TranscribeOptions): Promise<Transcript> {
  const {
    fileFingerprint,
    durationSec,
    chunks,
    modelId,
    device,
    language = 'en',
    signal,
    skipCache = false,
    onProgress,
  } = options;

  if (signal?.aborted) {
    throw new DOMException('Transcription cancelled', 'AbortError');
  }

  onProgress?.({
    phase: 'checking-cache',
    progress: 0,
    chunkIndex: 0,
    totalChunks: chunks.length,
  });

  if (!skipCache) {
    const cached = await getCachedTranscript(fileFingerprint, modelId);
    if (cached) {
      onProgress?.({
        phase: 'cached',
        progress: 1,
        chunkIndex: chunks.length,
        totalChunks: chunks.length,
      });
      return cached;
    }
  }

  if (chunks.length === 0) {
    const emptyTranscript: Transcript = {
      fileFingerprint,
      modelId,
      language,
      durationSec,
      text: '',
      words: [],
      segments: [],
      createdAt: Date.now(),
    };
    await saveCachedTranscript(emptyTranscript);
    return emptyTranscript;
  }

  const words = await new Promise<WordTimestamp[]>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/whisper.worker.ts', import.meta.url),
      { type: 'module' },
    );

    let settled = false;
    const fileProgress = new Map<string, { loaded: number; total: number }>();

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      worker.postMessage({ type: 'CANCEL' });
      cleanup();
      reject(new DOMException('Transcription cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) => {
      if (settled) return;
      const msg = event.data;

      switch (msg.type) {
        case 'MODEL_PROGRESS': {
          if (msg.download.total > 0) {
            fileProgress.set(msg.download.file, {
              loaded: msg.download.loaded,
              total: msg.download.total,
            });
          }
          let loadedSum = 0;
          let totalSum = 0;
          for (const entry of fileProgress.values()) {
            loadedSum += entry.loaded;
            totalSum += entry.total;
          }
          const aggProgress =
            totalSum > 0
              ? Math.min(1, loadedSum / totalSum)
              : Math.min(1, msg.download.progress / 100);

          onProgress?.({
            phase: 'loading-model',
            progress: aggProgress * 0.25,
            chunkIndex: 0,
            totalChunks: chunks.length,
            device: msg.device,
            download: {
              ...msg.download,
              progress: Math.round(aggProgress * 100),
            },
          });
          break;
        }

        case 'DEVICE_FALLBACK':
          onProgress?.({
            phase: 'loading-model',
            progress: 0.1,
            chunkIndex: 0,
            totalChunks: chunks.length,
            device: msg.to,
          });
          break;

        case 'CHUNK_DONE': {
          const frac = msg.totalChunks > 0 ? msg.chunkIndex / msg.totalChunks : 1;
          onProgress?.({
            phase: 'transcribing',
            progress: 0.25 + frac * 0.75,
            chunkIndex: msg.chunkIndex,
            totalChunks: msg.totalChunks,
          });
          break;
        }

        case 'COMPLETE':
          settled = true;
          cleanup();
          resolve(msg.words);
          break;

        case 'CANCELLED':
          settled = true;
          cleanup();
          reject(new DOMException('Transcription cancelled', 'AbortError'));
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
      reject(new Error(err.message || 'Whisper transcription worker crashed.'));
    };

    // Clone chunk sample buffers for worker transfer so caller can reuse or free independently
    const workerChunks = chunks.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      samples: new Float32Array(c.samples),
    }));

    worker.postMessage(
      {
        type: 'TRANSCRIBE',
        modelId,
        device,
        language,
        chunks: workerChunks,
      },
      workerChunks.map((c) => c.samples.buffer),
    );
  });

  const segments = groupWordsIntoSegments(words);
  const transcript: Transcript = {
    fileFingerprint,
    modelId,
    language,
    durationSec,
    text: segments.map((s) => s.text).join(' '),
    words,
    segments,
    createdAt: Date.now(),
  };

  await saveCachedTranscript(transcript);
  return transcript;
}
