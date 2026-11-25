import type { Transcript, TranscriptSegment, WordTimestamp } from '../transcribe/types';
import { SCORING_CONFIG } from './config';
import { scoreHook } from './features';
import type { CandidateClip } from './types';

export interface BoundarySnapOptions {
  leadPadSec?: number;
  tailPadSec?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
}

const WEAK_OPENER_RE =
  /^(?:uh+|um+|so yeah|anyway|welcome back|hello everyone|hey guys|like i said|as i said)\b/i;

function getPreviousWordEnd(allWords: WordTimestamp[], firstWord: WordTimestamp): number {
  const idx = allWords.indexOf(firstWord);
  if (idx <= 0) return 0;
  return allWords[idx - 1]!.end;
}

function getNextWordStart(
  allWords: WordTimestamp[],
  lastWord: WordTimestamp,
  totalDurationSec: number,
): number {
  const idx = allWords.indexOf(lastWord);
  if (idx === -1 || idx >= allWords.length - 1) return totalDurationSec;
  return allWords[idx + 1]!.start;
}

function computeSafeWordRange(
  words: WordTimestamp[],
  allWords: WordTimestamp[],
  totalDurationSec: number,
  leadPadSec: number,
  tailPadSec: number,
): { start: number; end: number } {
  const firstWord = words[0]!;
  const lastWord = words[words.length - 1]!;

  const prevEnd = getPreviousWordEnd(allWords, firstWord);
  const maxLeadPad = Math.max(0, (firstWord.start - prevEnd) * 0.45);
  const start = Math.max(0, firstWord.start - Math.min(leadPadSec, maxLeadPad));

  const nextStart = getNextWordStart(allWords, lastWord, totalDurationSec);
  const maxTailPad = Math.max(0, (nextStart - lastWord.end) * 0.45);
  const end = Math.min(totalDurationSec, lastWord.end + Math.min(tailPadSec, maxTailPad));

  return {
    start: Math.round(start * 1000) / 1000,
    end: Math.round(Math.max(start + 0.1, end) * 1000) / 1000,
  };
}

function shouldPromoteSecondSegmentAsHook(
  segments: TranscriptSegment[],
  minDurationSec: number,
): boolean {
  if (segments.length < 2) return false;
  const first = segments[0]!;
  const second = segments[1]!;
  const last = segments[segments.length - 1]!;

  const remainingDuration = last.end - second.start;
  if (remainingDuration < minDurationSec) return false;

  const firstText = first.text.trim();
  const secondText = second.text.trim();
  const first3s = first.words
    .filter((w) => w.start < first.start + 3)
    .map((w) => w.text)
    .join(' ');
  const second3s = second.words
    .filter((w) => w.start < second.start + 3)
    .map((w) => w.text)
    .join(' ');

  const firstHook = scoreHook(first3s, firstText);
  const secondHook = scoreHook(second3s, secondText);

  if (WEAK_OPENER_RE.test(firstText) && secondHook > firstHook) {
    return true;
  }
  return firstHook < 0.25 && secondHook >= 0.45;
}

/**
 * Snaps a manual trim range [rawStart, rawEnd] so neither bound cuts mid-word.
 */
export function snapRangeToWordBoundaries(
  rawStart: number,
  rawEnd: number,
  words: WordTimestamp[],
  totalDurationSec: number,
  leadPadSec = 0.08,
  tailPadSec = 0.12,
): { start: number; end: number; words: WordTimestamp[] } {
  const clampedStart = Math.max(0, Math.min(rawStart, totalDurationSec));
  const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, totalDurationSec));

  if (words.length === 0) {
    return {
      start: Math.round(clampedStart * 1000) / 1000,
      end: Math.round(clampedEnd * 1000) / 1000,
      words: [],
    };
  }

  let startIdx = words.findIndex((w) => w.end > clampedStart);
  if (startIdx === -1) startIdx = words.length - 1;
  const startWord = words[startIdx]!;
  // If rawStart fell past the midpoint of startWord, advance to next word so startWord isn't clipped mid-word
  if (
    clampedStart > (startWord.start + startWord.end) / 2 &&
    startIdx + 1 < words.length
  ) {
    startIdx += 1;
  }

  let endIdx = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i]!.start < clampedEnd) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) endIdx = 0;
  const endWord = words[endIdx]!;
  // If rawEnd fell before the midpoint of endWord, pull back to previous word so endWord isn't clipped mid-word
  if (
    clampedEnd < (endWord.start + endWord.end) / 2 &&
    endIdx - 1 >= startIdx
  ) {
    endIdx -= 1;
  }

  if (endIdx < startIdx) {
    endIdx = startIdx;
  }

  const sliced = words.slice(startIdx, endIdx + 1);
  const { start, end } = computeSafeWordRange(
    sliced,
    words,
    totalDurationSec,
    leadPadSec,
    tailPadSec,
  );

  return { start, end, words: sliced };
}

/**
 * Refines clip boundaries: trims leading silence, drops weak intro filler if the next
 * sentence forms a real hook, and guarantees cuts never land mid-word.
 */
export function snapClipBoundaries(
  clip: CandidateClip,
  transcript: Transcript,
  options: BoundarySnapOptions = {},
): CandidateClip {
  const leadPadSec = options.leadPadSec ?? 0.08;
  const tailPadSec = options.tailPadSec ?? 0.12;
  const defaultMin =
    transcript.durationSec < SCORING_CONFIG.penalties.durationHardMin
      ? Math.max(4, transcript.durationSec * 0.5)
      : SCORING_CONFIG.penalties.durationHardMin;
  const minDurationSec = options.minDurationSec ?? defaultMin;

  let segments = [...clip.segments];
  while (shouldPromoteSecondSegmentAsHook(segments, minDurationSec)) {
    segments = segments.slice(1);
  }

  const words = segments.flatMap((s) => s.words);
  if (words.length === 0) {
    return clip;
  }

  const { start, end } = computeSafeWordRange(
    words,
    transcript.words.length > 0 ? transcript.words : words,
    transcript.durationSec,
    leadPadSec,
    tailPadSec,
  );

  const text = segments.map((s) => s.text).join(' ').trim();
  const firstLine = segments[0]?.text.trim() ?? clip.firstLine;

  return {
    ...clip,
    start,
    end,
    duration: Math.round((end - start) * 100) / 100,
    text,
    firstLine,
    words,
    segments,
  };
}
