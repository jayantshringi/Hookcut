import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped ESM bridge module
import { buildFfmpegHeaderArg, getExtraYtDlpArgs, normalizeYouTubeUrl, selectStreamPlan } from '../../vercel-bridge/server.mjs';

describe('vercel-bridge helpers', () => {
  it('normalizes YouTube watch, short, and shorts URLs', () => {
    expect(normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(normalizeYouTubeUrl('https://youtube.com/shorts/abcdefghijk')).toEqual({
      videoId: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(normalizeYouTubeUrl('https://example.com/video.mp4')).toBeNull();
  });

  it('formats ffmpeg -headers argument excluding user-agent, accept-encoding, host, and CRLF injection', () => {
    const hdr = buildFfmpegHeaderArg({
      'User-Agent': 'Mozilla/5.0',
      'Accept-Encoding': 'gzip, deflate',
      Host: 'example.com',
      Referer: 'https://www.youtube.com/\r\nInjected: bad',
      Accept: '*/*',
    });
    expect(hdr).not.toContain('User-Agent');
    expect(hdr).not.toContain('Accept-Encoding');
    expect(hdr).not.toContain('Host');
    expect(hdr).toContain('Referer: https://www.youtube.com/Injected: bad\r\n');
    expect(hdr).toContain('Accept: */*\r\n');
  });

  it('selects zero-disk ffmpeg-mux plan when yt-dlp returns separate video and audio streams', () => {
    const plan = selectStreamPlan({
      duration: 180,
      requested_formats: [
        { url: 'https://video.example/v.mp4', filesize_approx: 50_000_000, http_headers: {} },
        { url: 'https://audio.example/a.m4a', filesize_approx: 5_000_000, http_headers: {} },
      ],
    });
    expect(plan.mode).toBe('ffmpeg-mux');
    expect(plan.estimatedBytes).toBe(55_000_000);
    expect(plan.inputs).toHaveLength(2);
  });

  it('selects ffmpeg-remux for single format URL and ytdlp-stdout fallback otherwise', () => {
    const single = selectStreamPlan({
      duration: 60,
      url: 'https://muxed.example/v.mp4',
      filesize: 12_000_000,
    });
    expect(single.mode).toBe('ffmpeg-remux');
    expect(single.estimatedBytes).toBe(12_000_000);

    const fallback = selectStreamPlan({ duration: 60 });
    expect(fallback.mode).toBe('ytdlp-stdout');
  });

  it('builds extra yt-dlp flags for JS runtime, extractor args, proxy, and base64 cookies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hookcut-yt-test-'));
    try {
      const sampleCookies = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tPREF\ttz=UTC\n';
      const args = getExtraYtDlpArgs(dir, {
        YTDLP_JS_RUNTIMES: 'node',
        YTDLP_EXTRACTOR_ARGS: 'youtube:player_client=web',
        YTDLP_PROXY: 'http://proxy.internal:8080',
        YTDLP_COOKIES_B64: Buffer.from(sampleCookies).toString('base64'),
      });
      expect(args).toContain('--js-runtimes');
      expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node');
      expect(args[args.indexOf('--extractor-args') + 1]).toBe('youtube:player_client=web');
      expect(args[args.indexOf('--proxy') + 1]).toBe('http://proxy.internal:8080');
      const cookieFile = args[args.indexOf('--cookies') + 1];
      expect(readFileSync(cookieFile, 'utf8')).toBe(sampleCookies);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
