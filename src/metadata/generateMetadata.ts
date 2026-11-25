import type { CandidateClip } from '../scoring/types';

export interface ClipMetadata {
  title: string;
  description: string;
  hashtags: string[];
  hookLine: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were', 'have',
  'has', 'had', 'not', 'but', 'what', 'why', 'how', 'when', 'where', 'who', 'which', 'from',
  'they', 'their', 'them', 'there', 'here', 'just', 'like', 'about', 'into', 'than', 'then',
  'most', 'more', 'some', 'such', 'only', 'very', 'really', 'actually', 'because', 'instead',
  'before', 'after', 'could', 'would', 'should', 'will', 'can', 'did', 'does', 'doing', 'done',
  'being', 'been', 'every', 'everyone', 'everything', 'people', 'thing', 'things', 'make',
  'made', 'know', 'think', 'want', 'going', 'said', 'says', 'wait', 'until', 'hear',
]);

function truncateAtWord(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > maxLen * 0.5 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.replace(/[,:;.\-!?]+$/, '')}…`;
}

export function extractHashtags(text: string, maxTags = 6): string[] {
  const counts = new Map<string, number>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  for (const w of words) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  const rankedWords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => `#${w}`);

  const defaults = ['#shorts', '#reels', '#clips'];
  const combined: string[] = [];
  const seen = new Set<string>();

  for (const tag of [...rankedWords.slice(0, Math.max(2, maxTags - 2)), ...defaults]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    combined.push(tag);
    if (combined.length >= maxTags) break;
  }

  return combined;
}

/**
 * Generates a title (<= 60 chars), concise description, and hashtags locally
 * from the clip's transcript and optional LLM title.
 */
export function generateClipMetadata(clip: CandidateClip): ClipMetadata {
  const hookLine = (clip.llmHookLine || clip.firstLine || '').trim();
  const titleSource = clip.llmTitle?.trim() || hookLine || clip.text;
  const cleanedTitle = titleSource
    .replace(/^(?:uh+|um+|so|and|well)[,\s]+/i, '')
    .replace(/[.!?]+$/, '');
  const title = truncateAtWord(cleanedTitle || 'Highlight Short', 60);

  const summaryBody =
    clip.llmReason?.trim() ||
    truncateAtWord(
      clip.segments.length > 1
        ? clip.segments.slice(0, 2).map((s) => s.text).join(' ')
        : clip.text,
      180,
    );

  const hashtags = extractHashtags(clip.text, 6);
  const description = `${summaryBody}\n\n${hashtags.join(' ')}`;

  return {
    title,
    description,
    hashtags,
    hookLine,
  };
}
