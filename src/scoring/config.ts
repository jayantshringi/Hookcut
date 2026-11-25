import rawConfig from '../../config/scoring.json';
import type { ScoringConfig } from './types';

export const SCORING_CONFIG: ScoringConfig = rawConfig as ScoringConfig;

export function sumScoringWeights(config: ScoringConfig): number {
  return Object.values(config.weights).reduce((acc, w) => acc + w, 0);
}

export function validateScoringConfig(config: ScoringConfig): void {
  const weightSum = sumScoringWeights(config);
  if (Math.abs(weightSum - 1.0) > 1e-6) {
    throw new Error(`Scoring weights must sum to 1.0, got ${weightSum}`);
  }
  const blendSum = config.rerank.heuristicWeight + config.rerank.llmWeight;
  if (Math.abs(blendSum - 1.0) > 1e-6) {
    throw new Error(`Rerank weights must sum to 1.0, got ${blendSum}`);
  }
  if (config.penalties.durationHardMin > config.penalties.durationIdealMin) {
    throw new Error('durationHardMin must be <= durationIdealMin');
  }
  if (config.penalties.durationIdealMax > config.penalties.durationHardMax) {
    throw new Error('durationIdealMax must be <= durationHardMax');
  }
}
