import { MAX_VIDEO_DURATION_SEC, MAX_VIDEO_FILE_BYTES } from './types';
import { validateSelectedFile, validateVideoDuration } from './validateFile';

const STORAGE_KEY = 'hookcut:yt-bridge-url';
const DEFAULT_LOCAL_BRIDGE = 'http://127.0.0.1:8787';
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export type ClassifiedVideoUrl =
  | { kind: 'youtube'; url: string; videoId: string }
  | { kind: 'direct'; url: string };

export interface YouTubePreviewInfo {
  videoId: string;
  title: string;
  authorName?: string;
  durationSec?: number;
  thumbnailUrl: string;
}

export interface UrlDownloadProgress {
  loadedBytes: number;
  totalBytes: number;
  progress: number; // 0..1
}

export interface UrlIngestOptions {
  rawUrl: string;
  bridgeUrl?: string;
  signal?: AbortSignal;
  onPreview?: (preview: YouTubePreviewInfo) => void;
  onProgress?: (progress: UrlDownloadProgress) => void;
}

export class BridgeUnavailableError extends Error {
  readonly bridgeUrl: string;
  readonly isPublicDeployment: boolean;

  constructor(bridgeUrl: string, message?: string, isPublicDeployment = false) {
    super(
      message ??
        (isPublicDeployment
          ? 'No YouTube download server is configured on this deployment. Use "Record Browser Tab" below (works right in Chrome/Edge with zero installs), upload a local video, or enter a self-hosted bridge/Cobalt URL in Bridge settings.'
          : `YouTube bridge is not reachable at ${bridgeUrl}. Start it locally with "npm run yt-bridge" (requires yt-dlp), use "Record Browser Tab", or enter a self-hosted bridge/Cobalt URL.`),
    );
    this.name = 'BridgeUnavailableError';
    this.bridgeUrl = bridgeUrl;
    this.isPublicDeployment = isPublicDeployment;
  }
}

export function isLocalBrowserHost(): boolean {
  const host = globalThis.location?.hostname?.toLowerCase();
  if (!host) return true;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function getDefaultYtBridgeUrl(): string {
  const envUrl = (import.meta.env?.VITE_YT_BRIDGE_URL as string | undefined)?.trim();
  if (envUrl) return normalizeBridgeUrl(envUrl);
  return DEFAULT_LOCAL_BRIDGE;
}

export function normalizeBridgeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function getStoredYtBridgeUrl(): string {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)?.trim();
    if (saved) return normalizeBridgeUrl(saved);
  } catch {
    // ignore storage errors
  }
  return getDefaultYtBridgeUrl();
}

export function setStoredYtBridgeUrl(url: string): void {
  try {
    const normalized = normalizeBridgeUrl(url);
    if (normalized) {
      globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function extractYouTubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v');
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0]!)) {
        candidate = parts[1] ?? null;
      }
    }
  } else {
    return null;
  }

  return candidate && YOUTUBE_ID_RE.test(candidate) ? candidate : null;
}

export function classifyVideoUrl(rawUrl: string): ClassifiedVideoUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Please paste a YouTube link or direct video URL.');
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid URL format. Paste a full https:// or YouTube link.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// video links are supported.');
  }

  const videoId = extractYouTubeVideoId(parsed);
  if (videoId) {
    return {
      kind: 'youtube',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (host.includes('youtube.com') || host === 'youtu.be') {
    throw new Error('Could not find a valid YouTube video ID in that link.');
  }

  return { kind: 'direct', url: parsed.toString() };
}

export async function checkWorkerBridgeConfigured(signal?: AbortSignal): Promise<boolean> {
  if (!globalThis.location?.protocol?.startsWith('http')) return false;
  try {
    const res = await fetch('/api/yt-bridge/status', { signal });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { configured?: boolean } | null;
    return Boolean(data?.configured);
  } catch {
    return false;
  }
}

export async function checkBridgeHealth(
  bridgeUrl: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; kind?: 'yt-bridge' | 'cobalt'; ytdlpVersion?: string; error?: string }> {
  const base = normalizeBridgeUrl(bridgeUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        mode?: string;
        ytdlpVersion?: string;
        error?: string;
      } | null;
      if (data?.ok) {
        return {
          ok: true,
          kind: data.mode === 'cobalt' ? 'cobalt' : 'yt-bridge',
          ytdlpVersion: data.ytdlpVersion,
        };
      }
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }

    // Check if the endpoint is a self-hosted Cobalt instance (`GET /` returns `{ cobalt: ... }`)
    const rootRes = await fetch(`${base}/`, { signal: controller.signal }).catch(() => null);
    if (rootRes?.ok) {
      const rootJson = (await rootRes.json().catch(() => null)) as { cobalt?: unknown } | null;
      if (rootJson && typeof rootJson === 'object' && 'cobalt' in rootJson) {
        return { ok: true, kind: 'cobalt', ytdlpVersion: 'cobalt' };
      }
    }

    const errData = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: errData?.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchYouTubePreview(
  videoId: string,
  watchUrl: string,
  bridgeUrl?: string,
  signal?: AbortSignal,
): Promise<YouTubePreviewInfo> {
  const fallback: YouTubePreviewInfo = {
    videoId,
    title: `YouTube Video (${videoId})`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  const base = normalizeBridgeUrl(bridgeUrl ?? getStoredYtBridgeUrl());
  const tryInfoEndpoints = [
    ...(base && (base.startsWith('/') || isLocalBrowserHost() || base !== DEFAULT_LOCAL_BRIDGE)
      ? [`${base}/info?url=${encodeURIComponent(watchUrl)}`]
      : []),
    ...(globalThis.location?.protocol?.startsWith('http')
      ? [`/api/youtube-oembed?url=${encodeURIComponent(watchUrl)}`]
      : []),
  ];

  for (const endpoint of tryInfoEndpoints) {
    try {
      const res = await fetch(endpoint, { signal });
      if (res.ok) {
        const info = (await res.json()) as {
          title?: string;
          uploader?: string;
          authorName?: string;
          durationSec?: number;
          thumbnailUrl?: string;
        };
        return {
          videoId,
          title: info.title || fallback.title,
          authorName: info.uploader || info.authorName,
          durationSec: typeof info.durationSec === 'number' ? info.durationSec : undefined,
          thumbnailUrl: info.thumbnailUrl || fallback.thumbnailUrl,
        };
      }
    } catch {
      // continue to next endpoint
    }
  }

  return fallback;
}

async function readResponseAsBlob(
  response: Response,
  onProgress?: (progress: UrlDownloadProgress) => void,
): Promise<Blob> {
  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;
  if (Number.isFinite(totalBytes) && totalBytes > MAX_VIDEO_FILE_BYTES) {
    throw new Error('Remote video exceeds the 1.00 GB limit.');
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_VIDEO_FILE_BYTES) {
      throw new Error('Remote video exceeds the 1.00 GB limit.');
    }
    onProgress?.({ loadedBytes: blob.size, totalBytes: blob.size, progress: 1 });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      loadedBytes += value.byteLength;
      if (loadedBytes > MAX_VIDEO_FILE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Remote video exceeds the 1.00 GB limit.');
      }
      chunks.push(value);
      onProgress?.({
        loadedBytes,
        totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
        progress:
          Number.isFinite(totalBytes) && totalBytes > 0
            ? Math.min(0.99, loadedBytes / totalBytes)
            : 0,
      });
    }
  }

  onProgress?.({
    loadedBytes,
    totalBytes: totalBytes || loadedBytes,
    progress: 1,
  });

  const parts = chunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new Blob(parts, {
    type: response.headers.get('content-type') || 'video/mp4',
  });
}

function inferFilenameFromUrl(url: string, fallbackExt = 'mp4'): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.split('/').filter(Boolean).pop();
    if (tail && /\.(mp4|mov|webm|mkv|m4v)$/i.test(tail)) {
      return tail.replace(/[^a-zA-Z0-9._-]/g, '_');
    }
  } catch {
    // ignore
  }
  return `remote-video.${fallbackExt}`;
}

async function resolveActiveBridge(
  requestedBridgeUrl: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ base: string; kind: 'yt-bridge' | 'cobalt' }> {
  const customOrDefault = normalizeBridgeUrl(requestedBridgeUrl ?? getStoredYtBridgeUrl());
  const isDefaultLocal = customOrDefault === DEFAULT_LOCAL_BRIDGE;
  const isCustomExplicit = Boolean(
    customOrDefault && customOrDefault !== DEFAULT_LOCAL_BRIDGE,
  );

  if (isCustomExplicit) {
    const health = await checkBridgeHealth(customOrDefault, signal);
    if (health.ok) {
      return { base: customOrDefault, kind: health.kind ?? 'yt-bridge' };
    }
    throw new BridgeUnavailableError(
      customOrDefault,
      health.error?.includes('yt-dlp') ? health.error : undefined,
      !isLocalBrowserHost(),
    );
  }

  // On a public HTTP(S) deploy, prefer the Cloudflare Worker `/api/yt-bridge` proxy if configured
  if (await checkWorkerBridgeConfigured(signal)) {
    const workerHealth = await checkBridgeHealth('/api/yt-bridge', signal);
    if (workerHealth.ok) {
      return { base: '/api/yt-bridge', kind: workerHealth.kind ?? 'yt-bridge' };
    }
  }

  // Otherwise try local bridge if running on user's machine
  if (isDefaultLocal) {
    const localHealth = await checkBridgeHealth(DEFAULT_LOCAL_BRIDGE, signal);
    if (localHealth.ok) {
      return { base: DEFAULT_LOCAL_BRIDGE, kind: localHealth.kind ?? 'yt-bridge' };
    }
    throw new BridgeUnavailableError(
      DEFAULT_LOCAL_BRIDGE,
      localHealth.error?.includes('yt-dlp') ? localHealth.error : undefined,
      !isLocalBrowserHost(),
    );
  }

  throw new BridgeUnavailableError(customOrDefault, undefined, !isLocalBrowserHost());
}

async function downloadFromCobalt(
  bridgeBase: string,
  watchUrl: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const cobaltRes = await fetch(`${bridgeBase}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      url: watchUrl,
      videoQuality: '1080',
      filenameStyle: 'basic',
    }),
    signal,
  });

  const data = (await cobaltRes.json().catch(() => null)) as {
    url?: string;
    error?: { code?: string };
  } | null;

  if (!cobaltRes.ok || !data?.url) {
    throw new Error(data?.error?.code || `Cobalt API error (HTTP ${cobaltRes.status}).`);
  }

  try {
    const mediaRes = await fetch(data.url, { signal });
    if (mediaRes.ok) return mediaRes;
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  if (globalThis.location?.protocol?.startsWith('http')) {
    return fetch(`/api/proxy?url=${encodeURIComponent(data.url)}`, { signal });
  }
  throw new Error('Could not download Cobalt stream URL.');
}

export async function ingestVideoFromUrl(
  options: UrlIngestOptions,
): Promise<{ file: File; sourceLabel: string }> {
  const classified = classifyVideoUrl(options.rawUrl);
  const { signal, onPreview, onProgress } = options;

  if (classified.kind === 'direct') {
    let response: Response;
    try {
      response = await fetch(classified.url, { signal });
    } catch {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (globalThis.location?.protocol?.startsWith('http')) {
        response = await fetch(`/api/proxy?url=${encodeURIComponent(classified.url)}`, { signal });
      } else {
        throw new Error(
          'Could not fetch that video URL directly (CORS or network blocked).',
        );
      }
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errBody?.error || `Failed to fetch video URL (HTTP ${response.status}).`);
    }

    const blob = await readResponseAsBlob(response, onProgress);
    const mime = blob.type && blob.type.startsWith('video/') ? blob.type : 'video/mp4';
    const file = new File([blob], inferFilenameFromUrl(classified.url), {
      type: mime,
      lastModified: 0,
    });
    validateSelectedFile(file);
    return { file, sourceLabel: classified.url };
  }

  const preview = await fetchYouTubePreview(
    classified.videoId,
    classified.url,
    options.bridgeUrl,
    signal,
  ).catch(() => undefined);
  if (preview) onPreview?.(preview);

  const bridge = await resolveActiveBridge(options.bridgeUrl, signal);

  if (typeof preview?.durationSec === 'number' && preview.durationSec > MAX_VIDEO_DURATION_SEC) {
    validateVideoDuration(preview.durationSec);
  }

  const downloadRes =
    bridge.kind === 'cobalt'
      ? await downloadFromCobalt(bridge.base, classified.url, signal)
      : await fetch(
          `${bridge.base}/download?url=${encodeURIComponent(classified.url)}`,
          { signal },
        );

  if (!downloadRes.ok) {
    const errBody = (await downloadRes.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `YouTube download failed (HTTP ${downloadRes.status}).`);
  }

  const blob = await readResponseAsBlob(downloadRes, onProgress);
  const safeBase =
    (preview?.title || classified.videoId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || classified.videoId;
  const file = new File([blob], `${safeBase}.mp4`, {
    type: 'video/mp4',
    lastModified: 0,
  });
  validateSelectedFile(file);
  return { file, sourceLabel: classified.url };
}
