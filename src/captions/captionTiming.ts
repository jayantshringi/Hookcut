import type { CaptionStylePreset } from '../render/types';
import type { WordTimestamp } from '../transcribe/types';

export interface CaptionWordItem {
  text: string;
  start: number;
  end: number;
  isEmphasized: boolean;
}

export interface CaptionCue {
  id: number;
  start: number;
  end: number;
  lines: CaptionWordItem[][];
  words: CaptionWordItem[];
}

export interface ActiveCaptionFrame {
  cue: CaptionCue;
  activeWordIndex: number; // -1 if between words inside cue
}

const EMPHASIS_POWER_RE =
  /^(?:why|never|always|secret|free|zero|truth|mistake|stop|insane|crazy|best|worst|warning|double|tripled?)$/i;
const EMPHASIS_NUMBER_RE = /\d|[$%]/;
const CLAUSE_END_RE = /[.!?,;:]$/;

export function extractEmphasisKeywords(
  words: WordTimestamp[],
  extraKeywords: string[] = [],
): Set<string> {
  const custom = new Set(extraKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const emphasized = new Set<string>();

  for (const w of words) {
    const clean = w.text.replace(/^[^a-zA-Z0-9$%]+|[^a-zA-Z0-9$%]+$/g, '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (custom.has(lower) || EMPHASIS_POWER_RE.test(lower) || EMPHASIS_NUMBER_RE.test(clean)) {
      emphasized.add(lower);
    }
  }

  return emphasized;
}

/**
 * Splits word timestamps into short-form caption cues with safe word counts per line,
 * natural pause/sentence breaks, and automatic keyword emphasis flags.
 */
export function buildCaptionCues(
  words: WordTimestamp[],
  preset: Pick<CaptionStylePreset, 'maxWordsPerLine' | 'maxLines' | 'uppercase'>,
  extraKeywords: string[] = [],
): CaptionCue[] {
  if (words.length === 0) return [];

  const maxWordsPerCue = Math.max(1, preset.maxWordsPerLine * preset.maxLines);
  const keywords = extractEmphasisKeywords(words, extraKeywords);
  const cues: CaptionCue[] = [];
  let bucket: CaptionWordItem[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const lines: CaptionWordItem[][] = [];
    for (let i = 0; i < bucket.length; i += preset.maxWordsPerLine) {
      lines.push(bucket.slice(i, i + preset.maxWordsPerLine));
    }
    cues.push({
      id: cues.length,
      start: bucket[0]!.start,
      end: bucket[bucket.length - 1]!.end,
      lines,
      words: bucket,
    });
    bucket = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = bucket[bucket.length - 1];
    if (prev && w.start - prev.end >= 0.45) {
      flush();
    }

    const cleanLower = w.text
      .replace(/^[^a-zA-Z0-9$%]+|[^a-zA-Z0-9$%]+$/g, '')
      .toLowerCase();
    const display = preset.uppercase ? w.text.toUpperCase() : w.text;

    bucket.push({
      text: display,
      start: w.start,
      end: w.end,
      isEmphasized: keywords.has(cleanLower),
    });

    if (bucket.length >= maxWordsPerCue || CLAUSE_END_RE.test(w.text)) {
      flush();
    }
  }

  flush();
  return cues;
}

/**
 * Finds the active caption cue and currently spoken word index at `timeSec`.
 */
export function getActiveCaptionCue(
  cues: CaptionCue[],
  timeSec: number,
): ActiveCaptionFrame | null {
  if (cues.length === 0) return null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    // Keep cue visible briefly across micro-gaps within same phrasing
    const nextStart = cues[i + 1]?.start ?? cue.end;
    const visibleEnd = Math.min(nextStart, cue.end + 0.15);

    if (timeSec >= cue.start - 0.04 && timeSec <= visibleEnd) {
      let activeWordIndex = -1;
      for (let wIdx = 0; wIdx < cue.words.length; wIdx++) {
        const w = cue.words[wIdx]!;
        if (timeSec >= w.start && timeSec <= w.end) {
          activeWordIndex = wIdx;
          break;
        }
        if (timeSec > w.end) {
          activeWordIndex = wIdx;
        }
      }
      return { cue, activeWordIndex };
    }
  }

  return null;
}
