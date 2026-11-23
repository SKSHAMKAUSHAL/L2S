#!/usr/bin/env python3
"""Bridge script: calls faster-whisper and outputs JSON transcript to stdout."""

import json
import sys
import os
import argparse

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"


def detect_device():
    """Detect whether CUDA is actually usable, not just installed."""
    try:
        import ctypes
        ctypes.cdll.LoadLibrary("cublas64_12.dll" if os.name == "nt" else "libcublas.so.12")
        return "cuda", "float16"
    except OSError:
        pass
    try:
        import ctranslate2
        if "cuda" in ctranslate2.get_supported_compute_types("cuda"):
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def transcribe_audio(audio_path, model_size, device, compute_type, language=None, initial_prompt=None, condition_on_prev=False, vad_filter=True):
    """Run transcription with faster-whisper with strict options."""
    from faster_whisper import WhisperModel

    print(f"Loading Whisper model '{model_size}' on {device} ({compute_type})...", file=sys.stderr, flush=True)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    kwargs = {
        "word_timestamps": True,
        "vad_filter": vad_filter,
        "condition_on_previous_text": condition_on_prev,
    }
    if language and language != "auto":
        kwargs["language"] = language
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt

    segments_gen, info = model.transcribe(audio_path, **kwargs)
    segments = list(segments_gen)
    return segments, info


def main():
    parser = argparse.ArgumentParser(description="faster-whisper CLI runner")
    parser.add_argument("audio_path", help="Path to input audio file")
    parser.add_argument("--model_size", default="small", help="Whisper model size (default: small)")
    parser.add_argument("--language", default=None, help="Target language (e.g. en, hi)")
    parser.add_argument("--initial_prompt", default=None, help="Initial prompt text")
    parser.add_argument("--condition_on_previous_text", action="store_true", default=False)
    parser.add_argument("--no_vad", action="store_true", default=False)

    # Also support positional arguments for backwards compatibility: [audio_path] [model_size]
    args, unknown = parser.parse_known_args()
    if unknown and len(unknown) == 1 and not args.model_size:
        args.model_size = unknown[0]

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}), file=sys.stderr)
        sys.exit(1)

    device, compute_type = detect_device()
    vad_filter = not args.no_vad

    try:
        segments, info = transcribe_audio(
            args.audio_path,
            args.model_size,
            device,
            compute_type,
            language=args.language,
            initial_prompt=args.initial_prompt,
            condition_on_prev=args.condition_on_previous_text,
            vad_filter=vad_filter
        )
    except Exception as e:
        if device != "cpu":
            print(f"Warning: {device} failed ({e}). Falling back to CPU.", file=sys.stderr, flush=True)
            device, compute_type = "cpu", "int8"
            segments, info = transcribe_audio(
                args.audio_path,
                args.model_size,
                device,
                compute_type,
                language=args.language,
                initial_prompt=args.initial_prompt,
                condition_on_prev=args.condition_on_previous_text,
                vad_filter=vad_filter
            )
        else:
            raise

    all_words = []
    result = {
        "language": info.language,
        "duration": info.duration,
        "segments": [],
        "words": []
    }

    for seg in segments:
        seg_dict = {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [],
        }

        if seg.words:
            for w in seg.words:
                w_obj = {
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                }
                seg_dict["words"].append(w_obj)
                all_words.push(w_obj) if hasattr(all_words, 'push') else all_words.append(w_obj)

        result["segments"].append(seg_dict)

    result["words"] = all_words
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
