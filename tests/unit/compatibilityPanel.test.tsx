import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompatibilityPanel } from '../../src/components/CompatibilityPanel';
import { buildExecutionPlan } from '../../src/capabilities/detectCapabilities';
import type { DeviceCapabilities } from '../../src/capabilities/types';

function makeCapabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
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
    webgpuAdapterName: 'Apple M2 GPU',
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
    storageAvailableMb: 12288,
    warnings,
    plan,
    ...overrides,
  };
}

describe('CompatibilityPanel', () => {
  it('renders loading state before probe completes', () => {
    render(<CompatibilityPanel capabilities={null} loading />);
    expect(screen.getByText(/Checking on-device WebGPU/i)).toBeInTheDocument();
  });

  it('displays optimal tier details and allows collapsing', () => {
    const onDismiss = vi.fn();
    render(<CompatibilityPanel capabilities={makeCapabilities()} onDismiss={onDismiss} />);

    expect(screen.getByText('Optimal (GPU Accelerated)')).toBeInTheDocument();
    expect(screen.getByText('Apple M2 GPU')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide details/i }));
    expect(screen.queryByText('Apple M2 GPU')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('surfaces warnings when device is constrained', () => {
    const { plan, warnings } = buildExecutionPlan({
      webgpu: false,
      webcodecs: true,
      h264Encode: false,
      webWorker: true,
      webAssembly: true,
      offscreenCanvas: true,
      crossOriginIsolated: false,
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
    });
    const caps = makeCapabilities({
      webgpu: false,
      h264Encode: false,
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
      crossOriginIsolated: false,
      plan,
      warnings,
    });

    render(<CompatibilityPanel capabilities={caps} />);
    expect(screen.getByText('Constrained Device')).toBeInTheDocument();
    expect(screen.getByText('ffmpeg.wasm fallback')).toBeInTheDocument();
    expect(
      screen.getByText(/Hardware\/WebCodecs H\.264 encoding is unsupported here/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Skipped \(heuristics only\)/i)).toBeInTheDocument();
  });
});
