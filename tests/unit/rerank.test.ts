import { describe, expect, it, vi } from 'vitest';
import { SCORING_CONFIG } from '../../src/scoring/config';
import {
  blendFinalScore,
  filterByMinLlmScore,
  rerankCandidatesWithRunner,
} from '../../src/scoring/rerankClient';
import {
  buildRerankPrompt,
  parseAndValidateRerankResponse,
} from '../../src/scoring/rerankPrompt';
import type { CandidateClip } from '../../src/scoring/types';

function makeCandidate(id: string, heuristicScore: number, text: string): CandidateClip {
  return {
    id,
    start: 0,
    end: 30,
    duration: 30,
    text,
    firstLine: text.split('.')[0] ?? text,
    words: [],
    segments: [],
    features: {
      hook: 0.7,
      completeness: 0.8,
      emotion: 0.5,
      curiosity: 0.6,
      ending: 0.7,
      audioEnergy: 0.5,
      speechRateChange: 0.4,
      laughter: 0,
      topicCoherence: 0.6,
    },
    penalties: {
      silenceRatio: 0.1,
      silencePenalty: 0,
      durationPenalty: 0,
      totalPenalty: 0,
    },
    rawWeightedScore: heuristicScore / 100,
    heuristicScore,
    finalScore: heuristicScore,
  };
}

describe('rerankPrompt', () => {
  const excerpt =
    'Why do 90% of apps stall in the browser? Because developers block the main thread instead of using Web Workers.';

  it('injects the excerpt into rerank_v1.md prompt template', () => {
    const prompt = buildRerankPrompt(excerpt);
    expect(prompt).toContain('You are a short-form video editor.');
    expect(prompt).toContain(excerpt);
    expect(prompt).not.toContain('{{EXCERPT}}');
  });

  it('accepts valid JSON matching schema and exact hook_line substring', () => {
    const valid = JSON.stringify({
      score: 84,
      title: 'Why Browser Apps Stall',
      hook_line: 'Why do 90% of apps stall in the browser?',
      reason: 'Strong opening question with an actionable browser performance takeaway.',
    });
    const res = parseAndValidateRerankResponse(valid, excerpt);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.score).toBe(84);
    }
  });

  it('rejects hallucinated hook_line not present in excerpt', () => {
    const invalid = JSON.stringify({
      score: 75,
      title: 'Browser Tips',
      hook_line: 'This sentence was invented by the model.',
      reason: 'Good tip.',
    });
    const res = parseAndValidateRerankResponse(invalid, excerpt);
    expect(res.ok).toBe(false);
  });

  it('rejects out-of-range scores, long titles, and >25 word reasons', () => {
    expect(
      parseAndValidateRerankResponse(
        JSON.stringify({
          score: 105,
          title: 'Valid',
          hook_line: 'Why do 90% of apps stall in the browser?',
          reason: 'Concise reason.',
        }),
        excerpt,
      ).ok,
    ).toBe(false);

    expect(
      parseAndValidateRerankResponse(
        JSON.stringify({
          score: 70,
          title: 'A'.repeat(61),
          hook_line: 'Why do 90% of apps stall in the browser?',
          reason: 'Concise reason.',
        }),
        excerpt,
      ).ok,
    ).toBe(false);

    expect(
      parseAndValidateRerankResponse(
        JSON.stringify({
          score: 70,
          title: 'Valid title',
          hook_line: 'Why do 90% of apps stall in the browser?',
          reason: new Array(26).fill('word').join(' '),
        }),
        excerpt,
      ).ok,
    ).toBe(false);
  });
});

describe('rerankCandidatesWithRunner', () => {
  it('calls runner once per candidate, retries once on invalid output, and falls back to heuristics', async () => {
    const c1 = makeCandidate('c1', 60, 'First hook sentence. Clear payoff here.');
    const c2 = makeCandidate('c2', 80, 'Second hook sentence. Solid explanation.');

    const runner = vi
      .fn<(prompt: string) => Promise<string>>()
      // c1 attempt 1: invalid JSON -> triggers retry
      .mockResolvedValueOnce('not json at all')
      // c1 attempt 2: valid high score
      .mockResolvedValueOnce(
        JSON.stringify({
          score: 90,
          title: 'Clip One',
          hook_line: 'First hook sentence.',
          reason: 'Great hook and clear payoff.',
        }),
      )
      // c2 attempt 1 & 2: both invalid -> falls back to heuristic 80
      .mockResolvedValueOnce('{"score": "bad"}')
      .mockResolvedValueOnce('{"score": 999}');

    const ranked = await rerankCandidatesWithRunner([c1, c2], runner, { llmEnabled: true });

    expect(runner).toHaveBeenCalledTimes(4);
    expect(ranked).toHaveLength(2);
    // c2 fell back to heuristic 80; c1 blended 0.4*60 + 0.6*90 = 78
    expect(ranked[0]!.id).toBe('c2');
    expect(ranked[0]!.finalScore).toBe(80);
    expect(ranked[1]!.id).toBe('c1');
    expect(ranked[1]!.finalScore).toBe(blendFinalScore(60, 90, SCORING_CONFIG));
  });

  it('skips LLM entirely on weak devices', async () => {
    const runner = vi.fn();
    const c1 = makeCandidate('c1', 55, 'Clip one.');
    const c2 = makeCandidate('c2', 75, 'Clip two.');

    const ranked = await rerankCandidatesWithRunner([c1, c2], runner, { llmEnabled: false });
    expect(runner).not.toHaveBeenCalled();
    expect(ranked.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(ranked[0]!.finalScore).toBe(75);
  });

  it('filters low LLM scores using minLlmScoreToKeep', () => {
    const low = { ...makeCandidate('low', 70, 'Weak.'), llmScore: 30 };
    const high = { ...makeCandidate('high', 65, 'Strong.'), llmScore: 75 };
    const filtered = filterByMinLlmScore([low, high], 40);
    expect(filtered.map((c) => c.id)).toEqual(['high']);
  });
});
