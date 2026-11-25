interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS?: AssetsBinding;
  YT_BRIDGE_URL?: string;
  YT_BRIDGE_TOKEN?: string;
}

const MAX_PROXY_BYTES = 250 * 1024 * 1024;
const MAX_BRIDGE_BYTES = 1024 * 1024 * 1024;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isYouTubeDomain(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'youtu.be' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube.com' ||
    host.endsWith('.googlevideo.com')
  );
}

function buildBridgeHeaders(env: WorkerEnv, accept = 'application/json'): HeadersInit {
  const headers: Record<string, string> = { Accept: accept };
  if (env.YT_BRIDGE_TOKEN) {
    headers.Authorization = `Bearer ${env.YT_BRIDGE_TOKEN}`;
  }
  return headers;
}

async function detectCobaltRoot(base: string, env: WorkerEnv): Promise<boolean> {
  try {
    const res = await fetch(`${base}/`, { headers: buildBridgeHeaders(env) });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { cobalt?: unknown } | null;
    return Boolean(data && typeof data === 'object' && 'cobalt' in data);
  } catch {
    return false;
  }
}

async function handleYouTubeOembed(requestUrl: URL): Promise<Response> {
  const raw = requestUrl.searchParams.get('url');
  if (!raw) {
    return jsonResponse({ error: 'Missing url query parameter.' }, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return jsonResponse({ error: 'Invalid YouTube URL.' }, 400);
  }

  if (!isYouTubeDomain(parsed.hostname)) {
    return jsonResponse({ error: 'Only YouTube URLs are allowed.' }, 400);
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.toString())}&format=json`;
  const upstream = await fetch(oembedUrl);
  if (!upstream.ok) {
    return jsonResponse({ error: `oEmbed lookup failed (HTTP ${upstream.status}).` }, upstream.status);
  }

  const data = (await upstream.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };
  return jsonResponse({
    title: data.title,
    authorName: data.author_name,
    thumbnailUrl: data.thumbnail_url,
  });
}

async function handleYtBridgeProxy(requestUrl: URL, env: WorkerEnv): Promise<Response> {
  const rawBridge = env.YT_BRIDGE_URL?.trim();
  const subpath = requestUrl.pathname.replace(/^\/api\/yt-bridge/, '') || '/status';

  if (subpath === '/status') {
    return jsonResponse({ configured: Boolean(rawBridge) });
  }

  if (!rawBridge) {
    return jsonResponse(
      {
        configured: false,
        error: 'No public YouTube downloader backend is configured on this deployment.',
      },
      503,
    );
  }

  const base = rawBridge.replace(/\/+$/, '');

  if (subpath === '/health') {
    try {
      const upstream = await fetch(`${base}/health`, { headers: buildBridgeHeaders(env) });
      if (upstream.ok) {
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      if (await detectCobaltRoot(base, env)) {
        return jsonResponse({ ok: true, mode: 'cobalt', ytdlpVersion: 'cobalt' });
      }
      return jsonResponse({ ok: false, error: `Bridge returned HTTP ${upstream.status}` }, 502);
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err instanceof Error ? err.message : 'Bridge unreachable' },
        502,
      );
    }
  }

  const targetVideoUrl = requestUrl.searchParams.get('url');
  if (!targetVideoUrl) {
    return jsonResponse({ error: 'Missing url query parameter.' }, 400);
  }

  if (subpath === '/info') {
    const upstream = await fetch(`${base}/info?url=${encodeURIComponent(targetVideoUrl)}`, {
      headers: buildBridgeHeaders(env),
    });
    if (upstream.ok) {
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    // Fallback to oEmbed when backend is Cobalt (which has no /info endpoint)
    return handleYouTubeOembed(requestUrl);
  }

  if (subpath === '/download') {
    let mediaResponse = await fetch(`${base}/download?url=${encodeURIComponent(targetVideoUrl)}`, {
      headers: buildBridgeHeaders(env, '*/*'),
    });

    if (mediaResponse.status === 404 || mediaResponse.status === 405) {
      // Try Cobalt POST / API on the configured bridge URL
      const cobaltRes = await fetch(`${base}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(env.YT_BRIDGE_TOKEN ? { Authorization: `Bearer ${env.YT_BRIDGE_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          url: targetVideoUrl,
          videoQuality: '1080',
          filenameStyle: 'basic',
        }),
      });

      const cobaltJson = (await cobaltRes.json().catch(() => null)) as {
        status?: string;
        url?: string;
        error?: { code?: string };
      } | null;

      if (!cobaltRes.ok || !cobaltJson?.url) {
        return jsonResponse(
          { error: cobaltJson?.error?.code || `Cobalt download failed (HTTP ${cobaltRes.status}).` },
          502,
        );
      }

      mediaResponse = await fetch(cobaltJson.url);
    }

    if (!mediaResponse.ok) {
      const msg = await mediaResponse.text().catch(() => '');
      return new Response(msg || JSON.stringify({ error: `Bridge download failed (HTTP ${mediaResponse.status}).` }), {
        status: mediaResponse.status,
        headers: {
          'Content-Type': mediaResponse.headers.get('content-type') || 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const contentLength = Number(mediaResponse.headers.get('content-length') || 0);
    const estimatedSize = Number(mediaResponse.headers.get('x-estimated-size') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BRIDGE_BYTES) {
      return jsonResponse({ error: 'Video exceeds the 1.00 GB limit.' }, 413);
    }

    const headers = new Headers();
    headers.set('Content-Type', mediaResponse.headers.get('content-type') || 'video/mp4');
    if (contentLength > 0) headers.set('Content-Length', String(contentLength));
    if (estimatedSize > 0) headers.set('X-Estimated-Size', String(estimatedSize));
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', 'X-Estimated-Size');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(mediaResponse.body, { status: 200, headers });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

async function handleMediaProxy(requestUrl: URL): Promise<Response> {
  const raw = requestUrl.searchParams.get('url');
  if (!raw) {
    return jsonResponse({ error: 'Missing url query parameter.' }, 400);
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return jsonResponse({ error: 'Invalid media URL.' }, 400);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return jsonResponse({ error: 'Only http/https media URLs are supported.' }, 400);
  }
  if (isBlockedHost(target.hostname)) {
    return jsonResponse({ error: 'Private or local network addresses are blocked.' }, 403);
  }
  if (isYouTubeDomain(target.hostname)) {
    return jsonResponse(
      { error: 'YouTube links require the YouTube bridge or browser tab capture.' },
      400,
    );
  }

  const upstream = await fetch(target.toString(), { redirect: 'follow' });
  if (!upstream.ok) {
    return jsonResponse({ error: `Upstream video host returned HTTP ${upstream.status}.` }, 502);
  }

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (
    contentType &&
    !contentType.startsWith('video/') &&
    !contentType.includes('application/octet-stream')
  ) {
    return jsonResponse({ error: `URL did not return a video stream (${contentType}).` }, 415);
  }

  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BYTES) {
    return jsonResponse({ error: 'Direct URL exceeds the 250 MB Cloudflare proxy limit.' }, 413);
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType || 'video/mp4');
  if (contentLength > 0) headers.set('Content-Length', String(contentLength));
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(upstream.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/youtube-oembed') {
      return handleYouTubeOembed(url);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/yt-bridge')) {
      return handleYtBridgeProxy(url, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/proxy') {
      return handleMediaProxy(url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};
