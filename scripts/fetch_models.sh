#!/usr/bin/env bash
set -e

MODEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models"
MODEL_FILE="$MODEL_DIR/face_detection_yunet_2023mar.onnx"
EXPECTED_HASH="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
URL="https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_FILE" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL_HASH=$(sha256sum "$MODEL_FILE" | awk '{print $1}')
    else
        ACTUAL_HASH=$(shasum -a 256 "$MODEL_FILE" | awk '{print $1}')
    fi
    if [ "$ACTUAL_HASH" = "$EXPECTED_HASH" ]; then
        echo "YuNet model verified: $MODEL_FILE"
        exit 0
    fi
fi

echo "Downloading YuNet ONNX face detection model..."
curl -L -f -o "$MODEL_FILE" "$URL"

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_HASH=$(sha256sum "$MODEL_FILE" | awk '{print $1}')
else
    ACTUAL_HASH=$(shasum -a 256 "$MODEL_FILE" | awk '{print $1}')
fi

if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
    echo "ERROR: SHA-256 hash mismatch!"
    echo "Expected: $EXPECTED_HASH"
    echo "Actual:   $ACTUAL_HASH"
    rm -f "$MODEL_FILE"
    exit 1
fi

echo "Successfully verified YuNet model."
