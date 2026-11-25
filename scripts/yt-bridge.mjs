import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const AUTH_TOKEN = process.env.YT_BRIDGE_TOKEN?.trim() || '';
const YTDLP_PROXY = process.env.YTDLP_PROXY?.trim() || '';
const YTDLP_COOKIES_B64 = process.env.YTDLP_COOKIES_B64?.trim() || '';
const MAX_DURATION_SEC = 30 * 60;
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function normalizeYouTubeUrl(raw) {
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

function runYtDlp(args, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function getExtraYtDlpArgs(tmpDir) {
  const extra = [];
  if (YTDLP_PROXY) {
    extra.push('--proxy', YTDLP_PROXY);
  }
  if (YTDLP_COOKIES_B64 && tmpDir) {
    const cookiePath = join(tmpDir, 'cookies.txt');
    writeFileSync(cookiePath, Buffer.from(YTDLP_COOKIES_B64, 'base64'));
    extra.push('--cookies', cookiePath);
  }
  return extra;
}

const server = createServer(async (req, res) => {
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

  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (AUTH_TOKEN && reqUrl.pathname !== '/health') {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  if (reqUrl.pathname === '/health') {
    try {
      const version = await runYtDlp(['--version']);
      sendJson(res, 200, { ok: true, ytdlpVersion: version });
    } catch {
      sendJson(res, 503, {
        ok: false,
        error: 'yt-dlp was not found on PATH. Install yt-dlp (e.g. winget install yt-dlp / brew install yt-dlp / pip install yt-dlp) and restart npm run yt-bridge.',
      });
    }
    return;
  }

  const target = normalizeYouTubeUrl(reqUrl.searchParams.get('url'));
  if (!target) {
    sendJson(res, 400, { error: 'Invalid or missing YouTube URL.' });
    return;
  }

  if (reqUrl.pathname === '/info') {
    const tmpDir = YTDLP_COOKIES_B64 ? mkdtempSync(join(tmpdir(), 'hookcut-info-')) : null;
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const rawJson = await runYtDlp(
        [
          ...getExtraYtDlpArgs(tmpDir),
          '--dump-single-json',
          '--no-playlist',
          '--no-warnings',
          target.url,
        ],
        abort.signal,
      );
      const info = JSON.parse(rawJson);
      sendJson(res, 200, {
        videoId: target.videoId,
        title: info.title || `YouTube (${target.videoId})`,
        uploader: info.uploader || info.channel || undefined,
        durationSec: typeof info.duration === 'number' ? info.duration : undefined,
        thumbnailUrl:
          info.thumbnail || `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`,
      });
    } catch (err) {
      sendJson(res, 502, {
        error: err instanceof Error ? err.message : 'Failed to inspect YouTube video.',
      });
    } finally {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  if (reqUrl.pathname === '/download') {
    const tmpDir = mkdtempSync(join(tmpdir(), 'hookcut-yt-'));
    const outFile = join(tmpDir, `${target.videoId}.mp4`);
    const abort = new AbortController();
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

    req.on('close', () => {
      abort.abort();
      cleanup();
    });

    try {
      await runYtDlp(
        [
          ...getExtraYtDlpArgs(tmpDir),
          '--no-playlist',
          '--no-warnings',
          '--match-filter',
          `duration <= ${MAX_DURATION_SEC}`,
          '--max-filesize',
          '1G',
          '-f',
          'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b',
          '--merge-output-format',
          'mp4',
          '-o',
          outFile,
          target.url,
        ],
        abort.signal,
      );

      const stat = statSync(outFile);
      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${target.videoId}.mp4"`,
      });

      const stream = createReadStream(outFile);
      stream.on('close', cleanup);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) sendJson(res, 500, { error: 'Failed to read downloaded file.' });
      });
      stream.pipe(res);
    } catch (err) {
      cleanup();
      if (!res.headersSent) {
        sendJson(res, 502, {
          error:
            err instanceof Error
              ? err.message
              : 'yt-dlp failed to download this video (it may exceed 30 min / 1 GB or require sign-in).',
        });
      }
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Hookcut YouTube bridge listening at http://${HOST}:${PORT}`);
});
