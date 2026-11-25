import { useState } from 'react';
import { Shield, Trash2, X } from 'lucide-react';
import { clearCachedTranscripts } from '../transcribe/transcriptCache';

interface LegalModalProps {
  openTab: 'privacy' | 'terms' | null;
  onClose: () => void;
  onSwitchTab: (tab: 'privacy' | 'terms') => void;
}

export function LegalModal({ openTab, onClose, onSwitchTab }: LegalModalProps) {
  const [cleared, setCleared] = useState(false);

  if (!openTab) return null;

  const handleClearCache = async () => {
    await clearCachedTranscripts();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={openTab === 'privacy' ? 'Privacy Policy' : 'Terms of Use'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSwitchTab('privacy')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  openTab === 'privacy'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                Privacy Policy
              </button>
              <button
                type="button"
                onClick={() => onSwitchTab('terms')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  openTab === 'terms'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                Terms of Use
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal dialog"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {openTab === 'privacy' ? (
          <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
            <p>
              <strong>Zero server uploads:</strong> Hookcut runs entirely inside your browser.
              Your video and audio files are never uploaded, transmitted, or stored on any remote
              server.
            </p>
            <p>
              <strong>On-device caching:</strong> AI model weights (Whisper, Qwen/SmolLM, MediaPipe)
              are downloaded directly from public CDNs into your browser&apos;s Cache API, and
              generated transcripts are cached locally in IndexedDB to speed up re-runs.
            </p>
            <p>
              <strong>No accounts, no tracking:</strong> Hookcut requires no login, no API keys,
              and embeds zero analytics or ad trackers.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClearCache}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                {cleared ? 'Local Transcript Cache Cleared' : 'Clear Cached Transcripts'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
            <p>
              <strong>Content Ownership &amp; Rights:</strong> You may only use Hookcut on videos
              that you own or for which you hold full copyright, license, or explicit permission to
              clip, caption, and distribute.
            </p>
            <p>
              <strong>Local Processing Responsibility:</strong> Because all processing occurs on your
              device, you retain sole responsibility for exported media, captions, and compliance
              with platform policies and applicable copyright laws.
            </p>
            <p>
              <strong>Open-Source License:</strong> Hookcut is open-source software licensed under
              the MIT License and provided &ldquo;AS IS&rdquo; without warranty of any kind.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
