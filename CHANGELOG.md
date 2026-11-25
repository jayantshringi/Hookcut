# Changelog

All notable changes to Hookcut will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-25

### Changed
- Rebranded project, package (`hookcut`), app title (`Hookcut`), IndexedDB cache (`hookcut-cache`), UI copy, documentation, and tests from ClipForge to **Hookcut**.

## [0.1.0] - 2026-11-25

### Added
- **Project & CI**: Vite + React 19 + TypeScript + Tailwind CSS v4 static SPA scaffold, ESLint, Vitest, Playwright E2E, Cloudflare Pages `public/_headers` (`COOP`/`COEP`), GitHub Actions CI, MIT `LICENSE`, `CONTRIBUTING.md`, issue templates, and `docs/MODELS.md`.
- **Capability Detection (`src/capabilities/`)**: On-load hardware/browser checks for WebGPU, WebCodecs (H.264 & AAC), RAM, CPU cores, storage quota, and COOP/COEP isolation, with automatic path selection and `CompatibilityPanel` warnings.
- **Streamed Input & Audio Extraction (`src/media/`, `src/workers/audioExtract.worker.ts`)**: Local-file-only validation (up to 30 min / 1 GB), 64 KB head/tail slice fingerprinting, Mediabunny `BlobSource` streamed 16 kHz mono resampling, 4 Hz RMS energy binning, and lazy-loaded `ffmpeg.wasm` fallback.
- **On-Device Whisper Transcription (`src/transcribe/`, `src/workers/whisper.worker.ts`)**: Transformers.js Whisper (`whisper-base.en` / `whisper-tiny.en`) with WebGPU + automatic WASM fallback, word-level timestamps, contraction/punctuation normalization, model download progress, cancellation, and IndexedDB caching.
- **Highlight Scoring & Local LLM Re-ranking (`src/scoring/`, `config/scoring.json`, `prompts/rerank_v1.md`)**: 20–60s sentence-snapped sliding windows, 9 normalized 0–1 features, silence/duration penalties, overlap deduplication, single-candidate WebGPU LLM re-rank with strict JSON + `hook_line` substring validation, 1-retry + heuristic fallback, and `scripts/eval.ts`.
- **Word-Safe Boundary Snapping (`src/scoring/boundarySnap.ts`)**: Never cuts mid-word, trims leading silence, and promotes strong follow-up hooks over weak filler openers.
- **9:16 Reframing & Video Export (`src/reframe/`, `src/render/`, `src/workers/faceTrack.worker.ts`, `src/workers/videoExport.worker.ts`)**: MediaPipe BlazeFace ~4 fps face tracking with 3-tap median + dead-zone + pan-rate crop smoothing, blurred-background fallback for wide/multi-speaker shots, OffscreenCanvas composition, Mediabunny H.264/AAC MP4 encoding (720p preview / 1080p export), and `ffmpeg.wasm` fallback.
- **Captions, Metadata & Studio UI (`src/captions/`, `src/metadata/`, `src/components/`)**: 6 safe-margin caption style presets with word-by-word highlighting and keyword emphasis, local title/description/hashtag and 9:16 thumbnail capture, mobile-friendly DropZone, live 9:16 PreviewPlayer, TrimHandles, ExportPanel, LegalModal (Privacy & content-ownership Terms), and donation links in Footer.
- **Testing**: 66 unit tests across 15 test files plus a Playwright E2E test against `fixtures/sample-video.webm` and `fixtures/sample-transcript.json`.
