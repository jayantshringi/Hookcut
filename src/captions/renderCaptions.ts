import type { CaptionRenderSpec } from '../render/types';
import {
  buildCaptionCues,
  getActiveCaptionCue,
  type CaptionCue,
  type CaptionWordItem,
} from './captionTiming';
import { getCaptionPreset } from './presets';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws word-by-word highlighted captions onto a 2D or OffscreenCanvas context,
 * respecting safe margins (8% horizontal, >=18% bottom) and keyword emphasis.
 */
export function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  spec: CaptionRenderSpec,
  precomputedCues?: CaptionCue[],
): void {
  if (!spec.enabled || spec.words.length === 0) return;

  const preset = getCaptionPreset(spec.presetId);
  const cues =
    precomputedCues ??
    buildCaptionCues(spec.words, preset, spec.emphasisKeywords ?? []);

  const activeFrame = getActiveCaptionCue(cues, timeSec);
  if (!activeFrame) return;

  const { cue, activeWordIndex } = activeFrame;
  const baseFontPx = Math.max(18, Math.round(height * preset.fontSizePct));
  const lineHeight = Math.round(baseFontPx * 1.28);
  const safeBottomPx = Math.round(height * (1 - preset.bottomMarginPct));
  const safeMaxWidth = Math.round(width * 0.84); // 8% horizontal safe margin on each side
  const scaleFactor = height / 1920;
  const strokePx = Math.max(2, Math.round(preset.strokeWidthPx * scaleFactor));

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  let globalWordIdx = 0;
  const totalLines = cue.lines.length;
  const topY = safeBottomPx - (totalLines - 1) * lineHeight - lineHeight / 2;

  for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
    const lineWords = cue.lines[lineIdx]!;
    const lineY = topY + lineIdx * lineHeight;

    // Measure word widths so we can center the entire line inside safe margins
    const measurements: Array<{
      word: CaptionWordItem;
      width: number;
      fontPx: number;
      isActive: boolean;
    }> = [];

    const spaceWidth = Math.round(baseFontPx * 0.34);
    let totalLineWidth = 0;

    for (let wIdx = 0; wIdx < lineWords.length; wIdx++) {
      const word = lineWords[wIdx]!;
      const isActive = globalWordIdx + wIdx === activeWordIndex;
      const fontPx = word.isEmphasized || isActive ? Math.round(baseFontPx * 1.07) : baseFontPx;
      ctx.font = `${preset.fontWeight} ${fontPx}px ${preset.fontFamily}`;
      const metrics = ctx.measureText(word.text);
      const wWidth = metrics.width;
      measurements.push({ word, width: wWidth, fontPx, isActive });
      totalLineWidth += wWidth + (wIdx > 0 ? spaceWidth : 0);
    }

    // Uniformly scale down line spacing/font if an extra-long word exceeds safe width
    const fitScale = totalLineWidth > safeMaxWidth ? safeMaxWidth / totalLineWidth : 1;
    let cursorX = (width - totalLineWidth * fitScale) / 2;

    if (preset.id === 'studio-box') {
      const padX = Math.round(18 * scaleFactor);
      const padY = Math.round(10 * scaleFactor);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.72)';
      drawRoundedRect(
        ctx,
        cursorX - padX,
        lineY - lineHeight / 2 - padY * 0.25,
        totalLineWidth * fitScale + padX * 2,
        lineHeight + padY * 0.5,
        Math.round(14 * scaleFactor),
      );
      ctx.fill();
    }

    for (let wIdx = 0; wIdx < measurements.length; wIdx++) {
      const m = measurements[wIdx]!;
      const scaledFontPx = Math.max(14, Math.round(m.fontPx * fitScale));
      const wordW = m.width * fitScale;
      ctx.font = `${preset.fontWeight} ${scaledFontPx}px ${preset.fontFamily}`;

      if (m.isActive && preset.activeBgColor) {
        const pillPadX = Math.round(12 * scaleFactor);
        const pillPadY = Math.round(8 * scaleFactor);
        ctx.fillStyle = preset.activeBgColor;
        drawRoundedRect(
          ctx,
          cursorX - pillPadX,
          lineY - scaledFontPx * 0.58 - pillPadY * 0.35,
          wordW + pillPadX * 2,
          scaledFontPx * 1.16 + pillPadY * 0.7,
          Math.round(12 * scaleFactor),
        );
        ctx.fill();
      }

      ctx.shadowColor = preset.shadowColor;
      ctx.shadowBlur = Math.round(10 * scaleFactor);
      ctx.shadowOffsetY = Math.round(3 * scaleFactor);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = preset.strokeColor;
      ctx.lineWidth = strokePx;
      ctx.strokeText(m.word.text, cursorX, lineY);

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = m.isActive
        ? preset.activeWordColor
        : m.word.isEmphasized
          ? '#FDE047'
          : preset.textColor;
      ctx.fillText(m.word.text, cursorX, lineY);

      cursorX += wordW + spaceWidth * fitScale;
    }

    globalWordIdx += lineWords.length;
  }

  ctx.restore();
}
