import type { ModelDownloadProgress } from '../transcribe/types';
import { SCORING_CONFIG } from './config';
import { buildRerankPrompt, parseAndValidateRerankResponse } from './rerankPrompt';
import type { CandidateClip, ScoringConfig } from './types';
import type { LlmRerankWorkerResponse } from '../workers/llmRerank.worker';

export type PromptRunner = (prompt: string) => Promise<string>;

export interface RerankProgress {
  phase: 'skipped' | 'loading-model' | 'evaluating' | 'done';
  completed: number;
  total: number;
  download?: ModelDownloadProgress;
}

export interface RerankOptions {
  llmEnabled: boolean;
  config?: ScoringConfig;
  signal?: AbortSignal;
  onProgress?: (progress: RerankProgress) => void;
}

export function blendFinalScore(
  heuristicScore: number,
  llmScore: number,
  config: ScoringConfig = SCORING_CONFIG,
): number {
  const blended =
    config.rerank.heuristicWeight * heuristicScore + config.rerank.llmWeight * llmScore;
  return Math.round(blended * 10) / 10;
}

export function filterByMinLlmScore(
  candidates: CandidateClip[],
  minLlmScore: number,
): CandidateClip[] {
  return candidates.filter((clip) => clip.llmScore === undefined || clip.llmScore >= minLlmScore);
}

/**
 * Pure, testable reranker that invokes `runner` once per candidate (with 1 retry on
 * invalid JSON/schema or non-substring hook_line) and falls back to heuristic score.
 */
export async function rerankCandidatesWithRunner(
  candidates: CandidateClip[],
  runner: PromptRunner,
  options: RerankOptions,
): Promise<CandidateClip[]> {
  const config = options.config ?? SCORING_CONFIG;
  const { topN, minLlmScoreToKeep } = config.rerank;

  if (candidates.length === 0) return [];

  if (!options.llmEnabled) {
    options.onProgress?.({
      phase: 'skipped',
      completed: candidates.length,
      total: candidates.length,
    });
    return [...candidates]
      .sort((a, b) => b.heuristicScore - a.heuristicScore)
      .slice(0, topN)
      .map((clip) => ({ ...clip, finalScore: clip.heuristicScore }));
  }

  const evaluated: CandidateClip[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (options.signal?.aborted) {
      throw new DOMException('LLM rerank cancelled', 'AbortError');
    }

    const candidate = candidates[i]!;
    const basePrompt = buildRerankPrompt(candidate.text);
    let parsedSuccess: ReturnType<typeof parseAndValidateRerankResponse> | null = null;

    // Attempt 1 + retry once on invalid output
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) {
        throw new DOMException('LLM rerank cancelled', 'AbortError');
      }
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nIMPORTANT: Output ONLY valid JSON. Ensure hook_line is copied verbatim from Excerpt.`;
      try {
        const rawOutput = await runner(prompt);
        const validation = parseAndValidateRerankResponse(rawOutput, candidate.text);
        if (validation.ok) {
          parsedSuccess = validation;
          break;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
      }
    }

    if (parsedSuccess && parsedSuccess.ok) {
      evaluated.push({
        ...candidate,
        llmScore: parsedSuccess.value.score,
        llmTitle: parsedSuccess.value.title,
        llmHookLine: parsedSuccess.value.hook_line,
        llmReason: parsedSuccess.value.reason,
        finalScore: blendFinalScore(candidate.heuristicScore, parsedSuccess.value.score, config),
      });
    } else {
      // Fallback to heuristic score after retry failure
      evaluated.push({
        ...candidate,
        finalScore: candidate.heuristicScore,
      });
    }

    options.onProgress?.({
      phase: 'evaluating',
      completed: i + 1,
      total: candidates.length,
    });
  }

  const filtered = filterByMinLlmScore(evaluated, minLlmScoreToKeep);
  const pool = filtered.length > 0 ? filtered : evaluated;

  options.onProgress?.({
    phase: 'done',
    completed: candidates.length,
    total: candidates.length,
  });

  return [...pool].sort((a, b) => b.finalScore - a.finalScore).slice(0, topN);
}

/**
 * Runs local WebGPU LLM reranking inside a dedicated Web Worker with graceful
 * fallback to heuristic scores if model initialization fails or device is weak.
 */
export async function rerankWithLocalLlm(
  candidates: CandidateClip[],
  options: RerankOptions & { modelId: string },
): Promise<CandidateClip[]> {
  if (!options.llmEnabled || candidates.length === 0) {
    return rerankCandidatesWithRunner(candidates, async () => '', {
      ...options,
      llmEnabled: false,
    });
  }

  if (options.signal?.aborted) {
    throw new DOMException('LLM rerank cancelled', 'AbortError');
  }

  const worker = new Worker(
    new URL('../workers/llmRerank.worker.ts', import.meta.url),
    { type: 'module' },
  );

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  let readyResolved = false;

  const disposeWorker = () => {
    try {
      worker.postMessage({ type: 'DISPOSE' });
    } catch {
      // ignore
    }
    worker.terminate();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        disposeWorker();
        reject(new DOMException('LLM rerank cancelled', 'AbortError'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      worker.onmessage = (event: MessageEvent<LlmRerankWorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'MODEL_PROGRESS') {
          if (msg.download.total > 0) {
            fileProgress.set(msg.download.file, {
              loaded: msg.download.loaded,
              total: msg.download.total,
            });
          }
          let loaded = 0;
          let total = 0;
          for (const entry of fileProgress.values()) {
            loaded += entry.loaded;
            total += entry.total;
          }
          const pct = total > 0 ? Math.round((loaded / total) * 100) : Math.round(msg.download.progress);
          options.onProgress?.({
            phase: 'loading-model',
            completed: 0,
            total: candidates.length,
            download: { ...msg.download, progress: pct },
          });
        } else if (msg.type === 'READY') {
          readyResolved = true;
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        } else if (msg.type === 'ERROR' && !readyResolved) {
          options.signal?.removeEventListener('abort', onAbort);
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        if (!readyResolved) {
          options.signal?.removeEventListener('abort', onAbort);
          reject(new Error(err.message || 'LLM worker initialization failed.'));
        }
      };

      worker.postMessage({ type: 'INIT', modelId: options.modelId });
    });

    let seq = 0;
    const runner: PromptRunner = (prompt) =>
      new Promise<string>((resolve, reject) => {
        const requestId = `req-${++seq}`;
        const onAbort = () => {
          disposeWorker();
          reject(new DOMException('LLM rerank cancelled', 'AbortError'));
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });

        const handler = (event: MessageEvent<LlmRerankWorkerResponse>) => {
          const msg = event.data;
          if (msg.type === 'RESULT' && msg.requestId === requestId) {
            worker.removeEventListener('message', handler);
            options.signal?.removeEventListener('abort', onAbort);
            resolve(msg.output);
          } else if (msg.type === 'ERROR' && msg.requestId === requestId) {
            worker.removeEventListener('message', handler);
            options.signal?.removeEventListener('abort', onAbort);
            reject(new Error(msg.message));
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'EVALUATE', requestId, prompt });
      });

    return await rerankCandidatesWithRunner(candidates, runner, options);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    // Graceful fallback to heuristics if WebGPU LLM model load fails at runtime
    return rerankCandidatesWithRunner(candidates, async () => '', {
      ...options,
      llmEnabled: false,
    });
  } finally {
    disposeWorker();
  }
}
