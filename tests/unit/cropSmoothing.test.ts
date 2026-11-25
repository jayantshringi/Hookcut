import { describe, expect, it } from 'vitest';
import {
  classifyFrameShot,
  smoothReframePath,
  type FaceDetectionSample,
} from '../../src/reframe/cropSmoothing';

describe('classifyFrameShot', () => {
  it('selects face-follow for single prominent speaker', () => {
    const shot = classifyFrameShot({
      timeSec: 0,
      faces: [{ cx: 0.72, cy: 0.45, width: 0.2, height: 0.28, score: 0.92 }],
    });
    expect(shot.mode).toBe('face-follow');
    expect(shot.centerX).toBeCloseTo(0.72, 2);
  });

  it('uses blurred-background fallback for wide shots with no faces', () => {
    const shot = classifyFrameShot({ timeSec: 0, faces: [] });
    expect(shot.mode).toBe('blurred-background');
    expect(shot.centerX).toBe(0.5);
  });

  it('uses blurred-background fallback when two speakers are both prominent in frame', () => {
    const shot = classifyFrameShot({
      timeSec: 0,
      faces: [
        { cx: 0.25, cy: 0.45, width: 0.18, height: 0.25, score: 0.9 },
        { cx: 0.75, cy: 0.46, width: 0.17, height: 0.24, score: 0.88 },
      ],
    });
    expect(shot.mode).toBe('blurred-background');
  });
});

describe('smoothReframePath', () => {
  it('suppresses micro-jitter inside dead-zone and rejects 1-frame detection spikes', () => {
    const samples: FaceDetectionSample[] = [
      { timeSec: 0.0, faces: [{ cx: 0.3, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      { timeSec: 0.25, faces: [{ cx: 0.31, cy: 0.505, width: 0.2, height: 0.25, score: 0.9 }] },
      // 1-frame outlier spike should be filtered by 3-tap median
      { timeSec: 0.5, faces: [{ cx: 0.9, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      { timeSec: 0.75, faces: [{ cx: 0.305, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      { timeSec: 1.0, faces: [{ cx: 0.295, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
    ];

    const keyframes = smoothReframePath(samples);
    expect(keyframes).toHaveLength(5);
    // Should remain locked near 0.3 with zero jump to 0.9
    for (const kf of keyframes) {
      expect(kf.centerX).toBeGreaterThan(0.28);
      expect(kf.centerX).toBeLessThan(0.33);
    }
  });

  it('rate-limits rapid speaker pans and stabilizes brief mode drops via hysteresis', () => {
    const samples: FaceDetectionSample[] = [
      { timeSec: 0.0, faces: [{ cx: 0.2, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      // Single missed detection frame (0.25s) should NOT flip mode immediately
      { timeSec: 0.25, faces: [] },
      { timeSec: 0.5, faces: [{ cx: 0.8, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      { timeSec: 0.75, faces: [{ cx: 0.8, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
      { timeSec: 1.0, faces: [{ cx: 0.8, cy: 0.5, width: 0.2, height: 0.25, score: 0.9 }] },
    ];

    const keyframes = smoothReframePath(samples, { maxPanSpeedPerSec: 0.4, minModeHoldSec: 0.75 });
    expect(keyframes.every((k) => k.mode === 'face-follow')).toBe(true);
    for (let i = 1; i < keyframes.length; i++) {
      const dt = keyframes[i]!.timeSec - keyframes[i - 1]!.timeSec;
      const dx = Math.abs(keyframes[i]!.centerX - keyframes[i - 1]!.centerX);
      expect(dx / dt).toBeLessThanOrEqual(0.41);
    }
  });
});
