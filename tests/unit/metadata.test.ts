import { describe, expect, it } from 'vitest';
import { extractHashtags, generateClipMetadata } from '../../src/metadata/generateMetadata';
import { selectThumbnailTimestamp } from '../../src/metadata/generateThumbnail';
import type { CandidateClip } from '../../src/scoring/types';

function makeClip(overrides: Partial<CandidateClip> = {}): CandidateClip {
  return {
    id: 'c1',
    start: 10,
    end: 40,
    duration: 30,
    text: 'Why do 90% of browser apps freeze? Because heavy inference runs on the main thread instead of Web Workers.',
    firstLine: 'Why do 90% of browser apps freeze?',
    words: [],
    segments: [
      { id: 0, start: 10, end: 15, text: 'Why do 90% of browser apps freeze?', words: [] },
      {
        id: 1,
        start: 15,
        end: 40,
        text: 'Because heavy inference runs on the main thread instead of Web Workers.',
        words: [],
      },
    ],
    features: {
      hook: 0.8,
      completeness: 0.9,
      emotion: 0.4,
      curiosity: 0.7,
      ending: 0.7,
      audioEnergy: 0.5,
      speechRateChange: 0.4,
      laughter: 0,
      topicCoherence: 0.6,
    },
    penalties: { silenceRatio: 0.1, silencePenalty: 0, durationPenalty: 0, totalPenalty: 0 },
    rawWeightedScore: 0.65,
    heuristicScore: 65,
    finalScore: 65,
    ...overrides,
  };
}

describe('generateClipMetadata', () => {
  it('generates <= 60 char title, concise description, and unique hashtags locally', () => {
    const meta = generateClipMetadata(makeClip());
    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.title).toContain('90% of browser apps freeze');
    expect(meta.hashtags.length).toBeGreaterThanOrEqual(3);
    expect(new Set(meta.hashtags).size).toBe(meta.hashtags.length);
    expect(meta.description).toContain('#shorts');
  });

  it('prefers validated llmTitle when present and strips filler from fallback titles', () => {
    const withLlm = generateClipMetadata(
      makeClip({ llmTitle: 'Stop Freezing Browser Tabs', llmReason: 'Clear hook and payoff.' }),
    );
    expect(withLlm.title).toBe('Stop Freezing Browser Tabs');
    expect(withLlm.description).toContain('Clear hook and payoff.');

    const fillerClip = generateClipMetadata(
      makeClip({
        firstLine: 'Uh, so this is a super long sentence that keeps going well past sixty characters without stopping anywhere.',
      }),
    );
    expect(fillerClip.title.startsWith('Uh')).toBe(false);
    expect(fillerClip.title.length).toBeLessThanOrEqual(60);
  });
});

describe('extractHashtags', () => {
  it('ignores stopwords and includes relevant keywords', () => {
    const tags = extractHashtags('WebGPU inference runs locally inside browsers with Whisper.');
    expect(tags.some((t) => t === '#webgpu' || t === '#inference' || t === '#whisper')).toBe(true);
    expect(tags.includes('#with')).toBe(false);
  });
});

describe('selectThumbnailTimestamp', () => {
  it('picks a hook frame shortly after clip start', () => {
    expect(selectThumbnailTimestamp(10, 40)).toBe(11.5);
    expect(selectThumbnailTimestamp(0, 5)).toBe(1.1);
  });
});
