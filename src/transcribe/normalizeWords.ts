import type { TranscriptSegment, WordTimestamp } from './types';

export interface RawWhisperChunk {
  text: string;
  timestamp: [number | null, number | null];
}

const MERGE_WITH_PREVIOUS_RE = /^(?:[.,!?;:%)\]}]+|'(?:s|t|re|ve|ll|d|m)\b)/i;
const SENTENCE_END_RE = /[.!?]["')\]]*$/;

/**
 * Normalizes raw Whisper word chunks relative to a global chunk offset:
 * - shifts timestamps by chunkOffsetSec
 * - clamps to [chunkOffsetSec, maxEndSec]
 * - ensures strictly non-decreasing monotonic bounds
 * - merges attached punctuation / contraction suffixes cleanly into the preceding word
 */
export function normalizeWhisperWordChunks(
  rawChunks: RawWhisperChunk[],
  chunkOffsetSec = 0,
  maxEndSec = Number.POSITIVE_INFINITY,
): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let cursor = Math.max(0, chunkOffsetSec);

  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i]!;
    const rawText = raw.text ?? '';
    const trimmed = rawText.trim();
    if (!trimmed) continue;

    const relStart = raw.timestamp[0] ?? Math.max(0, cursor - chunkOffsetSec);
    if (Number.isFinite(maxEndSec) && chunkOffsetSec + relStart >= maxEndSec) {
      continue;
    }

    const nextRawStart = rawChunks[i + 1]?.timestamp[0];
    const relEnd =
      raw.timestamp[1] ??
      (typeof nextRawStart === 'number' ? Math.max(relStart, nextRawStart) : relStart + 0.25);

    const start = Math.min(maxEndSec - 0.04, Math.max(cursor, chunkOffsetSec + relStart));
    const end = Math.min(maxEndSec, Math.max(start + 0.04, chunkOffsetSec + relEnd));

    const startsWithoutSpace = rawText.length > 0 && !/^\s/.test(rawText);
    const shouldMerge =
      words.length > 0 && (MERGE_WITH_PREVIOUS_RE.test(trimmed) || (startsWithoutSpace && trimmed.length <= 3));

    if (shouldMerge) {
      const prev = words[words.length - 1]!;
      prev.text = `${prev.text}${trimmed}`;
      prev.end = Math.max(prev.end, end);
    } else {
      words.push({
        text: trimmed,
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
      });
    }

    cursor = end;
  }

  return words;
}

/**
 * Fallback normalizer for segment-level Whisper timestamps (`return_timestamps: true`):
 * distributes each segment's time span across its whitespace-delimited words proportionally
 * by character length while preserving monotonic bounds within [chunkOffsetSec, maxEndSec].
 */
export function normalizeWhisperSegmentChunks(
  rawChunks: RawWhisperChunk[],
  chunkOffsetSec = 0,
  maxEndSec = Number.POSITIVE_INFINITY,
): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let cursor = Math.max(0, chunkOffsetSec);

  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i]!;
    const tokens = (raw.text ?? '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const relStart = raw.timestamp[0] ?? Math.max(0, cursor - chunkOffsetSec);
    if (Number.isFinite(maxEndSec) && chunkOffsetSec + relStart >= maxEndSec) {
      continue;
    }

    const nextRawStart = rawChunks[i + 1]?.timestamp[0];
    const fallbackDuration = Math.max(0.4, tokens.length * 0.35);
    const relEnd =
      raw.timestamp[1] ??
      (typeof nextRawStart === 'number' ? Math.max(relStart + 0.2, nextRawStart) : relStart + fallbackDuration);

    const segStart = Math.min(maxEndSec - 0.04, Math.max(cursor, chunkOffsetSec + relStart));
    const segEnd = Math.min(
      maxEndSec,
      Math.max(segStart + 0.04 * tokens.length, chunkOffsetSec + relEnd),
    );
    const span = Math.max(0.04 * tokens.length, segEnd - segStart);

    const weights = tokens.map((t) => Math.max(2, t.length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let localTime = segStart;

    for (let j = 0; j < tokens.length; j++) {
      const share = (weights[j]! / totalWeight) * span;
      const wStart = Math.min(maxEndSec - 0.04, Math.max(cursor, localTime));
      const wEnd =
        j === tokens.length - 1
          ? Math.min(maxEndSec, Math.max(wStart + 0.04, segEnd))
          : Math.min(maxEndSec, Math.max(wStart + 0.04, localTime + share));

      words.push({
        text: tokens[j]!,
        start: Math.round(wStart * 1000) / 1000,
        end: Math.round(wEnd * 1000) / 1000,
      });

      localTime = wEnd;
      cursor = wEnd;
    }
  }

  return words;
}

/**
 * Groups word-level timestamps into sentence/utterance segments using punctuation
 * and inter-word pause boundaries.
 */
export function groupWordsIntoSegments(
  words: WordTimestamp[],
  maxPauseSec = 0.7,
  maxSegmentWords = 20,
): TranscriptSegment[] {
  if (words.length === 0) return [];

  const segments: TranscriptSegment[] = [];
  let current: WordTimestamp[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      id: segments.length,
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
      text: current.map((w) => w.text).join(' '),
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const prev = current[current.length - 1];

    if (prev && word.start - prev.end >= maxPauseSec) {
      flush();
    }

    current.push(word);

    if (SENTENCE_END_RE.test(word.text) || current.length >= maxSegmentWords) {
      flush();
    }
  }

  flush();
  return segments;
}
