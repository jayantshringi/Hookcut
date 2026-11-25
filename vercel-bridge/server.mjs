import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_DURATION_SEC = 30 * 60;
const MAX_FILESIZE_BYTES = 1024 * 1024 * 1024;
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'X-Estimated-Size, X-Stream-Mode, X-Fallback-Reason');
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function normalizeYouTubeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
        id = parts[1];
      }
    }
  }
  if (!id || !YOUTUBE_ID_RE.test(id)) return null;
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

const STRIPPED_FFMPEG_HEADERS = new Set([
  'user-agent',
  'accept-encoding',
  'host',
  'connection',
  'content-length',
]);

export function buildFfmpegHeaderArg(headersObj) {
  if (!headersObj || typeof headersObj !== 'object') return '';
  const lines = [];
  for (const [k, v] of Object.entries(headersObj)) {
    if (!v || STRIPPED_FFMPEG_HEADERS.has(k.toLowerCase())) continue;
    const cleanKey = String(k).replace(/[\r\n:]/g, '');
    const cleanVal = String(v).replace(/[\r\n]/g, '');
    if (cleanKey && cleanVal) {
      lines.push(`${cleanKey}: ${cleanVal}`);
    }
  }
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '';
}

export function selectStreamPlan(info) {
  const duration = typeof info?.duration === 'number' ? info.duration : null;
  const requested = Array.isArray(info?.requested_formats) ? info.requested_formats : [];

  if (requested.length >= 2 && requested[0]?.url && requested[1]?.url) {
    const est =
      (Number(requested[0].filesize || requested[0].filesize_approx) || 0) +
      (Number(requested[1].filesize || requested[1].filesize_approx) || 0);
    return {
      mode: 'ffmpeg-mux',
      duration,
      estimatedBytes: est > 0 ? est : Number(info.filesize_approx) || 0,
      inputs: [
        { url: requested[0].url, headers: requested[0].http_headers || info.http_headers },
        { url: requested[1].url, headers: requested[1].http_headers || info.http_headers },
      ],
    };
  }

  if (info?.url) {
    const est = Number(info.filesize || info.filesize_approx) || 0;
    return {
      mode: 'ffmpeg-remux',
      duration,
      estimatedBytes: est,
      inputs: [{ url: info.url, headers: info.http_headers }],
    };
  }

  return {
    mode: 'ytdlp-stdout',
    duration,
    estimatedBytes: Number(info?.filesize_approx) || 0,
    inputs: [],
  };
}

export function getExtraYtDlpArgs(tmpDir, env = process.env) {
  const extra = [];
  const jsRuntimes = env.YTDLP_JS_RUNTIMES?.trim();
  const extractorArgs = env.YTDLP_EXTRACTOR_ARGS?.trim();
  const proxy = env.YTDLP_PROXY?.trim();
  const cookiesB64 = env.YTDLP_COOKIES_B64?.trim();
  if (jsRuntimes) {
    extra.push('--js-runtimes', jsRuntimes);
  }
  if (extractorArgs) {
    extra.push('--extractor-args', extractorArgs);
  }
  if (proxy) {
    extra.push('--proxy', proxy);
  }
  if (cookiesB64 && tmpDir) {
    const cookiePath = join(tmpDir, 'cookies.txt');
    writeFileSync(cookiePath, Buffer.from(cookiesB64, 'base64'));
    extra.push('--cookies', cookiePath);
  }
  return extra;
}

function runCommandCapture(bin, args, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
      }
    });
  });
}

function streamProcessToResponse(bin, args, res, headers, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    let settled = false;
    let stderr = '';

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stderr.on('data', (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });

    proc.stdout.on('data', (chunk) => {
      if (!started) {
        started = true;
        setCorsHeaders(res);
        res.writeHead(200, headers);
      }
      if (!res.write(chunk)) {
        proc.stdout.pause();
        res.once('drain', () => proc.stdout.resume());
      }
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      reject(err);
    });

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      if (started) {
        res.end();
        resolve();
      } else if (code === 0) {
        reject(new Error('Stream produced zero bytes.'));
      } else {
        reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
      }
    });
  });
}

function streamYtdlpPipedToFfmpegToResponse(ytdlpArgs, res, headers, signal) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', ytdlpArgs, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-c',
        'copy',
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1',
      ],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let started = false;
    let settled = false;
    let ytdlpStderr = '';
    let ffStderr = '';

    const killAll = () => {
      try {
        ytdlp.kill('SIGTERM');
      } catch {
        // ignore
      }
      try {
        ff.kill('SIGTERM');
      } catch {
        // ignore
      }
    };

    const onAbort = () => killAll();
    signal?.addEventListener('abort', onAbort, { once: true });

    ytdlp.stderr.on('data', (chunk) => {
      if (ytdlpStderr.length < 4096) ytdlpStderr += chunk.toString();
    });
    ff.stderr.on('data', (chunk) => {
      if (ffStderr.length < 4096) ffStderr += chunk.toString();
    });

    ff.stdin.on('error', () => {
      // ffmpeg may close stdin early on error or abort
    });
    ytdlp.stdout.pipe(ff.stdin);

    ff.stdout.on('data', (chunk) => {
      if (!started) {
        started = true;
        setCorsHeaders(res);
        res.writeHead(200, headers);
      }
      if (!res.write(chunk)) {
        ff.stdout.pause();
        res.once('drain', () => ff.stdout.resume());
      }
    });

    const failBeforeFinish = (err) => {
      signal?.removeEventListener('abort', onAbort);
      killAll();
      if (settled) return;
      settled = true;
      reject(err);
    };

    ytdlp.on('error', failBeforeFinish);
    ff.on('error', failBeforeFinish);

    ff.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      try {
        ytdlp.kill('SIGTERM');
      } catch {
        // ignore
      }
      if (settled) return;
      settled = true;
      if (started) {
        res.end();
        resolve();
      } else if (code === 0) {
        reject(new Error(ytdlpStderr.trim() || 'Piped stream produced zero bytes.'));
      } else {
        reject(
          new Error(
            ffStderr.trim() || ytdlpStderr.trim() || `ffmpeg exited with code ${code}`,
          ),
        );
      }
    });
  });
}

function buildFfmpegArgs(inputs) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  const proxy = process.env.YTDLP_PROXY?.trim();
  for (const input of inputs) {
    if (proxy) {
      args.push('-http_proxy', proxy);
    }
    const ua = input.headers?.['User-Agent'] || input.headers?.['user-agent'];
    if (ua) {
      args.push('-user_agent', String(ua).replace(/[\r\n]/g, ''));
    }
    const hdr = buildFfmpegHeaderArg(input.headers);
    if (hdr) {
      args.push('-headers', hdr);
    }
    args.push('-i', input.url);
  }
  args.push(
    '-c',
    'copy',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  );
  return args;
}

export function createBridgeServer() {
  const authToken = process.env.YT_BRIDGE_TOKEN?.trim() || '';

  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://localhost');

    if (authToken && reqUrl.pathname !== '/health' && reqUrl.pathname !== '/') {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${authToken}`) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
    }

    if (reqUrl.pathname === '/' || reqUrl.pathname === '/health') {
      try {
        const version = await runCommandCapture('yt-dlp', ['--version']);
        sendJson(res, 200, {
          ok: true,
          mode: 'streaming-fmp4',
          ytdlpVersion: version,
          jsRuntimes: process.env.YTDLP_JS_RUNTIMES?.trim() || null,
          hasCookies: Boolean(process.env.YTDLP_COOKIES_B64?.trim()),
        });
      } catch {
        sendJson(res, 503, {
          ok: false,
          error:
            'yt-dlp was not found on PATH. Install yt-dlp and restart the bridge.',
        });
      }
      return;
    }

    const target = normalizeYouTubeUrl(reqUrl.searchParams.get('url'));
    if (!target) {
      sendJson(res, 400, { error: 'Invalid or missing YouTube URL.' });
      return;
    }

    const tmpDir = process.env.YTDLP_COOKIES_B64?.trim()
      ? mkdtempSync(join(tmpdir(), 'hookcut-cookie-'))
      : null;
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      const formatSelector =
        'bv*[height<=1080][ext=mp4][protocol!*=m3u8]+ba[ext=m4a][protocol!*=m3u8]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4][protocol!*=m3u8]/b[height<=1080][ext=mp4]/b[ext=mp4]/bv*[height<=1080]+ba/b';
      const rawJson = await runCommandCapture(
        'yt-dlp',
        [
          ...getExtraYtDlpArgs(tmpDir),
          '--dump-single-json',
          '--no-playlist',
          '-f',
          formatSelector,
          target.url,
        ],
        abort.signal,
      );
      const info = JSON.parse(rawJson);

      if (reqUrl.pathname === '/info') {
        sendJson(res, 200, {
          videoId: target.videoId,
          title: info.title || `YouTube (${target.videoId})`,
          uploader: info.uploader || info.channel || undefined,
          durationSec: typeof info.duration === 'number' ? info.duration : undefined,
          thumbnailUrl:
            info.thumbnail || `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`,
        });
        return;
      }

      if (reqUrl.pathname !== '/download') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      const plan = selectStreamPlan(info);
      if (typeof plan.duration === 'number' && plan.duration > MAX_DURATION_SEC) {
        sendJson(res, 413, {
          error: `Video is ${(plan.duration / 60).toFixed(1)} min long. Hookcut supports up to 30 min.`,
        });
        return;
      }
      if (plan.estimatedBytes > MAX_FILESIZE_BYTES) {
        sendJson(res, 413, { error: 'Video exceeds the 1.00 GB limit.' });
        return;
      }

      const streamHeaders = {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${target.videoId}.mp4"`,
        ...(plan.estimatedBytes > 0
          ? { 'X-Estimated-Size': String(Math.round(plan.estimatedBytes)) }
          : {}),
      };

      // Stream 0-disk fragmented MP4 via ffmpeg when direct stream URLs are available
      let fallbackReason = '';
      if (plan.mode === 'ffmpeg-mux' || plan.mode === 'ffmpeg-remux') {
        try {
          await streamProcessToResponse(
            'ffmpeg',
            buildFfmpegArgs(plan.inputs),
            res,
            { ...streamHeaders, 'X-Stream-Mode': plan.mode },
            abort.signal,
          );
          return;
        } catch (err) {
          if (res.headersSent || abort.signal.aborted) {
            throw err;
          }
          fallbackReason = (err instanceof Error ? err.message : String(err))
            .replace(/[\r\n]+/g, ' ')
            .slice(0, 160);
          // Fall through to yt-dlp | ffmpeg stdout remux if direct ffmpeg failed before headers
        }
      }

      await streamYtdlpPipedToFfmpegToResponse(
        [
          ...getExtraYtDlpArgs(tmpDir),
          '--no-playlist',
          '--max-filesize',
          '1G',
          '-f',
          'b[height<=1080][ext=mp4][protocol!*=m3u8]/b[height<=1080][ext=mp4]/b[ext=mp4]/b',
          '-o',
          '-',
          target.url,
        ],
        res,
        {
          ...streamHeaders,
          'X-Stream-Mode': 'ytdlp-ffmpeg-pipe',
          ...(fallbackReason ? { 'X-Fallback-Reason': fallbackReason } : {}),
        },
        abort.signal,
      );
    } catch (err) {
      if (!res.headersSent && !abort.signal.aborted) {
        sendJson(res, 502, {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to stream YouTube video.',
        });
      } else if (res.headersSent && !res.writableEnded) {
        res.end();
      }
    } finally {
      if (tmpDir) {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  });
}

export function startBridgeServer(opts = {}) {
  const port = Number(opts.port ?? process.env.PORT ?? 80);
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0';
  const server = createBridgeServer();

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 25_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  server.listen(port, host, () => {
    console.log(`Hookcut streaming YouTube bridge listening at http://${host}:${port}`);
  });
  return server;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startBridgeServer();
}
