"""
scripts/index.py
Vercel Python Service Handler for L2S (Whisper STT & YuNet Video Reframe)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Add current directory to path for imports
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    from whisper_transcribe import transcribe_audio
except Exception:
    transcribe_audio = None

try:
    from reframe_analyze import analyze_clip, NumpyEncoder
except Exception:
    analyze_clip = None
    NumpyEncoder = None


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        cls = NumpyEncoder if NumpyEncoder else None
        body = json.dumps(data, cls=cls).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/health", "/api/health"):
            self._send_json(200, {
                "status": "ok",
                "service": "scripts",
                "transcribe_available": transcribe_audio is not None,
                "reframe_available": analyze_clip is not None
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception as e:
            self._send_json(400, {"error": f"Invalid JSON payload: {str(e)}"})
            return

        path = self.path.split("?")[0]

        if path == "/transcribe":
            audio_path = payload.get("audioPath") or payload.get("audio_path")
            if not audio_path or not os.path.exists(audio_path):
                self._send_json(400, {"error": f"Audio file not found: {audio_path}"})
                return

            model_size = payload.get("modelSize") or payload.get("model_size") or "tiny.en"
            language = payload.get("language") or "auto"
            prompt = payload.get("prompt") or ""

            if transcribe_audio is None:
                self._send_json(500, {"error": "Whisper transcription module not loaded"})
                return

            try:
                device, compute_type = "cpu", "int8"
                segments, info = transcribe_audio(
                    audio_path=audio_path,
                    model_size=model_size,
                    device=device,
                    compute_type=compute_type,
                    language=language if language != "auto" else None,
                    initial_prompt=prompt if prompt else None
                )
                seg_list = []
                word_list = []
                for s in segments:
                    words = [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability} for w in (s.words or [])]
                    seg_list.append({"id": s.id, "start": s.start, "end": s.end, "text": s.text, "words": words})
                    word_list.extend(words)

                self._send_json(200, {
                    "segments": seg_list,
                    "words": word_list,
                    "info": {"language": info.language, "language_probability": info.language_probability}
                })
            except Exception as err:
                self._send_json(500, {"error": f"Transcription error: {str(err)}"})

        elif path == "/reframe":
            video_path = payload.get("videoPath") or payload.get("video_path")
            if not video_path or not os.path.exists(video_path):
                self._send_json(400, {"error": f"Video file not found: {video_path}"})
                return

            start = float(payload.get("start", 0))
            end = float(payload.get("end", 0))
            target_aspect = payload.get("targetAspect", "9:16")

            if analyze_clip is None:
                self._send_json(500, {"error": "Reframe module not loaded"})
                return

            try:
                data = analyze_clip(video_path, start, end, target_aspect=target_aspect)
                self._send_json(200, data)
            except Exception as err:
                self._send_json(500, {"error": f"Reframe analysis error: {str(err)}"})

        else:
            self._send_json(404, {"error": f"Endpoint {path} not found"})
