import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCachedTranscripts,
  getCachedTranscript,
  saveCachedTranscript,
} from '../../src/transcribe/transcriptCache';
import type { Transcript } from '../../src/transcribe/types';

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    fileFingerprint: 'sample.mp4:1024:100:abcd1234',
    modelId: 'onnx-community/whisper-tiny.en',
    language: 'en',
    durationSec: 12,
    text: 'Hello world.',
    words: [
      { text: 'Hello', start: 0.1, end: 0.5 },
      { text: 'world.', start: 0.5, end: 1.1 },
    ],
    segments: [
      {
        id: 0,
        start: 0.1,
        end: 1.1,
        text: 'Hello world.',
        words: [
          { text: 'Hello', start: 0.1, end: 0.5 },
          { text: 'world.', start: 0.5, end: 1.1 },
        ],
      },
    ],
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('transcriptCache', () => {
  beforeEach(async () => {
    await clearCachedTranscripts();
  });

  it('saves, retrieves, and clears transcripts keyed by fingerprint and model', async () => {
    const t = makeTranscript();
    expect(await getCachedTranscript(t.fileFingerprint, t.modelId)).toBeNull();

    await saveCachedTranscript(t);
    const loaded = await getCachedTranscript(t.fileFingerprint, t.modelId);
    expect(loaded).toEqual(t);

    expect(await getCachedTranscript(t.fileFingerprint, 'other-model')).toBeNull();

    await clearCachedTranscripts();
    expect(await getCachedTranscript(t.fileFingerprint, t.modelId)).toBeNull();
  });
});
