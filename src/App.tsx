import { useEffect, useState } from 'react';
import { Scissors, ShieldCheck } from 'lucide-react';
import { detectCapabilities } from './capabilities/detectCapabilities';
import type { DeviceCapabilities } from './capabilities/types';
import { CaptionStylePicker } from './components/CaptionStylePicker';
import { ClipGallery } from './components/ClipGallery';
import { CompatibilityPanel } from './components/CompatibilityPanel';
import { DropZone } from './components/DropZone';
import { ExportPanel } from './components/ExportPanel';
import { Footer } from './components/Footer';
import { LegalModal } from './components/LegalModal';
import { PipelineStatusBar } from './components/PipelineStatusBar';
import { PreviewPlayer } from './components/PreviewPlayer';
import { TrimHandles } from './components/TrimHandles';
import { useHookcutPipeline } from './pipeline/useHookcutPipeline';

export interface AppProps {
  initialCapabilities?: DeviceCapabilities;
}

export function App({ initialCapabilities }: AppProps) {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(
    initialCapabilities ?? null,
  );
  const [checkingCaps, setCheckingCaps] = useState<boolean>(!initialCapabilities);
  const [capsDismissed, setCapsDismissed] = useState<boolean>(false);
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms' | null>(null);

  useEffect(() => {
    if (initialCapabilities) return;
    let active = true;
    detectCapabilities()
      .then((result) => {
        if (!active) return;
        setCapabilities(result);
        setCheckingCaps(false);
      })
      .catch(() => {
        if (!active) return;
        setCheckingCaps(false);
      });
    return () => {
      active = false;
    };
  }, [initialCapabilities]);

  const {
    selectedFile,
    sourceUrl,
    youtubePreview,
    videoMetadata,
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
    language,
    setLanguage,
    tabCapture,
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
  } = useHookcutPipeline(capabilities);

  const isRunning =
    pipeline.stage === 'fetching' ||
    pipeline.stage === 'extracting' ||
    pipeline.stage === 'transcribing' ||
    pipeline.stage === 'scoring' ||
    pipeline.stage === 'reranking';

  const selectedArtifacts = selectedClip ? clipArtifacts[selectedClip.id] : undefined;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800/80 px-4 sm:px-6 py-3.5">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm">
              <Scissors className="h-4 w-4" />
            </span>
            <div>
              <span className="text-base sm:text-lg font-bold tracking-tight">Hookcut</span>
              <span className="ml-2 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                v0.1.1
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {capsDismissed && (
              <button
                type="button"
                onClick={() => setCapsDismissed(false)}
                className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Device check
              </button>
            )}
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              100% On-Device • Zero Uploads
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        {!capsDismissed && (
          <CompatibilityPanel
            capabilities={capabilities}
            loading={checkingCaps}
            onDismiss={() => setCapsDismissed(true)}
          />
        )}

        <DropZone
          selectedFile={selectedFile}
          sourceUrl={sourceUrl}
          youtubePreview={youtubePreview}
          metadata={videoMetadata}
          language={language}
          onChangeLanguage={setLanguage}
          disabled={isRunning || !capabilities?.plan.canRun}
          onSelectFile={runPipelineForFile}
          onSubmitUrl={runPipelineForUrl}
          tabCapture={{
            recording: tabCapture.recording,
            elapsedSec: tabCapture.elapsedSec,
            hasAudio: tabCapture.hasAudio,
            error: tabCapture.error,
            onStart: () => void tabCapture.start(),
            onStop: () => void tabCapture.stop(),
            onCancel: tabCapture.cancel,
          }}
        />

        <PipelineStatusBar
          state={pipeline}
          onCancel={cancelPipeline}
          onRetry={selectedFile || sourceUrl ? retryPipeline : undefined}
          onRecordTab={() => void tabCapture.start()}
        />

        {clips.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr_360px] items-start">
            <ClipGallery
              clips={clips}
              selectedClipId={selectedClipId}
              artifacts={clipArtifacts}
              onSelectClip={setSelectedClipId}
            />

            <div className="space-y-4">
              <PreviewPlayer
                file={selectedFile}
                clip={selectedClip}
                reframeKeyframes={selectedArtifacts?.reframeKeyframes}
                trackingFaces={selectedArtifacts?.trackingFaces}
                captionsEnabled={captionsEnabled}
                captionPresetId={captionPresetId}
                customKeywords={customKeywords}
              />
              {selectedClip && (
                <TrimHandles
                  clip={selectedClip}
                  maxDurationSec={videoMetadata?.durationSec ?? selectedClip.end}
                  onChangeTrim={updateClipTrim}
                />
              )}
            </div>

            {selectedClip && selectedArtifacts && (
              <div className="space-y-4">
                <CaptionStylePicker
                  enabled={captionsEnabled}
                  presetId={captionPresetId}
                  customKeywords={customKeywords}
                  onToggleEnabled={setCaptionsEnabled}
                  onSelectPreset={setCaptionPresetId}
                  onChangeKeywords={setCustomKeywords}
                />
                <ExportPanel
                  clip={selectedClip}
                  artifacts={selectedArtifacts}
                  defaultExportHeight={capabilities?.plan.exportHeight ?? 1080}
                  onExport={exportClip}
                  onCancelExport={cancelExport}
                  onCaptureThumbnail={captureThumbnail}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <Footer onOpenLegal={setLegalTab} />
      <LegalModal openTab={legalTab} onClose={() => setLegalTab(null)} onSwitchTab={setLegalTab} />
    </div>
  );
}

export default App;
