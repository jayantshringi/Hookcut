import type { TranscriptSegment, WordTimestamp } from '../transcribe/types';
import type { EnergyProfile, ScoringFeatures } from './types';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'to', 'of', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we',
  'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'him', 'her', 'us', 'them', 'just',
  'like', 'really', 'very', 'about', 'into', 'out', 'up', 'down',
]);

const HOOK_QUESTION_RE =
  /^(?:why|how|what if|what happens|did you know|have you ever|would you|can you|do you|who else|imagine)\b|[?]/i;
const HOOK_BOLD_CLAIM_RE =
  /\b(?:never|always|everything|nothing|nobody|everyone knows|every single|biggest mistake|truth is|changed everything|stop doing|secret|impossible|guaranteed|most important|best way|worst mistake|unpopular opinion)\b/i;
const HOOK_NUMBER_RE =
  /(?:\$|\b\d+(?:\.\d+)?[%xXkKmMbB]?|\b(?:two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|percent)\b)/i;
const HOOK_CONTRAST_RE =
  /\b(?:but|however|instead|actually|except|yet|until|wrong|myth|most people think|everyone thinks)\b/i;
const HOOK_STORY_OPENER_RE =
  /\b(?:yesterday|last week|last year|years ago|months ago|one day|when i|picture this|story|i remember|the moment)\b/i;

const BACK_REFERENCE_START_RE =
  /^(?:and |so yeah|like i said|as i mentioned|as i said|again,|anyway,|continuing|to wrap up that previous)\b/i;
const TRAILING_FILLER_RE = /\b(?:uh+|um+|so yeah|you know|whatever|etcetera)\W*$/i;

const EMOTION_WORDS_RE =
  /\b(?:love|hate|insane|crazy|terrifying|amazing|incredible|heartbreaking|shocking|obsessed|excited|angry|scared|honestly|literally|unbelievable|mind-blowing|brutal|wild|genius|painful|thrilled)\b/gi;

const CURIOSITY_WORDS_RE =
  /\b(?:secret|reason|turned out|wait until|here is why|here's why|what happened|nobody talks about|hidden|surprising|unexpected|spoiler|mystery|twist|realize|discover|actually)\b/gi;

const TAKEAWAY_WORDS_RE =
  /\b(?:that's why|thats why|lesson|remember|never again|changed everything|matter|truth|moral|rule|point is|here's the takeaway|bottom line)\b/i;

const LAUGHTER_TEXT_RE =
  /\b(?:haha+|hehe+|lol|lmao|laugh(?:ing|ed|s)?|hilarious|funny|joke|kidding)\b|\[laughter\]/gi;

function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function tokenizeContentWords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Evaluates whether the first 3 seconds form a compelling hook:
 * question, bold claim, concrete number, contrast, or story opener.
 */
export function scoreHook(first3sText: string, firstSentence: string): number {
  const sample = `${first3sText} ${firstSentence}`.trim();
  if (!sample) return 0;

  let signals = 0;
  if (HOOK_QUESTION_RE.test(first3sText) || firstSentence.trim().endsWith('?')) signals += 0.38;
  if (HOOK_BOLD_CLAIM_RE.test(sample)) signals += 0.32;
  if (HOOK_NUMBER_RE.test(first3sText)) signals += 0.28;
  if (HOOK_CONTRAST_RE.test(sample)) signals += 0.25;
  if (HOOK_STORY_OPENER_RE.test(sample)) signals += 0.28;

  // Mild penalty if the opening starts mid-reference
  if (BACK_REFERENCE_START_RE.test(firstSentence.trim())) {
    signals -= 0.25;
  }

  // Baseline fluency credit for crisp 4-18 word opening hook
  const wordCount = first3sText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 4 && wordCount <= 18) {
    signals += 0.12;
  }

  return clamp01(signals);
}

/**
 * Measures self-contained completeness: clean start, clean sentence ending,
 * absence of prior-context references, and adequate substance.
 */
export function scoreCompleteness(segments: TranscriptSegment[], words: WordTimestamp[]): number {
  if (segments.length === 0 || words.length === 0) return 0;

  const firstText = segments[0]!.text.trim();
  const lastText = segments[segments.length - 1]!.text.trim();

  let score = 0.25;
  if (/^[A-Z0-9"']/.test(firstText) && !BACK_REFERENCE_START_RE.test(firstText)) {
    score += 0.25;
  }
  if (/[.!?]["')\]]*$/.test(lastText)) {
    score += 0.25;
  }
  if (words.length >= 45) {
    score += 0.15;
  } else if (words.length >= 25) {
    score += 0.08;
  }
  if (segments.length >= 2) {
    score += 0.1;
  }

  return clamp01(score);
}

export function scoreEmotion(text: string): number {
  if (!text.trim()) return 0;
  const wordCount = Math.max(1, text.trim().split(/\s+/).length);
  const emotionHits = countMatches(text, EMOTION_WORDS_RE);
  const exclamations = countMatches(text, /!/g);
  const density = (emotionHits * 1.4 + exclamations * 0.7) / Math.max(4, wordCount / 12);
  return clamp01(density * 0.55);
}

export function scoreCuriosity(text: string): number {
  if (!text.trim()) return 0;
  const curiosityHits = countMatches(text, CURIOSITY_WORDS_RE);
  const questions = countMatches(text, /\?/g);
  return clamp01(curiosityHits * 0.28 + Math.min(2, questions) * 0.22);
}

export function scoreEnding(lastSegmentText: string): number {
  const trimmed = lastSegmentText.trim();
  if (!trimmed) return 0;

  let score = 0.15;
  if (/[.!?]["')\]]*$/.test(trimmed)) score += 0.35;
  if (/[!?]["')\]]*$/.test(trimmed)) score += 0.15;
  if (TAKEAWAY_WORDS_RE.test(trimmed)) score += 0.35;
  if (TRAILING_FILLER_RE.test(trimmed)) score -= 0.35;

  return clamp01(score);
}

export function scoreAudioEnergy(
  startSec: number,
  endSec: number,
  energyProfile?: EnergyProfile,
  words?: WordTimestamp[],
): number {
  if (energyProfile && energyProfile.bins.length > 0 && energyProfile.binSec > 0) {
    const startIdx = Math.max(0, Math.floor(startSec / energyProfile.binSec));
    const endIdx = Math.min(energyProfile.bins.length, Math.ceil(endSec / energyProfile.binSec));
    const slice = energyProfile.bins.slice(startIdx, endIdx);

    if (slice.length > 0) {
      const globalMean =
        energyProfile.bins.reduce((acc, v) => acc + v, 0) / energyProfile.bins.length || 1e-4;
      const windowMean = slice.reduce((acc, v) => acc + v, 0) / slice.length;
      const sorted = [...slice].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? windowMean;

      const relativeMean = windowMean / Math.max(globalMean, 1e-4);
      const relativePeak = p90 / Math.max(globalMean, 1e-4);
      return clamp01((relativeMean - 0.5) * 0.45 + (relativePeak - 0.8) * 0.3);
    }
  }

  // Fallback when scoring text-only fixtures without audio PCM: speech density proxy
  if (words && endSec > startSec) {
    const wps = words.length / (endSec - startSec);
    return clamp01((wps - 1.2) / 2.2);
  }
  return 0.4;
}

export function scoreSpeechRateChange(words: WordTimestamp[]): number {
  if (words.length < 8) return 0;

  const start = words[0]!.start;
  const end = words[words.length - 1]!.end;
  const span = end - start;
  if (span < 6) return 0;

  const bucketSec = 3;
  const numBuckets = Math.max(2, Math.ceil(span / bucketSec));
  const counts = new Array<number>(numBuckets).fill(0);

  for (const w of words) {
    const idx = Math.min(numBuckets - 1, Math.max(0, Math.floor((w.start - start) / bucketSec)));
    counts[idx]! += 1;
  }

  const rates = counts.map((c) => c / bucketSec);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return 0;

  const variance = rates.reduce((acc, r) => acc + (r - mean) ** 2, 0) / rates.length;
  const stdDev = Math.sqrt(variance);
  const coeffOfVariation = stdDev / mean;

  return clamp01(coeffOfVariation * 1.4);
}

export function scoreLaughter(
  text: string,
  startSec: number,
  endSec: number,
  energyProfile?: EnergyProfile,
): number {
  const markerHits = countMatches(text, LAUGHTER_TEXT_RE);
  let score = Math.min(1, markerHits * 0.5);

  if (energyProfile && energyProfile.bins.length > 0 && energyProfile.binSec > 0) {
    const startIdx = Math.max(0, Math.floor(startSec / energyProfile.binSec));
    const endIdx = Math.min(energyProfile.bins.length, Math.ceil(endSec / energyProfile.binSec));
    const globalMean =
      energyProfile.bins.reduce((acc, v) => acc + v, 0) / energyProfile.bins.length || 1e-4;
    let spikeCount = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if ((energyProfile.bins[i] ?? 0) > globalMean * 2.1) {
        spikeCount++;
      }
    }
    if (spikeCount >= 2) {
      score = Math.max(score, Math.min(0.6, spikeCount * 0.12));
    }
  }

  return clamp01(score);
}

export function scoreTopicCoherence(segments: TranscriptSegment[]): number {
  if (segments.length <= 1) return segments.length === 1 ? 0.75 : 0;

  const tokenSets = segments.map((s) => tokenizeContentWords(s.text));
  let totalPairScore = 0;
  let pairs = 0;

  for (let i = 0; i < tokenSets.length - 1; i++) {
    const a = tokenSets[i]!;
    const b = tokenSets[i + 1]!;
    if (a.size === 0 || b.size === 0) continue;

    let intersection = 0;
    for (const token of a) {
      if (b.has(token)) intersection++;
    }
    const union = a.size + b.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    // Adjacent sentences naturally share ~10-35% content tokens when staying on topic
    totalPairScore += clamp01(jaccard * 3.5);
    pairs++;
  }

  return pairs === 0 ? 0.5 : clamp01(totalPairScore / pairs);
}

export function computeWindowFeatures(input: {
  startSec: number;
  endSec: number;
  segments: TranscriptSegment[];
  words: WordTimestamp[];
  energyProfile?: EnergyProfile;
}): ScoringFeatures {
  const { startSec, endSec, segments, words, energyProfile } = input;
  const fullText = segments.map((s) => s.text).join(' ').trim();
  const firstSentence = segments[0]?.text.trim() ?? '';
  const lastSentence = segments[segments.length - 1]?.text.trim() ?? '';
  const first3sWords = words.filter((w) => w.start < startSec + 3.0);
  const first3sText = first3sWords.map((w) => w.text).join(' ').trim();

  return {
    hook: scoreHook(first3sText, firstSentence),
    completeness: scoreCompleteness(segments, words),
    emotion: scoreEmotion(fullText),
    curiosity: scoreCuriosity(fullText),
    ending: scoreEnding(lastSentence),
    audioEnergy: scoreAudioEnergy(startSec, endSec, energyProfile, words),
    speechRateChange: scoreSpeechRateChange(words),
    laughter: scoreLaughter(fullText, startSec, endSec, energyProfile),
    topicCoherence: scoreTopicCoherence(segments),
  };
}
