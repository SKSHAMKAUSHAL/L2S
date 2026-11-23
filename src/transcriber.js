// =============================================
// L2S — Unified Transcriber Facade
// =============================================
// Rebuilt according to Step 1 specs with deterministic SHA-256 caching,
// strict transcript validation, and explicit fallback controls.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { transcribeGroq, buildWhisperPrompt } from './stt/groq.js';
import { transcribeLocal } from './stt/local.js';

/**
 * Validate transcript schema and timestamp monotonicity
 *
 * @param {Object} t - Transcript object
 * @throws {Error} If shape or timestamps are invalid
 */
export function validateTranscript(t) {
  if (!t || typeof t !== 'object') {
    throw new Error('validateTranscript: transcript must be an object');
  }

  if (typeof t.text !== 'string') {
    throw new Error('validateTranscript: transcript.text must be a string');
  }

  if (typeof t.duration !== 'number' || isNaN(t.duration) || t.duration < 0) {
    throw new Error('validateTranscript: transcript.duration must be a non-negative number');
  }

  if (!Array.isArray(t.segments)) {
    throw new Error('validateTranscript: transcript.segments must be an array');
  }

  if (!Array.isArray(t.words)) {
    throw new Error('validateTranscript: transcript.words must be an array');
  }

  // Validate words
  let lastWordEnd = -1;
  for (let i = 0; i < t.words.length; i++) {
    const w = t.words[i];
    if (typeof w.word !== 'string') {
      throw new Error(`validateTranscript: word at index ${i} must have a string .word`);
    }
    if (typeof w.start !== 'number' || typeof w.end !== 'number' || isNaN(w.start) || isNaN(w.end)) {
      throw new Error(`validateTranscript: word "${w.word}" has non-numeric timestamps`);
    }
    if (w.start < 0 || w.end < 0) {
      throw new Error(`validateTranscript: word "${w.word}" has negative timestamps`);
    }
    if (w.start > w.end) {
      throw new Error(`validateTranscript: word "${w.word}" has start > end (${w.start} > ${w.end})`);
    }
    // Allow slight tolerance (up to 0.05s) for audio overlap/coarticulation, but not inverted sequence
    if (w.start < lastWordEnd - 0.5) {
      throw new Error(`validateTranscript: words are not non-decreasing at index ${i} ("${w.word}")`);
    }
    lastWordEnd = Math.max(lastWordEnd, w.end);
  }

  // Validate segments
  let lastSegStart = -1;
  for (let i = 0; i < t.segments.length; i++) {
    const s = t.segments[i];
    if (typeof s.start !== 'number' || typeof s.end !== 'number' || isNaN(s.start) || isNaN(s.end)) {
      throw new Error(`validateTranscript: segment at index ${i} has non-numeric timestamps`);
    }
    if (s.start > s.end) {
      throw new Error(`validateTranscript: segment at index ${i} has start > end (${s.start} > ${s.end})`);
    }
    if (s.start < lastSegStart) {
      throw new Error(`validateTranscript: segments are not in chronological order at index ${i}`);
    }
    lastSegStart = s.start;
  }

  return true;
}

/**
 * Compute deterministic cache key using SHA-256 of:
 * (audio file sample/stat + model + language + prompt)
 */
export function computeTranscriptHash(audioPath, model = '', language = '', prompt = '') {
  const hash = crypto.createHash('sha256');

  // Read up to 1MB of audio header/body for fast uniqueness hash + file size
  const stat = fs.statSync(audioPath);
  hash.update(`size:${stat.size};`);

  const fd = fs.openSync(audioPath, 'r');
  const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  hash.update(buffer);
  hash.update(`model:${model};`);
  hash.update(`lang:${language};`);
  hash.update(`prompt:${prompt};`);

  return hash.digest('hex');
}

/**
 * Main transcribeAudio facade preserving backward compatibility
 *
 * @param {string} audioPath - Path to extracted audio
 * @param {string} cacheDir - Path to cache directory
 * @param {Object|string} [options={}] - Options object or legacy modelSize string
 * @param {Function} [onProgress] - Optional status callback
 */
export async function transcribeAudio(audioPath, cacheDir, options = {}, onProgress) {
  // Normalize options (support legacy signature: (audioPath, cacheDir, modelSize, onProgress))
  let opts = {};
  if (typeof options === 'string') {
    opts = { model: options };
  } else if (typeof options === 'object' && options !== null) {
    opts = { ...options };
  }

  if (typeof options === 'function' && !onProgress) {
    onProgress = options;
    opts = {};
  }

  fs.mkdirSync(cacheDir, { recursive: true });

  const language = opts.language || 'auto';
  const model = opts.model || (
    (language === 'hi' || language === 'hinglish')
      ? 'whisper-large-v3'
      : (process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo')
  );
  const prompt = opts.prompt || buildWhisperPrompt(opts);

  // Deterministic SHA-256 cache check
  const cacheKey = computeTranscriptHash(audioPath, model, language, prompt);
  const cacheFile = path.join(cacheDir, `${cacheKey}.transcript.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      validateTranscript(cached);
      if (typeof onProgress === 'function') onProgress('Loaded validated transcript from cache');
      return cached;
    } catch (e) {
      // Corrupt cache file, recompute
      try { fs.unlinkSync(cacheFile); } catch (err) {}
    }
  }

  const hasGroqKey = Boolean((opts.apiKey || process.env.GROQ_API_KEY || '').trim());
  let transcript;

  if (hasGroqKey && opts.provider !== 'local') {
    try {
      transcript = await transcribeGroq(audioPath, { ...opts, model, language, prompt }, onProgress);
    } catch (err) {
      const allowFallback = process.env.STT_ALLOW_LOCAL_FALLBACK === 'true';
      if (allowFallback) {
        console.warn(`[transcriber] ⚠️ Groq STT failed (${err.message}). STT_ALLOW_LOCAL_FALLBACK=true enabled, falling back to local Whisper.`);
        if (typeof onProgress === 'function') {
          onProgress(`Groq failed (${err.message}). Falling back to local Whisper...`);
        }
        transcript = await transcribeLocal(audioPath, { ...opts, language, prompt }, onProgress);
        transcript.meta.fallback = true;
      } else {
        throw new Error(`Groq STT failed: ${err.message}. (Local fallback is disabled; set STT_ALLOW_LOCAL_FALLBACK=true to allow)`);
      }
    }
  } else {
    transcript = await transcribeLocal(audioPath, { ...opts, language, prompt }, onProgress);
  }

  // Validate before writing to cache
  validateTranscript(transcript);

  // Write to cache atomically
  fs.writeFileSync(cacheFile, JSON.stringify(transcript, null, 2), 'utf8');

  return transcript;
}
