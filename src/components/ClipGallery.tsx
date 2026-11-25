import { Clock, Flame, Sparkles } from 'lucide-react';
import type { ClipArtifacts } from '../pipeline/useClipForgePipeline';
import type { CandidateClip } from '../scoring/types';

interface ClipGalleryProps {
  clips: CandidateClip[];
  selectedClipId: string | null;
  artifacts: Record<string, ClipArtifacts>;
  onSelectClip: (clipId: string) => void;
}

function formatRange(start: number, end: number): string {
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

function scoreColor(score: number): string {
  if (score >= 75) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
  if (score >= 55) return 'bg-amber-500/15 text-amber-300 border-amber-500/35';
  return 'bg-zinc-800 text-zinc-300 border-zinc-700';
}

export function ClipGallery({
  clips,
  selectedClipId,
  artifacts,
  onSelectClip,
}: ClipGalleryProps) {
  if (clips.length === 0) return null;

  return (
    <section aria-label="Detected highlight clips" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-amber-400" />
          Top Highlights ({clips.length})
        </h2>
        <span className="text-[11px] text-zinc-400">Ranked by hook &amp; payoff</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {clips.map((clip, idx) => {
          const isSelected = clip.id === selectedClipId;
          const meta = artifacts[clip.id]?.metadata;
          const title = meta?.title || clip.llmTitle || clip.firstLine;
          const reason =
            clip.llmReason ||
            `Hook ${Math.round(clip.features.hook * 100)}% • Curiosity ${Math.round(clip.features.curiosity * 100)}% • Payoff ${Math.round(clip.features.ending * 100)}%`;

          return (
            <button
              key={clip.id}
              type="button"
              onClick={() => onSelectClip(clip.id)}
              aria-pressed={isSelected}
              className={`min-w-[260px] lg:min-w-0 text-left rounded-xl border p-3.5 transition-all cursor-pointer ${
                isSelected
                  ? 'border-amber-500 bg-amber-500/10 shadow-sm shadow-amber-500/10'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-mono text-zinc-400">
                  #{idx + 1} • {formatRange(clip.start, clip.end)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold font-mono ${scoreColor(clip.finalScore)}`}
                >
                  <Sparkles className="h-3 w-3" />
                  {Math.round(clip.finalScore)}
                </span>
              </div>

              <h3 className="mt-1.5 text-sm font-semibold text-zinc-100 line-clamp-2">
                {title}
              </h3>

              <p className="mt-1 text-xs text-zinc-400 line-clamp-2">{reason}</p>

              <div className="mt-2.5 flex items-center justify-between text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Clock className="h-3 w-3" />
                  {clip.duration.toFixed(1)}s
                </span>
                {clip.llmScore !== undefined ? (
                  <span className="text-sky-300/90">AI + Heuristic</span>
                ) : (
                  <span>Heuristic</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
