import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceCapabilities } from '../capabilities/types';
import { extractAudioFromVideo } from '../media/audioExtractClient';
import { ENERGY_BIN_SEC, type VideoMetadata } from '../media/types';
import {
  BridgeUnavailableError,
  ingestVideoFromUrl,
  type YouTubePreviewInfo,
} from '../media/urlIngest';
import { validateSelectedFile } from '../media/validateFile';
import { generateClipMetadata, type ClipMetadata } from '../metadata/generateMetadata';
import { generateClipThumbnail, type ClipThumbnail } from '../metadata/generateThumbnail';
import { trackFacesForClip } from '../reframe/faceTrackClient';
import type { ExportProgress, ExportResult, ReframeKeyframe } from '../render/types';
import { renderAndExportClip } from '../render/videoExportClient';
import { snapClipBoundaries, snapRangeToWordBoundaries } from '../scoring/boundarySnap';
import { scoreTranscriptCandidates } from '../scoring/candidates';
import { SCORING_CONFIG } from '../scoring/config';
import { rerankWithLocalLlm } from '../scoring/rerankClient';
import type { CandidateClip } from '../scoring/types';
import { transcribeAudioChunks } from '../transcribe/transcribeClient';
import type { ModelDownloadProgress, Transcript } from '../transcribe/types';

export type PipelineStage =
  | 'idle'
  | 'fetching'
  | 'extracting'
  | 'transcribing'
  | 'scoring'
  | 'reranking'
  | 'ready'
  | 'cancelled'
  | 'error';

export interface PipelineUiState {
  stage: PipelineStage;
  stageLabel: string;
  progress: number; // 0..1
  downloadProgress: ModelDownloadProgress | null;
  errorMessage: string | null;
  bridgeSetupUrl?: string | null;
}

export interface ClipArtifacts {
  reframeKeyframes?: ReframeKeyframe[];
  trackingFaces?: boolean;
  metadata: ClipMetadata;
  thumbnail?: ClipThumbnail;
  capturingThumbnail?: boolean;
  exportResult?: ExportResult;
  exportProgress?: ExportProgress | null;
  exportError?: string | null;
}

export function useHookcutPipeline(capabilities: DeviceCapabilities | null) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceBridgeUrl, setSourceBridgeUrl] = useState<string | undefined>(undefined);
  const [youtubePreview, setYoutubePreview] = useState<YouTubePreviewInfo | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [clips, setClips] = useState<CandidateClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [captionPresetId, setCaptionPresetId] = useState<string>('bold-amber');
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(true);
  const [customKeywords, setCustomKeywords] = useState<string>('');
  const [clipArtifacts, setClipArtifacts] = useState<Record<string, ClipArtifacts>>({});

  const [pipeline, setPipeline] = useState<PipelineUiState>({
    stage: 'idle',
    stageLabel: 'Ready for a local video file or YouTube link',
    progress: 0,
    downloadProgress: null,
    errorMessage: null,
    bridgeSetupUrl: null,
  });

  const pipelineAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const cancelPipeline = useCallback(() => {
    pipelineAbortRef.current?.abort();
    pipelineAbortRef.current = null;
    setPipeline((prev) => ({
      ...prev,
      stage: 'cancelled',
      stageLabel: 'Processing cancelled',
      downloadProgress: null,
      bridgeSetupUrl: null,
    }));
  }, []);

  const cancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
  }, []);

  const processValidatedFile = useCallback(
    async (file: File, abort: AbortController) => {
      if (!capabilities?.plan.canRun) return;

      try {
        setPipeline({
          stage: 'extracting',
          stageLabel: 'Extracting 16 kHz mono audio on-device…',
          progress: 0.05,
          downloadProgress: null,
          errorMessage: null,
          bridgeSetupUrl: null,
        });

        const extraction = await extractAudioFromVideo({
          file,
          signal: abort.signal,
          onMetadata: (meta) => setVideoMetadata(meta),
          onProgress: (p) => {
            setPipeline((prev) => ({
              ...prev,
              stage: 'extracting',
              stageLabel:
                p.stage === 'probing'
                  ? 'Reading video container metadata…'
                  : `Extracting audio (${Math.round(p.progress * 100)}%)…`,
              progress: p.progress * 0.25,
            }));
          },
        });

        setVideoMetadata(extraction.metadata);

        setPipeline({
          stage: 'transcribing',
          stageLabel: `Loading Whisper (${capabilities.plan.asrDevice.toUpperCase()})…`,
          progress: 0.26,
          downloadProgress: null,
          errorMessage: null,
        });

        const tx = await transcribeAudioChunks({
          fileFingerprint: extraction.metadata.fileFingerprint,
          durationSec: extraction.totalDurationSec,
          chunks: extraction.chunks,
          modelId: capabilities.plan.asrModel,
          device: capabilities.plan.asrDevice,
          signal: abort.signal,
          onProgress: (tp) => {
            setPipeline((prev) => ({
              ...prev,
              stage: 'transcribing',
              stageLabel:
                tp.phase === 'cached'
                  ? 'Loaded cached transcript from IndexedDB'
                  : tp.phase === 'loading-model'
                    ? `Downloading Whisper model (${tp.download?.progress ?? 0}%)…`
                    : `Transcribing chunk ${tp.chunkIndex}/${tp.totalChunks}…`,
              progress: 0.25 + tp.progress * 0.45,
              downloadProgress: tp.phase === 'loading-model' ? (tp.download ?? null) : null,
            }));
          },
        });

        // Release raw 16 kHz PCM buffers immediately after transcription completes
        extraction.chunks.length = 0;

        setTranscript(tx);

        setPipeline({
          stage: 'scoring',
          stageLabel: 'Scoring hooks, energy, and story arcs…',
          progress: 0.74,
          downloadProgress: null,
          errorMessage: null,
        });

        const candidates = scoreTranscriptCandidates(tx, {
          config: SCORING_CONFIG,
          energyProfile: {
            bins: extraction.energyBins,
            binSec: extraction.energyBinSec || ENERGY_BIN_SEC,
          },
        });

        setPipeline({
          stage: 'reranking',
          stageLabel: capabilities.plan.llmEnabled
            ? 'Re-ranking top candidates with local WebGPU LLM…'
            : 'Selecting top highlights (fast heuristic path)…',
          progress: 0.8,
          downloadProgress: null,
          errorMessage: null,
        });

        const reranked = await rerankWithLocalLlm(candidates, {
          llmEnabled: capabilities.plan.llmEnabled,
          modelId: capabilities.plan.llmModel,
          config: SCORING_CONFIG,
          signal: abort.signal,
          onProgress: (rp) => {
            setPipeline((prev) => ({
              ...prev,
              stage: 'reranking',
              stageLabel:
                rp.phase === 'loading-model'
                  ? `Downloading local LLM (${rp.download?.progress ?? 0}%)…`
                  : rp.phase === 'skipped'
                    ? 'Applying heuristic ranking…'
                    : `Evaluating candidate ${rp.completed}/${rp.total}…`,
              progress:
                rp.phase === 'evaluating' && rp.total > 0
                  ? 0.8 + (rp.completed / rp.total) * 0.16
                  : 0.8,
              downloadProgress: rp.phase === 'loading-model' ? (rp.download ?? null) : null,
            }));
          },
        });

        const snapped = reranked.map((clip) => snapClipBoundaries(clip, tx));
        const initialArtifacts: Record<string, ClipArtifacts> = {};
        for (const c of snapped) {
          initialArtifacts[c.id] = {
            metadata: generateClipMetadata(c),
            exportProgress: null,
            exportError: null,
          };
        }

        setClips(snapped);
        setClipArtifacts(initialArtifacts);
        setSelectedClipId(snapped[0]?.id ?? null);

        setPipeline({
          stage: 'ready',
          stageLabel:
            snapped.length > 0
              ? `Found ${snapped.length} viral-ready clip${snapped.length === 1 ? '' : 's'}`
              : 'No clips could be generated from this video.',
          progress: 1,
          downloadProgress: null,
          errorMessage: null,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setPipeline({
          stage: 'error',
          stageLabel: 'Pipeline error',
          progress: 0,
          downloadProgress: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          bridgeSetupUrl: null,
        });
      } finally {
        if (pipelineAbortRef.current === abort) {
          pipelineAbortRef.current = null;
        }
      }
    },
    [capabilities],
  );

  const runPipelineForFile = useCallback(
    async (file: File) => {
      if (!capabilities?.plan.canRun) {
        setPipeline({
          stage: 'error',
          stageLabel: 'Unsupported browser environment',
          progress: 0,
          downloadProgress: null,
          errorMessage: 'Web Workers and WebAssembly are required to process videos locally.',
          bridgeSetupUrl: null,
        });
        return;
      }

      try {
        validateSelectedFile(file);
      } catch (err) {
        setPipeline({
          stage: 'error',
          stageLabel: 'Invalid video file',
          progress: 0,
          downloadProgress: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          bridgeSetupUrl: null,
        });
        return;
      }

      pipelineAbortRef.current?.abort();
      const abort = new AbortController();
      pipelineAbortRef.current = abort;

      setSourceUrl(null);
      setSourceBridgeUrl(undefined);
      setYoutubePreview(null);
      setSelectedFile(file);
      setVideoMetadata(null);
      setTranscript(null);
      setClips([]);
      setSelectedClipId(null);
      setClipArtifacts({});

      await processValidatedFile(file, abort);
    },
    [capabilities, processValidatedFile],
  );

  const runPipelineForUrl = useCallback(
    async (rawUrl: string, bridgeUrlOverride?: string) => {
      if (!capabilities?.plan.canRun) {
        setPipeline({
          stage: 'error',
          stageLabel: 'Unsupported browser environment',
          progress: 0,
          downloadProgress: null,
          errorMessage: 'Web Workers and WebAssembly are required to process videos locally.',
          bridgeSetupUrl: null,
        });
        return;
      }

      pipelineAbortRef.current?.abort();
      const abort = new AbortController();
      pipelineAbortRef.current = abort;

      setSourceUrl(rawUrl);
      setSourceBridgeUrl(bridgeUrlOverride);
      setYoutubePreview(null);
      setSelectedFile(null);
      setVideoMetadata(null);
      setTranscript(null);
      setClips([]);
      setSelectedClipId(null);
      setClipArtifacts({});

      try {
        setPipeline({
          stage: 'fetching',
          stageLabel: 'Fetching video metadata and stream…',
          progress: 0.03,
          downloadProgress: null,
          errorMessage: null,
          bridgeSetupUrl: null,
        });

        const { file } = await ingestVideoFromUrl({
          rawUrl,
          bridgeUrl: bridgeUrlOverride,
          signal: abort.signal,
          onPreview: (preview) => setYoutubePreview(preview),
          onProgress: (prog) => {
            const pct = prog.totalBytes > 0 ? Math.round(prog.progress * 100) : null;
            const mb = (prog.loadedBytes / (1024 * 1024)).toFixed(1);
            setPipeline((prev) => ({
              ...prev,
              stage: 'fetching',
              stageLabel:
                pct !== null
                  ? `Downloading video into browser (${pct}% • ${mb} MB)…`
                  : `Downloading video into browser (${mb} MB)…`,
              progress: prog.totalBytes > 0 ? 0.03 + prog.progress * 0.12 : 0.06,
            }));
          },
        });

        if (abort.signal.aborted) return;
        setSelectedFile(file);
        await processValidatedFile(file, abort);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setPipeline({
          stage: 'error',
          stageLabel:
            err instanceof BridgeUnavailableError ? 'YouTube bridge needed' : 'URL fetch failed',
          progress: 0,
          downloadProgress: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          bridgeSetupUrl: err instanceof BridgeUnavailableError ? err.bridgeUrl : null,
        });
        if (pipelineAbortRef.current === abort) {
          pipelineAbortRef.current = null;
        }
      }
    },
    [capabilities, processValidatedFile],
  );

  const retryPipeline = useCallback(() => {
    if (sourceUrl) {
      void runPipelineForUrl(sourceUrl, sourceBridgeUrl);
    } else if (selectedFile) {
      void runPipelineForFile(selectedFile);
    }
  }, [runPipelineForFile, runPipelineForUrl, selectedFile, sourceBridgeUrl, sourceUrl]);

  // Lazily run 4 fps face tracking when a clip is selected for preview/export
  const ensureFaceTrackingForClip = useCallback(
    async (clip: CandidateClip): Promise<ReframeKeyframe[]> => {
      if (!selectedFile) {
        return [{ timeSec: clip.start, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }];
      }

      const existing = clipArtifacts[clip.id]?.reframeKeyframes;
      if (existing && existing.length > 0) {
        return existing;
      }

      setClipArtifacts((prev) => ({
        ...prev,
        [clip.id]: {
          ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
          trackingFaces: true,
        },
      }));

      try {
        const result = await trackFacesForClip({
          file: selectedFile,
          startSec: clip.start,
          endSec: clip.end,
          sampleFps: 4,
        });
        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            reframeKeyframes: result.keyframes,
            trackingFaces: false,
          },
        }));
        return result.keyframes;
      } catch {
        const fallback: ReframeKeyframe[] = [
          { timeSec: clip.start, centerX: 0.5, centerY: 0.5, mode: 'face-follow' },
        ];
        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            reframeKeyframes: fallback,
            trackingFaces: false,
          },
        }));
        return fallback;
      }
    },
    [clipArtifacts, selectedFile],
  );

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  useEffect(() => {
    if (selectedClip && selectedFile && !clipArtifacts[selectedClip.id]?.reframeKeyframes && !clipArtifacts[selectedClip.id]?.trackingFaces) {
      void ensureFaceTrackingForClip(selectedClip);
    }
  }, [selectedClip, selectedFile, clipArtifacts, ensureFaceTrackingForClip]);

  const updateClipTrim = useCallback(
    (clipId: string, rawStart: number, rawEnd: number) => {
      if (!transcript) return;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          const snapped = snapRangeToWordBoundaries(
            rawStart,
            rawEnd,
            transcript.words,
            transcript.durationSec,
          );
          const updated: CandidateClip = {
            ...c,
            start: snapped.start,
            end: snapped.end,
            duration: Math.round((snapped.end - snapped.start) * 100) / 100,
            words: snapped.words,
            text: snapped.words.map((w) => w.text).join(' ') || c.text,
          };
          setClipArtifacts((art) => ({
            ...art,
            [clipId]: {
              ...(art[clipId] ?? { metadata: generateClipMetadata(updated) }),
              metadata: generateClipMetadata(updated),
              reframeKeyframes: undefined,
              exportResult: undefined,
            },
          }));
          return updated;
        }),
      );
    },
    [transcript],
  );

  const exportClip = useCallback(
    async (clip: CandidateClip, resolution: '720p' | '1080p') => {
      if (!selectedFile || !capabilities) return;
      exportAbortRef.current?.abort();
      const abort = new AbortController();
      exportAbortRef.current = abort;

      const keyframes = await ensureFaceTrackingForClip(clip);
      const emphasisKeywords = customKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      setClipArtifacts((prev) => ({
        ...prev,
        [clip.id]: {
          ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
          exportProgress: { phase: 'preparing', progress: 0, engine: capabilities.plan.videoEngine },
          exportError: null,
        },
      }));

      try {
        const result = await renderAndExportClip({
          request: {
            file: selectedFile,
            startSec: clip.start,
            endSec: clip.end,
            resolution,
            videoEngine: capabilities.plan.videoEngine,
            reframeKeyframes: keyframes,
            captions: {
              enabled: captionsEnabled,
              presetId: captionPresetId,
              words: clip.words,
              emphasisKeywords,
            },
          },
          signal: abort.signal,
          onProgress: (prog) => {
            setClipArtifacts((prev) => ({
              ...prev,
              [clip.id]: {
                ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
                exportProgress: prog,
              },
            }));
          },
        });

        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            exportResult: result,
            exportProgress: null,
            exportError: null,
          },
        }));
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            exportProgress: null,
            exportError: isAbort ? null : err instanceof Error ? err.message : String(err),
          },
        }));
      } finally {
        if (exportAbortRef.current === abort) {
          exportAbortRef.current = null;
        }
      }
    },
    [
      capabilities,
      captionPresetId,
      captionsEnabled,
      customKeywords,
      ensureFaceTrackingForClip,
      selectedFile,
    ],
  );

  const captureThumbnail = useCallback(
    async (clip: CandidateClip) => {
      if (!selectedFile) return;
      const keyframes = await ensureFaceTrackingForClip(clip);
      const emphasisKeywords = customKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      setClipArtifacts((prev) => ({
        ...prev,
        [clip.id]: {
          ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
          capturingThumbnail: true,
        },
      }));

      try {
        const thumb = await generateClipThumbnail({
          file: selectedFile,
          startSec: clip.start,
          endSec: clip.end,
          reframeKeyframes: keyframes,
          captions: {
            enabled: captionsEnabled,
            presetId: captionPresetId,
            words: clip.words,
            emphasisKeywords,
          },
        });

        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            thumbnail: thumb,
            capturingThumbnail: false,
          },
        }));
      } catch {
        setClipArtifacts((prev) => ({
          ...prev,
          [clip.id]: {
            ...(prev[clip.id] ?? { metadata: generateClipMetadata(clip) }),
            capturingThumbnail: false,
          },
        }));
      }
    },
    [captionPresetId, captionsEnabled, customKeywords, ensureFaceTrackingForClip, selectedFile],
  );

  return {
    selectedFile,
    sourceUrl,
    youtubePreview,
    videoMetadata,
    transcript,
    clips,
    selectedClip,
    selectedClipId,
    setSelectedClipId,
    captionPresetId,
    setCaptionPresetId,
    captionsEnabled,
    setCaptionsEnabled,
    customKeywords,
    setCustomKeywords,
    clipArtifacts,
    pipeline,
    runPipelineForFile,
    runPipelineForUrl,
    retryPipeline,
    cancelPipeline,
    cancelExport,
    updateClipTrim,
    exportClip,
    captureThumbnail,
  };
}
