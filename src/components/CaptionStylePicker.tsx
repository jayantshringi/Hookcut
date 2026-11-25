import { Type } from 'lucide-react';
import { CAPTION_PRESETS } from '../captions/presets';

interface CaptionStylePickerProps {
  enabled: boolean;
  presetId: string;
  customKeywords: string;
  onToggleEnabled: (enabled: boolean) => void;
  onSelectPreset: (presetId: string) => void;
  onChangeKeywords: (keywords: string) => void;
}

export function CaptionStylePicker({
  enabled,
  presetId,
  customKeywords,
  onToggleEnabled,
  onSelectPreset,
  onChangeKeywords,
}: CaptionStylePickerProps) {
  return (
    <section
      aria-label="Caption style picker"
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Type className="h-3.5 w-3.5 text-amber-400" />
          Animated Captions
        </h3>
        <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="h-4 w-4 accent-amber-500 rounded cursor-pointer"
          />
          Burn-in captions
        </label>
      </div>

      {enabled && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CAPTION_PRESETS.map((preset) => {
              const selected = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectPreset(preset.id)}
                  aria-pressed={selected}
                  className={`rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-zinc-100">{preset.name}</span>
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{
                        color: preset.activeWordColor,
                        backgroundColor: preset.activeBgColor ?? '#18181b',
                      }}
                    >
                      {preset.uppercase ? 'WORD' : 'Word'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400 line-clamp-2">
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="space-y-1">
            <label htmlFor="emphasis-keywords" className="block text-[11px] text-zinc-400">
              Extra emphasis keywords (comma-separated, numbers &amp; power words auto-highlighted)
            </label>
            <input
              id="emphasis-keywords"
              type="text"
              value={customKeywords}
              onChange={(e) => onChangeKeywords(e.target.value)}
              placeholder="e.g., WebGPU, local, Whisper"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </>
      )}
    </section>
  );
}
