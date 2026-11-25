import promptTemplate from '../../prompts/rerank_v1.md?raw';

export interface RerankLlmOutput {
  score: number;
  title: string;
  hook_line: string;
  reason: string;
}

export type RerankValidationResult =
  | { ok: true; value: RerankLlmOutput }
  | { ok: false; error: string };

export function buildRerankPrompt(excerpt: string): string {
  return promptTemplate.replace('{{EXCERPT}}', excerpt.trim());
}

function extractJsonObjectCandidate(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return trimmed.slice(firstBrace, lastBrace + 1);
}

/**
 * Validates raw LLM JSON output against the strict rerank_v1 schema and checks
 * that hook_line is a real substring of the excerpt.
 */
export function parseAndValidateRerankResponse(
  rawText: string,
  excerpt: string,
): RerankValidationResult {
  const jsonSlice = extractJsonObjectCandidate(rawText);
  if (!jsonSlice) {
    return { ok: false, error: 'Response does not contain a JSON object.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { ok: false, error: 'Response is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Parsed output must be a JSON object.' };
  }

  const record = parsed as Record<string, unknown>;
  const { score, title, hook_line, reason } = record;

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
    return { ok: false, error: 'score must be an integer between 0 and 100.' };
  }

  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 60) {
    return { ok: false, error: 'title must be a non-empty string up to 60 characters.' };
  }

  if (typeof hook_line !== 'string' || hook_line.trim().length === 0) {
    return { ok: false, error: 'hook_line must be a non-empty string.' };
  }

  const normalizedHook = hook_line.trim();
  if (!excerpt.includes(normalizedHook)) {
    return { ok: false, error: 'hook_line must be an exact substring of the excerpt.' };
  }

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, error: 'reason must be a non-empty string.' };
  }

  const reasonWords = reason.trim().split(/\s+/).filter(Boolean);
  if (reasonWords.length > 25) {
    return { ok: false, error: 'reason must be at most 25 words.' };
  }

  return {
    ok: true,
    value: {
      score,
      title: title.trim(),
      hook_line: normalizedHook,
      reason: reason.trim(),
    },
  };
}
