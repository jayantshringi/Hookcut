import { RESOLUTION_MAP, type ExportClipRequest, type ExportProgress, type ExportResult } from './types';

export interface FfmpegExportOptions {
  request: ExportClipRequest;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Lazy-loaded @ffmpeg/ffmpeg fallback for cutting, 9:16 scaling/cropping,
 * and MP4 export when WebCodecs H.264/AAC encoding is unavailable.
 */
export async function exportClipWithFfmpegFallback(
  options: FfmpegExportOptions,
): Promise<ExportResult> {
  const { request, signal, onProgress } = options;
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }

  const { width, height } = RESOLUTION_MAP[request.resolution];
  const durationSec = Math.max(0.1, request.endSec - request.startSec);

  onProgress?.({ phase: 'preparing', progress: 0.05, engine: 'ffmpeg-wasm' });

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);

  const ffmpeg = new FFmpeg();
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

  ffmpeg.on('progress', ({ progress }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    onProgress?.({
      phase: clamped > 0.92 ? 'finalizing' : 'rendering',
      progress: 0.1 + clamped * 0.88,
      engine: 'ffmpeg-wasm',
    });
  });

  const onAbort = () => {
    try {
      ffmpeg.terminate();
    } catch {
      // ignore
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }

    const mountDir = '/input';
    const safeName = request.file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'source.mp4';
    let inputPath = `${mountDir}/${safeName}`;
    let mounted = false;

    try {
      await ffmpeg.createDir(mountDir);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ffmpeg.mount('WORKERFS' as any, { files: [request.file] }, mountDir);
      mounted = true;
    } catch {
      // Guard against copying massive >300MB files into WASM MEMFS when WORKERFS is unavailable
      if (request.file.size > 300 * 1024 * 1024) {
        throw new Error(
          'WORKERFS unavailable for >300 MB file in ffmpeg.wasm fallback. Please use Chrome/Edge with WebCodecs enabled.',
        );
      }
      inputPath = `/${safeName}`;
      const reader = request.file.stream().getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      const buf = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        buf.set(c, offset);
        offset += c.byteLength;
      }
      await ffmpeg.writeFile(inputPath, buf);
    }

    const outputPath = '/hookcut_export.mp4';
    const scaleCropFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

    const exitCode = await ffmpeg.exec([
      '-ss',
      request.startSec.toFixed(3),
      '-t',
      durationSec.toFixed(3),
      '-i',
      inputPath,
      '-vf',
      scaleCropFilter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    if (exitCode !== 0) {
      throw new Error(`ffmpeg.wasm export failed with exit code ${exitCode}.`);
    }

    const raw = (await ffmpeg.readFile(outputPath)) as Uint8Array;
    const copy = raw.slice();
    const blob = new Blob([copy.buffer], { type: 'video/mp4' });

    try {
      await ffmpeg.deleteFile(outputPath);
      if (mounted) {
        await ffmpeg.unmount(mountDir);
      } else {
        await ffmpeg.deleteFile(inputPath);
      }
    } catch {
      // ignore cleanup failures
    }

    onProgress?.({ phase: 'finalizing', progress: 1, engine: 'ffmpeg-wasm' });
    return {
      blob,
      mimeType: 'video/mp4',
      durationSec,
      width,
      height,
      engine: 'ffmpeg-wasm',
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      ffmpeg.terminate();
    } catch {
      // ignore
    }
  }
}
