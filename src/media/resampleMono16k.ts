import { DEFAULT_AUDIO_CHUNK_SEC, ENERGY_BIN_SEC, TARGET_ASR_SAMPLE_RATE, type AudioChunk } from './types';

/**
 * Downmixes interleaved multi-channel f32 PCM to mono and resamples to 16 kHz.
 * Uses box-averaging downsampling when sourceRate > targetRate to prevent aliasing.
 */
export function downmixAndResampleToMono(
  interleaved: Float32Array,
  sourceSampleRate: number,
  numberOfChannels: number,
  targetSampleRate = TARGET_ASR_SAMPLE_RATE,
): Float32Array {
  if (sourceSampleRate <= 0 || numberOfChannels <= 0 || interleaved.length === 0) {
    return new Float32Array(0);
  }

  const sourceFrameCount = Math.floor(interleaved.length / numberOfChannels);
  if (sourceFrameCount === 0) return new Float32Array(0);

  const mono = new Float32Array(sourceFrameCount);
  if (numberOfChannels === 1) {
    mono.set(interleaved.subarray(0, sourceFrameCount));
  } else {
    const invChannels = 1 / numberOfChannels;
    for (let i = 0; i < sourceFrameCount; i++) {
      let sum = 0;
      const base = i * numberOfChannels;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        sum += interleaved[base + ch]!;
      }
      mono[i] = sum * invChannels;
    }
  }

  if (sourceSampleRate === targetSampleRate) {
    return mono;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outLength = Math.max(1, Math.round(sourceFrameCount / ratio));
  const out = new Float32Array(outLength);

  if (ratio > 1) {
    // Box-averaged downsampling preserves speech energy and suppresses aliasing
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(sourceFrameCount, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let acc = 0;
      for (let j = start; j < end; j++) {
        acc += mono[j]!;
      }
      out[i] = acc / (end - start);
    }
  } else {
    // Linear interpolation for upsampling
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = mono[Math.min(idx, sourceFrameCount - 1)]!;
      const b = mono[Math.min(idx + 1, sourceFrameCount - 1)]!;
      out[i] = a + (b - a) * frac;
    }
  }

  return out;
}

/**
 * Computes fixed-duration RMS energy bins (0..1+) across mono PCM samples.
 */
export function computeRmsEnergyBins(
  monoSamples: Float32Array,
  sampleRate = TARGET_ASR_SAMPLE_RATE,
  binDurationSec = ENERGY_BIN_SEC,
): number[] {
  if (monoSamples.length === 0 || sampleRate <= 0 || binDurationSec <= 0) {
    return [];
  }

  const binSamples = Math.max(1, Math.round(sampleRate * binDurationSec));
  const bins: number[] = [];

  for (let offset = 0; offset < monoSamples.length; offset += binSamples) {
    const end = Math.min(monoSamples.length, offset + binSamples);
    let sqSum = 0;
    for (let i = offset; i < end; i++) {
      const s = monoSamples[i]!;
      sqSum += s * s;
    }
    bins.push(Math.sqrt(sqSum / (end - offset)));
  }

  return bins;
}

/**
 * Accumulates streamed 16 kHz mono frames into bounded chunks so peak worker allocation stays low.
 */
export class MonoAudioChunker {
  private readonly chunkSamples: number;
  private readonly sampleRate: number;
  private pending: Float32Array[] = [];
  private pendingLength = 0;
  private emittedSamples = 0;
  private chunkIndex = 0;

  constructor(
    chunkDurationSec = DEFAULT_AUDIO_CHUNK_SEC,
    sampleRate = TARGET_ASR_SAMPLE_RATE,
  ) {
    this.sampleRate = sampleRate;
    this.chunkSamples = Math.max(1, Math.round(chunkDurationSec * sampleRate));
  }

  push(samples: Float32Array): AudioChunk[] {
    if (samples.length === 0) return [];
    this.pending.push(samples);
    this.pendingLength += samples.length;

    const ready: AudioChunk[] = [];
    while (this.pendingLength >= this.chunkSamples) {
      ready.push(this.drain(this.chunkSamples));
    }
    return ready;
  }

  flush(): AudioChunk | null {
    if (this.pendingLength === 0) return null;
    return this.drain(this.pendingLength);
  }

  private drain(count: number): AudioChunk {
    const out = new Float32Array(count);
    let written = 0;

    while (written < count && this.pending.length > 0) {
      const head = this.pending[0]!;
      const needed = count - written;
      if (head.length <= needed) {
        out.set(head, written);
        written += head.length;
        this.pending.shift();
      } else {
        out.set(head.subarray(0, needed), written);
        this.pending[0] = head.subarray(needed);
        written += needed;
      }
    }

    this.pendingLength -= count;
    const startSec = this.emittedSamples / this.sampleRate;
    this.emittedSamples += count;
    const endSec = this.emittedSamples / this.sampleRate;

    return {
      index: this.chunkIndex++,
      startSec,
      endSec,
      samples: out,
    };
  }
}
