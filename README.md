# L2S (Long-to-Short) — AI-Powered YouTube → Viral Shorts

> Turn long-form videos into viral-ready vertical shorts, entirely on your local machine. Free, no cloud restrictions.

Saw a bunch of paid tools doing this — why pay when you can run it locally? L2S uses **faster-whisper** for transcription, **Ollama** for AI ranking, and **FFmpeg** for rendering with advanced manual framing control. Everything runs on your machine.

L2S is a local web application with two modes:
- **⚡ Shorts Generator** — AI-powered clip selection, scoring, and rendering
- **✂️ Long Video Cutter** — Manual segment editor for precision cutting


## Tech Stack & Core Functionality

- **Languages**: JavaScript (Node.js), HTML, CSS
- **Frameworks**: Express.js (Backend)
- **Databases**: None (Uses local file system and JSON caching for storage)
- **Tools**: 
  - **yt-dlp**: Video downloading.
  - **FFmpeg**: Video processing, smart vertical cropping, and subtitle rendering. Supports GPU (NVENC) acceleration.
  - **Ollama**: Local LLM ranking for virality scoring.
  - **Groq Whisper API** (or local `faster-whisper`): Precise audio transcription with word-level timestamps.
- **Core Functionality**: A full-stack web application that downloads long-form videos, transcribes audio, automatically chunks and ranks segments based on virality using AI, and renders vertical short-form clips. 

*(Note: The automatic YouTube Shorts and Instagram Reels upload feature is currently a Work In Progress and not fully operational.)*

## Features

- **Download**: Pulls videos from YouTube using `yt-dlp` (or processes local video files).
- **Transcribe**: Uses the lightning-fast Groq Whisper API (or a local `faster-whisper` Python fallback) to transcribe audio with precise word-level timestamps.
- **Smart Clip Selection**: 6-signal heuristic scoring + LLM ranking to find the most viral-worthy segments.
- **Genre-Aware AI**: 12 genre profiles (motivational, comedy, educational, etc.) that tune scoring weights and LLM prompts.
- **Render**: Customizes the video with smart vertical cropping (16:9, 9:16, 1:1, 4:3) and renders the final MP4 clips with burned-in subtitles using FFmpeg.
- **GPU Acceleration**: Auto-detects NVIDIA GPU (NVENC) for 5-10x faster rendering, with graceful CPU fallback.
- **Parallel Rendering**: Renders 2 clips concurrently for faster output.
- **Long Video Cutter**: Dedicated page for manually cutting long videos into segments — no AI, just precision control.

## Clip Selection Scoring Pipeline

The core of L2S is its multi-signal clip selection pipeline. Here's how it works:

```
Transcript (Whisper) → segmenter.js (sliding windows)
                     → scorer.js (6-signal heuristics)
                     → pre-filter (top 30%)
                     → ranker.js (LLM scoring via Ollama)
                     → boundary refinement (snap to sentences + VAD trim)
                     → greedy diversity selection (overlap + text-sim penalty)
                     → Final clips
```

### The 6 Scoring Signals

Each candidate segment is scored 0–100 on six signals, weighted by genre:

| Signal | What it measures | Method |
|--------|-----------------|--------|
| **Hook Strength** | First 3 seconds quality | Question/claim/number detection + filler penalty |
| **Standalone** | Zero-context comprehensibility | Dangling pronoun + continuation-opener penalty |
| **Payoff/Structure** | Setup → tension → resolution arc | Transition markers + payoff in final 15% |
| **Emotion/Energy** | Excitement level | Emotional words + exclamations + speaking-rate variance |
| **Topic Density** | Genre relevance | Genre keyword density from `genre_config.js` |
| **Length Fit** | Ideal short length | Gaussian centered on 30s, tapering at [20, 45]s |

### Tuning the Scoring

All weights and thresholds live in [`src/genre_config.js`](src/genre_config.js):

```js
// Example: making motivational clips prioritize emotion + payoff
GENRE_PROFILES.motivational.weights = {
  hook: 0.15,       // How much the hook matters
  standalone: 0.10, // Standalone comprehensibility
  payoff: 0.25,     // Mini-arc / resolution quality
  emotion: 0.25,    // Emotional intensity
  topicDensity: 0.10, // Genre keyword relevance
  lengthFit: 0.15,  // Length in ideal range
};

// Global thresholds
SCORING_CONFIG.preFilterTopPercent = 0.30;  // Only send top 30% to LLM
SCORING_CONFIG.preFilterMinScore = 25;      // Minimum heuristic score
SCORING_CONFIG.idealLengthRange = [20, 45]; // Ideal short length (seconds)
```

### Dry-Run CLI (Test Scoring Without Rendering)

Test clip selection on any transcript without the full pipeline:

```bash
# Full pipeline (heuristic + LLM)
node src/dry_run.js temp/cache/video.transcript.json --genre motivational --clips 5

# Heuristic-only (fast, no Ollama needed)
node src/dry_run.js temp/cache/video.transcript.json --genre comedy --clips 3 --heuristic-only

# Options
node src/dry_run.js --help
```

This prints a formatted table with full score breakdowns so you can tune weights by inspecting real output without re-rendering video every time.

## Prerequisites

Before running the project, make sure you have the following installed on your system:

- **Node.js** (v18+)
- **FFmpeg** (Must be installed and added to your system PATH)
- **yt-dlp** (Must be installed and added to your system PATH)
- **Ollama** (For local AI ranking. Recommended model: `llama3.2:3b`)
- *(Optional)* **Python 3** (Only required if you plan to use local `faster-whisper` for transcription instead of the Groq API)

## Installation & Setup

1. **Clone the repository and navigate to the directory:**
   ```bash
   git clone https://github.com/yourusername/L2S.git
   cd L2S
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   Create or edit the `.env` file in the root directory:
   ```env
   OLLAMA_URL=http://localhost:11434
   MODEL=llama3.2:3b
   GROQ_API_KEY=your_groq_api_key_here  # Optional, for faster transcription
   ```

4. **Start the local server:**
   ```bash
   npm run dev
   ```
   *This will start the Node.js Express server on port 3000.*

5. **Open the Web UI:**
   Navigate to `http://localhost:3000` in your web browser.

## How to Use

### ⚡ Shorts Generator (AI Mode)
1. **Input**: Enter a YouTube URL or select a local video file.
2. **Process**: The app downloads, transcribes, scores, and AI-ranks clips automatically.
3. **Review**: Review the AI-ranked clips and choose the ones you want.
4. **Edit**: Adjust framing (pan/zoom), aspect ratio, and subtitle style.
5. **Render**: Click render to generate your final shorts. Output saved to `output/`.

### ⚡ Unified Creator Workflow (AI & Manual Mode)
1. **Import & Configure**: Paste any YouTube URL or local video path. Select genre, download quality, and output encoding preset (Fast, Balanced, High Q, Max Q). Optionally define manual timestamp ranges or enable "Only Timestamps" mode.
2. **Process**: Fully asynchronous child-process pipeline downloads (yt-dlp), transcribes (Whisper via faster-whisper or Groq), generates multi-signal heuristic scores, and performs AI viral ranking (Ollama / Groq).
3. **Review & Selection**: Inspect viral moments, hook badges, reason summaries, and pick candidate clips.
4. **Caption Studio & Fine-Tuning**: Open the live 9:16 Caption Studio. Preview 8 professional presets (Bold Highlight, Karaoke, Animated Pop, Cinematic, Clean Minimal, Podcast, Educational, Gaming Neon) with side-by-side View A vs View B comparison, adjust vertical safe zone position with instant TikTok/Reels UI collision warnings, and export .SRT or .ASS subtitles.
5. **Render & Publish**: Hardware-accelerated NVENC or CPU rendering produces pristine vertical shorts with burned-in subtitles and fast-start MP4 containers. Download locally or publish in 1-click directly to YouTube Shorts & Instagram Reels via official OAuth.
6. **AI Virality & Posting Guide**: Access real-time peak engagement windows, hook rules (<2.5s), optimal duration targets (30-45s), and genre-specific virality strategies directly within the unified results workspace.

## Project Structure

```
src/
├── ai/
│   ├── contracts.js         # BaseLLMProvider, BaseSTTProvider & AI contracts
│   ├── ollama_provider.js   # Local Ollama inference (RTX 2050 / CPU optimized)
│   ├── groq_provider.js     # Groq cloud LPU inference & Whisper STT
│   └── registry.js          # Dynamic provider registry (Ollama & Groq only)
├── captions/
│   ├── presets.js           # 8 Professional caption styles & mathematical styling
│   └── ass_builder.js       # Advanced SubStation Alpha (ASS) generator & escaping
├── video/
│   ├── quality_profiles.js  # Source download & export encoding profiles
│   └── verifier.js          # FFprobe validation & corrupt file detection
├── system/
│   └── disk_guard.js        # Storage capacity checks & safe directory cleanup
├── server.js          # Express + WebSocket server & REST APIs
├── pipeline.js        # Full end-to-end pipeline orchestrator & process management
├── downloader.js      # Video downloading (yt-dlp) with cookie & format fallbacks
├── transcriber.js     # Whisper transcription (Groq API / local)
├── clip_selector.js   # Clip selection orchestrator
├── segmenter.js       # Sliding-window segment generator
├── scorer.js          # 6-signal heuristic scorer
├── ranker.js          # LLM scoring + diversity selection
├── genre_config.js    # Genre weights, keywords, LLM modifiers
├── renderer.js        # FFmpeg rendering (GPU NVENC / CPU, parallel)
├── subtitles.js       # SRT/ASS subtitle generation
├── social.js          # Social media content generation
├── auth.js            # OAuth for YouTube & Instagram
├── cache_manager.js   # Storage & cache management
└── uploader.js        # Social media publishing

public/
├── index.html         # Unified single-page creator workspace & Live Studio
├── app.js             # Unified frontend logic & Caption Studio
└── style.css          # Modern dark design system with safe-zone overlays

tests/
├── ai_providers.test.js     # AI contracts, providers & key isolation tests
├── captions_studio.test.js  # Caption presets, ASS syntax, escaping & safe zones
├── export_profiles.test.js  # Export presets & hardware encoding benchmarks
├── pipeline_reliability.test.js # Disk guard, corrupt media & job state tests
├── quality.test.js          # Source format selection & fallback tests
├── segmenter.test.js        # Candidate window generation & boundary tests
├── scorer.test.js           # 6-signal virality heuristic tests
├── sorting.test.js          # Merge-sort & quick-select top-K tests
├── security.test.js         # URL & input validation tests
└── workflow_consolidation.test.js # Unified workflow, redirects & API tests

## Testing & Quality Assurance

Run the automated test suite with Node's native test runner:

```bash
npm test
```

## Security & OWASP Hardening (Version 2)

- **Content Security Policy (CSP)**: Strict headers defending against XSS, clickjacking, and unauthorized framing.
- **Argument Injection Protection**: Video URLs and directory paths are validated and safely separated with `--`.
- **Zero CVEs**: All transitive dependencies audited and remediated (`npm audit`).
- **CI/CD Pipeline**: GitHub Actions automatically runs matrix tests on Node 20.x and 22.x LTS.
