import { describe, expect, it } from 'vitest';
import {
  groupWordsIntoSegments,
  normalizeWhisperSegmentChunks,
  normalizeWhisperWordChunks,
} from '../../src/transcribe/normalizeWords';

describe('normalizeWhisperWordChunks', () => {
  it('shifts chunk timestamps by offset, clamps bounds, and merges contractions/punctuation', () => {
    const words = normalizeWhisperWordChunks(
      [
        { text: ' Why', timestamp: [0.0, 0.4] },
        { text: ' don', timestamp: [0.4, 0.65] },
        { text: "'t", timestamp: [0.65, 0.8] },
        { text: ' creators', timestamp: [0.85, 1.35] },
        { text: ' quit', timestamp: [1.35, null] },
        { text: '?', timestamp: [1.7, 1.85] },
      ],
      30,
      60,
    );

    expect(words).toHaveLength(4);
    expect(words[0]).toEqual({ text: 'Why', start: 30, end: 30.4 });
    expect(words[1]).toEqual({ text: "don't", start: 30.4, end: 30.8 });
    expect(words[2]).toEqual({ text: 'creators', start: 30.85, end: 31.35 });
    expect(words[3]).toEqual({ text: 'quit?', start: 31.35, end: 31.85 });
  });

  it('guarantees strictly non-decreasing timestamps even on noisy Whisper overlaps', () => {
    const words = normalizeWhisperWordChunks(
      [
        { text: ' One', timestamp: [1.0, 1.5] },
        { text: ' two', timestamp: [1.2, 1.4] },
      ],
      0,
      10,
    );
    expect(words[1]!.start).toBeGreaterThanOrEqual(words[0]!.end);
    expect(words[1]!.end).toBeGreaterThan(words[1]!.start);
  });

  it('drops out-of-bounds hallucinated tokens beyond maxEndSec', () => {
    const words = normalizeWhisperWordChunks(
      [
        { text: ' Valid', timestamp: [0.5, 1.0] },
        { text: ' Ghost', timestamp: [23.24, 23.44] },
      ],
      0,
      3.0,
    );
    expect(words).toEqual([{ text: 'Valid', start: 0.5, end: 1.0 }]);
  });
});

describe('normalizeWhisperSegmentChunks', () => {
  it('distributes segment-level timestamps proportionally across words', () => {
    const words = normalizeWhisperSegmentChunks(
      [{ text: 'Why hooks win fast', timestamp: [1.0, 3.0] }],
      10,
      20,
    );
    expect(words).toHaveLength(4);
    expect(words[0]!.start).toBe(11);
    expect(words[3]!.end).toBe(13);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
    }
  });
});

describe('groupWordsIntoSegments', () => {
  it('splits segments on sentence punctuation and long pauses', () => {
    const segments = groupWordsIntoSegments([
      { text: 'Wait', start: 0.0, end: 0.3 },
      { text: 'a', start: 0.3, end: 0.4 },
      { text: 'second.', start: 0.4, end: 0.9 },
      { text: 'Here', start: 1.0, end: 1.3 },
      { text: 'is', start: 1.3, end: 1.45 },
      { text: 'why', start: 2.5, end: 2.8 }, // 1.05s pause triggers segment break
      { text: 'it', start: 2.8, end: 2.95 },
      { text: 'worked.', start: 2.95, end: 3.4 },
    ]);

    expect(segments).toHaveLength(3);
    expect(segments[0]!.text).toBe('Wait a second.');
    expect(segments[1]!.text).toBe('Here is');
    expect(segments[2]!.text).toBe('why it worked.');
  });
});
