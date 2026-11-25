import { Scissors } from 'lucide-react';
import type { CandidateClip } from '../scoring/types';

interface TrimHandlesProps {
  clip: CandidateClip;
  maxDurationSec: number;
  onChangeTrim: (clipId: string, rawStart: number, rawEnd: number) => void;
}

export function TrimHandles({ clip, maxDurationSec, onChangeTrim }: TrimHandlesProps) {
  const safeMax = Math.max(clip.end, maxDurationSec);

  const nudgeStart = (delta: number) => {
    const nextStart = Math.max(0, Math.min(clip.end - 2, clip.start + delta));
    onChangeTrim(clip.id, nextStart, clip.end);
  };

  const nudgeEnd = (delta: number) => {
    const nextEnd = Math.min(safeMax, Math.max(clip.start + 2, clip.end + delta));
    onChangeTrim(clip.id, clip.start, nextEnd);
  };

  return (
    <section
      aria-label="Clip trim handles"
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Scissors className="h-3.5 w-3.5 text-amber-400" />
          Word-Snapped Trim Handles
        </h3>
        <span className="font-mono text-xs text-zinc-400">
          {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s ({clip.duration.toFixed(1)}s)
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <label htmlFor="trim-start-slider">Start ({clip.start.toFixed(2)}s)</label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => nudgeStart(-0.5)}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] hover:bg-zinc-700 cursor-pointer"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => nudgeStart(0.5)}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] hover:bg-zinc-700 cursor-pointer"
              >
                +0.5s
              </button>
            </div>
          </div>
          <input
            id="trim-start-slider"
            type="range"
            min={0}
            max={Math.max(0.5, clip.end - 2)}
            step={0.1}
            value={clip.start}
            onChange={(e) => onChangeTrim(clip.id, Number(e.target.value), clip.end)}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <label htmlFor="trim-end-slider">End ({clip.end.toFixed(2)}s)</label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => nudgeEnd(-0.5)}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] hover:bg-zinc-700 cursor-pointer"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => nudgeEnd(0.5)}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] hover:bg-zinc-700 cursor-pointer"
              >
                +0.5s
              </button>
            </div>
          </div>
          <input
            id="trim-end-slider"
            type="range"
            min={Math.min(safeMax, clip.start + 2)}
            max={safeMax}
            step={0.1}
            value={clip.end}
            onChange={(e) => onChangeTrim(clip.id, clip.start, Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>
      </div>

      <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-xs text-zinc-300 leading-relaxed max-h-24 overflow-y-auto">
        {clip.text}
      </p>
    </section>
  );
}
