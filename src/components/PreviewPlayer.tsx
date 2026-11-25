import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { buildCaptionCues } from '../captions/captionTiming';
import { getCaptionPreset } from '../captions/presets';
import { drawCaptionOverlay } from '../captions/renderCaptions';
import { composePortraitFrame, sampleReframeAtTime } from '../render/frameComposer';
import { RESOLUTION_MAP, type ReframeKeyframe } from '../render/types';
import type { CandidateClip } from '../scoring/types';

interface PreviewPlayerProps {
  file: File | null;
  clip: CandidateClip | null;
  reframeKeyframes?: ReframeKeyframe[];
  trackingFaces?: boolean;
  captionsEnabled: boolean;
  captionPresetId: string;
  customKeywords: string;
}

export function PreviewPlayer({
  file,
  clip,
  reframeKeyframes,
  trackingFaces = false,
  captionsEnabled,
  captionPresetId,
  customKeywords,
}: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const emphasisKeywords = useMemo(
    () =>
      customKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    [customKeywords],
  );

  const captionCues = useMemo(() => {
    if (!clip || !captionsEnabled) return [];
    const preset = getCaptionPreset(captionPresetId);
    return buildCaptionCues(clip.words, preset, emphasisKeywords);
  }, [clip, captionsEnabled, captionPresetId, emphasisKeywords]);

  // Reset playback head when clip boundaries change
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    setPlaying(false);
    video.pause();
    video.currentTime = clip.start;
    setCurrentTime(clip.start);
  }, [clip]);

  // Draw live 720p 9:16 reframed + captioned frame onto preview canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !clip) return;

    const { width, height } = RESOLUTION_MAP['720p'];
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;

    const renderFrame = () => {
      const t = video.currentTime || clip.start;
      setCurrentTime(t);

      if (t >= clip.end && !video.paused) {
        video.pause();
        video.currentTime = clip.start;
        setPlaying(false);
      }

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const reframe = sampleReframeAtTime(reframeKeyframes, t);
        composePortraitFrame(
          ctx,
          video,
          video.videoWidth,
          video.videoHeight,
          width,
          height,
          reframe,
        );
      } else {
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);
      }

      if (captionsEnabled) {
        drawCaptionOverlay(
          ctx,
          width,
          height,
          t,
          {
            enabled: true,
            presetId: captionPresetId,
            words: clip.words,
            emphasisKeywords,
          },
          captionCues,
        );
      }

      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();
    const onSeeked = () => renderFrame();
    const onLoadedData = () => renderFrame();
    const onLoadedMetadata = () => {
      if (video.paused && Math.abs(video.currentTime - clip.start) > 0.05) {
        video.currentTime = clip.start;
      }
      renderFrame();
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      cancelAnimationFrame(rafId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [
    clip,
    reframeKeyframes,
    captionsEnabled,
    captionPresetId,
    emphasisKeywords,
    captionCues,
    playing,
  ]);

  if (!clip || !objectUrl) return null;

  const relCurrent = Math.max(0, Math.min(clip.duration, currentTime - clip.start));
  const activeReframe = sampleReframeAtTime(reframeKeyframes, currentTime);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < clip.start || video.currentTime >= clip.end) {
        video.currentTime = clip.start;
      }
      await video.play().catch(() => undefined);
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  return (
    <section
      aria-label="9:16 portrait preview player"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 flex flex-col items-center gap-3"
    >
      <div className="w-full flex items-center justify-between text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-200">
          <Eye className="h-3.5 w-3.5 text-amber-400" />
          720p Live 9:16 Preview
        </span>
        <span className="rounded-full border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 text-[11px]">
          {trackingFaces
            ? 'Tracking faces…'
            : activeReframe.mode === 'blurred-background'
              ? 'Wide / Blurred BG'
              : 'Face Follow'}
        </span>
      </div>

      {/* Hidden streaming source video */}
      <video
        ref={videoRef}
        src={objectUrl}
        playsInline
        preload="auto"
        className="hidden"
      />

      <div className="relative w-full max-w-[290px] aspect-[9/16] overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-950 shadow-xl">
        <canvas
          ref={canvasRef}
          onClick={togglePlay}
          className="h-full w-full object-contain cursor-pointer"
        />
      </div>

      <div className="w-full max-w-[340px] space-y-2">
        <input
          type="range"
          min={clip.start}
          max={clip.end}
          step={0.05}
          value={Math.max(clip.start, Math.min(clip.end, currentTime))}
          aria-label="Preview playback position"
          onChange={(e) => {
            const val = Number(e.target.value);
            setCurrentTime(val);
            if (videoRef.current) {
              videoRef.current.currentTime = val;
            }
          }}
          className="w-full accent-amber-500 cursor-pointer"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause preview' : 'Play preview'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>
          <span className="font-mono text-xs text-zinc-400">
            {relCurrent.toFixed(1)}s / {clip.duration.toFixed(1)}s
          </span>
        </div>
      </div>
    </section>
  );
}
