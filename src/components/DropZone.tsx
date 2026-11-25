import { useRef, useState, useEffect, type DragEvent, type FormEvent } from 'react';
import {
  CheckCircle2,
  Film,
  Globe,
  Languages,
  Link2,
  Radio,
  Settings2,
  ShieldCheck,
  Square,
  Upload,
  WifiOff,
} from 'lucide-react';
import {
  formatRecordingDuration,
  isTabCaptureSupported,
} from '../media/tabCapture';
import type { VideoMetadata } from '../media/types';
import {
  checkBridgeHealth,
  classifyVideoUrl,
  fetchYouTubePreview,
  getStoredYtBridgeUrl,
  setStoredYtBridgeUrl,
  type YouTubePreviewInfo,
} from '../media/urlIngest';
import { WHISPER_LANGUAGES } from '../transcribe/languages';

export interface TabCaptureUiProps {
  recording: boolean;
  elapsedSec: number;
  hasAudio: boolean;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

interface DropZoneProps {
  onSelectFile: (file: File) => void;
  onSubmitUrl?: (url: string, bridgeUrl?: string) => void;
  disabled?: boolean;
  selectedFile: File | null;
  sourceUrl?: string | null;
  youtubePreview?: YouTubePreviewInfo | null;
  metadata: VideoMetadata | null;
  language?: string;
  onChangeLanguage?: (lang: string) => void;
  tabCapture?: TabCaptureUiProps;
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
  onSubmitUrl,
  disabled = false,
  selectedFile,
  sourceUrl = null,
  youtubePreview = null,
  metadata,
  language = 'en',
  onChangeLanguage,
  tabCapture,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<'file' | 'url' | 'record'>('file');
  const [urlInput, setUrlInput] = useState(sourceUrl ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showBridgeSettings, setShowBridgeSettings] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState(() => getStoredYtBridgeUrl());
  const [bridgeStatus, setBridgeStatus] = useState<{
    checked: boolean;
    ok: boolean;
    detail?: string;
  }>({ checked: false, ok: false });
  const [draftPreview, setDraftPreview] = useState<YouTubePreviewInfo | null>(null);

  useEffect(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const classified = classifyVideoUrl(trimmed);
        if (classified.kind !== 'youtube') {
          if (active) setDraftPreview(null);
          return;
        }
        const info = await fetchYouTubePreview(
          classified.videoId,
          classified.url,
          bridgeUrl,
        );
        if (active) setDraftPreview(info);
      } catch {
        if (active) setDraftPreview(null);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridgeUrl, urlInput]);

  const activePreview = youtubePreview ?? (urlInput.trim() ? draftPreview : null);
  const effectiveMode = tabCapture?.recording ? 'record' : mode;
  const tabSupported = isTabCaptureSupported();

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !disabled) {
      onSelectFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled && effectiveMode === 'file') setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (effectiveMode !== 'file') setMode('file');
    handleFiles(e.dataTransfer.files);
  };

  const handleUrlSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || !onSubmitUrl) return;
    try {
      const classified = classifyVideoUrl(urlInput);
      setUrlError(null);
      setStoredYtBridgeUrl(bridgeUrl);
      onSubmitUrl(classified.url, bridgeUrl);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCheckBridge = async () => {
    setStoredYtBridgeUrl(bridgeUrl);
    const res = await checkBridgeHealth(bridgeUrl);
    setBridgeStatus({
      checked: true,
      ok: res.ok,
      detail: res.ok
        ? `Connected (${res.kind === 'cobalt' ? 'Cobalt API' : `yt-dlp ${res.ytdlpVersion ?? 'ready'}`})`
        : res.error,
    });
  };

  return (
    <section aria-label="Video upload">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-2xl border-2 border-dashed p-5 sm:p-7 text-center transition-all ${
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

        {/* Source mode selector + Speech Language */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
          <div className="inline-flex flex-wrap justify-center rounded-xl border border-zinc-800 bg-zinc-950/70 p-1">
            <button
              type="button"
              onClick={() => setMode('file')}
              disabled={Boolean(tabCapture?.recording)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                effectiveMode === 'file'
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'text-zinc-300 hover:text-zinc-100'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Local Video File
            </button>
            <button
              type="button"
              onClick={() => setMode('url')}
              disabled={Boolean(tabCapture?.recording)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                effectiveMode === 'url'
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'text-zinc-300 hover:text-zinc-100'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              YouTube / Video URL
            </button>
            <button
              type="button"
              onClick={() => setMode('record')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                effectiveMode === 'record'
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'text-zinc-300 hover:text-zinc-100'
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              Record Browser Tab
            </button>
          </div>

          {onChangeLanguage && (
            <label className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-300">
              <Languages className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="sr-only">Speech language</span>
              <select
                aria-label="Speech language"
                value={language}
                disabled={disabled || Boolean(tabCapture?.recording)}
                onChange={(e) => onChangeLanguage(e.target.value)}
                className="bg-transparent text-xs text-zinc-100 focus:outline-none cursor-pointer"
              >
                {WHISPER_LANGUAGES.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-zinc-900 text-zinc-100">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {effectiveMode === 'file' && (
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
        )}

        {effectiveMode === 'url' && (
          <div className="mx-auto max-w-xl space-y-3 text-left">
            <form onSubmit={handleUrlSubmit} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="url"
                  value={urlInput}
                  disabled={disabled}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setUrlInput(nextVal);
                    setUrlError(null);
                    if (!nextVal.trim()) setDraftPreview(null);
                  }}
                  aria-label="YouTube or video URL"
                  placeholder="https://www.youtube.com/watch?v=... or direct .mp4 link"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 pl-9 pr-3 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={disabled || !urlInput.trim()}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
              >
                Fetch &amp; Forge
              </button>
            </form>

            {urlError && <p className="text-xs text-rose-300">{urlError}</p>}

            {activePreview && (
              <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
                <img
                  src={activePreview.thumbnailUrl}
                  alt={activePreview.title}
                  className="h-14 w-24 rounded-lg object-cover bg-zinc-900 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100 truncate">
                    {activePreview.title}
                  </p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {activePreview.authorName ? `${activePreview.authorName} • ` : ''}
                    {typeof activePreview.durationSec === 'number'
                      ? formatDuration(activePreview.durationSec)
                      : 'YouTube video'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
              <span>
                Direct MP4/WebM URLs stream automatically. YouTube links use the configured server or{' '}
                <button
                  type="button"
                  onClick={() => setMode('record')}
                  className="text-amber-300 hover:underline cursor-pointer"
                >
                  browser tab capture
                </button>
                .
              </span>
              <button
                type="button"
                onClick={() => setShowBridgeSettings((s) => !s)}
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-amber-300 hover:underline cursor-pointer"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Bridge settings
              </button>
            </div>

            {showBridgeSettings && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2 text-xs">
                <label className="block text-[11px] font-medium text-zinc-300" htmlFor="yt-bridge-url">
                  Custom YouTube Bridge / Cobalt Endpoint URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="yt-bridge-url"
                    type="url"
                    value={bridgeUrl}
                    onChange={(e) => {
                      setBridgeUrl(e.target.value);
                      setBridgeStatus({ checked: false, ok: false });
                    }}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCheckBridge()}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                  >
                    Check
                  </button>
                </div>
                {bridgeStatus.checked && (
                  <p
                    className={`inline-flex items-center gap-1.5 text-[11px] ${
                      bridgeStatus.ok ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {bridgeStatus.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{bridgeStatus.detail}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {effectiveMode === 'record' && (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl border ${
                tabCapture?.recording
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}
            >
              <Radio className="h-6 w-6" />
            </div>

            {tabCapture?.recording ? (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-zinc-100">
                    Recording Browser Tab •{' '}
                    <span className="font-mono text-amber-300">
                      {formatRecordingDuration(tabCapture.elapsedSec)}
                    </span>
                  </p>
                  {!tabCapture.hasAudio && (
                    <p className="text-xs text-amber-300">
                      No audio track detected — make sure &ldquo;Also share tab audio&rdquo; is checked for transcription.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={tabCapture.onStop}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-amber-400 cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Stop &amp; Forge Clips
                  </button>
                  <button
                    type="button"
                    onClick={tabCapture.onCancel}
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-semibold text-zinc-100">
                    Capture any playing YouTube or browser tab
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    Open YouTube in another tab, click Start Recording, select that tab, and enable{' '}
                    <strong>Also share tab audio</strong>. 100% browser-only, no server needed.
                  </p>
                </div>
                {tabCapture?.error && <p className="text-xs text-rose-300">{tabCapture.error}</p>}
                <button
                  type="button"
                  disabled={disabled || !tabSupported || !tabCapture}
                  onClick={tabCapture?.onStart}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Radio className="h-4 w-4" />
                  {tabSupported ? 'Start Tab Recording' : 'Tab Recording Requires Desktop Chrome/Edge'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
