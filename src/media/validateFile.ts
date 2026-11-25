import { MAX_VIDEO_DURATION_SEC, MAX_VIDEO_FILE_BYTES } from './types';

const ALLOWED_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi', 'ogv']);

export class FileValidationError extends Error {
  readonly code:
    | 'empty-file'
    | 'file-too-large'
    | 'unsupported-format'
    | 'duration-exceeded'
    | 'no-video-track'
    | 'unreadable-file';

  constructor(
    code: FileValidationError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'FileValidationError';
    this.code = code;
  }
}

export function validateSelectedFile(file: Pick<File, 'name' | 'size' | 'type'>): void {
  if (!file || file.size <= 0) {
    throw new FileValidationError('empty-file', 'The selected file is empty.');
  }

  if (file.size > MAX_VIDEO_FILE_BYTES) {
    const sizeGb = (file.size / (1024 * 1024 * 1024)).toFixed(2);
    throw new FileValidationError(
      'file-too-large',
      `File is ${sizeGb} GB. ClipForge supports local files up to 1.00 GB.`,
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isVideoMime = file.type.startsWith('video/');
  if (!isVideoMime && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new FileValidationError(
      'unsupported-format',
      `Unsupported file format (${file.type || ext || 'unknown'}). Please choose an MP4, MOV, WebM, or MKV video.`,
    );
  }
}

export function validateVideoDuration(durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new FileValidationError(
      'unreadable-file',
      'Could not determine video duration from container metadata.',
    );
  }
  if (durationSec > MAX_VIDEO_DURATION_SEC) {
    const mins = (durationSec / 60).toFixed(1);
    throw new FileValidationError(
      'duration-exceeded',
      `Video is ${mins} minutes long. ClipForge v1 supports videos up to 30 minutes.`,
    );
  }
}

async function readSliceArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file slice as ArrayBuffer.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Computes a deterministic cache key by slicing only the header and tail of the file
 * so multi-hundred-MB files are never read fully into memory.
 */
export async function computeFileFingerprint(file: Blob & { name?: string; lastModified?: number }): Promise<string> {
  const sliceLen = Math.min(64 * 1024, file.size);
  const tailStart = Math.max(0, file.size - sliceLen);
  const [headBuf, tailBuf] = await Promise.all([
    readSliceArrayBuffer(file.slice(0, sliceLen)),
    readSliceArrayBuffer(file.slice(tailStart, file.size)),
  ]);

  const head = new Uint8Array(headBuf);
  const tail = new Uint8Array(tailBuf);

  let hash = 2166136261;
  for (let i = 0; i < head.length; i++) {
    hash ^= head[i]!;
    hash = Math.imul(hash, 16777619);
  }
  for (let i = 0; i < tail.length; i++) {
    hash ^= tail[i]!;
    hash = Math.imul(hash, 16777619);
  }

  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${file.name ?? 'video'}:${file.size}:${file.lastModified ?? 0}:${hex}`;
}
