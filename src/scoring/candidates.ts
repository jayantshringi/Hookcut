import type { Transcript, TranscriptSegment } from '../transcribe/types';
import { SCORING_CONFIG } from './config';
import { computeWindowFeatures } from './features';
import { computeCandidatePenalties } from './penalties';
import type {
  CandidateClip,
  EnergyProfile,
  ScoringConfig,
  ScoringFeatures,
  ScoringWeights,
} from './types';

export interface WindowRange {
  startSegmentIdx: number;
  endSegmentIdx: number;
  start: number;
  end: number;
  segments: TranscriptSegment[];
}

export function computeWeightedFeatureScore(
  features: ScoringFeatures,
  weights: ScoringWeights,
): number {
  let sum = 0;
  for (const key of Object.keys(weights) as (keyof ScoringWeights)[]) {
    sum += features[key] * weights[key];
  }
  return Math.max(0, Math.min(1, sum));
}

export function computeOverlapRatio(
  a: Pick<CandidateClip, 'start' | 'end'>,
  b: Pick<CandidateClip, 'start' | 'end'>,
): number {
  const overlapStart = Math.max(a.start, b.start);
  const overlapEnd = Math.min(a.end, b.end);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  if (overlap <= 0) return 0;

  const minLen = Math.min(a.end - a.start, b.end - b.start);
  return minLen > 0 ? overlap / minLen : 0;
}

/**
 * Generates sliding windows in [durationHardMin, durationHardMax] snapped to sentence boundaries.
 */
export function generateSlidingWindows(
  transcript: Transcript,
  config: ScoringConfig = SCORING_CONFIG,
): WindowRange[] {
  const segments = transcript.segments;
  if (segments.length === 0) return [];

  const { durationHardMin, durationHardMax } = config.penalties;
  const windows: WindowRange[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const startSeg = segments[i]!;
    for (let j = i; j < segments.length; j++) {
      const endSeg = segments[j]!;
      const duration = endSeg.end - startSeg.start;

      if (duration < durationHardMin) continue;
      if (duration > durationHardMax) break;

      const key = `${startSeg.start.toFixed(2)}:${endSeg.end.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      windows.push({
        startSegmentIdx: i,
        endSegmentIdx: j,
        start: startSeg.start,
        end: endSeg.end,
        segments: segments.slice(i, j + 1),
      });
    }
  }

  return windows;
}

export function dedupeOverlappingCandidates<T extends Pick<CandidateClip, 'start' | 'end' | 'heuristicScore'>>(
  candidates: T[],
  maxOverlapRatio: number,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.heuristicScore - a.heuristicScore);
  const kept: T[] = [];

  for (const candidate of sorted) {
    const overlapsExisting = kept.some(
      (existing) => computeOverlapRatio(candidate, existing) > maxOverlapRatio,
    );
    if (!overlapsExisting) {
      kept.push(candidate);
    }
  }

  return kept;
}

export interface ScoreCandidatesOptions {
  config?: ScoringConfig;
  energyProfile?: EnergyProfile;
  allowShortVideoFallback?: boolean;
}

/**
 * Splits any segment longer than `maxSegmentSec` along word boundaries so
 * unpunctuated monologues can still form valid 20-60s highlight windows.
 */
function splitOversizedSegments(
  segments: TranscriptSegment[],
  maxSegmentSec: number,
  targetSplitSec = 35,
): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  for (const seg of segments) {
    if (seg.end - seg.start <= maxSegmentSec || seg.words.length < 2) {
      result.push(seg);
      continue;
    }

    let bucket: typeof seg.words = [];
    for (const w of seg.words) {
      bucket.push(w);
      const span = w.end - bucket[0]!.start;
      if (span >= targetSplitSec && bucket.length >= 2) {
        result.push({
          id: result.length,
          start: bucket[0]!.start,
          end: w.end,
          text: bucket.map((item) => item.text).join(' '),
          words: bucket,
        });
        bucket = [];
      }
    }
    if (bucket.length > 0) {
      result.push({
        id: result.length,
        start: bucket[0]!.start,
        end: bucket[bucket.length - 1]!.end,
        text: bucket.map((item) => item.text).join(' '),
        words: bucket,
      });
    }
  }
  return result.map((s, id) => ({ ...s, id }));
}

function findPeakEnergyWindow(
  durationSec: number,
  energyProfile?: EnergyProfile,
  targetDurationSec = 35,
): { start: number; end: number } {
  const safeDuration = Math.max(0.5, durationSec);
  const clipLen = Math.min(safeDuration, targetDurationSec);
  if (!energyProfile || energyProfile.bins.length === 0 || energyProfile.binSec <= 0) {
    return { start: 0, end: Math.round(clipLen * 100) / 100 };
  }

  const windowBins = Math.max(1, Math.round(clipLen / energyProfile.binSec));
  if (windowBins >= energyProfile.bins.length) {
    return { start: 0, end: Math.round(clipLen * 100) / 100 };
  }

  let runningSum = 0;
  for (let i = 0; i < windowBins; i++) {
    runningSum += energyProfile.bins[i] ?? 0;
  }
  let bestStartBin = 0;
  let bestSum = runningSum;
  for (let i = windowBins; i < energyProfile.bins.length; i++) {
    runningSum += (energyProfile.bins[i] ?? 0) - (energyProfile.bins[i - windowBins] ?? 0);
    if (runningSum > bestSum) {
      bestSum = runningSum;
      bestStartBin = i - windowBins + 1;
    }
  }

  const start = Math.max(0, Math.min(safeDuration - clipLen, bestStartBin * energyProfile.binSec));
  const end = Math.min(safeDuration, start + clipLen);
  return {
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
  };
}

/**
 * Scores sentence-aligned sliding windows, applies penalties, deduplicates overlapping spans,
 * and returns the top candidatesToRerank candidates.
 */
export function scoreTranscriptCandidates(
  transcript: Transcript,
  options: ScoreCandidatesOptions = {},
): CandidateClip[] {
  const config = options.config ?? SCORING_CONFIG;
  const energyProfile = options.energyProfile;
  const allowShortFallback = options.allowShortVideoFallback ?? true;

  let windows = generateSlidingWindows(transcript, config);

  if (windows.length === 0 && allowShortFallback) {
    if (transcript.segments.length > 0) {
      const normalizedSegments = splitOversizedSegments(
        transcript.segments,
        config.penalties.durationHardMax,
      );
      if (normalizedSegments.length !== transcript.segments.length) {
        windows = generateSlidingWindows(
          { ...transcript, segments: normalizedSegments },
          config,
        );
      }

      if (windows.length === 0) {
        // Group available speech segments into a single fallback window (capped at durationHardMax)
        const picked: TranscriptSegment[] = [];
        const first = normalizedSegments[0]!;
        for (const seg of normalizedSegments) {
          if (seg.end - first.start <= config.penalties.durationHardMax || picked.length === 0) {
            picked.push(seg);
          } else {
            break;
          }
        }
        const last = picked[picked.length - 1]!;
        windows = [
          {
            startSegmentIdx: 0,
            endSegmentIdx: picked.length - 1,
            start: first.start,
            end: Math.min(last.end, first.start + config.penalties.durationHardMax),
            segments: picked,
          },
        ];
      }
    } else if (transcript.durationSec > 0) {
      // Instrumental / silent video fallback so preview, reframe, and MP4 export remain available
      const peak = findPeakEnergyWindow(
        transcript.durationSec,
        energyProfile,
        Math.min(30, config.penalties.durationIdealMax),
      );
      windows = [
        {
          startSegmentIdx: 0,
          endSegmentIdx: 0,
          start: peak.start,
          end: peak.end,
          segments: [
            {
              id: 0,
              start: peak.start,
              end: peak.end,
              text: '',
              words: [],
            },
          ],
        },
      ];
    }
  }

  const scored: CandidateClip[] = windows.map((win, idx) => {
    const words = win.segments.flatMap((s) => s.words);
    const text = win.segments.map((s) => s.text).join(' ').trim();
    const firstLine = win.segments[0]?.text.trim() ?? '';
    const features = computeWindowFeatures({
      startSec: win.start,
      endSec: win.end,
      segments: win.segments,
      words,
      energyProfile,
    });
    const penalties = computeCandidatePenalties({
      startSec: win.start,
      endSec: win.end,
      words,
      config: config.penalties,
      energyProfile,
    });
    const rawWeightedScore = computeWeightedFeatureScore(features, config.weights);
    const net01 = Math.max(0, Math.min(1, rawWeightedScore - penalties.totalPenalty));
    const heuristicScore = Math.round(net01 * 1000) / 10;

    return {
      id: `clip-${idx + 1}-${Math.round(win.start)}s`,
      start: win.start,
      end: win.end,
      duration: Math.round((win.end - win.start) * 100) / 100,
      text,
      firstLine,
      words,
      segments: win.segments,
      features,
      penalties,
      rawWeightedScore: Math.round(rawWeightedScore * 1000) / 1000,
      heuristicScore,
      finalScore: heuristicScore,
    };
  });

  const deduped = dedupeOverlappingCandidates(scored, config.overlap.maxOverlapRatio);
  return deduped.slice(0, config.rerank.candidatesToRerank);
}
