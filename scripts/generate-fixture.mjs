import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

async function main() {
  const server = await createServer({ server: { host: '127.0.0.1', port: 4179 } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4179');

    const encoded = await page.evaluate(async () => {
      const mb = await import('/node_modules/mediabunny/dist/modules/src/index.js');

      const vH264 = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f',
        width: 640,
        height: 360,
        bitrate: 350_000,
        framerate: 15,
      });
      const aAac = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 1,
        bitrate: 64_000,
      });

      const useMp4 = Boolean(vH264.supported && aAac.supported);
      const format = useMp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat();
      const target = new mb.BufferTarget();
      const output = new mb.Output({ format, target });

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      const videoSource = new mb.CanvasSource(canvas, {
        codec: useMp4 ? 'avc' : 'vp9',
        quality: new mb.Quality('low'),
        keyFrameInterval: 2,
      });
      output.addVideoTrack(videoSource, { frameRate: 15 });

      const audioSource = new mb.AudioBufferSource({
        codec: useMp4 ? 'aac' : 'opus',
        quality: new mb.Quality('low'),
      });
      output.addAudioTrack(audioSource);

      await output.start();

      // Generate 12 seconds @ 15 fps = 180 frames with a moving portrait-subject circle
      const fps = 15;
      const durationSec = 12;
      const totalFrames = fps * durationSec;
      for (let i = 0; i < totalFrames; i++) {
        const t = i / fps;
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, 640, 360);

        const cx = 220 + Math.sin(t * 0.7) * 90;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(cx, 145, 52, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f4f4f5';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(`ClipForge Sample ${t.toFixed(1)}s`, 32, 315);

        await videoSource.add(t, 1 / fps);
      }
      videoSource.close();

      // Generate 12 seconds of modulated 48 kHz mono audio
      const sampleRate = 48000;
      const audioCtx = new OfflineAudioContext(1, sampleRate * durationSec, sampleRate);
      const audioBuffer = audioCtx.createBuffer(1, sampleRate * durationSec, sampleRate);
      const ch = audioBuffer.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        const t = i / sampleRate;
        const env = Math.sin(t * Math.PI * 2) > -0.3 ? 0.25 : 0.01;
        ch[i] = Math.sin(2 * Math.PI * 330 * t) * env;
      }
      await audioSource.add(audioBuffer);
      audioSource.close();

      await output.finalize();
      const bytes = Array.from(new Uint8Array(target.buffer));
      return { ext: useMp4 ? 'mp4' : 'webm', bytes };
    });

    const outPath = resolve(process.cwd(), `fixtures/sample-video.${encoded.ext}`);
    writeFileSync(outPath, Buffer.from(encoded.bytes));
    console.log(`Generated ${outPath} (${encoded.bytes.length} bytes)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
