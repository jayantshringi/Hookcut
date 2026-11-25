interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS?: AssetsBinding;
}

const MAX_PROXY_BYTES = 250 * 1024 * 1024;

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
      { error: 'YouTube links require the YouTube bridge (npm run yt-bridge) instead of the direct CORS proxy.' },
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

    if (request.method === 'GET' && url.pathname === '/api/proxy') {
      return handleMediaProxy(url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};
