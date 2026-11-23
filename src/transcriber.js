// =============================================
// L2S — Transcriber Bridge
// =============================================
// Delegates transcription to the active STT provider in aiRegistry
// (local faster-whisper or Groq Whisper Cloud) with deterministic caching.

import path from 'path';
import fs from 'fs';
import { aiRegistry } from './ai/registry.js';

/**
 * Transcribe audio using the active STT provider
 *
 * @param {string} audioPath - Path to extracted audio file (.wav/.mp3)
 * @param {string} cacheDir - Directory for caching transcripts
 * @param {string} [modelSize="base"] - Model size preference
 * @param {Function} [onProgress] - Callback for real-time progress messages
 * @returns {Promise<Object>} Transcript object { language, duration, segments }
 */
export async function transcribeAudio(audioPath, cacheDir, modelSize = 'base', onProgress) {
  fs.mkdirSync(cacheDir, { recursive: true });

  // Check cache first
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const cacheFile = path.join(cacheDir, `${baseName}.transcript.json`);

  if (fs.existsSync(cacheFile)) {
    if (typeof onProgress === 'function') onProgress('Loaded transcript from local cache');
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  const activeSTT = aiRegistry.getSTTProvider();

  let transcript;
  try {
    transcript = await activeSTT.transcribe(audioPath, onProgress, { modelSize });
  } catch (err) {
    // Check if cloud fallback is explicitly permitted
    if (aiRegistry.allowCloudFallback && activeSTT.type === 'cloud') {
      if (typeof onProgress === 'function') {
        onProgress(`Cloud STT failed (${err.message}). Explicit fallback to local faster-whisper...`);
      }
      const localSTT = aiRegistry.getSTTProvider('local_whisper');
      transcript = await localSTT.transcribe(audioPath, onProgress, { modelSize });
    } else {
      throw err;
    }
  }

  // Ensure consistent transcript structure
  const normalizedSegments = (transcript.segments || []).map((seg, idx) => ({
    id: seg.id ?? idx,
    start: Number(seg.start ?? 0),
    end: Number(seg.end ?? 0),
    text: String(seg.text || '').trim(),
    words: (seg.words || []).map(w => ({
      word: String(w.word || ''),
      start: Number(w.start ?? 0),
      end: Number(w.end ?? 0),
    })),
  }));

  const normalizedTranscript = {
    segments: normalizedSegments,
    language: transcript.language || 'unknown',
    duration: Number(transcript.duration || (normalizedSegments.length > 0 ? normalizedSegments[normalizedSegments.length - 1].end : 0)),
  };

  fs.writeFileSync(cacheFile, JSON.stringify(normalizedTranscript, null, 2));
  return normalizedTranscript;
}
