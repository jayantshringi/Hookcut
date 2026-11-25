# Models & Licenses

Hookcut downloads and caches all ML models directly inside the user's browser (via Cache Storage / IndexedDB). No inference runs on any remote server.

| Role | Model ID | Source | License | Runtime | Approximate Size |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Speech-to-Text (ASR) | `onnx-community/whisper-tiny.en_timestamped` (default fast) / `onnx-community/whisper-base.en_timestamped` (quality) | Hugging Face / OpenAI Whisper | MIT | `@huggingface/transformers` (WebGPU / WASM) | ~40 MB (tiny) / ~75 MB (base) |
| Highlight Re-ranking (LLM) | `onnx-community/Qwen2.5-0.5B-Instruct` (optional WebGPU) / fallback `HuggingFaceTB/SmolLM2-360M-Instruct` | Hugging Face / Qwen & HuggingFaceTB | Apache-2.0 | `@huggingface/transformers` (WebGPU) | ~300–400 MB (q4f16) |
| Face Detection | `blaze_face_short_range` (`float16`) | Google MediaPipe | Apache-2.0 | `@mediapipe/tasks-vision` (WebGL / CPU WASM) | ~230 KB |

## Notes
- Whisper weights by OpenAI are released under the **MIT License**.
- Qwen2.5-0.5B-Instruct and SmolLM2-360M-Instruct are released under the **Apache-2.0 License**.
- MediaPipe BlazeFace is released under the **Apache-2.0 License**.
- FFmpeg.wasm (`@ffmpeg/ffmpeg` / `@ffmpeg/core`) is used only as an optional lazy-loaded fallback for browsers without WebCodecs H.264/AAC support and follows LGPL/GPL component licensing depending on core build.
