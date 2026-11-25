import { describe, expect, it } from 'vitest';
import {
  computePortraitCropRect,
  sampleReframeAtTime,
} from '../../src/render/frameComposer';
import { RESOLUTION_MAP } from '../../src/render/types';

describe('RESOLUTION_MAP', () => {
  it('defines 720p preview and 1080p export 9:16 portrait dimensions', () => {
    expect(RESOLUTION_MAP['720p']).toEqual({ width: 720, height: 1280 });
    expect(RESOLUTION_MAP['1080p']).toEqual({ width: 1080, height: 1920 });
  });
});

describe('computePortraitCropRect', () => {
  it('crops 16:9 1920x1080 horizontally to 9:16 centered around centerX', () => {
    const centered = computePortraitCropRect(1920, 1080, 1080, 1920, 0.5, 0.5);
    expect(centered.sh).toBe(1080);
    expect(centered.sw).toBe(608);
    expect(centered.sx).toBe(656);
    expect(centered.sy).toBe(0);

    const leftSpeaker = computePortraitCropRect(1920, 1080, 1080, 1920, 0.1, 0.5);
    expect(leftSpeaker.sx).toBe(0);

    const rightSpeaker = computePortraitCropRect(1920, 1080, 1080, 1920, 0.95, 0.5);
    expect(rightSpeaker.sx).toBe(1920 - 608);
  });
});

describe('sampleReframeAtTime', () => {
  it('linearly interpolates centerX and centerY across keyframes', () => {
    const keyframes = [
      { timeSec: 0, centerX: 0.2, centerY: 0.4, mode: 'face-follow' as const },
      { timeSec: 4, centerX: 0.8, centerY: 0.6, mode: 'face-follow' as const },
    ];
    const mid = sampleReframeAtTime(keyframes, 2);
    expect(mid.centerX).toBeCloseTo(0.5, 5);
    expect(mid.centerY).toBeCloseTo(0.5, 5);
    expect(mid.mode).toBe('face-follow');
  });
});
