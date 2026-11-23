# Recovered Historical Files

Recovered from Git commit `82ae01a` ("Update application features and styles") before they were archived/removed. These files serve as reference implementations for Step 6 (Face-tracked reframing) and caption/transcript processing.

## Files Overview

### 1. `face_detect.py`
- **Source Commit:** `82ae01a:scripts/face_detect.py`
- **Purpose:** Extracts video frames, detects facial landmarks and bounding boxes using OpenCV/MediaPipe, and outputs frame-indexed face center coordinates `(x, y, w, h)` with confidence scores.
- **Key Logic:** Frame sampling, multi-face confidence scoring, and fallback to central frame coordinates when no face is detected.

### 2. `auto_crop.py`
- **Source Commit:** `82ae01a:scripts/auto_crop.py`
- **Purpose:** Takes face detection coordinates and computes smooth panning windows for 9:16 vertical cropping from 16:9 widescreen source footage.
- **Key Logic:** Exponential moving average (EMA) smoothing to eliminate camera jitter, scene change detection, and dynamic boundary clamping.

### 3. `chunker.js`
- **Source Commit:** `82ae01a:src/chunker.js`
- **Purpose:** Legacy JavaScript transcript chunker that split Whisper transcripts into time-windowed chunks for ranking and subtitle generation.
- **Key Logic:** Timestamp offset shifting, text chunking, and duration constraint enforcement.
