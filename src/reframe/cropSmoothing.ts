import type { ReframeKeyframe, ReframeLayoutMode } from '../render/types';

export interface NormalizedFaceBox {
  /** Normalized center X [0..1] */
  cx: number;
  /** Normalized center Y [0..1] */
  cy: number;
  /** Normalized width [0..1] */
  width: number;
  /** Normalized height [0..1] */
  height: number;
  score: number;
}

export interface FaceDetectionSample {
  timeSec: number;
  faces: NormalizedFaceBox[];
}

export interface CropSmoothingOptions {
  /** EMA smoothing factor alpha in (0, 1]. Lower = smoother. */
  emaAlpha?: number;
  /** Dead-zone radius [0..1] below which micro head movements do not pan crop */
  deadZone?: number;
  /** Maximum normalized horizontal/vertical pan velocity per second */
  maxPanSpeedPerSec?: number;
  /** Minimum seconds before switching between face-follow and blurred-background */
  minModeHoldSec?: number;
  /** Minimum face width [0..1] considered close enough for face-follow */
  minFaceWidthRatio?: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function areaOf(face: NormalizedFaceBox): number {
  return Math.max(0, face.width) * Math.max(0, face.height);
}

/**
 * Chooses shot framing for a single sampled frame:
 * - Single prominent speaker -> 'face-follow' centered on speaker's head/upper chest
 * - Wide shot (no face / tiny distant face) or multi-speaker shot -> 'blurred-background'
 */
export function classifyFrameShot(
  sample: FaceDetectionSample,
  minFaceWidthRatio = 0.04,
): { centerX: number; centerY: number; mode: ReframeLayoutMode } {
  const validFaces = sample.faces
    .filter((f) => f.score >= 0.45 && f.width >= minFaceWidthRatio && f.height >= minFaceWidthRatio)
    .sort((a, b) => areaOf(b) - areaOf(a));

  if (validFaces.length === 0) {
    return { centerX: 0.5, centerY: 0.5, mode: 'blurred-background' };
  }

  const primary = validFaces[0]!;
  if (validFaces.length >= 2) {
    const secondary = validFaces[1]!;
    const sizeRatio = areaOf(secondary) / Math.max(1e-6, areaOf(primary));
    const horizontalGap = Math.abs(secondary.cx - primary.cx);
    // Multiple prominent speakers separated in frame -> show full wide context via blurred background
    if (sizeRatio >= 0.48 && horizontalGap >= 0.16) {
      return { centerX: 0.5, centerY: 0.5, mode: 'blurred-background' };
    }
  }

  // Slight upward bias places eyes near upper-third rule of 9:16 frame
  return {
    centerX: clamp01(primary.cx),
    centerY: clamp01(primary.cy - primary.height * 0.05),
    mode: 'face-follow',
  };
}

/**
 * Rejects single-frame outlier spikes (e.g., transient false detections) via 3-tap median.
 */
function median3(a: number, b: number, c: number): number {
  return [a, b, c].sort((x, y) => x - y)[1]!;
}

/**
 * Generates jitter-free, rate-limited, hysteresis-stabilized 9:16 crop keyframes
 * from ~4 fps face detection samples.
 */
export function smoothReframePath(
  samples: FaceDetectionSample[],
  options: CropSmoothingOptions = {},
): ReframeKeyframe[] {
  if (samples.length === 0) {
    return [{ timeSec: 0, centerX: 0.5, centerY: 0.5, mode: 'face-follow' }];
  }

  const emaAlpha = options.emaAlpha ?? 0.28;
  const deadZone = options.deadZone ?? 0.03;
  const maxPanSpeedPerSec = options.maxPanSpeedPerSec ?? 0.45;
  const minModeHoldSec = options.minModeHoldSec ?? 0.75;
  const minFaceWidthRatio = options.minFaceWidthRatio ?? 0.04;

  const sorted = [...samples].sort((a, b) => a.timeSec - b.timeSec);
  const raw = sorted.map((s) => ({
    timeSec: s.timeSec,
    ...classifyFrameShot(s, minFaceWidthRatio),
  }));

  // 1. 3-tap median filter on center coordinates to eliminate 1-frame outliers
  const demed = raw.map((item, idx) => {
    if (idx === 0 || idx === raw.length - 1) return { ...item };
    const prev = raw[idx - 1]!;
    const next = raw[idx + 1]!;
    return {
      ...item,
      centerX: median3(prev.centerX, item.centerX, next.centerX),
      centerY: median3(prev.centerY, item.centerY, next.centerY),
    };
  });

  // 2. Mode hysteresis + dead-zone + velocity-clamped EMA smoothing
  const result: ReframeKeyframe[] = [];
  let curX = demed[0]!.centerX;
  let curY = demed[0]!.centerY;
  let activeMode: ReframeLayoutMode = demed[0]!.mode;
  let candidateMode: ReframeLayoutMode | null = null;
  let candidateModeSince = demed[0]!.timeSec;

  result.push({
    timeSec: demed[0]!.timeSec,
    centerX: Math.round(curX * 10000) / 10000,
    centerY: Math.round(curY * 10000) / 10000,
    mode: activeMode,
  });

  for (let i = 1; i < demed.length; i++) {
    const step = demed[i]!;
    const dt = Math.max(0.05, step.timeSec - demed[i - 1]!.timeSec);

    if (step.mode !== activeMode) {
      if (candidateMode !== step.mode) {
        candidateMode = step.mode;
        candidateModeSince = step.timeSec;
      } else if (step.timeSec - candidateModeSince >= minModeHoldSec) {
        activeMode = step.mode;
        candidateMode = null;
      }
    } else {
      candidateMode = null;
    }

    const targetX = activeMode === 'blurred-background' ? 0.5 : step.centerX;
    const targetY = activeMode === 'blurred-background' ? 0.5 : step.centerY;

    const dx = targetX - curX;
    const dy = targetY - curY;
    const dist = Math.hypot(dx, dy);

    if (dist > deadZone) {
      const emaX = curX + emaAlpha * dx;
      const emaY = curY + emaAlpha * dy;
      const maxStep = maxPanSpeedPerSec * dt;
      const stepDist = Math.hypot(emaX - curX, emaY - curY);

      if (stepDist > maxStep && stepDist > 1e-6) {
        const scale = maxStep / stepDist;
        curX += (emaX - curX) * scale;
        curY += (emaY - curY) * scale;
      } else {
        curX = emaX;
        curY = emaY;
      }
    }

    result.push({
      timeSec: step.timeSec,
      centerX: Math.round(clamp01(curX) * 10000) / 10000,
      centerY: Math.round(clamp01(curY) * 10000) / 10000,
      mode: activeMode,
    });
  }

  return result;
}
