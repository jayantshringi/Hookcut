import type { TranscriptSegment, WordTimestamp } from '../transcribe/types';

export interface ScoringWeights {
  hook: number;
  completeness: number;
  emotion: number;
  curiosity: number;
  ending: number;
  audioEnergy: number;
  speechRateChange: number;
  laughter: number;
  topicCoherence: number;
}

export interface ScoringPenaltiesConfig {
  silenceRatioOver: number;
  silenceMaxPenalty: number;
  durationIdealMin: number;
  durationIdealMax: number;
  durationHardMin: number;
  durationHardMax: number;
  durationMaxPenalty: number;
}

export interface RerankConfig {
  candidatesToRerank: number;
  heuristicWeight: number;
  llmWeight: number;
  minLlmScoreToKeep: number;
  topN: number;
}

export interface OverlapConfig {
  maxOverlapRatio: number;
}

export interface ScoringConfig {
  version: number;
  weights: ScoringWeights;
  penalties: ScoringPenaltiesConfig;
  rerank: RerankConfig;
  overlap: OverlapConfig;
}

export type ScoringFeatures = Record<keyof ScoringWeights, number>;

export interface EnergyProfile {
  bins: number[];
  binSec: number;
}

export interface CandidatePenalties {
  silenceRatio: number;
  silencePenalty: number;
  durationPenalty: number;
  totalPenalty: number;
}

export interface CandidateClip {
  id: string;
  start: number;
  end: number;
  duration: number;
  text: string;
  firstLine: string;
  words: WordTimestamp[];
  segments: TranscriptSegment[];
  features: ScoringFeatures;
  penalties: CandidatePenalties;
  rawWeightedScore: number; // 0..1 before penalties
  heuristicScore: number; // 0..100 after penalties
  llmScore?: number; // 0..100
  llmTitle?: string;
  llmHookLine?: string;
  llmReason?: string;
  finalScore: number; // 0..100
}
