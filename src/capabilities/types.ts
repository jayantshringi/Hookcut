export type CompatibilityTier = 'optimal' | 'standard' | 'constrained' | 'unsupported';

export type AsrDevice = 'webgpu' | 'wasm';
export type VideoEngine = 'mediabunny-webcodecs' | 'ffmpeg-wasm';

export interface CapabilityWarning {
  code:
    | 'no-webgpu'
    | 'no-webcodecs'
    | 'no-h264-encode'
    | 'low-memory'
    | 'low-cores'
    | 'no-cross-origin-isolation'
    | 'no-worker'
    | 'no-wasm';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ExecutionPlan {
  tier: CompatibilityTier;
  asrDevice: AsrDevice;
  asrModel: string;
  llmEnabled: boolean;
  llmModel: string;
  llmSkipReason?: string;
  videoEngine: VideoEngine;
  previewHeight: 720;
  exportHeight: 1080 | 720;
  canRun: boolean;
}

export interface DeviceCapabilities {
  webgpu: boolean;
  webgpuAdapterName: string | null;
  webcodecs: boolean;
  h264Encode: boolean;
  aacEncode: boolean;
  offscreenCanvas: boolean;
  webWorker: boolean;
  webAssembly: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  storageAvailableMb: number | null;
  warnings: CapabilityWarning[];
  plan: ExecutionPlan;
}
