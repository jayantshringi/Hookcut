import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { buildExecutionPlan } from '../../src/capabilities/detectCapabilities';
import type { DeviceCapabilities } from '../../src/capabilities/types';

function makeMockCapabilities(): DeviceCapabilities {
  const { plan, warnings } = buildExecutionPlan({
    webgpu: true,
    webcodecs: true,
    h264Encode: true,
    webWorker: true,
    webAssembly: true,
    offscreenCanvas: true,
    crossOriginIsolated: true,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
  });

  return {
    webgpu: true,
    webgpuAdapterName: 'Mock GPU',
    webcodecs: true,
    h264Encode: true,
    aacEncode: true,
    offscreenCanvas: true,
    webWorker: true,
    webAssembly: true,
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    storageAvailableMb: 4096,
    warnings,
    plan,
  };
}

describe('App', () => {
  it('renders ClipForge header and device compatibility panel', () => {
    render(<App initialCapabilities={makeMockCapabilities()} />);
    expect(screen.getByText('ClipForge')).toBeInTheDocument();
    expect(screen.getByText('Optimal (GPU Accelerated)')).toBeInTheDocument();
  });
});
