import type { ReframeKeyframe, ReframeLayoutMode } from './types';

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Computes source crop rectangle for a target 9:16 frame given normalized center [0..1].
 */
export function computePortraitCropRect(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  centerX = 0.5,
  centerY = 0.5,
): CropRect {
  if (srcWidth <= 0 || srcHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, srcWidth), sh: Math.max(1, srcHeight) };
  }

  const targetAspect = targetWidth / targetHeight;
  const srcAspect = srcWidth / srcHeight;

  let sw: number;
  let sh: number;
  if (srcAspect > targetAspect) {
    // Source is wider than 9:16 -> crop horizontally
    sh = Math.round(srcHeight);
    sw = Math.min(srcWidth, Math.round(sh * targetAspect));
  } else {
    // Source is taller or equal -> crop vertically
    sw = Math.round(srcWidth);
    sh = Math.min(srcHeight, Math.round(sw / targetAspect));
  }

  const clampedCx = Math.max(0, Math.min(1, centerX));
  const clampedCy = Math.max(0, Math.min(1, centerY));

  const maxSx = Math.max(0, srcWidth - sw);
  const maxSy = Math.max(0, srcHeight - sh);

  const sx = Math.max(0, Math.min(maxSx, Math.round(clampedCx * srcWidth - sw / 2)));
  const sy = Math.max(0, Math.min(maxSy, Math.round(clampedCy * srcHeight - sh / 2)));

  return { sx, sy, sw, sh };
}

/**
 * Interpolates smoothed centerX/centerY and layout mode at a given clip timestamp.
 */
export function sampleReframeAtTime(
  keyframes: ReframeKeyframe[] | undefined,
  timeSec: number,
): { centerX: number; centerY: number; mode: ReframeLayoutMode } {
  if (!keyframes || keyframes.length === 0) {
    return { centerX: 0.5, centerY: 0.5, mode: 'face-follow' };
  }

  if (timeSec <= keyframes[0]!.timeSec) {
    return keyframes[0]!;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (timeSec >= last.timeSec) {
    return last;
  }

  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid]!.timeSec <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = keyframes[lo]!;
  const b = keyframes[hi]!;
  const span = Math.max(1e-6, b.timeSec - a.timeSec);
  const t = Math.max(0, Math.min(1, (timeSec - a.timeSec) / span));

  return {
    centerX: a.centerX + (b.centerX - a.centerX) * t,
    centerY: a.centerY + (b.centerY - a.centerY) * t,
    mode: t < 0.5 ? a.mode : b.mode,
  };
}

export interface DrawableFrame {
  displayWidth: number;
  displayHeight: number;
  draw: (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ) => void;
}

/**
 * Draws a frame onto the 9:16 target canvas using either face-follow crop or
 * blurred-background contain layout (for wide/multi-speaker shots).
 */
export function composePortraitFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  reframe: { centerX: number; centerY: number; mode: ReframeLayoutMode },
): void {
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  if (reframe.mode === 'blurred-background') {
    // 1. Draw blurred cover background
    const bgCrop = computePortraitCropRect(srcWidth, srcHeight, targetWidth, targetHeight, 0.5, 0.5);
    ctx.save();
    ctx.filter = 'blur(26px) brightness(0.55)';
    ctx.drawImage(
      source,
      bgCrop.sx,
      bgCrop.sy,
      bgCrop.sw,
      bgCrop.sh,
      -24,
      -24,
      targetWidth + 48,
      targetHeight + 48,
    );
    ctx.restore();

    // 2. Draw crisp centered foreground keeping full horizontal context
    const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
    const fgW = Math.round(srcWidth * scale);
    const fgH = Math.round(srcHeight * scale);
    const fgX = Math.round((targetWidth - fgW) / 2);
    const fgY = Math.round((targetHeight - fgH) / 2);

    ctx.drawImage(source, 0, 0, srcWidth, srcHeight, fgX, fgY, fgW, fgH);
    return;
  }

  const crop = computePortraitCropRect(
    srcWidth,
    srcHeight,
    targetWidth,
    targetHeight,
    reframe.centerX,
    reframe.centerY,
  );
  ctx.drawImage(
    source,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    targetWidth,
    targetHeight,
  );
}
