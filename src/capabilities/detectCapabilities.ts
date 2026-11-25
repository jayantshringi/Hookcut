import type {
  CapabilityWarning,
  CompatibilityTier,
  DeviceCapabilities,
  ExecutionPlan,
} from './types';

export interface CapabilityProbeDeps {
  hasWorker?: () => boolean;
  hasWebAssembly?: () => boolean;
  hasOffscreenCanvas?: () => boolean;
  getCrossOriginIsolated?: () => boolean;
  hasSharedArrayBuffer?: () => boolean;
  getDeviceMemoryGb?: () => number | null;
  getHardwareConcurrency?: () => number | null;
  estimateStorageMb?: () => Promise<number | null>;
  probeWebGpu?: () => Promise<{ available: boolean; adapterName: string | null }>;
  probeWebCodecs?: () => Promise<{
    available: boolean;
    h264Encode: boolean;
    aacEncode: boolean;
  }>;
}

const DEFAULT_ASR_BASE_MODEL = 'onnx-community/whisper-base.en_timestamped';
const DEFAULT_ASR_TINY_MODEL = 'onnx-community/whisper-tiny.en_timestamped';
const DEFAULT_LLM_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

async function defaultProbeWebGpu(): Promise<{ available: boolean; adapterName: string | null }> {
  const nav = globalThis.navigator as Navigator & {
    gpu?: {
      requestAdapter: () => Promise<{ info?: { description?: string; vendor?: string } } | null>;
    };
  };

  if (!nav?.gpu || typeof nav.gpu.requestAdapter !== 'function') {
    return { available: false, adapterName: null };
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return { available: false, adapterName: null };
    }
    const desc = adapter.info?.description || adapter.info?.vendor || 'WebGPU Adapter';
    return { available: true, adapterName: desc };
  } catch {
    return { available: false, adapterName: null };
  }
}

async function defaultProbeWebCodecs(): Promise<{
  available: boolean;
  h264Encode: boolean;
  aacEncode: boolean;
}> {
  const hasApis =
    typeof globalThis.VideoDecoder === 'function' &&
    typeof globalThis.VideoEncoder === 'function' &&
    typeof globalThis.AudioDecoder === 'function' &&
    typeof globalThis.AudioEncoder === 'function';

  if (!hasApis) {
    return { available: false, h264Encode: false, aacEncode: false };
  }

  let h264Encode: boolean;
  let aacEncode: boolean;

  try {
    const videoSupport = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: 720,
      height: 1280,
      bitrate: 3_000_000,
      framerate: 30,
    });
    h264Encode = Boolean(videoSupport.supported);
  } catch {
    h264Encode = false;
  }

  try {
    const audioSupport = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    aacEncode = Boolean(audioSupport.supported);
  } catch {
    aacEncode = false;
  }

  return { available: true, h264Encode, aacEncode };
}

async function defaultEstimateStorageMb(): Promise<number | null> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (!estimate || typeof estimate.quota !== 'number') return null;
    const used = typeof estimate.usage === 'number' ? estimate.usage : 0;
    return Math.max(0, Math.round((estimate.quota - used) / (1024 * 1024)));
  } catch {
    return null;
  }
}

/**
 * Evaluates execution path and compatibility tier from probed hardware/browser flags.
 */
export function buildExecutionPlan(input: {
  webgpu: boolean;
  webcodecs: boolean;
  h264Encode: boolean;
  webWorker: boolean;
  webAssembly: boolean;
  offscreenCanvas: boolean;
  crossOriginIsolated: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
}): { plan: ExecutionPlan; warnings: CapabilityWarning[] } {
  const warnings: CapabilityWarning[] = [];

  if (!input.webWorker) {
    warnings.push({
      code: 'no-worker',
      severity: 'error',
      message: 'Web Workers are unavailable in this browser. Hookcut requires Web Workers.',
    });
  }

  if (!input.webAssembly) {
    warnings.push({
      code: 'no-wasm',
      severity: 'error',
      message: 'WebAssembly is required for local AI transcription and face detection.',
    });
  }

  if (!input.webgpu) {
    warnings.push({
      code: 'no-webgpu',
      severity: 'info',
      message:
        'WebGPU is unavailable. Transcription will use the WASM fallback, and local LLM re-ranking is skipped for speed.',
    });
  }

  if (!input.webcodecs) {
    warnings.push({
      code: 'no-webcodecs',
      severity: 'warning',
      message:
        'WebCodecs is unavailable. Video export will lazy-load the ffmpeg.wasm fallback.',
    });
  } else if (!input.h264Encode) {
    warnings.push({
      code: 'no-h264-encode',
      severity: 'warning',
      message:
        'Hardware/WebCodecs H.264 encoding is unsupported here. Export will use the ffmpeg.wasm fallback.',
    });
  }

  const isLowMemory = input.deviceMemoryGb !== null && input.deviceMemoryGb <= 4;
  const isVeryLowMemory = input.deviceMemoryGb !== null && input.deviceMemoryGb <= 2;
  const isLowCores = input.hardwareConcurrency !== null && input.hardwareConcurrency <= 2;

  if (isLowMemory) {
    warnings.push({
      code: 'low-memory',
      severity: isVeryLowMemory ? 'warning' : 'info',
      message: `Device reports ~${input.deviceMemoryGb} GB RAM. Using compact models and streaming buffers to avoid out-of-memory errors.`,
    });
  }

  if (isLowCores) {
    warnings.push({
      code: 'low-cores',
      severity: 'info',
      message: `Device reports ${input.hardwareConcurrency} CPU cores. Expect slower export and WASM processing.`,
    });
  }

  if (!input.crossOriginIsolated) {
    warnings.push({
      code: 'no-cross-origin-isolation',
      severity: 'info',
      message:
        'Cross-origin isolation (COOP/COEP) is inactive. Multi-threaded WASM fallback may run single-threaded.',
    });
  }

  const canRun = input.webWorker && input.webAssembly;
  const useMediabunny = input.webcodecs && input.h264Encode && input.offscreenCanvas;
  const videoEngine = useMediabunny ? 'mediabunny-webcodecs' : 'ffmpeg-wasm';
  const asrDevice = input.webgpu ? 'webgpu' : 'wasm';

  const memoryAllowsBaseWhisper = input.deviceMemoryGb === null || input.deviceMemoryGb >= 4;
  const asrModel =
    input.webgpu && memoryAllowsBaseWhisper ? DEFAULT_ASR_BASE_MODEL : DEFAULT_ASR_TINY_MODEL;

  const memoryAllowsLlm = input.deviceMemoryGb === null || input.deviceMemoryGb >= 6;
  const coresAllowLlm = input.hardwareConcurrency === null || input.hardwareConcurrency >= 4;
  const llmEnabled = input.webgpu && memoryAllowsLlm && coresAllowLlm;

  let llmSkipReason: string | undefined;
  if (!llmEnabled) {
    if (!input.webgpu) {
      llmSkipReason = 'WebGPU unavailable — using fast heuristic highlight scoring.';
    } else if (!memoryAllowsLlm) {
      llmSkipReason = `Insufficient reported RAM (${input.deviceMemoryGb} GB < 6 GB) — skipping local LLM.`;
    } else if (!coresAllowLlm) {
      llmSkipReason = `Limited CPU cores (${input.hardwareConcurrency} < 4) — skipping local LLM.`;
    }
  }

  let tier: CompatibilityTier = 'optimal';
  if (!canRun) {
    tier = 'unsupported';
  } else if (!useMediabunny || isVeryLowMemory || (!input.webgpu && isLowCores)) {
    tier = 'constrained';
  } else if (!input.webgpu || !llmEnabled || isLowMemory) {
    tier = 'standard';
  }

  const exportHeight: 1080 | 720 = isVeryLowMemory ? 720 : 1080;

  return {
    plan: {
      tier,
      asrDevice,
      asrModel,
      llmEnabled,
      llmModel: DEFAULT_LLM_MODEL,
      llmSkipReason,
      videoEngine,
      previewHeight: 720,
      exportHeight,
      canRun,
    },
    warnings,
  };
}

/**
 * Probes browser ML and media capabilities without leaving the device.
 */
export async function detectCapabilities(
  deps: CapabilityProbeDeps = {},
): Promise<DeviceCapabilities> {
  const webWorker = deps.hasWorker ? deps.hasWorker() : typeof globalThis.Worker === 'function';
  const webAssembly = deps.hasWebAssembly
    ? deps.hasWebAssembly()
    : typeof globalThis.WebAssembly === 'object';
  const offscreenCanvas = deps.hasOffscreenCanvas
    ? deps.hasOffscreenCanvas()
    : typeof globalThis.OffscreenCanvas === 'function';
  const crossOriginIsolated = deps.getCrossOriginIsolated
    ? deps.getCrossOriginIsolated()
    : Boolean(globalThis.crossOriginIsolated);
  const sharedArrayBuffer = deps.hasSharedArrayBuffer
    ? deps.hasSharedArrayBuffer()
    : typeof globalThis.SharedArrayBuffer === 'function';

  const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGb = deps.getDeviceMemoryGb
    ? deps.getDeviceMemoryGb()
    : typeof nav?.deviceMemory === 'number'
      ? nav.deviceMemory
      : null;
  const hardwareConcurrency = deps.getHardwareConcurrency
    ? deps.getHardwareConcurrency()
    : typeof nav?.hardwareConcurrency === 'number'
      ? nav.hardwareConcurrency
      : null;

  const [gpuResult, codecsResult, storageAvailableMb] = await Promise.all([
    deps.probeWebGpu
      ? deps.probeWebGpu()
      : withTimeout(defaultProbeWebGpu(), PROBE_TIMEOUT_MS, { available: false, adapterName: null }),
    deps.probeWebCodecs
      ? deps.probeWebCodecs()
      : withTimeout(defaultProbeWebCodecs(), PROBE_TIMEOUT_MS, {
          available: false,
          h264Encode: false,
          aacEncode: false,
        }),
    deps.estimateStorageMb
      ? deps.estimateStorageMb()
      : withTimeout(defaultEstimateStorageMb(), PROBE_TIMEOUT_MS, null),
  ]);

  const { plan, warnings } = buildExecutionPlan({
    webgpu: gpuResult.available,
    webcodecs: codecsResult.available,
    h264Encode: codecsResult.h264Encode,
    webWorker,
    webAssembly,
    offscreenCanvas,
    crossOriginIsolated,
    deviceMemoryGb,
    hardwareConcurrency,
  });

  return {
    webgpu: gpuResult.available,
    webgpuAdapterName: gpuResult.adapterName,
    webcodecs: codecsResult.available,
    h264Encode: codecsResult.h264Encode,
    aacEncode: codecsResult.aacEncode,
    offscreenCanvas,
    webWorker,
    webAssembly,
    crossOriginIsolated,
    sharedArrayBuffer,
    deviceMemoryGb,
    hardwareConcurrency,
    storageAvailableMb,
    warnings,
    plan,
  };
}
