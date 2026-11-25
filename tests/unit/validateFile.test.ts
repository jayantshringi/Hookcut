import { describe, expect, it } from 'vitest';
import {
  computeFileFingerprint,
  FileValidationError,
  validateSelectedFile,
  validateVideoDuration,
} from '../../src/media/validateFile';
import { MAX_VIDEO_DURATION_SEC, MAX_VIDEO_FILE_BYTES } from '../../src/media/types';

describe('validateSelectedFile', () => {
  it('accepts valid mp4 video within 1 GB limit', () => {
    expect(() =>
      validateSelectedFile({ name: 'podcast.mp4', size: 50 * 1024 * 1024, type: 'video/mp4' }),
    ).not.toThrow();
  });

  it('rejects empty files', () => {
    expect(() => validateSelectedFile({ name: 'empty.mp4', size: 0, type: 'video/mp4' })).toThrow(
      FileValidationError,
    );
  });

  it('rejects files exceeding 1 GB', () => {
    expect(() =>
      validateSelectedFile({
        name: 'huge.mp4',
        size: MAX_VIDEO_FILE_BYTES + 1,
        type: 'video/mp4',
      }),
    ).toThrow(/1\.00 GB/);
  });

  it('rejects non-video files', () => {
    expect(() =>
      validateSelectedFile({ name: 'notes.pdf', size: 1024, type: 'application/pdf' }),
    ).toThrow(/Unsupported file format/);
  });
});

describe('validateVideoDuration', () => {
  it('accepts durations up to 30 minutes', () => {
    expect(() => validateVideoDuration(MAX_VIDEO_DURATION_SEC)).not.toThrow();
  });

  it('rejects durations exceeding 30 minutes', () => {
    expect(() => validateVideoDuration(MAX_VIDEO_DURATION_SEC + 1)).toThrow(/30 minutes/);
  });
});

describe('computeFileFingerprint', () => {
  it('hashes head and tail slices deterministically without full read', async () => {
    const contentA = new Uint8Array(200_000);
    contentA[10] = 42;
    contentA[199_990] = 7;

    const contentB = new Uint8Array(200_000);
    contentB[10] = 42;
    contentB[199_990] = 9; // differs only in tail

    const fileA = Object.assign(new Blob([contentA]), { name: 'clip.mp4', lastModified: 100 });
    const fileB = Object.assign(new Blob([contentB]), { name: 'clip.mp4', lastModified: 100 });

    const fpA1 = await computeFileFingerprint(fileA);
    const fpA2 = await computeFileFingerprint(fileA);
    const fpB = await computeFileFingerprint(fileB);

    expect(fpA1).toBe(fpA2);
    expect(fpA1).not.toBe(fpB);
    expect(fpA1.startsWith('clip.mp4:200000:100:')).toBe(true);
  });
});
