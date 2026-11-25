import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import type { ModelDownloadProgress } from '../transcribe/types';

export type LlmRerankWorkerRequest =
  | { type: 'INIT'; modelId: string }
  | { type: 'EVALUATE'; requestId: string; prompt: string }
  | { type: 'DISPOSE' };

export type LlmRerankWorkerResponse =
  | { type: 'MODEL_PROGRESS'; download: ModelDownloadProgress }
  | { type: 'READY' }
  | { type: 'RESULT'; requestId: string; output: string }
  | { type: 'ERROR'; requestId?: string; message: string }
  | { type: 'DISPOSED' };

let generator: TextGenerationPipeline | null = null;
let cancelled = false;

function post(msg: LlmRerankWorkerResponse): void {
  self.postMessage(msg);
}

async function disposeGenerator(): Promise<void> {
  if (!generator) return;
  const current = generator;
  generator = null;
  try {
    await current.dispose();
  } catch {
    // ignore cleanup error
  }
}

self.onmessage = async (event: MessageEvent<LlmRerankWorkerRequest>) => {
  const payload = event.data;

  if (payload.type === 'DISPOSE') {
    cancelled = true;
    await disposeGenerator();
    post({ type: 'DISPOSED' });
    return;
  }

  if (payload.type === 'INIT') {
    cancelled = false;
    try {
      await disposeGenerator();
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      generator = await pipeline('text-generation', payload.modelId, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: (info: {
          status?: string;
          file?: string;
          loaded?: number;
          total?: number;
          progress?: number;
        }) => {
          if (cancelled) return;
          post({
            type: 'MODEL_PROGRESS',
            download: {
              file: info.file ?? 'llm',
              status: info.status ?? 'loading',
              loaded: info.loaded ?? 0,
              total: info.total ?? 0,
              progress: typeof info.progress === 'number' ? info.progress : 0,
            },
          });
        },
      });

      if (cancelled) {
        await disposeGenerator();
        return;
      }
      post({ type: 'READY' });
    } catch (err) {
      await disposeGenerator();
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'ERROR', message });
    }
    return;
  }

  if (payload.type === 'EVALUATE') {
    if (!generator) {
      post({
        type: 'ERROR',
        requestId: payload.requestId,
        message: 'LLM generator is not initialized.',
      });
      return;
    }

    try {
      const messages = [
        { role: 'system', content: 'Respond ONLY with valid JSON matching the requested schema.' },
        { role: 'user', content: payload.prompt },
      ];
      const output = await generator(messages, {
        max_new_tokens: 180,
        do_sample: false,
      });

      const first = Array.isArray(output) ? output[0] : output;
      const generated = first?.generated_text;
      let text = '';
      if (typeof generated === 'string') {
        text = generated;
      } else if (Array.isArray(generated)) {
        const lastMsg = generated[generated.length - 1] as { content?: string } | undefined;
        text = lastMsg?.content ?? '';
      }

      post({ type: 'RESULT', requestId: payload.requestId, output: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'ERROR', requestId: payload.requestId, message });
    }
  }
};
