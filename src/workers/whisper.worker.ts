import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import {
  normalizeWhisperSegmentChunks,
  normalizeWhisperWordChunks,
  type RawWhisperChunk,
} from '../transcribe/normalizeWords';
import type { ModelDownloadProgress, WordTimestamp } from '../transcribe/types';

export interface TranscribeChunkInput {
  index: number;
  startSec: number;
  endSec: number;
  samples: Float32Array;
}

export type WhisperWorkerRequest =
  | {
      type: 'TRANSCRIBE';
      modelId: string;
      device: 'webgpu' | 'wasm';
      language?: string;
      chunks: TranscribeChunkInput[];
    }
  | { type: 'CANCEL' };

export type WhisperWorkerResponse =
  | { type: 'MODEL_PROGRESS'; download: ModelDownloadProgress; device: 'webgpu' | 'wasm' }
  | { type: 'DEVICE_FALLBACK'; from: 'webgpu'; to: 'wasm'; reason: string }
  | { type: 'CHUNK_DONE'; chunkIndex: number; totalChunks: number; words: WordTimestamp[] }
  | { type: 'COMPLETE'; words: WordTimestamp[]; device: 'webgpu' | 'wasm' }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string };

let cancelled = false;
let activePipeline: AutomaticSpeechRecognitionPipeline | null = null;

function post(msg: WhisperWorkerResponse): void {
  self.postMessage(msg);
}

async function createTranscriber(
  modelId: string,
  preferredDevice: 'webgpu' | 'wasm',
): Promise<{ transcriber: AutomaticSpeechRecognitionPipeline; activeDevice: 'webgpu' | 'wasm' }> {
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const loadWithDevice = async (device: 'webgpu' | 'wasm') => {
    const progressHandler = (info: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
      progress?: number;
    }) => {
      if (cancelled) return;
      post({
        type: 'MODEL_PROGRESS',
        device,
        download: {
          file: info.file ?? 'model',
          status: info.status ?? 'loading',
          loaded: info.loaded ?? 0,
          total: info.total ?? 0,
          progress: typeof info.progress === 'number' ? info.progress : 0,
        },
      });
    };

    const instance = await pipeline('automatic-speech-recognition', modelId, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: progressHandler,
    });
    return instance;
  };

  if (preferredDevice === 'webgpu') {
    try {
      const transcriber = await loadWithDevice('webgpu');
      return { transcriber, activeDevice: 'webgpu' };
    } catch (err) {
      if (cancelled) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      post({ type: 'DEVICE_FALLBACK', from: 'webgpu', to: 'wasm', reason });
      const transcriber = await loadWithDevice('wasm');
      return { transcriber, activeDevice: 'wasm' };
    }
  }

  const transcriber = await loadWithDevice('wasm');
  return { transcriber, activeDevice: 'wasm' };
}

async function runTranscriberPass(
  transcriber: AutomaticSpeechRecognitionPipeline,
  chunk: TranscribeChunkInput,
  returnTimestamps: 'word' | true,
  langOptions: Record<string, string>,
): Promise<WordTimestamp[]> {
  const result = await transcriber(chunk.samples, {
    return_timestamps: returnTimestamps,
    force_full_sequences: false,
    chunk_length_s: 30,
    stride_length_s: 5,
    ...langOptions,
  });
  const single = Array.isArray(result) ? result[0] : result;
  const rawChunks = (single?.chunks ?? []) as RawWhisperChunk[];
  if (rawChunks.length > 0) {
    return returnTimestamps === 'word'
      ? normalizeWhisperWordChunks(rawChunks, chunk.startSec, chunk.endSec)
      : normalizeWhisperSegmentChunks(rawChunks, chunk.startSec, chunk.endSec);
  }
  if (single?.text?.trim()) {
    return normalizeWhisperSegmentChunks(
      [{ text: single.text, timestamp: [0, Math.max(0.5, chunk.endSec - chunk.startSec)] }],
      chunk.startSec,
      chunk.endSec,
    );
  }
  return [];
}

async function transcribeChunkWords(
  transcriber: AutomaticSpeechRecognitionPipeline,
  chunk: TranscribeChunkInput,
  language?: string,
  modelId = '',
): Promise<WordTimestamp[]> {
  const langOptions: Record<string, string> =
    language && !modelId.endsWith('.en') && !modelId.endsWith('.en_timestamped')
      ? { language, task: 'transcribe' }
      : {};

  try {
    return await runTranscriberPass(transcriber, chunk, 'word', langOptions);
  } catch {
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
    // Fallback to segment-level timestamps when word-level cross-attentions are unavailable
    return await runTranscriberPass(transcriber, chunk, true, langOptions);
  }
}

async function disposeActivePipeline(): Promise<void> {
  if (!activePipeline) return;
  const pipe = activePipeline;
  activePipeline = null;
  try {
    await pipe.dispose();
  } catch {
    // ignore disposal error
  }
}

self.onmessage = async (event: MessageEvent<WhisperWorkerRequest>) => {
  const payload = event.data;

  if (payload.type === 'CANCEL') {
    cancelled = true;
    await disposeActivePipeline();
    return;
  }

  if (payload.type !== 'TRANSCRIBE') return;

  cancelled = false;

  try {
    const { transcriber, activeDevice } = await createTranscriber(payload.modelId, payload.device);
    activePipeline = transcriber;

    if (cancelled) {
      await disposeActivePipeline();
      post({ type: 'CANCELLED' });
      return;
    }

    const allWords: WordTimestamp[] = [];
    const totalChunks = payload.chunks.length;

    for (let i = 0; i < totalChunks; i++) {
      if (cancelled) {
        await disposeActivePipeline();
        post({ type: 'CANCELLED' });
        return;
      }

      const chunk = payload.chunks[i]!;
      if (chunk.samples.length === 0) {
        post({ type: 'CHUNK_DONE', chunkIndex: i + 1, totalChunks, words: [] });
        continue;
      }

      const normalized = await transcribeChunkWords(
        transcriber,
        chunk,
        payload.language,
        payload.modelId,
      );

      if (cancelled) {
        await disposeActivePipeline();
        post({ type: 'CANCELLED' });
        return;
      }

      allWords.push(...normalized);
      post({
        type: 'CHUNK_DONE',
        chunkIndex: i + 1,
        totalChunks: totalChunks,
        words: normalized,
      });
    }

    await disposeActivePipeline();
    post({ type: 'COMPLETE', words: allWords, device: activeDevice });
  } catch (err) {
    await disposeActivePipeline();
    if (cancelled) {
      post({ type: 'CANCELLED' });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'ERROR', message });
    }
  }
};
