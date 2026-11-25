import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const SAMPLE_VIDEO_BYTES = Array.from(
  readFileSync(resolve(process.cwd(), 'fixtures/sample-video.webm')),
);
const SAMPLE_TRANSCRIPT = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/sample-transcript.json'), 'utf8'),
);

test('processes a local sample video end-to-end in the browser', async ({ page }) => {
  await page.goto('/');

  // Verify COOP/COEP isolation is active
  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  expect(isolated).toBe(true);

  await expect(page.getByText('Hookcut', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Device compatibility check')).toBeVisible();
  await expect(page.getByText(/WebGPU|WASM Isolation/i).first()).toBeVisible();

  // Seed IndexedDB transcript cache matching the exact sample-video.webm fingerprint
  // so E2E tests run deterministically offline without downloading 40+ MB HuggingFace weights.
  await page.evaluate(
    async ({ videoBytes, transcriptTemplate }) => {
      const bytes = new Uint8Array(videoBytes);
      const lastModified = 1700000000000;
      const file = new File([bytes], 'sample-video.webm', {
        type: 'video/webm',
        lastModified,
      });

      const sliceLen = Math.min(64 * 1024, file.size);
      const head = new Uint8Array(await file.slice(0, sliceLen).arrayBuffer());
      const tail = new Uint8Array(
        await file.slice(Math.max(0, file.size - sliceLen), file.size).arrayBuffer(),
      );

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
      const fingerprint = `${file.name}:${file.size}:${lastModified}:${hex}`;

      await new Promise<void>((resolveDb, rejectDb) => {
        const req = indexedDB.open('hookcut-cache', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('transcripts')) {
            db.createObjectStore('transcripts', { keyPath: 'cacheKey' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('transcripts', 'readwrite');
          const store = tx.objectStore('transcripts');
          for (const modelId of [
            'onnx-community/whisper-tiny.en_timestamped',
            'onnx-community/whisper-base.en_timestamped',
          ]) {
            const record = {
              cacheKey: `${fingerprint}::${modelId}`,
              transcript: {
                ...transcriptTemplate,
                fileFingerprint: fingerprint,
                modelId,
              },
            };
            store.put(record);
          }
          tx.oncomplete = () => {
            db.close();
            resolveDb();
          };
          tx.onerror = () => rejectDb(tx.error);
        };
        req.onerror = () => rejectDb(req.error);
      });

      // Dispatch drag-and-drop onto DropZone with the exact File object
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { videoBytes: SAMPLE_VIDEO_BYTES, transcriptTemplate: SAMPLE_TRANSCRIPT },
  );

  // Real Mediabunny audio extraction + cached transcript + scoring + snapping runs
  await expect(page.getByText(/Found 1 viral-ready clip/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByLabel('Detected highlight clips')).toBeVisible();
  await expect(page.getByLabel('9:16 portrait preview player')).toBeVisible();

  // Verify 720p portrait preview canvas dimensions
  const canvasDims = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas ? { width: canvas.width, height: canvas.height } : null;
  });
  expect(canvasDims).toEqual({ width: 720, height: 1280 });

  // Interact with CaptionStylePicker & TrimHandles
  await page.getByRole('button', { name: /Neon Pill/i }).click();
  await page.getByRole('button', { name: /\+0\.5s/i }).first().click();

  // Capture a real 9:16 JPEG thumbnail from sample-video.webm
  await page.getByRole('button', { name: /Capture Thumbnail/i }).click();
  await expect(page.getByAltText('Clip thumbnail')).toBeVisible({ timeout: 15_000 });

  // Open Legal Modal and verify content ownership terms
  await page.getByRole('button', { name: /Terms \(Rights Required\)/i }).click();
  await expect(page.getByRole('dialog', { name: 'Terms of Use' })).toBeVisible();
  await expect(page.getByText(/hold full copyright, license, or explicit permission/i)).toBeVisible();
});

test('processes a YouTube link via the bridge into 9:16 clips', async ({ page }) => {
  await page.route('**/api/yt-bridge/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: false }),
    });
  });
  await page.route('http://127.0.0.1:8787/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ytdlpVersion: '2026.10.01' }),
    });
  });
  await page.route('http://127.0.0.1:8787/info*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        videoId: 'dQw4w9WgXcQ',
        title: 'Hookcut Demo Talk',
        uploader: 'Hookcut',
        durationSec: 12,
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      }),
    });
  });
  await page.route('http://127.0.0.1:8787/download*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      body: Buffer.from(SAMPLE_VIDEO_BYTES),
    });
  });

  await page.goto('/');

  // Pre-seed IndexedDB transcript matching File("hookcut-demo-talk.mp4", { lastModified: 0 })
  await page.evaluate(
    async ({ videoBytes, transcriptTemplate }) => {
      const bytes = new Uint8Array(videoBytes);
      const file = new File([bytes], 'hookcut-demo-talk.mp4', {
        type: 'video/mp4',
        lastModified: 0,
      });
      const sliceLen = Math.min(64 * 1024, file.size);
      const head = new Uint8Array(await file.slice(0, sliceLen).arrayBuffer());
      const tail = new Uint8Array(
        await file.slice(Math.max(0, file.size - sliceLen), file.size).arrayBuffer(),
      );
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
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${hex}`;

      await new Promise<void>((resolveDb, rejectDb) => {
        const req = indexedDB.open('hookcut-cache', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('transcripts')) {
            db.createObjectStore('transcripts', { keyPath: 'cacheKey' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('transcripts', 'readwrite');
          const store = tx.objectStore('transcripts');
          for (const modelId of [
            'onnx-community/whisper-tiny.en_timestamped',
            'onnx-community/whisper-base.en_timestamped',
          ]) {
            store.put({
              cacheKey: `${fingerprint}::${modelId}`,
              transcript: {
                ...transcriptTemplate,
                fileFingerprint: fingerprint,
                modelId,
              },
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolveDb();
          };
          tx.onerror = () => rejectDb(tx.error);
        };
        req.onerror = () => rejectDb(req.error);
      });
    },
    { videoBytes: SAMPLE_VIDEO_BYTES, transcriptTemplate: SAMPLE_TRANSCRIPT },
  );

  await page.getByRole('button', { name: /YouTube \/ Video URL/i }).click();
  await page.getByLabel(/YouTube or video URL/i).fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: /Fetch & Forge/i }).click();

  await expect(page.getByText(/Found 1 viral-ready clip/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByLabel('Detected highlight clips')).toBeVisible();
  await expect(page.getByLabel('9:16 portrait preview player')).toBeVisible();
});
