import { useRef, useState, type DragEvent } from 'react';
import { Film, ShieldCheck, Upload } from 'lucide-react';
import type { VideoMetadata } from '../media/types';

interface DropZoneProps {
  onSelectFile: (file: File) => void;
  disabled?: boolean;
  selectedFile: File | null;
  metadata: VideoMetadata | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DropZone({
  onSelectFile,
  disabled = false,
  selectedFile,
  metadata,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !disabled) {
      onSelectFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <section aria-label="Video upload">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-all ${
          disabled
            ? 'border-zinc-800 bg-zinc-900/30 opacity-60 cursor-not-allowed'
            : dragging
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-zinc-700/80 bg-zinc-900/50 hover:border-amber-500/60 hover:bg-zinc-900/80'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
          disabled={disabled}
          aria-label="Choose local video file"
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="mx-auto flex max-w-lg flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            {selectedFile ? <Film className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </div>

          {selectedFile ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-100 break-all">
                {selectedFile.name}
              </p>
              <p className="text-xs text-zinc-400">
                {formatBytes(selectedFile.size)}
                {metadata
                  ? ` • ${formatDuration(metadata.durationSec)} • ${metadata.width}×${metadata.height} @ ${metadata.fps}fps`
                  : ''}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-semibold text-zinc-100">
                Drop a local video to forge 9:16 viral shorts
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400">
                MP4, MOV, WebM, or MKV • Max 30 min &amp; 1 GB • Local files only
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {selectedFile ? 'Choose Another Video' : 'Select Video File'}
            </button>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              Processed 100% on-device
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
