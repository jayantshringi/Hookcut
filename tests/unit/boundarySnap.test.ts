import { describe, expect, it } from 'vitest';
import {
  snapClipBoundaries,
  snapRangeToWordBoundaries,
} from '../../src/scoring/boundarySnap';
import type { CandidateClip } from '../../src/scoring/types';
import type { Transcript, TranscriptSegment, WordTimestamp } from '../../src/transcribe/types';

function makeWord(text: string, start: number, end: number): WordTimestamp {
  return { text, start, end };
}

describe('snapRangeToWordBoundaries', () => {
  const words: WordTimestamp[] = [
    makeWord('Before', 1.0, 1.8),
    makeWord('Why', 2.0, 2.6),
    makeWord('do', 2.65, 3.0),
    makeWord('most', 3.05, 3.5),
    makeWord('apps', 3.55, 4.1),
    makeWord('fail?', 4.15, 4.8),
    makeWord('After', 5.5, 6.2),
  ];

  it('never cuts mid-word when start or end lands inside a word', () => {
    // 2.45 is past midpoint of "Why" (2.3), so start snaps forward to "do" (2.65 - pad)
    // 3.70 is before midpoint of "apps" (3.825), so end snaps backward to "most" (3.5 + pad)
    const snapped = snapRangeToWordBoundaries(2.45, 3.7, words, 10, 0.05, 0.05);
    expect(snapped.words.map((w) => w.text)).toEqual(['do', 'most']);
    expect(snapped.start).toBeLessThanOrEqual(snapped.words[0]!.start);
    expect(snapped.end).toBeGreaterThanOrEqual(snapped.words[snapped.words.length - 1]!.end);
    // Must not overlap neighboring words
    expect(snapped.start).toBeGreaterThan(words[1]!.end);
    expect(snapped.end).toBeLessThan(words[4]!.start);
  });

  it('includes word when cut lands in first half of start word and second half of end word', () => {
    const snapped = snapRangeToWordBoundaries(2.1, 4.7, words, 10, 0.08, 0.12);
    expect(snapped.words[0]!.text).toBe('Why');
    expect(snapped.words[snapped.words.length - 1]!.text).toBe('fail?');
    expect(snapped.start).toBeCloseTo(1.92, 2);
    expect(snapped.end).toBeCloseTo(4.92, 2);
  });
});

describe('snapClipBoundaries', () => {
  it('trims leading silence and drops weak filler opener in favor of hook sentence', () => {
    const seg0: TranscriptSegment = {
      id: 0,
      start: 2.0, // 2s leading silence in raw clip [0, 32]
      end: 6.0,
      text: 'Uh welcome back guys.',
      words: [
        makeWord('Uh', 2.0, 2.3),
        makeWord('welcome', 2.4, 3.2),
        makeWord('back', 3.3, 4.0),
        makeWord('guys.', 4.1, 6.0),
      ],
    };
    const seg1: TranscriptSegment = {
      id: 1,
      start: 6.5,
      end: 18.0,
      text: 'Why did 95% of teams waste two years building backends?',
      words: [
        makeWord('Why', 6.5, 6.9),
        makeWord('did', 6.95, 7.2),
        makeWord('95%', 7.25, 7.8),
        makeWord('of', 7.85, 8.0),
        makeWord('teams', 8.05, 8.5),
        makeWord('waste', 8.55, 9.0),
        makeWord('two', 9.05, 9.3),
        makeWord('years', 9.35, 9.8),
        makeWord('building', 9.85, 10.6),
        makeWord('backends?', 10.65, 18.0),
      ],
    };
    const seg2: TranscriptSegment = {
      id: 2,
      start: 18.4,
      end: 28.0,
      text: 'Because WebGPU now runs everything locally in the browser!',
      words: [
        makeWord('Because', 18.4, 18.9),
        makeWord('WebGPU', 18.95, 19.6),
        makeWord('now', 19.65, 20.0),
        makeWord('runs', 20.05, 20.5),
        makeWord('everything', 20.55, 21.4),
        makeWord('locally', 21.45, 22.1),
        makeWord('in', 22.15, 22.3),
        makeWord('the', 22.35, 22.5),
        makeWord('browser!', 22.55, 28.0),
      ],
    };

    const transcript: Transcript = {
      fileFingerprint: 'fp',
      modelId: 'm',
      language: 'en',
      durationSec: 40,
      text: `${seg0.text} ${seg1.text} ${seg2.text}`,
      words: [...seg0.words, ...seg1.words, ...seg2.words],
      segments: [seg0, seg1, seg2],
      createdAt: 0,
    };

    const rawClip: CandidateClip = {
      id: 'c1',
      start: 0,
      end: 30,
      duration: 30,
      text: transcript.text,
      firstLine: seg0.text,
      words: transcript.words,
      segments: [seg0, seg1, seg2],
      features: {
        hook: 0.2,
        completeness: 0.8,
        emotion: 0.5,
        curiosity: 0.5,
        ending: 0.8,
        audioEnergy: 0.5,
        speechRateChange: 0.4,
        laughter: 0,
        topicCoherence: 0.6,
      },
      penalties: { silenceRatio: 0.1, silencePenalty: 0, durationPenalty: 0, totalPenalty: 0 },
      rawWeightedScore: 0.6,
      heuristicScore: 60,
      finalScore: 60,
    };

    const snapped = snapClipBoundaries(rawClip, transcript);
    expect(snapped.firstLine).toBe(seg1.text);
    expect(snapped.start).toBeGreaterThanOrEqual(6.4);
    expect(snapped.start).toBeLessThanOrEqual(6.5);
    expect(snapped.end).toBeCloseTo(28.12, 2);
  });
});
