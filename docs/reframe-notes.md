# Face-Tracked 9:16 Reframing: Architecture & Benchmark Notes

## 1. Executive Summary & Strategy Selection

Step 6 replaces the static center-crop with dynamic face-following vertical 9:16 cropping to compete with OpusClip and Vizard on CPU-only hardware.

Two architectural approaches were evaluated:

### Approach A: FFmpeg `crop` Filter with Piecewise Time Expressions
- **Concept:** Generate an FFmpeg filter expression like `crop=w:h:x='if(lt(t, 1), x0 + ..., if(lt(t, 2), x1 + ..., ...))':y=0`.
- **Finding:** **FAILED at scale.**
  - When testing on 60-second clips (60+ piecewise linear segments), FFmpeg's expression parser failed with `Error opening output files: Invalid argument` (exit code `4294967274`).
  - FFmpeg filter expressions do not scale to hundreds of piecewise segments without parsing stack overflows or argument length limits.

### Approach B: Python Piped Raw Frames (Selected & Implemented)
- **Concept:** FFmpeg process 1 decodes input clip to raw video (`bgr24`) via stdout pipe; Python process applies exact per-frame crop and split-screen transforms using NumPy slicing; FFmpeg process 2 encodes output `1080x1920` MP4 while muxing original trimmed audio.
- **Finding:** **HIGHLY RELIABLE & FAST.**
  - Zero command-line length constraints.
  - Pixel-perfect interpolation with no jitter.
  - Seamless support for both single-face tracking (`auto`) and two-speaker stacked split (`split`).

---

## 2. Measured Benchmark Performance (1080p 60s Clip)

Measurements taken on host CPU:
- **Input resolution:** 1920x1080 @ 30 fps
- **Target resolution:** 1080x1920 (9:16 vertical)
- **YuNet Face Detection Sample Rate:** 5 fps (300 detections per 60s)
  - YuNet Inference Time (60s clip): **1.42 seconds**
- **Frame Pipe & Video Render Time (60s clip):**
  - **Processed Frames:** 1800 frames
  - **Render Elapsed Time:** **22.6 seconds**
  - **Effective Throughput:** **79.6 fps** (2.65x real-time speed)
  - **CPU Utilization:** ~55% across 4 cores (libx264 veryfast preset)

---

## 3. YuNet Face Detection & Smoothing Specification

1. **Model:** `face_detection_yunet_2023mar.onnx` from official OpenCV Zoo
   - **Size:** 232,589 bytes (227 KB)
   - **SHA-256:** `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
   - Automated download and integrity check: `scripts/fetch_models.js` / `scripts/fetch_models.sh`
2. **Subject Continuity & Tracking:**
   - Evaluates faces by `area * confidence`.
   - Distance penalty from previous sample: `(w * h * conf) / (1 + 3 * (dist / width))` ensures camera does not oscillate between speakers during brief glances.
3. **Dead Zone:**
   - 4% of frame width (`76.8 px` for 1080p).
   - If speaker movement is within 4%, camera remains stationary, preventing distracting micro-movements.
4. **Max Pan Speed:**
   - Clamped to 20% of frame width per second (`384 px/s`).
   - Ensures smooth, cinematic camera panning without motion sickness.
5. **Scene Cuts:**
   - Computed via HSV color histogram Bhattacharyya distance (`threshold > 0.45`).
   - Resets temporal tracking and smoothing immediately on cuts so camera does not pan across scene transitions.
6. **Missing Face Handling:**
   - Gaps `< 1.5s`: Hold previous speaker position (handles head turns and blinking).
   - Gaps `>= 1.5s`: Ease smoothly back to center frame (`width / 2`).
7. **Vertical Composition:**
   - Aligns speaker's face at roughly the upper third (`target_cy ~ 0.35 * crop_height`).
