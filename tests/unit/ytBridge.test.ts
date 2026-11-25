import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped ESM bridge module
import { buildFfmpegHeaderArg, normalizeYouTubeUrl, selectStreamPlan } from '../../vercel-bridge/server.mjs';

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

  it('formats ffmpeg -headers argument excluding user-agent and CRLF injection', () => {
    const hdr = buildFfmpegHeaderArg({
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://www.youtube.com/\r\nInjected: bad',
      Accept: '*/*',
    });
    expect(hdr).not.toContain('User-Agent');
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
});
