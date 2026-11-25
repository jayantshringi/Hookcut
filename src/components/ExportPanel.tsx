import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, Copy, Download, Film, Loader2, X } from 'lucide-react';
import type { ClipArtifacts } from '../pipeline/useHookcutPipeline';
import type { CandidateClip } from '../scoring/types';

interface ExportPanelProps {
  clip: CandidateClip;
  artifacts: ClipArtifacts;
  defaultExportHeight: 1080 | 720;
  onExport: (clip: CandidateClip, resolution: '720p' | '1080p') => void;
  onCancelExport: () => void;
  onCaptureThumbnail: (clip: CandidateClip) => void;
}

export function ExportPanel({
  clip,
  artifacts,
  defaultExportHeight,
  onExport,
  onCancelExport,
  onCaptureThumbnail,
}: ExportPanelProps) {
  const [copiedField, setCopiedField] = useState<'title' | 'description' | 'hashtags' | null>(null);

  const exportUrl = useMemo(
    () => (artifacts.exportResult ? URL.createObjectURL(artifacts.exportResult.blob) : null),
    [artifacts.exportResult],
  );

  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
  }, [exportUrl]);

  const isRendering = Boolean(artifacts.exportProgress);
  const progressPct = artifacts.exportProgress
    ? Math.round(artifacts.exportProgress.progress * 100)
    : 0;

  const copyText = async (field: 'title' | 'description' | 'hashtags', value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // ignore clipboard denial
    }
  };

  const slug = artifacts.metadata.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'hookcut-short';

  return (
    <section
      aria-label="Export and social metadata"
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Film className="h-3.5 w-3.5 text-amber-400" />
          Export &amp; Metadata
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isRendering}
            onClick={() => onExport(clip, '720p')}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Render 720p MP4
          </button>
          <button
            type="button"
            disabled={isRendering}
            onClick={() => onExport(clip, defaultExportHeight === 1080 ? '1080p' : '720p')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export {defaultExportHeight}p MP4
          </button>
        </div>
      </div>

      {artifacts.exportProgress && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-200">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
              Encoding H.264 + AAC ({artifacts.exportProgress.engine})… {progressPct}%
            </span>
            <button
              type="button"
              onClick={onCancelExport}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-800 cursor-pointer"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {artifacts.exportError && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200">
          Export failed: {artifacts.exportError}
        </p>
      )}

      {artifacts.exportResult && exportUrl && (
        <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/20 p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-emerald-200">
            Ready: {artifacts.exportResult.width}×{artifacts.exportResult.height} MP4 (
            {(artifacts.exportResult.blob.size / (1024 * 1024)).toFixed(2)} MB •{' '}
            {artifacts.exportResult.engine})
          </div>
          <a
            href={exportUrl}
            download={`${slug}.mp4`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download MP4
          </a>
        </div>
      )}

      {/* Local Metadata & Thumbnail */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] pt-1 border-t border-zinc-800/80">
        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Title</span>
              <button
                type="button"
                onClick={() => copyText('title', artifacts.metadata.title)}
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-amber-300 cursor-pointer"
              >
                {copiedField === 'title' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedField === 'title' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100">
              {artifacts.metadata.title}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Description &amp; Hashtags</span>
              <button
                type="button"
                onClick={() => copyText('description', artifacts.metadata.description)}
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-amber-300 cursor-pointer"
              >
                {copiedField === 'description' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedField === 'description' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-300 whitespace-pre-line">
              {artifacts.metadata.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 sm:w-28">
          {artifacts.thumbnail ? (
            <>
              <img
                src={artifacts.thumbnail.dataUrl}
                alt="Clip thumbnail"
                className="w-24 aspect-[9/16] rounded-lg border border-zinc-700 object-cover"
              />
              <a
                href={artifacts.thumbnail.dataUrl}
                download={`${slug}-thumb.jpg`}
                className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:underline"
              >
                <Download className="h-3 w-3" /> Thumbnail
              </a>
            </>
          ) : (
            <button
              type="button"
              disabled={artifacts.capturingThumbnail}
              onClick={() => onCaptureThumbnail(clip)}
              className="w-full h-28 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/60 p-2 flex flex-col items-center justify-center gap-1.5 text-[11px] text-zinc-300 hover:border-amber-500/60 cursor-pointer"
            >
              <Camera className="h-4 w-4 text-amber-400" />
              {artifacts.capturingThumbnail ? 'Capturing…' : 'Capture Thumbnail'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
