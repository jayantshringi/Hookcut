import { describe, expect, it } from 'vitest';
import {
  buildExecutionPlan,
  detectCapabilities,
  type CapabilityProbeDeps,
} from '../../src/capabilities/detectCapabilities';

function makeBaseInput(overrides: Partial<Parameters<typeof buildExecutionPlan>[0]> = {}) {
  return {
    webgpu: true,
    webcodecs: true,
    h264Encode: true,
    webWorker: true,
    webAssembly: true,
    offscreenCanvas: true,
    crossOriginIsolated: true,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    ...overrides,
  };
}

describe('buildExecutionPlan', () => {
  it('selects optimal WebGPU + Mediabunny path on capable hardware', () => {
    const { plan, warnings } = buildExecutionPlan(makeBaseInput());
    expect(plan.tier).toBe('optimal');
    expect(plan.canRun).toBe(true);
    expect(plan.asrDevice).toBe('webgpu');
    expect(plan.asrModel).toBe('onnx-community/whisper-base.en_timestamped');
    expect(plan.llmEnabled).toBe(true);
    expect(plan.videoEngine).toBe('mediabunny-webcodecs');
    expect(plan.exportHeight).toBe(1080);
    expect(warnings).toHaveLength(0);
  });

  it('falls back to WASM Whisper and skips LLM when WebGPU is absent', () => {
    const { plan, warnings } = buildExecutionPlan(makeBaseInput({ webgpu: false }));
    expect(plan.tier).toBe('standard');
    expect(plan.asrDevice).toBe('wasm');
    expect(plan.asrModel).toBe('onnx-community/whisper-tiny.en_timestamped');
    expect(plan.llmEnabled).toBe(false);
    expect(plan.llmSkipReason).toMatch(/WebGPU unavailable/i);
    expect(plan.videoEngine).toBe('mediabunny-webcodecs');
    expect(warnings.some((w) => w.code === 'no-webgpu')).toBe(true);
  });

  it('falls back to ffmpeg.wasm when WebCodecs H.264 encode is unsupported', () => {
    const { plan, warnings } = buildExecutionPlan(makeBaseInput({ h264Encode: false }));
    expect(plan.tier).toBe('constrained');
    expect(plan.videoEngine).toBe('ffmpeg-wasm');
    expect(warnings.some((w) => w.code === 'no-h264-encode')).toBe(true);
  });

  it('skips LLM and downgrades export height on very low memory (<= 2 GB)', () => {
    const { plan, warnings } = buildExecutionPlan(
      makeBaseInput({ deviceMemoryGb: 2, hardwareConcurrency: 4 }),
    );
    expect(plan.tier).toBe('constrained');
    expect(plan.llmEnabled).toBe(false);
    expect(plan.asrModel).toBe('onnx-community/whisper-tiny.en_timestamped');
    expect(plan.exportHeight).toBe(720);
    expect(warnings.some((w) => w.code === 'low-memory')).toBe(true);
  });

  it('skips LLM on 2-core devices even with WebGPU', () => {
    const { plan, warnings } = buildExecutionPlan(makeBaseInput({ hardwareConcurrency: 2 }));
    expect(plan.llmEnabled).toBe(false);
    expect(plan.llmSkipReason).toMatch(/CPU cores/i);
    expect(warnings.some((w) => w.code === 'low-cores')).toBe(true);
  });

  it('marks device unsupported when Web Workers or WebAssembly are missing', () => {
    const { plan, warnings } = buildExecutionPlan(makeBaseInput({ webWorker: false }));
    expect(plan.tier).toBe('unsupported');
    expect(plan.canRun).toBe(false);
    expect(warnings.some((w) => w.code === 'no-worker' && w.severity === 'error')).toBe(true);
  });
});

describe('detectCapabilities', () => {
  it('collects probed hardware and browser APIs via injected dependencies', async () => {
    const deps: CapabilityProbeDeps = {
      hasWorker: () => true,
      hasWebAssembly: () => true,
      hasOffscreenCanvas: () => true,
      getCrossOriginIsolated: () => true,
      hasSharedArrayBuffer: () => true,
      getDeviceMemoryGb: () => 16,
      getHardwareConcurrency: () => 12,
      estimateStorageMb: async () => 20480,
      probeWebGpu: async () => ({ available: true, adapterName: 'Mock RTX GPU' }),
      probeWebCodecs: async () => ({ available: true, h264Encode: true, aacEncode: true }),
    };

    const caps = await detectCapabilities(deps);
    expect(caps.webgpu).toBe(true);
    expect(caps.webgpuAdapterName).toBe('Mock RTX GPU');
    expect(caps.aacEncode).toBe(true);
    expect(caps.storageAvailableMb).toBe(20480);
    expect(caps.plan.tier).toBe('optimal');
  });
});
