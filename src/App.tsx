import { useEffect, useState } from 'react';
import { detectCapabilities } from './capabilities/detectCapabilities';
import type { DeviceCapabilities } from './capabilities/types';
import { CompatibilityPanel } from './components/CompatibilityPanel';

export interface AppProps {
  initialCapabilities?: DeviceCapabilities;
}

export function App({ initialCapabilities }: AppProps) {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(
    initialCapabilities ?? null,
  );
  const [checkingCaps, setCheckingCaps] = useState<boolean>(!initialCapabilities);
  const [capsDismissed, setCapsDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (initialCapabilities) return;
    let active = true;
    detectCapabilities()
      .then((result) => {
        if (!active) return;
        setCapabilities(result);
        setCheckingCaps(false);
      })
      .catch(() => {
        if (!active) return;
        setCheckingCaps(false);
      });
    return () => {
      active = false;
    };
  }, [initialCapabilities]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800/80 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm">
            CF
          </span>
          <span className="text-lg font-semibold tracking-tight">ClipForge</span>
        </div>
        <span className="text-xs text-zinc-400">100% On-Device • Zero Uploads</span>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl p-6 space-y-6">
        {!capsDismissed && (
          <CompatibilityPanel
            capabilities={capabilities}
            loading={checkingCaps}
            onDismiss={() => setCapsDismissed(true)}
          />
        )}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-center text-sm text-zinc-400">
          Drop zone & studio pipeline coming next…
        </div>
      </main>
    </div>
  );
}

export default App;
