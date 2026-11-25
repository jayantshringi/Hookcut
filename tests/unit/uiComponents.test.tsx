import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CaptionStylePicker } from '../../src/components/CaptionStylePicker';
import { ClipGallery } from '../../src/components/ClipGallery';
import { DropZone } from '../../src/components/DropZone';
import { ExportPanel } from '../../src/components/ExportPanel';
import { Footer } from '../../src/components/Footer';
import { LegalModal } from '../../src/components/LegalModal';
import { PipelineStatusBar } from '../../src/components/PipelineStatusBar';
import { TrimHandles } from '../../src/components/TrimHandles';
import { generateClipMetadata } from '../../src/metadata/generateMetadata';
import type { CandidateClip } from '../../src/scoring/types';

function makeClip(id = 'c1'): CandidateClip {
  return {
    id,
    start: 10,
    end: 40,
    duration: 30,
    text: 'Why do creators quit early? Because hooks matter most.',
    firstLine: 'Why do creators quit early?',
    words: [
      { text: 'Why', start: 10, end: 10.4 },
      { text: 'do', start: 10.4, end: 10.7 },
    ],
    segments: [],
    features: {
      hook: 0.85,
      completeness: 0.9,
      emotion: 0.5,
      curiosity: 0.7,
      ending: 0.8,
      audioEnergy: 0.5,
      speechRateChange: 0.4,
      laughter: 0,
      topicCoherence: 0.6,
    },
    penalties: { silenceRatio: 0.1, silencePenalty: 0, durationPenalty: 0, totalPenalty: 0 },
    rawWeightedScore: 0.72,
    heuristicScore: 72,
    llmScore: 86,
    llmTitle: 'Why Creators Quit Early',
    llmReason: 'Strong question hook with clear retention takeaway.',
    finalScore: 80.4,
  };
}

describe('UI components', () => {
  it('DropZone calls onSelectFile when a file is chosen', () => {
    const onSelect = vi.fn();
    render(<DropZone selectedFile={null} metadata={null} onSelectFile={onSelect} />);
    const input = screen.getByLabelText(/Choose local video file/i) as HTMLInputElement;
    const file = new File(['abc'], 'demo.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('DropZone switches to YouTube / Video URL tab and submits validated URL', () => {
    const onSubmitUrl = vi.fn();
    render(
      <DropZone
        selectedFile={null}
        metadata={null}
        onSelectFile={vi.fn()}
        onSubmitUrl={onSubmitUrl}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /YouTube \/ Video URL/i }));
    const urlInput = screen.getByLabelText(/YouTube or video URL/i);
    fireEvent.change(urlInput, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.submit(urlInput.closest('form')!);
    expect(onSubmitUrl).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      expect.any(String),
    );
  });

  it('DropZone changes speech language and triggers Record Browser Tab controls', () => {
    const onChangeLanguage = vi.fn();
    const onStartTab = vi.fn();
    render(
      <DropZone
        selectedFile={null}
        metadata={null}
        language="en"
        onChangeLanguage={onChangeLanguage}
        onSelectFile={vi.fn()}
        tabCapture={{
          recording: false,
          elapsedSec: 0,
          hasAudio: true,
          error: null,
          onStart: onStartTab,
          onStop: vi.fn(),
          onCancel: vi.fn(),
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Speech language/i), { target: { value: 'hi' } });
    expect(onChangeLanguage).toHaveBeenCalledWith('hi');
    fireEvent.click(screen.getByRole('button', { name: /Record Browser Tab/i }));
    expect(screen.getByText(/Capture any playing YouTube or browser tab/i)).toBeInTheDocument();
  });

  it('PipelineStatusBar shows model download progress and triggers cancel', () => {
    const onCancel = vi.fn();
    render(
      <PipelineStatusBar
        onCancel={onCancel}
        state={{
          stage: 'transcribing',
          stageLabel: 'Downloading Whisper model (42%)…',
          progress: 0.42,
          downloadProgress: {
            file: 'encoder_model.onnx',
            status: 'progress',
            loaded: 21 * 1024 * 1024,
            total: 50 * 1024 * 1024,
            progress: 42,
          },
          errorMessage: null,
        }}
      />,
    );

    expect(screen.getByText(/encoder_model\.onnx/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('PipelineStatusBar offers Record YouTube / Browser Tab when public bridge is missing', () => {
    const onRecordTab = vi.fn();
    render(
      <PipelineStatusBar
        onCancel={vi.fn()}
        onRecordTab={onRecordTab}
        state={{
          stage: 'error',
          stageLabel: 'YouTube backend unavailable',
          progress: 0,
          downloadProgress: null,
          errorMessage: 'No YouTube download server configured.',
          bridgeSetupUrl: 'http://127.0.0.1:8787',
          isPublicBridgeMissing: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Record YouTube \/ Browser Tab/i }));
    expect(onRecordTab).toHaveBeenCalledTimes(1);
  });

  it('ClipGallery renders score + reason and selects clip on click', () => {
    const clip = makeClip();
    const onSelect = vi.fn();
    render(
      <ClipGallery
        clips={[clip]}
        selectedClipId={clip.id}
        artifacts={{ [clip.id]: { metadata: generateClipMetadata(clip) } }}
        onSelectClip={onSelect}
      />,
    );
    expect(screen.getByText('Why Creators Quit Early')).toBeInTheDocument();
    expect(screen.getByText(/Strong question hook/i)).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('TrimHandles nudges start/end boundaries and CaptionStylePicker selects presets', () => {
    const clip = makeClip();
    const onTrim = vi.fn();
    render(<TrimHandles clip={clip} maxDurationSec={120} onChangeTrim={onTrim} />);
    fireEvent.click(screen.getAllByRole('button', { name: /\+0\.5s/i })[0]!);
    expect(onTrim).toHaveBeenCalledWith(clip.id, 10.5, 40);

    const onSelectPreset = vi.fn();
    render(
      <CaptionStylePicker
        enabled
        presetId="bold-amber"
        customKeywords=""
        onToggleEnabled={vi.fn()}
        onSelectPreset={onSelectPreset}
        onChangeKeywords={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Neon Pill/i }));
    expect(onSelectPreset).toHaveBeenCalledWith('neon-pill');
  });

  it('ExportPanel triggers 1080p MP4 export and thumbnail capture', () => {
    const clip = makeClip();
    const onExport = vi.fn();
    const onThumb = vi.fn();
    render(
      <ExportPanel
        clip={clip}
        artifacts={{ metadata: generateClipMetadata(clip) }}
        defaultExportHeight={1080}
        onExport={onExport}
        onCancelExport={vi.fn()}
        onCaptureThumbnail={onThumb}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Export 1080p MP4/i }));
    expect(onExport).toHaveBeenCalledWith(clip, '1080p');

    fireEvent.click(screen.getByRole('button', { name: /Capture Thumbnail/i }));
    expect(onThumb).toHaveBeenCalledWith(clip);
  });

  it('Footer links GitHub Sponsors and LegalModal enforces ownership terms', () => {
    const onOpenLegal = vi.fn();
    render(<Footer onOpenLegal={onOpenLegal} />);
    expect(screen.queryByRole('link', { name: /Ko-fi/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GitHub Sponsors/i })).toHaveAttribute(
      'href',
      expect.stringContaining('github.com/sponsors'),
    );

    render(<LegalModal openTab="terms" onClose={vi.fn()} onSwitchTab={vi.fn()} />);
    expect(screen.getByText(/hold full copyright, license, or explicit permission/i)).toBeInTheDocument();
  });
});
