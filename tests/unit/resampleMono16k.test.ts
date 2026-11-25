import { describe, expect, it } from 'vitest';
import {
  computeRmsEnergyBins,
  downmixAndResampleToMono,
  MonoAudioChunker,
} from '../../src/media/resampleMono16k';

describe('downmixAndResampleToMono', () => {
  it('downmixes stereo 48 kHz sine wave to 16 kHz mono preserving length and amplitude', () => {
    const srcRate = 48_000;
    const durationSec = 1;
    const freqHz = 440;
    const stereo = new Float32Array(srcRate * durationSec * 2);

    for (let i = 0; i < srcRate * durationSec; i++) {
      const sample = Math.sin((2 * Math.PI * freqHz * i) / srcRate);
      stereo[i * 2] = sample;
      stereo[i * 2 + 1] = sample;
    }

    const mono16k = downmixAndResampleToMono(stereo, srcRate, 2, 16_000);
    expect(mono16k.length).toBe(16_000);

    let sqSum = 0;
    for (let i = 0; i < mono16k.length; i++) {
      sqSum += mono16k[i]! * mono16k[i]!;
    }
    const rms = Math.sqrt(sqSum / mono16k.length);
    // 440 Hz sine wave RMS ~ 0.707; box averaging at 3:1 slightly attenuates < 2%
    expect(rms).toBeGreaterThan(0.68);
    expect(rms).toBeLessThan(0.73);
  });

  it('handles 44.1 kHz to 16 kHz resampling cleanly', () => {
    const mono44 = new Float32Array(44_100).fill(0.5);
    const out = downmixAndResampleToMono(mono44, 44_100, 1, 16_000);
    expect(out.length).toBe(16_000);
    expect(out[100]).toBeCloseTo(0.5, 4);
  });
});

describe('computeRmsEnergyBins', () => {
  it('computes per-bin RMS across quiet and loud segments', () => {
    const samples = new Float32Array(16_000); // 1 second
    samples.fill(0.0, 0, 8_000); // first 0.5s silent
    samples.fill(0.5, 8_000, 16_000); // second 0.5s constant 0.5

    const bins = computeRmsEnergyBins(samples, 16_000, 0.25);
    expect(bins).toHaveLength(4);
    expect(bins[0]).toBe(0);
    expect(bins[1]).toBe(0);
    expect(bins[2]).toBeCloseTo(0.5, 4);
    expect(bins[3]).toBeCloseTo(0.5, 4);
  });
});

describe('MonoAudioChunker', () => {
  it('splits streamed audio into exact fixed chunks and flushes remainder', () => {
    const chunker = new MonoAudioChunker(1, 16_000); // 1s chunks for test
    const first = chunker.push(new Float32Array(10_000).fill(1));
    expect(first).toHaveLength(0);

    const second = chunker.push(new Float32Array(25_000).fill(2));
    expect(second).toHaveLength(2);
    expect(second[0]!.index).toBe(0);
    expect(second[0]!.startSec).toBe(0);
    expect(second[0]!.endSec).toBe(1);
    expect(second[0]!.samples).toHaveLength(16_000);

    expect(second[1]!.index).toBe(1);
    expect(second[1]!.startSec).toBe(1);
    expect(second[1]!.endSec).toBe(2);

    const tail = chunker.flush();
    expect(tail).not.toBeNull();
    expect(tail!.index).toBe(2);
    expect(tail!.samples).toHaveLength(3_000);
    expect(tail!.startSec).toBe(2);
    expect(tail!.endSec).toBeCloseTo(2.1875, 4);
  });
});
