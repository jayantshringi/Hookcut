export interface TabCaptureSession {
  hasAudio: boolean;
  mimeType: string;
  stop: () => Promise<File>;
  cancel: () => void;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function isTabCaptureSupported(): boolean {
  return (
    typeof globalThis.navigator?.mediaDevices?.getDisplayMedia === 'function' &&
    typeof globalThis.MediaRecorder === 'function'
  );
}

export function pickRecorderMimeType(): string {
  if (typeof globalThis.MediaRecorder?.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

export function formatRecordingDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Starts capturing a browser tab or screen via MediaDevices.getDisplayMedia + MediaRecorder,
 * returning a controller that resolves to a local WebM/MP4 File when stopped.
 */
export async function startTabCaptureSession(options?: {
  onEndedExternally?: (file: File) => void;
  onError?: (message: string) => void;
}): Promise<TabCaptureSession> {
  if (!isTabCaptureSupported()) {
    throw new Error(
      'Browser tab recording is unsupported here. Please use desktop Chrome or Edge, or upload a local video file.',
    );
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: true,
  });

  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No video track was shared.');
  }

  const hasAudio = stream.getAudioTracks().length > 0;
  const mimeType = pickRecorderMimeType();
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });

  let stoppedByUser = false;
  let settled = false;

  const stopTracks = () => {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
  };

  const stopPromise = new Promise<File>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      stopTracks();
      const err = new Error('Tab recording failed.');
      options?.onError?.(err.message);
      reject(err);
    };

    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      stopTracks();
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size === 0) {
        const err = new Error('Captured recording was empty.');
        options?.onError?.(err.message);
        reject(err);
        return;
      }
      const file = new File([blob], `tab-capture.${ext}`, {
        type: mimeType.split(';')[0] || `video/${ext}`,
        lastModified: Date.now(),
      });
      if (!stoppedByUser) {
        options?.onEndedExternally?.(file);
      }
      resolve(file);
    };
  });

  // Handle user clicking the browser's built-in "Stop sharing" banner
  videoTracks[0]!.addEventListener(
    'ended',
    () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    },
    { once: true },
  );

  recorder.start(1000);

  return {
    hasAudio,
    mimeType,
    stop: async () => {
      stoppedByUser = true;
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      return stopPromise;
    },
    cancel: () => {
      stoppedByUser = true;
      settled = true;
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {
        // ignore
      }
      stopTracks();
    },
  };
}
