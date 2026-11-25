# Contributing to Hookcut

Thank you for helping make **Hookcut** better! Hookcut is a 100% free, open-source, browser-only video repurposer that runs completely on the user's device.

## Development Principles

- **Privacy & Zero Backend**: All video decoding, AI transcription, highlight scoring, face detection, caption rendering, and MP4 encoding must run client-side in the browser. Never introduce telemetry, external API uploads, or API key requirements.
- **Worker-First**: Keep heavy inference and media processing inside Web Workers so the main UI thread stays responsive.
- **Resource Cleanup**: Always close `VideoFrame`, `AudioData`, `ImageBitmap`, and dispose model sessions when finished or cancelled.

## Getting Started

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```
2. Run the local dev server (with COOP/COEP headers enabled):
   ```bash
   npm run dev
   ```
3. Run checks before opening a PR:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
4. Evaluate scoring weights on sample transcripts:
   ```bash
   npm run eval
   ```

## Commit & Branch Conventions

- Branch from `main` using descriptive names (`feat/...`, `fix/...`, `docs/...`).
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:`, `perf:`.
- Update `CHANGELOG.md` for user-facing changes.
