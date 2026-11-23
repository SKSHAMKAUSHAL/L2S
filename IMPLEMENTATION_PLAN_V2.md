# L2S Industrial Redesign — Complete Version 2 Implementation Plan

**Date:** November 2026  
**Status:** Awaiting User Approval (HARD APPROVAL GATE: No source code modified, no dependencies installed, no models downloaded)  
**Target:** Single-Workspace Industrial Long-to-Short Creation Suite  

---

## 1. Executive Summary & Existing vs. Target Comparison

| Capability | Current State | Target Version 2 State |
|---|---|---|
| **Architecture** | Split across main page, separate `/dashboard`, and fragmented editor | **Single Unified Workspace**: Clean, single-page workflow (Import → Quality → Transcribe → AI Rank → Side-by-Side Caption Studio → Export) |
| **Dashboard** | 40KB separate `dashboard.html`, `dashboard.js`, `dashboard.css`, `dashboard_manager.js` | **Completely Removed**: Essential system status & quota metrics unified into a compact status drawer |
| **Long Video Cutter** | Disjointed references, separate editor logic | **Integrated Trimming**: Precision start/end, VAD snap, and frame-accurate seeking integrated directly into the workspace |
| **Captions Experience** | Single hardcoded yellow font style, basic on/off toggle | **Dedicated Caption Studio**: 8 professional presets, live side-by-side comparison on same timestamp, accurate ASS rendering |
| **Video Quality** | Basic 1080p/720p selection | **Granular Controls**: Source download quality (Original/4K/1440p/1080p/720p/Audio) + Export quality (Fast/Balanced/HQ/Max) with FFprobe verification |
| **AI Independence** | Hardcoded Ollama dependency with heuristic fallback | **Provider-Agnostic Adapters**: Pluggable Speech-to-Text (Groq Whisper, local Whisper) and LLM (Ollama, Groq, OpenAI) with switchable System Status |
| **Security & Safety** | Basic headers added on `version-2` | **Industrial OWASP Hardening**: Strict CSP, argument injection isolation, path traversal defense, 0 CVEs, safe token masking |
| **Testing & QA** | 13 unit tests | **12-Category Quality Engineering**: Unit, integration, E2E, stress, failure scenario, and regression testing suites |

---

## 2. Hardware Audit & Ollama Model Benchmark Evaluation

### 2.1 Hardware Specifications (Inspected)
- **CPU**: 12th Gen Intel Core i5-12450HX (8 cores: 4 P-cores, 4 E-cores, 12 logical threads)
- **RAM**: 12.0 GB System RAM
- **Dedicated GPU**: NVIDIA GeForce RTX 2050 Mobile
- **VRAM**: **4,096 MB (4.0 GB) GDDR6**, CUDA 13.3 support, NVENC hardware encoder enabled
- **Storage**: C: Drive with ~19.6 GB free space
- **Operating System**: Windows 11 (64-bit)

### 2.2 Model Feasibility & Recommendation Matrix

| Model | Parameters | Quantization | RAM/VRAM Required | Fits RTX 2050 4GB VRAM? | Expected Tokens/Sec | Ranking Quality & JSON Reliability | Suitability Verdict |
|---|---|---|---|---|---|---|---|
| **Llama-3.2-3B-Instruct** | 3.2B | Q4_K_M | **~2.2 GB** | **YES (100% GPU)** | **65–85 tok/s** | High (native JSON mode, sharp hook detection) | **RECOMMENDED LOCAL PRIMARY** |
| **Qwen2.5-3B-Instruct** | 3.1B | Q4_K_M | **~2.1 GB** | **YES (100% GPU)** | **70–90 tok/s** | Exceptional (dense instruction following, structured output) | **BEST LOCAL ALTERNATIVE** |
| **Llama-3.2-1B-Instruct** | 1.2B | Q4_K_M | **~1.1 GB** | **YES (100% GPU)** | **110–140 tok/s** | Moderate (faster, occasionally needs prompt retry) | **LIGHTWEIGHT FAST LOCAL** |
| **Llama-3.1-8B-Instruct** | 8.0B | Q4_K_M | **~5.5 GB** | **NO (VRAM Spillover)** | **9–16 tok/s** | Very High (but spills ~1.5GB into slow system RAM) | **NOT RECOMMENDED ON 4GB VRAM** |
| **Groq (Llama-3.3-70B)** | 70B | Cloud LPUs | **0 GB Local** | **N/A (Cloud)** | **350–500 tok/s** | State-of-the-art virality analysis & social copy | **BEST CLOUD ALTERNATIVE** |
| **OpenAI (GPT-4o-mini)** | ~8B eq. | Cloud | **0 GB Local** | **N/A (Cloud)** | **90–120 tok/s** | Industry standard structured JSON | **SOLID CLOUD ALTERNATIVE** |

**Installation Commands (for recommended local models):**
```bash
# Recommended Primary (3.2B, fits 100% in 4GB VRAM)
ollama run llama3.2:3b

# Lightweight Alternative (1.2B, ultra-fast)
ollama run llama3.2:1b
```

---

## 3. Architecture & Provider-Independent AI Design

```
                               ┌────────────────────────────────┐
                               │   AI Provider Registry & Bus   │
                               │        (src/ai/registry.js)    │
                               └───────────────┬────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               │                                                               │
     ┌─────────▼─────────────┐                                       ┌─────────▼─────────────┐
     │  Speech-to-Text (STT) │                                       │   LLM Ranking & Text  │
     │  Standard Interface   │                                       │   Standard Interface  │
     ├───────────────────────┤                                       ├───────────────────────┤
     │ + transcribe(audio)   │                                       │ + rankSegments(...)   │
     │ + isAvailable()       │                                       │ + generateSocial(...) │
     │ + testConnection()    │                                       │ + testConnection()    │
     └─────────┬─────────────┘                                       └─────────┬─────────────┘
               │                                                               │
       ┌───────┴──────────────┐                                    ┌───────────┼───────────┐
       │                      │                                    │           │           │
┌──────▼──────┐       ┌───────▼──────┐                      ┌──────▼─────┐ ┌───▼────┐ ┌────▼─────┐
│ Groq Whisper│       │ Local Faster-│                      │   Ollama   │ │  Groq  │ │  OpenAI  │
│ Cloud API   │       │ Whisper      │                      │(llama3.2)  │ │(Llama3)│ │(4o-mini) │
└─────────────┘       └──────────────┘                      └────────────┘ └────────┘ └──────────┘
```

### Safety & Privacy Rules:
1. **Zero Silent Cloud Fallback**: If the user selects Local Ollama, the system will *never* upload audio/video to the cloud upon failure. It logs an error and prompts the user.
2. **Backend-Only Credential Storage**: All API keys (`GROQ_API_KEY`, `OPENAI_API_KEY`) stay strictly in `.env` on the server and are masked (`gsk_...***`) before being sent to the browser.
3. **Pluggable UI Switcher**: In the header System Status, users can switch the active provider with 1 click, test connectivity, and inspect response latency.

---

## 4. Professional Caption Studio (Deep Dive)

### 4.1 Professional Caption Styles & ASS Implementation

| Style Name | Description | Target Niche | Visual Features |
|---|---|---|---|
| **1. Clean Minimal** | Sans-serif, semi-transparent black pill box | Tech, Business, Podcasts | White Arial/Inter, subtle background box, no distraction |
| **2. Cinematic** | Serif/Clean, letterboxed with tracking | Storytelling, Documentaries | Georgia/Merriweather, subtle dropshadow, elegant line breaks |
| **3. Bold Highlight** | Thick condensed font, active word pop in neon | Viral TikTok/Reels | Montserrat/Arial Black, active word bright yellow/cyan |
| **4. Word-by-Word Karaoke** | Progressive word color fill as spoken | High-tempo speeches, Rap | Dual-tone fill (`\k` ASS tags) tracking word timestamps |
| **5. Animated Word Pop** | 1-2 words on screen at a time, bounce scale | High-energy shorts | 120% scale-up on entrance (`\fscx120\fscy120`), rapid cycle |
| **6. Podcast Studio** | Dual-line layout with speaker badge | Interviews, Podcasts | Subdued styling, bottom-third alignment, safe margins |
| **7. Educational / Explainer** | Clean highlighted key terms, boxed emphasis | Tutorials, Facts, Science | Rounded highlight boxes on technical terminology |
| **8. Gaming / High Energy** | Heavy italicized stroke, vibrant gradients | Gaming, Memes, Reactions | Heavy black outline (8px), skewed angle (`\frz-3`), vibrant red/yellow |

### 4.2 Side-by-Side Live Comparison Engine
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CAPTION STUDIO PREVIEW                                 │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│    Original (No Sub)     │    Style A: Bold Pop     │    Style B: Word Karaoke         │
│  [ Video at 00:14.2 ]    │   [ Video at 00:14.2 ]   │     [ Video at 00:14.2 ]         │
│                          │      THIS is why you     │        THIS is why you           │
│   (Clean video frame)    │        *FAIL* daily      │       (green word wipe)          │
│                          │                          │                                  │
│                          │     [ Select Style ]     │     [ Select Style ] (Active)    │
├──────────────────────────┴──────────────────────────┴──────────────────────────────────┤
│ Controls: [Font Size: 32px] [Position: Bottom] [Highlight: #00FFCC] [Apply to All Clips]│
└────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Live Syncing**: Synchronizes HTML5 `<video>` timestamps across split canvases.
- **Visual Parity**: Uses CSS canvas overlays matching the exact ASS coordinate space (`PlayResX: 1080`, `PlayResY: 1920`) so what the user sees in the browser matches the FFmpeg-rendered MP4 pixel-for-pixel.

---

## 5. Video Quality & Export Pipeline

### 5.1 Source Quality Matrix
- **Best Available**: Auto-negotiates max resolution via `yt-dlp` format hierarchy.
- **4K / 1440p / 1080p / 720p**: Strict height limits without artificial upscaling. If 4K is requested on a 1080p video, the UI notifies: *"Maximum available source resolution is 1080p. Downloading in 1080p native."*
- **Audio Preservation**: Copies source AAC/Opus streams or transcodes losslessly to 16-bit 48kHz PCM for clipping.

### 5.2 Export Encoding Profiles
| Profile | NVENC Preset / CPU Equivalent | Rate Control | Audio Bitrate | Target Use Case |
|---|---|---|---|---|
| **Fast** | `p1` (NVENC) / `veryfast` (x264) | CRF 26 / CQ 28 | 128 kbps AAC | Quick preview drafts |
| **Balanced** | `p4` (NVENC) / `medium` (x264) | CRF 22 / CQ 24 | 192 kbps AAC | Standard social export (Reels/Shorts) |
| **High Quality** | `p6` (NVENC) / `slow` (x264) | CRF 18 / CQ 20 | 256 kbps AAC | High-bitrate crisp details (Recommended) |
| **Maximum** | `p7` (NVENC) / `slower` (x264) | CRF 15 / CQ 16 | 320 kbps AAC | Master archive quality |

---

## 6. Industrial Package Manager Comparison: npm vs Bun

| Evaluation Criterion | npm (Current Default) | Bun (Alternative) | Industrial Analysis |
|---|---|---|---|
| **Install Speed** | ~4 seconds on this repo | ~0.8 seconds | Bun is faster, but 3 seconds difference on a 70-package repo is negligible |
| **Windows Process Spawning** | 100% battle-tested `child_process` with Win32 job objects | Known Windows PTY and async handle edge cases | L2S relies heavily on continuous stdout/stderr streams from FFmpeg/yt-dlp. Node is significantly more stable on Windows. |
| **Native Tooling** | Native `node:test` runner built-in | Custom `bun:test` | `node:test` requires zero dependencies and integrates seamlessly with CI. |
| **Ecosystem & CVE Auditing** | `npm audit` with automated vulnerability database | No native `bun audit` command | Security compliance is superior on npm. |
| **Verdict** | **KEEP npm AS PRIMARY** | **OPTIONAL DEV ALTERNATIVE** | Retain `npm` as the stable production standard on Windows. |

---

## 7. File-by-File Change Plan

### 7.1 Files to Remove (Dead Code & Bulky Auxiliary Pages)
1. `public/dashboard.html` — Delete standalone dashboard page.
2. `public/dashboard.js` — Delete dashboard frontend logic.
3. `public/dashboard.css` — Delete dashboard styles.
4. `src/dashboard_manager.js` — Delete dashboard data persistence layer.
5. `public/long-cuts.*` (if present) — Delete separate long cutter artifacts; consolidate editor into main UI.
6. `temp.md`, `STATUS.txt` — Remove obsolete scratch files.

### 7.2 Files to Create (New Modular Architecture)
1. `src/ai/registry.js` — Central provider registry and abstraction bus.
2. `src/ai/providers/ollama.js` — Local Ollama LLM provider adapter.
3. `src/ai/providers/groq.js` — Groq Cloud LLM provider adapter.
4. `src/ai/providers/openai.js` — OpenAI ChatGPT provider adapter.
5. `src/ai/stt/whisper_groq.js` — Groq Whisper cloud speech-to-text adapter.
6. `src/ai/stt/whisper_local.js` — Local faster-whisper speech-to-text adapter.
7. `src/captions/presets.js` — Specifications for all 8 professional caption styles.
8. `src/captions/ass_builder.js` — Industrial ASS subtitle generator supporting Karaoke, Pop, and Boxing.
9. `src/video/quality_profiles.js` — Video download and render profile matrix.
10. `tests/captions.test.js` — Unit tests for all caption presets and coordinate math.
11. `tests/ai_providers.test.js` — Contract tests for LLM and STT adapters.

### 7.3 Files to Modify (Core Refactoring)
1. `src/server.js`:
   - Remove `/dashboard` and `/api/dashboard/*` endpoints.
   - Add `/api/providers` (get status, switch active provider, test connection).
   - Add `/api/caption-presets` (serve style specs to frontend).
   - Integrate quality profiles into `/api/process` and `/api/render`.
2. `src/subtitles.js`:
   - Route subtitle generation through `src/captions/ass_builder.js` supporting all 8 presets.
3. `src/renderer.js`:
   - Accept export quality preset (Fast/Balanced/HQ/Max) and configure NVENC/libx264 parameters dynamically.
4. `public/index.html`:
   - Remove "Creator Studio Dashboard" navigation links.
   - Add **Caption Studio** section with side-by-side comparison tabs.
   - Add **System Status & AI Switcher** compact drawer.
   - Add **Quality Selector** (Source Download Quality & Final Export Quality).
5. `public/app.js`:
   - Implement side-by-side live video preview for caption comparison.
   - Add live caption rendering on canvas overlay.
   - Wire provider switching without page reloads.

---

## 8. Quality Engineering & 12-Category Test Matrix

1. **Unit Testing**: Segmenter sentence snapping, 6-signal heuristic scorer, ASS tag generation, sorting algorithms.
2. **Integration Testing**: Whisper transcript → Segmenter → AI Ranker → Clip Selector pipeline.
3. **API & Contract Testing**: `/api/providers`, `/api/process`, `/api/render`, `/api/video-info`.
4. **Caption Parity Testing**: Verify HTML5 canvas preview coordinates match FFmpeg ASS output within 1px.
5. **Video Quality Verification**: Inspect rendered MP4s with `ffprobe` to verify requested resolution, bitrate, and audio streams.
6. **Provider Fallback & Error Handling**: Test pipeline behavior when Ollama is offline, Groq rate-limited, or network drops.
7. **Security & Injection Testing**: Command line argument injection (`--` flags), path traversal, and CSP headers.
8. **Concurrency & Load Testing**: 2-clip and 4-clip parallel rendering without GPU VRAM exhaustion.
9. **Stress & Durability Testing**: 2-hour long video transcription and 20+ clip generation soak test.
10. **Hardware Resource Monitoring**: Measure VRAM usage on RTX 2050 during Ollama inference and NVENC encoding.
11. **Browser & Responsive Testing**: Verify layout and side-by-side previews on 1080p, 1440p, and mobile viewports.
12. **Automated Regression Suite**: CI-automated regression runner on every commit.

---

## 9. Rollback Strategy

1. **Branch Isolation**: All changes are made strictly on `version-2`. The `main` branch remains untouched and operational.
2. **Atomic Commits**: Each phase (Removal, AI Adapters, Caption Studio, Quality Pipeline, Test Suite) is committed independently.
3. **Zero Destructive Data Loss**: No local clips, user files, or credentials are deleted without explicit backup.
