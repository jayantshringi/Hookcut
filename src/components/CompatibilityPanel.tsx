import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Film,
  HardDrive,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { CompatibilityTier, DeviceCapabilities } from '../capabilities/types';

interface CompatibilityPanelProps {
  capabilities: DeviceCapabilities | null;
  loading?: boolean;
  onDismiss?: () => void;
}

const TIER_STYLES: Record<
  CompatibilityTier,
  { badge: string; label: string; border: string; summary: string }
> = {
  optimal: {
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    label: 'Optimal (GPU Accelerated)',
    border: 'border-emerald-500/25',
    summary: 'WebGPU + WebCodecs ready. Full local AI pipeline enabled.',
  },
  standard: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    label: 'Standard Mode',
    border: 'border-amber-500/25',
    summary: 'Compatible browser with CPU/WASM fallback for some AI steps.',
  },
  constrained: {
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    label: 'Constrained Device',
    border: 'border-orange-500/30',
    summary: 'Reduced-memory path selected to keep processing stable.',
  },
  unsupported: {
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    label: 'Unsupported Browser',
    border: 'border-rose-500/30',
    summary: 'Missing required browser features (Web Workers / WebAssembly).',
  },
};

function StatusChip({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        )}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400 truncate" title={detail}>
        {detail}
      </p>
    </div>
  );
}

export function CompatibilityPanel({
  capabilities,
  loading = false,
  onDismiss,
}: CompatibilityPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (loading || !capabilities) {
    return (
      <section
        aria-label="Device compatibility check"
        className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
      >
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Cpu className="h-4 w-4 animate-pulse text-amber-400" />
          <span>Checking on-device WebGPU, WebCodecs, memory, and CPU cores…</span>
        </div>
      </section>
    );
  }

  const tierStyle = TIER_STYLES[capabilities.plan.tier];
  const hasSevere = capabilities.warnings.some((w) => w.severity !== 'info');

  return (
    <section
      aria-label="Device compatibility check"
      className={`rounded-xl border ${tierStyle.border} bg-zinc-900/70 p-4 transition-colors`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {capabilities.plan.canRun ? (
            <Sparkles className="h-5 w-5 text-amber-400 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-rose-400 shrink-0" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Device Compatibility</h2>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tierStyle.badge}`}
              >
                {tierStyle.label}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{tierStyle.summary}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700/80 transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                Hide details <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Details <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
          {onDismiss && capabilities.plan.canRun && !hasSevere && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors"
            >
              Continue
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatusChip
              ok={capabilities.webgpu}
              label="WebGPU"
              detail={
                capabilities.webgpu
                  ? capabilities.webgpuAdapterName || 'Enabled'
                  : 'Unavailable (WASM fallback)'
              }
            />
            <StatusChip
              ok={capabilities.webcodecs && capabilities.h264Encode}
              label="WebCodecs"
              detail={
                capabilities.webcodecs && capabilities.h264Encode
                  ? 'Mediabunny H.264/AAC'
                  : 'ffmpeg.wasm fallback'
              }
            />
            <StatusChip
              ok={capabilities.deviceMemoryGb === null || capabilities.deviceMemoryGb >= 4}
              label="Memory & Cores"
              detail={`${capabilities.deviceMemoryGb ?? '?'} GB RAM • ${capabilities.hardwareConcurrency ?? '?'} cores`}
            />
            <StatusChip
              ok={capabilities.crossOriginIsolated && capabilities.sharedArrayBuffer}
              label="WASM Isolation"
              detail={
                capabilities.crossOriginIsolated
                  ? 'COOP/COEP active'
                  : 'Single-thread WASM'
              }
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-xs text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Film className="h-3.5 w-3.5 text-amber-400" />
              <strong>Path:</strong> {capabilities.plan.videoEngine} ({capabilities.plan.exportHeight}p export)
            </span>
            <span>
              <strong>Whisper:</strong> {capabilities.plan.asrModel.split('/')[1]} ({capabilities.plan.asrDevice})
            </span>
            <span>
              <strong>LLM Re-rank:</strong>{' '}
              {capabilities.plan.llmEnabled
                ? capabilities.plan.llmModel.split('/')[1]
                : 'Skipped (heuristics only)'}
            </span>
            {capabilities.storageAvailableMb !== null && (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <HardDrive className="h-3.5 w-3.5" />
                {Math.round(capabilities.storageAvailableMb / 1024)} GB browser cache free
              </span>
            )}
          </div>

          {capabilities.warnings.length > 0 && (
            <ul className="space-y-1.5" aria-label="Compatibility notices">
              {capabilities.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    warning.severity === 'error'
                      ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                      : warning.severity === 'warning'
                        ? 'border-amber-500/35 bg-amber-950/25 text-amber-200'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
