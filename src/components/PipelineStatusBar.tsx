import { AlertCircle, CheckCircle2, Download, Loader2, RotateCcw, X } from 'lucide-react';
import type { PipelineStage, PipelineUiState } from '../pipeline/useClipForgePipeline';

interface PipelineStatusBarProps {
  state: PipelineUiState;
  onCancel: () => void;
  onRetry?: () => void;
}

const STEPS: Array<{ id: PipelineStage; label: string }> = [
  { id: 'extracting', label: 'Audio' },
  { id: 'transcribing', label: 'Whisper' },
  { id: 'scoring', label: 'Score' },
  { id: 'reranking', label: 'Re-rank' },
  { id: 'ready', label: 'Clips' },
];

const STAGE_ORDER: Record<PipelineStage, number> = {
  idle: -1,
  extracting: 0,
  transcribing: 1,
  scoring: 2,
  reranking: 3,
  ready: 4,
  cancelled: -1,
  error: -1,
};

export function PipelineStatusBar({ state, onCancel, onRetry }: PipelineStatusBarProps) {
  if (state.stage === 'idle') return null;

  const isRunning =
    state.stage === 'extracting' ||
    state.stage === 'transcribing' ||
    state.stage === 'scoring' ||
    state.stage === 'reranking';

  const activeStepIdx = STAGE_ORDER[state.stage];
  const pct = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);

  return (
    <section
      aria-label="Pipeline progress"
      className={`rounded-xl border p-4 space-y-3 ${
        state.stage === 'error'
          ? 'border-rose-500/40 bg-rose-950/20'
          : state.stage === 'ready'
            ? 'border-emerald-500/30 bg-emerald-950/15'
            : 'border-zinc-800 bg-zinc-900/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-amber-400 shrink-0" />}
          {state.stage === 'ready' && (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          )}
          {(state.stage === 'error' || state.stage === 'cancelled') && (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <div>
            <p className="text-xs sm:text-sm font-medium text-zinc-100">{state.stageLabel}</p>
            {state.errorMessage && (
              <p className="text-xs text-rose-300 mt-0.5">{state.errorMessage}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <>
              <span className="font-mono text-xs text-zinc-300">{pct}%</span>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </>
          )}
          {(state.stage === 'error' || state.stage === 'cancelled') && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </button>
          )}
        </div>
      </div>

      {/* Stepper pills */}
      <div className="grid grid-cols-5 gap-1.5">
        {STEPS.map((step, idx) => {
          const done = state.stage === 'ready' || (activeStepIdx > idx && isRunning);
          const current = isRunning && activeStepIdx === idx;
          return (
            <div
              key={step.id}
              className={`rounded-md px-2 py-1 text-center text-[11px] font-medium border transition-colors ${
                done
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                  : current
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-950/50 text-zinc-500'
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>

      {/* Overall progress bar */}
      {isRunning && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-amber-500 transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Model download progress bar */}
      {isRunning && state.downloadProgress && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-300">
            <span className="inline-flex items-center gap-1.5 truncate">
              <Download className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              Caching model file: <span className="font-mono">{state.downloadProgress.file}</span>
            </span>
            <span className="font-mono text-zinc-400 shrink-0 ml-2">
              {state.downloadProgress.total > 0
                ? `${(state.downloadProgress.loaded / (1024 * 1024)).toFixed(1)} / ${(state.downloadProgress.total / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.round(state.downloadProgress.progress)}%`}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-sky-400 transition-all duration-150"
              style={{
                width: `${Math.max(2, Math.min(100, Math.round(state.downloadProgress.progress)))}%`,
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
