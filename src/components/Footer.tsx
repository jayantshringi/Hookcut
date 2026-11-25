import { Coffee, Heart, ShieldCheck } from 'lucide-react';

interface FooterProps {
  onOpenLegal: (tab: 'privacy' | 'terms') => void;
}

export function Footer({ onOpenLegal }: FooterProps) {
  return (
    <footer className="border-t border-zinc-800/80 px-6 py-5 mt-8">
      <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ClipForge • MIT Open Source
          </span>
          <span>Videos stay 100% on your device.</span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => onOpenLegal('privacy')}
            className="hover:text-zinc-200 underline-offset-4 hover:underline cursor-pointer"
          >
            Privacy
          </button>
          <button
            type="button"
            onClick={() => onOpenLegal('terms')}
            className="hover:text-zinc-200 underline-offset-4 hover:underline cursor-pointer"
          >
            Terms (Rights Required)
          </button>
          <a
            href="https://ko-fi.com/clipforge"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <Coffee className="h-3.5 w-3.5" />
            Ko-fi
          </a>
          <a
            href="https://github.com/sponsors/jayantshringi"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-pink-500/35 bg-pink-500/10 px-2.5 py-1 text-pink-300 hover:bg-pink-500/20 transition-colors"
          >
            <Heart className="h-3.5 w-3.5" />
            GitHub Sponsors
          </a>
        </div>
      </div>
    </footer>
  );
}
