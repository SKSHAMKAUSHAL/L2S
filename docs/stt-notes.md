# Groq Speech-to-Text (STT) Technical Notes & Specifications

**Reference Documentation:**
- Groq Audio API Reference: https://console.groq.com/docs/speech-text
- Groq Supported Models: https://console.groq.com/docs/models#whisper
- OpenAI Compatibility & Granularity: https://platform.openai.com/docs/api-reference/audio/createTranscription

---

## 1. Supported Whisper Models on Groq
| Model Name | Groq Identifier | Context / Target Use |
| :--- | :--- | :--- |
| **Whisper Large v3 Turbo** | `whisper-large-v3-turbo` | Ultra-fast execution, optimized for English & multilingual speed. |
| **Whisper Large v3** | `whisper-large-v3` | Highest accuracy, superior for Indic languages (Hindi, Hinglish, Tamil, etc.). |

---

## 2. API Limits & Parameters
- **Max File Upload Size:** 25 MB (strictly enforced HTTP 413 `Request Entity Too Large` if exceeded).
- **Supported Audio Containers:** `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`.
- **Response Format:** `verbose_json` returns detailed duration, language, segments, and word-level timestamps.
- **Timestamp Granularities:** `timestamp_granularities: ["word", "segment"]` (requires `response_format: "verbose_json"`).
- **Prompt Token Ceiling:** Whisper accepts up to 224 prompt tokens. Prompts must be kept under 200 tokens to prevent silent truncation.
- **Rate Limits & HTTP Statuses:**
  - `413`: Payload Too Large (handled by pre-compression and 10-minute chunking).
  - `429`: Rate Limit Exceeded (handled via exponential backoff with jitter and `Retry-After` header parsing).
  - `5xx`: Upstream Server Errors (retried up to 3 times).

---

## 3. Audio Prep & Splitting Strategy
- **Standard Format:** 16 kHz mono.
- **Pre-Compression Threshold:** When raw PCM WAV exceeds 20 MB, FFmpeg re-encodes it using `libmp3lame` at 48 kbps mono 16 kHz. A 64 MB WAV drops to ~12 MB.
- **Silence-Aware Chunking:** For files exceeding 24 MB (>65 min audio):
  - Target chunk duration is 600s (10 minutes).
  - Splitting occurs at the quietest point within `±10s` of the boundary using FFmpeg `silencedetect`.
  - Timestamps are offset by chunk start time and overlapping duplicate words are pruned.
