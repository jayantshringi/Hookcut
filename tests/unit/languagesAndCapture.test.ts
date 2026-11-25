import { describe, expect, it } from 'vitest';
import { formatRecordingDuration, isTabCaptureSupported } from '../../src/media/tabCapture';
import { selectAsrModelForLanguage, WHISPER_LANGUAGES } from '../../src/transcribe/languages';

describe('selectAsrModelForLanguage', () => {
  it('keeps .en_timestamped models for English and switches to multilingual _timestamped for others', () => {
    expect(selectAsrModelForLanguage('onnx-community/whisper-tiny.en_timestamped', 'en')).toBe(
      'onnx-community/whisper-tiny.en_timestamped',
    );
    expect(selectAsrModelForLanguage('onnx-community/whisper-tiny.en_timestamped', 'hi')).toBe(
      'onnx-community/whisper-tiny_timestamped',
    );
    expect(selectAsrModelForLanguage('onnx-community/whisper-base.en_timestamped', 'es')).toBe(
      'onnx-community/whisper-base_timestamped',
    );
    expect(WHISPER_LANGUAGES.some((l) => l.code === 'hi')).toBe(true);
  });
});

describe('tabCapture helpers', () => {
  it('formats elapsed recording duration and detects support safely', () => {
    expect(formatRecordingDuration(0)).toBe('0:00');
    expect(formatRecordingDuration(65)).toBe('1:05');
    expect(typeof isTabCaptureSupported()).toBe('boolean');
  });
});
