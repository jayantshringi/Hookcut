import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transcript, TranscriptSegment, WordTimestamp } from '../src/transcribe/types';
import { SCORING_CONFIG } from '../src/scoring/config';
import { scoreTranscriptCandidates } from '../src/scoring/candidates';

function buildFixtureTranscript(): Transcript {
  const samplePath = resolve(process.cwd(), 'fixtures/sample-transcript.json');
  const shortSample = JSON.parse(readFileSync(samplePath, 'utf8')) as Transcript;

  // Also synthesize a 150-second multi-segment creator podcast transcript for weight tuning
  const rawSegments: Array<{ start: number; end: number; text: string }> = [
    { start: 1.0, end: 9.0, text: 'Welcome back everybody, uh, let me check if the mic is working today.' },
    { start: 12.0, end: 22.0, text: 'As I said earlier, we moved apartments last month and unpacked boxes, uh.' },
    { start: 23.0, end: 28.5, text: 'Why did our tiny browser app beat a cloud startup burning 200k every month?' },
    { start: 29.0, end: 36.5, text: 'Most people think you need GPUs in the cloud, but WebGPU changed everything!' },
    { start: 37.0, end: 44.5, text: 'Instead of uploading video files, the browser decodes frames right on your laptop.' },
    { start: 45.0, end: 52.0, text: 'Wait until you hear the crazy part: zero server cost, haha, that is the whole secret!' },
    { start: 53.0, end: 64.0, text: 'Yeah so anyway, let me open another tab and look at some random bookmarks here.' },
    { start: 70.0, end: 81.0, text: 'Three years ago I almost deleted my entire codebase after losing my first 50 users.' },
    { start: 81.5, end: 91.0, text: 'Honestly it was terrifying because nobody told me how brutal retention drops are.' },
    { start: 91.5, end: 101.0, text: 'The hidden reason was our hook took twelve seconds before delivering any real payoff.' },
    { start: 101.5, end: 110.0, text: 'That is why cutting the first pause doubled our watch time overnight!' },
    { start: 115.0, end: 129.0, text: 'Um, let us talk about keyboard shortcuts and monitor stands for a little while, yeah.' },
  ];

  const segments: TranscriptSegment[] = rawSegments.map((seg, id) => {
    const tokens = seg.text.split(/\s+/);
    const dur = (seg.end - seg.start) / Math.max(1, tokens.length);
    const words: WordTimestamp[] = tokens.map((token, idx) => ({
      text: token,
      start: Math.round((seg.start + idx * dur) * 100) / 100,
      end: Math.round((seg.start + (idx + 0.9) * dur) * 100) / 100,
    }));
    return {
      id,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      words,
    };
  });

  if (!shortSample.words.length) {
    throw new Error('Sample transcript fixture must contain words');
  }

  return {
    fileFingerprint: 'eval-podcast:1:1:eval',
    modelId: 'eval-synthetic',
    language: 'en',
    durationSec: 135,
    text: segments.map((s) => s.text).join(' '),
    words: segments.flatMap((s) => s.words),
    segments,
    createdAt: Date.now(),
  };
}

function main() {
  const inputPath = process.argv[2];
  const transcript = inputPath
    ? (JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8')) as Transcript)
    : buildFixtureTranscript();

  const candidates = scoreTranscriptCandidates(transcript, {
    config: SCORING_CONFIG,
  });

  console.log(`\nHookcut Scoring Evaluation (${candidates.length} candidates, config v${SCORING_CONFIG.version})\n`);
  candidates.forEach((clip, idx) => {
    console.log(
      `#${idx + 1} [${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s | ${clip.duration.toFixed(1)}s] Score: ${clip.heuristicScore.toFixed(1)}/100 (raw=${clip.rawWeightedScore.toFixed(3)}, penalty=-${clip.penalties.totalPenalty.toFixed(3)})`,
    );
    console.log(`   Hook: "${clip.firstLine}"`);
    const featSummary = Object.entries(clip.features)
      .map(([k, v]) => `${k}=${v.toFixed(2)}`)
      .join(' ');
    console.log(`   Features: ${featSummary}\n`);
  });
}

main();
