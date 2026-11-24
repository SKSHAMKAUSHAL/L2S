#!/usr/bin/env python3
"""
scripts/reframe_render.py
Pipes frames through OpenCV/NumPy to apply smooth face-tracking or split crop and muxes audio.

Usage:
    python reframe_render.py --input <video> --start <s0> --end <s1> --crop-data <json> --output <mp4> [--mode <auto|split|center>] [--encoder <libx264>] [--preset <veryfast>] [--crf <18>]
"""

import sys
import os
import argparse
import json
import subprocess
import tempfile
import cv2
import numpy as np

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920


def sample_crop_at(crop_path, t):
    if not crop_path:
        return None
    if len(crop_path) == 1 or t <= crop_path[0]["t"]:
        return crop_path[0]
    if t >= crop_path[-1]["t"]:
        return crop_path[-1]

    # Binary search or scan
    for i in range(len(crop_path) - 1):
        p0 = crop_path[i]
        p1 = crop_path[i + 1]
        if p0["t"] <= t <= p1["t"]:
            dt = p1["t"] - p0["t"]
            alpha = (t - p0["t"]) / dt if dt > 0.0001 else 0.0
            return {
                "cropX": int(round(p0["cropX"] + alpha * (p1["cropX"] - p0["cropX"]))),
                "cropY": int(round(p0["cropY"] + alpha * (p1["cropY"] - p0["cropY"]))),
                "cropW": int(round(p0["cropW"] + alpha * (p1["cropW"] - p0["cropW"]))),
                "cropH": int(round(p0["cropH"] + alpha * (p1["cropH"] - p0["cropH"]))),
            }
    return crop_path[-1]


def render_reframe(video_path, start, end, crop_data_path, output_path, mode="auto", encoder="libx264", preset="veryfast", crf="18", audio_bitrate="192k", video_bitrate="8M", maxrate="14M", bufsize="18M"):
    start = max(0.0, float(start))
    end = float(end)
    duration = max(0.1, end - start)

    crop_data = None
    if crop_data_path and os.path.exists(crop_data_path):
        with open(crop_data_path, "r", encoding="utf-8") as f:
            crop_data = json.load(f)

    # Probe input dimensions and fps
    cap = cv2.VideoCapture(video_path)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()

    if src_w <= 0 or src_h <= 0:
        src_w, src_h = 1920, 1080
    if fps <= 0 or np.isnan(fps):
        fps = 30.0

    smooth_path = crop_data.get("smooth_path", []) if crop_data else []
    target_crop_w = int(round(src_h * 9.0 / 16.0))
    if target_crop_w % 2 != 0:
        target_crop_w -= 1
    target_crop_h = src_h
    center_x = max(0, (src_w - target_crop_w) // 2)

    # Input FFmpeg decoding process
    ffmpeg_in_args = [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}",
        "-t", f"{duration:.3f}",
        "-i", video_path,
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:1"
    ]

    ffmpeg_in = subprocess.Popen(
        ffmpeg_in_args,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL
    )

    # Output FFmpeg encoding process with audio muxing
    # Input 0: piped raw video (1080x1920)
    # Input 1: original video audio stream trimmed to match
    ffmpeg_out_args = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-ss", f"{start:.3f}",
        "-t", f"{duration:.3f}",
        "-i", video_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", encoder,
        "-preset", preset,
        "-crf", str(crf),
        "-b:v", video_bitrate,
        "-maxrate", maxrate,
        "-bufsize", bufsize,
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-shortest",
        "-movflags", "+faststart",
        output_path
    ]

    err_file = tempfile.TemporaryFile()
    ffmpeg_out = subprocess.Popen(
        ffmpeg_out_args,
        stdin=subprocess.PIPE,
        stderr=err_file
    )

    frame_bytes = src_w * src_h * 3
    frame_idx = 0

    try:
        while True:
            raw = ffmpeg_in.stdout.read(frame_bytes)
            if not raw or len(raw) < frame_bytes:
                break

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((src_h, src_w, 3))
            t = frame_idx / fps

            if mode == "center" or not smooth_path:
                crop = frame[:, center_x:center_x + target_crop_w]
                out_frame = cv2.resize(crop, (OUTPUT_WIDTH, OUTPUT_HEIGHT), interpolation=cv2.INTER_LINEAR)
            elif mode == "split" and crop_data and crop_data.get("has_split_candidate"):
                # Split mode: two faces stacked vertically
                # Top half (1080x960) and Bottom half (1080x960)
                # Find two faces in the current sample or default to left/right
                half_h = OUTPUT_HEIGHT // 2  # 960
                crop_w_half = int(round(src_h * 1080.0 / 960.0 * 0.5))
                # Left speaker
                left_x = max(0, min(src_w - crop_w_half, int(src_w * 0.25 - crop_w_half / 2)))
                # Right speaker
                right_x = max(0, min(src_w - crop_w_half, int(src_w * 0.75 - crop_w_half / 2)))

                top_crop = frame[:, left_x:left_x + crop_w_half]
                bot_crop = frame[:, right_x:right_x + crop_w_half]

                top_resized = cv2.resize(top_crop, (OUTPUT_WIDTH, half_h), interpolation=cv2.INTER_LINEAR)
                bot_resized = cv2.resize(bot_crop, (OUTPUT_WIDTH, half_h), interpolation=cv2.INTER_LINEAR)
                out_frame = np.vstack([top_resized, bot_resized])
            else:
                # Auto face follow
                crop_info = sample_crop_at(smooth_path, t)
                cx = crop_info["cropX"] if crop_info else center_x
                cy = crop_info["cropY"] if crop_info else 0
                cw = crop_info["cropW"] if crop_info else target_crop_w
                ch = crop_info["cropH"] if crop_info else target_crop_h

                cx = max(0, min(src_w - cw, cx))
                cy = max(0, min(src_h - ch, cy))

                crop = frame[cy:cy + ch, cx:cx + cw]
                out_frame = cv2.resize(crop, (OUTPUT_WIDTH, OUTPUT_HEIGHT), interpolation=cv2.INTER_LINEAR)

            ffmpeg_out.stdin.write(out_frame.tobytes())
            frame_idx += 1

    finally:
        ffmpeg_in.stdout.close()
        ffmpeg_in.wait()
        if ffmpeg_out.stdin:
            try:
                ffmpeg_out.stdin.close()
            except Exception:
                pass
        ffmpeg_out.wait()
        if ffmpeg_out.returncode != 0:
            err_file.seek(0)
            err = err_file.read().decode('utf-8', errors='ignore')
            sys.stderr.write(f"FFmpeg error: {err}\n")
            err_file.close()
            sys.exit(1)
        err_file.close()

    print(json.dumps({"status": "ok", "rendered_frames": frame_idx, "output": output_path}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--crop-data", default=None)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--encoder", default="libx264")
    parser.add_argument("--preset", default="veryfast")
    parser.add_argument("--crf", default="18")
    parser.add_argument("--audio-bitrate", default="192k")
    parser.add_argument("--video-bitrate", default="8M")
    parser.add_argument("--maxrate", default="14M")
    parser.add_argument("--bufsize", default="18M")
    args = parser.parse_args()

    render_reframe(
        video_path=args.input,
        start=args.start,
        end=args.end,
        crop_data_path=args.crop_data,
        output_path=args.output,
        mode=args.mode,
        encoder=args.encoder,
        preset=args.preset,
        crf=args.crf,
        audio_bitrate=args.audio_bitrate,
        video_bitrate=args.video_bitrate,
        maxrate=args.maxrate,
        bufsize=args.bufsize
    )


if __name__ == "__main__":
    main()
