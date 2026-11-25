import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeWeightedFeatureScore,
  dedupeOverlappingCandidates,
  generateSlidingWindows,
  scoreTranscriptCandidates,
} from '../../src/scoring/candidates';
import {
  SCORING_CONFIG,
  sumScoringWeights,
  validateScoringConfig,
} from '../../src/scoring/config';
import {
  scoreCompleteness,
  scoreCuriosity,
  scoreEmotion,
  scoreEnding,
  scoreHook,
  scoreLaughter,
  scoreSpeechRateChange,
  scoreTopicCoherence,
} from '../../src/scoring/features';
import {
  computeDurationPenalty,
  computeSilencePenalty,
  computeSilenceRatio,
} from '../../src/scoring/penalties';
import type { Transcript, TranscriptSegment, WordTimestamp } from '../../src/transcribe/types';

function makeTranscriptFromSentences(
  entries: Array<{ start: number; end: number; text: string }>,
  totalDurationSec = 120,
): Transcript {
  const segments: TranscriptSegment[] = entries.map((entry, id) => {
    const tokens = entry.text.trim().split(/\s+/);
    const step = (entry.end - entry.start) / Math.max(1, tokens.length);
    const words: WordTimestamp[] = tokens.map((tok, i) => ({
      text: tok,
      start: Math.round((entry.start + i * step) * 100) / 100,
      end: Math.round((entry.start + (i + 0.85) * step) * 100) / 100,
    }));
    return {
      id,
      start: entry.start,
      end: entry.end,
      text: entry.text,
      words,
    };
  });

  return {
    fileFingerprint: 'test:1:1:hash',
    modelId: 'test',
    language: 'en',
    durationSec: totalDurationSec,
    text: segments.map((s) => s.text).join(' '),
    words: segments.flatMap((s) => s.words),
    segments,
    createdAt: 0,
  };
}

describe('config/scoring.json', () => {
  it('weights sum strictly to 1.0 and config passes validation', () => {
    expect(sumScoringWeights(SCORING_CONFIG)).toBeCloseTo(1.0, 6);
    expect(() => validateScoringConfig(SCORING_CONFIG)).not.toThrow();
  });
});

describe('heuristic features', () => {
  it('scores strong hooks (question, numbers, contrast, bold claim) much higher than weak openers', () => {
    const strong = scoreHook(
      'Why do 90% of startups fail, but never admit the real truth?',
      'Why do 90% of startups fail, but never admit the real truth?',
    );
    const weak = scoreHook(
      'And so yeah anyway we were talking about it',
      'And so yeah anyway we were talking about it',
    );
    expect(strong).toBeGreaterThan(0.7);
    expect(weak).toBeLessThan(0.2);
  });

  it('scores completeness, emotion, curiosity, ending, laughter, rate change, and topic coherence in [0, 1]', () => {
    const t = makeTranscriptFromSentences([
      { start: 0, end: 8, text: 'Why did this secret change everything? Honestly it was insane!' },
      { start: 8.2, end: 16, text: 'Haha wait until you see why this secret worked so well!' },
      { start: 16.2, end: 25, text: 'That is why fixing this one secret changed everything forever.' },
    ]);

    const allWords = t.words;
    expect(scoreCompleteness(t.segments, allWords)).toBeGreaterThan(0.6);
    expect(scoreEmotion(t.text)).toBeGreaterThan(0.3);
    expect(scoreCuriosity(t.text)).toBeGreaterThan(0.4);
    expect(scoreEnding(t.segments[2]!.text)).toBeGreaterThan(0.7);
    expect(scoreLaughter(t.text, 0, 25)).toBeGreaterThan(0.4);
    expect(scoreTopicCoherence(t.segments)).toBeGreaterThan(0.3);
    expect(scoreSpeechRateChange(allWords)).toBeGreaterThanOrEqual(0);
  });
});

describe('penalties and blending', () => {
  it('penalizes excess silence above silenceRatioOver and durations outside ideal range', () => {
    const { penalties } = SCORING_CONFIG;
    expect(computeSilencePenalty(0.15, penalties)).toBe(0);
    expect(computeSilencePenalty(0.55, penalties)).toBeGreaterThan(0.1);
    expect(computeSilencePenalty(1.0, penalties)).toBeCloseTo(penalties.silenceMaxPenalty, 6);

    expect(computeDurationPenalty(35, penalties)).toBe(0);
    expect(computeDurationPenalty(20, penalties)).toBeCloseTo(penalties.durationMaxPenalty, 6);
    expect(computeDurationPenalty(60, penalties)).toBeCloseTo(penalties.durationMaxPenalty, 6);
  });

  it('computes silence ratio from gaps when no audio energy bins exist', () => {
    const sparseWords: WordTimestamp[] = [
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'world.', start: 8.5, end: 9.0 },
    ];
    const ratio = computeSilenceRatio(0, 10, sparseWords);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('blends features strictly according to weights', () => {
    const allOnes = {
      hook: 1,
      completeness: 1,
      emotion: 1,
      curiosity: 1,
      ending: 1,
      audioEnergy: 1,
      speechRateChange: 1,
      laughter: 1,
      topicCoherence: 1,
    };
    expect(computeWeightedFeatureScore(allOnes, SCORING_CONFIG.weights)).toBeCloseTo(1.0, 6);
  });
});

describe('candidate generation and overlap deduplication', () => {
  it('generates 20-60s windows snapped to sentence boundaries and dedupes overlaps > 0.3', () => {
    const transcript = makeTranscriptFromSentences([
      { start: 0, end: 11, text: 'Uh anyway welcome back to the stream today everyone.' },
      { start: 12, end: 22, text: 'Why do 95% of developers ignore browser performance until launch?' },
      { start: 22.5, end: 32, text: 'Most people think servers are required, but WebGPU changed everything!' },
      { start: 32.5, end: 42, text: 'Wait until you hear the secret: zero backend cost, haha!' },
      { start: 42.5, end: 52, text: 'That is why building locally in the browser wins every time.' },
      { start: 58, end: 69, text: 'Now let us switch topics completely to mechanical keyboards.' },
      { start: 70, end: 81, text: 'Three mistakes ruined my favorite keyboard switches last winter.' },
      { start: 81.5, end: 92, text: 'Instead of lubing lightly, I flooded every single stabilizer!' },
      { start: 92.5, end: 103, text: 'Remember this rule: less lube always beats fixing sticky keys.' },
    ], 110);

    const windows = generateSlidingWindows(transcript, SCORING_CONFIG);
    expect(windows.length).toBeGreaterThan(3);
    for (const w of windows) {
      expect(w.end - w.start).toBeGreaterThanOrEqual(SCORING_CONFIG.penalties.durationHardMin);
      expect(w.end - w.start).toBeLessThanOrEqual(SCORING_CONFIG.penalties.durationHardMax);
    }

    const ranked = scoreTranscriptCandidates(transcript);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked.length).toBeLessThanOrEqual(SCORING_CONFIG.rerank.candidatesToRerank);
    // Strong hook segment at 12s should beat the "Uh anyway..." opener at 0s
    expect(ranked[0]!.firstLine).toMatch(/Why do 95%|Three mistakes/);

    const deduped = dedupeOverlappingCandidates(
      [
        { start: 10, end: 40, heuristicScore: 90 },
        { start: 12, end: 42, heuristicScore: 85 }, // > 0.3 overlap with [10, 40]
        { start: 45, end: 75, heuristicScore: 70 }, // 0 overlap
      ],
      0.3,
    );
    expect(deduped).toHaveLength(2);
    expect(deduped.map((c) => c.heuristicScore)).toEqual([90, 70]);
  });

  it('scores the sample-transcript.json fixture via short-clip fallback', () => {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), 'fixtures/sample-transcript.json'), 'utf8'),
    ) as Transcript;
    const ranked = scoreTranscriptCandidates(raw);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.features.hook).toBeGreaterThan(0.6);
  });
});
