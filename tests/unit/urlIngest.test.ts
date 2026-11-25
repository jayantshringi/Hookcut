import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeUnavailableError,
  classifyVideoUrl,
  ingestVideoFromUrl,
} from '../../src/media/urlIngest';

describe('classifyVideoUrl', () => {
  it('recognizes watch, shortlink, shorts, and live YouTube URLs', () => {
    expect(classifyVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s')).toEqual({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(classifyVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(classifyVideoUrl('https://youtube.com/shorts/abcdefghijk')).toEqual({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      videoId: 'abcdefghijk',
    });
    expect(classifyVideoUrl('youtube.com/live/12345678901')).toEqual({
      kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=12345678901',
      videoId: '12345678901',
    });
  });

  it('classifies direct video URLs and rejects unsupported schemes', () => {
    expect(classifyVideoUrl('https://cdn.example.com/clips/talk.mp4')).toEqual({
      kind: 'direct',
      url: 'https://cdn.example.com/clips/talk.mp4',
    });
    expect(() => classifyVideoUrl('javascript:alert(1)')).toThrow(/http:\/\/ and https:\/\//i);
    expect(() => classifyVideoUrl('https://www.youtube.com/watch?v=bad')).toThrow(/video ID/i);
  });
});

describe('ingestVideoFromUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches direct MP4 URLs into a validated File', async () => {
    const payload = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(payload.byteLength) },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await ingestVideoFromUrl({ rawUrl: 'https://cdn.example.com/demo.mp4' });
    expect(res.file.name).toBe('demo.mp4');
    expect(res.file.size).toBe(payload.byteLength);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/demo.mp4', { signal: undefined });
  });

  it('downloads YouTube videos through the configured bridge when healthy', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, ytdlpVersion: '2026.10.01' }), { status: 200 });
      }
      if (url.includes('/info?')) {
        return new Response(
          JSON.stringify({
            videoId: 'dQw4w9WgXcQ',
            title: 'Creator Hook Breakdown',
            uploader: 'Hookcut',
            durationSec: 120,
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/download?')) {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.byteLength) },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const previews: string[] = [];
    const res = await ingestVideoFromUrl({
      rawUrl: 'https://youtu.be/dQw4w9WgXcQ',
      bridgeUrl: 'http://127.0.0.1:8787',
      onPreview: (p) => previews.push(p.title),
    });

    expect(previews).toEqual(['Creator Hook Breakdown']);
    expect(res.file.name).toBe('creator-hook-breakdown.mp4');
    expect(res.file.size).toBe(bytes.byteLength);
  });

  it('throws BridgeUnavailableError when YouTube bridge is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      ingestVideoFromUrl({
        rawUrl: 'https://youtu.be/dQw4w9WgXcQ',
        bridgeUrl: 'http://127.0.0.1:8787',
      }),
    ).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it('downloads YouTube videos via Cobalt API when bridge root reports cobalt', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://cobalt.example.com/health') {
        return new Response('Not Found', { status: 404 });
      }
      if (url === 'https://cobalt.example.com/') {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({ status: 'tunnel', url: 'https://cobalt.example.com/stream/abc.mp4' }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ cobalt: { version: '10.0' } }), { status: 200 });
      }
      if (url === 'https://cobalt.example.com/stream/abc.mp4') {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.byteLength) },
        });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await ingestVideoFromUrl({
      rawUrl: 'https://youtu.be/dQw4w9WgXcQ',
      bridgeUrl: 'https://cobalt.example.com',
    });
    expect(res.file.size).toBe(bytes.byteLength);
  });
});
