import { describe, expect, it, vi } from 'vitest';
import {
  buildCaptionCues,
  extractEmphasisKeywords,
  getActiveCaptionCue,
} from '../../src/captions/captionTiming';
import { CAPTION_PRESETS, getCaptionPreset } from '../../src/captions/presets';
import { drawCaptionOverlay } from '../../src/captions/renderCaptions';
import type { WordTimestamp } from '../../src/transcribe/types';

const SAMPLE_WORDS: WordTimestamp[] = [
  { text: 'Why', start: 0.2, end: 0.45 },
  { text: 'do', start: 0.45, end: 0.65 },
  { text: '90%', start: 0.65, end: 1.05 },
  { text: 'of', start: 1.05, end: 1.2 },
  { text: 'creators', start: 1.2, end: 1.75 },
  { text: 'quit?', start: 1.75, end: 2.2 },
  { text: 'Never', start: 2.8, end: 3.2 }, // 0.6s pause forces new cue
  { text: 'skip', start: 3.2, end: 3.55 },
  { text: 'hooks.', start: 3.55, end: 4.0 },
];

describe('CAPTION_PRESETS', () => {
  it('provides at least 5 unique presets with safe margins', () => {
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(CAPTION_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(CAPTION_PRESETS.length);
    for (const preset of CAPTION_PRESETS) {
      expect(preset.bottomMarginPct).toBeGreaterThanOrEqual(0.16);
      expect(preset.bottomMarginPct).toBeLessThanOrEqual(0.35);
    }
  });
});

describe('caption timing and emphasis', () => {
  it('emphasizes numbers, power words, and custom keywords', () => {
    const kw = extractEmphasisKeywords(SAMPLE_WORDS, ['creators']);
    expect(kw.has('90%')).toBe(true);
    expect(kw.has('why')).toBe(true);
    expect(kw.has('never')).toBe(true);
    expect(kw.has('creators')).toBe(true);
  });

  it('builds line-wrapped cues and tracks exact active word at timeSec', () => {
    const preset = getCaptionPreset('bold-amber');
    const cues = buildCaptionCues(SAMPLE_WORDS, preset);

    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0]!.words.map((w) => w.text)).toEqual([
      'WHY',
      'DO',
      '90%',
      'OF',
      'CREATORS',
      'QUIT?',
    ]);

    const atStart = getActiveCaptionCue(cues, 0.3);
    expect(atStart?.activeWordIndex).toBe(0);

    const atKeyword = getActiveCaptionCue(cues, 0.8);
    expect(atKeyword?.activeWordIndex).toBe(2);
    expect(atKeyword?.cue.words[2]!.isEmphasized).toBe(true);

    const atSecondCue = getActiveCaptionCue(cues, 3.3);
    expect(atSecondCue?.cue.words[atSecondCue.activeWordIndex]?.text).toBe('SKIP');
  });
});

describe('drawCaptionOverlay', () => {
  it('draws active caption cue onto a 2D canvas context within safe margins', () => {
    const fillText = vi.fn();
    const strokeText = vi.fn();
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn((t: string) => ({ width: t.length * 24 })),
      fillText,
      strokeText,
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'round',
      miterLimit: 2,
      textAlign: 'left',
      textBaseline: 'middle',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetY: 0,
    } as unknown as CanvasRenderingContext2D;

    drawCaptionOverlay(mockCtx, 1080, 1920, 0.8, {
      enabled: true,
      presetId: 'neon-pill',
      words: SAMPLE_WORDS,
    });

    expect(fillText).toHaveBeenCalled();
    expect(strokeText).toHaveBeenCalled();
    const firstCallY = fillText.mock.calls[0]?.[2] as number;
    expect(firstCallY).toBeLessThan(1920 * 0.85);
  });
});
