#!/usr/bin/env python3
"""
scripts/reframe_analyze.py
Analyzes video clip range with OpenCV YuNet face detection and scene-cut detection.

Usage:
    python reframe_analyze.py <input_video> <start> <end> <output_json> [target_aspect]
"""

import sys
import os
import json
import math

os.environ["MPLBACKEND"] = "Agg"

import cv2
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_MODEL_PATH = os.path.join(ROOT_DIR, "models", "face_detection_yunet_2023mar.onnx")


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def compute_hist(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
    return hist


def is_scene_cut(hist1, hist2, threshold=0.45):
    if hist1 is None or hist2 is None:
        return False
    # Bhattacharyya distance: 0 is exact match, 1 is complete mismatch
    dist = cv2.compareHist(hist1, hist2, cv2.HISTCMP_BHATTACHARYYA)
    return dist > threshold


def analyze_clip(video_path: str, start: float, end: float, target_aspect: str = "9:16", model_path: str = DEFAULT_MODEL_PATH):
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"YuNet model not found: {model_path}. Run scripts/fetch_models.js first.")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0 or math.isnan(fps):
        fps = 30.0

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration = total_frames / fps if total_frames > 0 else 0.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if width <= 0 or height <= 0:
        width, height = 1920, 1080

    start = max(0.0, float(start))
    if end <= start:
        end = video_duration if video_duration > start else start + 10.0
    clip_duration = end - start

    # Initialize YuNet detector
    detector = cv2.FaceDetectorYN.create(
        model_path,
        "",
        (width, height),
        score_threshold=0.55,
        nms_threshold=0.3,
        top_k=5000
    )

    # Sample ~5 fps
    sample_rate_fps = 5.0
    step_frames = max(1, int(round(fps / sample_rate_fps)))

    start_frame = int(round(start * fps))
    end_frame = int(round(end * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    current_frame_idx = start_frame
    prev_hist = None
    prev_face_pos = None  # (cx, cy)
    last_face_time = None

    scene_cuts = []
    path_samples = []
    has_split_candidate = False

    while current_frame_idx <= end_frame:
        ret, frame = cap.read()
        if not ret:
            break

        timestamp = (current_frame_idx - start_frame) / fps
        abs_timestamp = current_frame_idx / fps

        # Check scene cut
        curr_hist = compute_hist(frame)
        if prev_hist is not None and is_scene_cut(prev_hist, curr_hist):
            scene_cuts.append(round(timestamp, 3))
            # Reset tracking across scene cuts
            prev_face_pos = None

        prev_hist = curr_hist

        # Run Face Detection
        detector.setInputSize((width, height))
        _, faces = detector.detect(frame)

        detected_faces = []
        if faces is not None and len(faces) > 0:
            for f in faces:
                x, y, w, h = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                conf = float(f[14])
                cx = x + w / 2.0
                cy = y + h / 2.0
                detected_faces.append({
                    "cx": round(cx, 1),
                    "cy": round(cy, 1),
                    "w": round(w, 1),
                    "h": round(h, 1),
                    "confidence": round(conf, 3)
                })

        # Check two people condition: both > 8% width, > 40% apart
        if len(detected_faces) >= 2:
            sorted_by_area = sorted(detected_faces, key=lambda f: f["w"] * f["h"], reverse=True)
            f1, f2 = sorted_by_area[0], sorted_by_area[1]
            if f1["w"] >= 0.08 * width and f2["w"] >= 0.08 * width:
                if abs(f1["cx"] - f2["cx"]) >= 0.40 * width:
                    has_split_candidate = True

        # Pick primary face with temporal tracking
        chosen_face = None
        if detected_faces:
            if prev_face_pos is not None:
                # Score = area * conf / (1 + distance_penalty)
                def track_score(f):
                    dist = math.hypot(f["cx"] - prev_face_pos[0], f["cy"] - prev_face_pos[1])
                    norm_dist = dist / float(width)
                    return (f["w"] * f["h"] * f["confidence"]) / (1.0 + 3.0 * norm_dist)

                chosen_face = max(detected_faces, key=track_score)
            else:
                chosen_face = max(detected_faces, key=lambda f: f["w"] * f["h"] * f["confidence"])

            prev_face_pos = (chosen_face["cx"], chosen_face["cy"])
            last_face_time = timestamp

            path_samples.append({
                "t": round(timestamp, 3),
                "cx": chosen_face["cx"],
                "cy": chosen_face["cy"],
                "w": chosen_face["w"],
                "h": chosen_face["h"],
                "confidence": chosen_face["confidence"],
                "faces": detected_faces
            })
        else:
            # No face detected in this frame
            path_samples.append({
                "t": round(timestamp, 3),
                "cx": round(width / 2.0, 1),
                "cy": round(height / 2.0, 1),
                "w": 0.0,
                "h": 0.0,
                "confidence": 0.0,
                "faces": []
            })

        # Advance to next sample frame
        current_frame_idx += step_frames
        cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame_idx)

    cap.release()

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(clip_duration, 3),
        "scene_cuts": scene_cuts,
        "has_split_candidate": has_split_candidate,
        "path": path_samples
    }


def main():
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Usage: reframe_analyze.py <video> <start> <end> <out_json> [aspect]"}), file=sys.stderr)
        sys.exit(1)

    video_path = sys.argv[1]
    start = float(sys.argv[2])
    end = float(sys.argv[3])
    out_json = sys.argv[4]
    aspect = sys.argv[5] if len(sys.argv) > 5 else "9:16"

    try:
        data = analyze_clip(video_path, start, end, aspect)
        os.makedirs(os.path.dirname(os.path.abspath(out_json)), exist_ok=True)
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(data, f, cls=NumpyEncoder, indent=2)
        print(json.dumps({"status": "ok", "samples": len(data["path"]), "cuts": len(data["scene_cuts"])}))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
