import type { WordTimestamp } from '../transcribe/types';
import type { CandidatePenalties, EnergyProfile, ScoringPenaltiesConfig } from './types';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Estimates fraction of the window consisting of silence (> 0.6s speech gaps
 * or low-energy audio bins when an EnergyProfile is provided).
 */
export function computeSilenceRatio(
  startSec: number,
  endSec: number,
  words: WordTimestamp[],
  energyProfile?: EnergyProfile,
): number {
  const duration = endSec - startSec;
  if (duration <= 0) return 1;
  if (words.length === 0) return 1;

  if (energyProfile && energyProfile.bins.length > 0 && energyProfile.binSec > 0) {
    const startIdx = Math.max(0, Math.floor(startSec / energyProfile.binSec));
    const endIdx = Math.min(energyProfile.bins.length, Math.ceil(endSec / energyProfile.binSec));
    const count = endIdx - startIdx;
    if (count > 0) {
      const globalMean =
        energyProfile.bins.reduce((acc, v) => acc + v, 0) / energyProfile.bins.length || 0;
      const silenceThreshold = Math.max(0.004, globalMean * 0.15);
      let silentBins = 0;
      for (let i = startIdx; i < endIdx; i++) {
        if ((energyProfile.bins[i] ?? 0) < silenceThreshold) {
          silentBins++;
        }
      }
      return clamp01(silentBins / count);
    }
  }

  let silentDuration = Math.max(0, words[0]!.start - startSec);
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1]!.start - words[i]!.end;
    if (gap > 0.6) {
      silentDuration += gap - 0.35;
    }
  }
  const tailGap = Math.max(0, endSec - words[words.length - 1]!.end);
  if (tailGap > 0.6) {
    silentDuration += tailGap - 0.35;
  }

  return clamp01(silentDuration / duration);
}

export function computeSilencePenalty(
  silenceRatio: number,
  config: ScoringPenaltiesConfig,
): number {
  if (silenceRatio <= config.silenceRatioOver) return 0;
  const excess = silenceRatio - config.silenceRatioOver;
  const span = Math.max(0.1, 0.7 - config.silenceRatioOver);
  const normalized = clamp01(excess / span);
  return normalized * config.silenceMaxPenalty;
}

export function computeDurationPenalty(
  durationSec: number,
  config: ScoringPenaltiesConfig,
): number {
  if (durationSec >= config.durationIdealMin && durationSec <= config.durationIdealMax) {
    return 0;
  }

  if (durationSec < config.durationIdealMin) {
    const span = Math.max(1, config.durationIdealMin - config.durationHardMin);
    const ratio = clamp01((config.durationIdealMin - durationSec) / span);
    return ratio * config.durationMaxPenalty;
  }

  const span = Math.max(1, config.durationHardMax - config.durationIdealMax);
  const ratio = clamp01((durationSec - config.durationIdealMax) / span);
  return ratio * config.durationMaxPenalty;
}

export function computeCandidatePenalties(input: {
  startSec: number;
  endSec: number;
  words: WordTimestamp[];
  config: ScoringPenaltiesConfig;
  energyProfile?: EnergyProfile;
}): CandidatePenalties {
  const silenceRatio = computeSilenceRatio(
    input.startSec,
    input.endSec,
    input.words,
    input.energyProfile,
  );
  const silencePenalty = computeSilencePenalty(silenceRatio, input.config);
  const durationPenalty = computeDurationPenalty(input.endSec - input.startSec, input.config);

  return {
    silenceRatio: Math.round(silenceRatio * 1000) / 1000,
    silencePenalty: Math.round(silencePenalty * 1000) / 1000,
    durationPenalty: Math.round(durationPenalty * 1000) / 1000,
    totalPenalty: Math.round((silencePenalty + durationPenalty) * 1000) / 1000,
  };
}
