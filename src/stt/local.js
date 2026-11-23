// =============================================
// L2S — Local Speech-to-Text Engine (faster-whisper)
// =============================================

import path from 'path';
import { fileURLToPath } from 'url';
import { runCommandAsync, computeScriptStats } from './groq.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/whisper_transcribe.py');

/**
 * Transcribe audio locally using faster-whisper Python bridge
 *
 * @param {string} audioPath - Path to input audio file
 * @param {Object} [options={}] - Options (model, language, prompt)
 * @param {Function} [onProgress] - Optional status callback
 */
export async function transcribeLocal(audioPath, options = {}, onProgress) {
  const modelSize = options.model || options.modelSize || process.env.LOCAL_WHISPER_MODEL || 'small';
  const language = options.language || 'auto';
  const prompt = options.prompt || '';

  if (typeof onProgress === 'function') {
    onProgress(`Transcribing audio locally using faster-whisper (${modelSize})...`);
  }

  const args = [SCRIPT_PATH, audioPath, '--model_size', modelSize];

  if (language && language !== 'auto') {
    const langCode = (language === 'hi' || language === 'hinglish') ? 'hi' : language;
    args.push('--language', langCode);
  }

  if (prompt) {
    args.push('--initial_prompt', prompt);
  }

  // Try python first, then python3
  let res;
  try {
    res = await runCommandAsync('python', args, 600000);
  } catch (err) {
    try {
      res = await runCommandAsync('python3', args, 600000);
    } catch (err3) {
      throw new Error(`Local Whisper execution failed: ${err.message}. Make sure Python and faster-whisper are installed.`);
    }
  }

  if (res.code !== 0) {
    throw new Error(`faster-whisper script failed (exit ${res.code}): ${res.stderr?.trim() || res.stdout?.trim()}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (jsonErr) {
    throw new Error(`Failed to parse faster-whisper output: ${res.stdout.slice(0, 300)}`);
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  const rawSegments = parsed.segments || [];
  const rawWords = parsed.words || [];

  const normalizedSegments = rawSegments.map((s, idx) => ({
    id: s.id ?? idx,
    start: Number(s.start ?? 0),
    end: Number(s.end ?? 0),
    text: String(s.text || '').trim(),
    words: (s.words || []).map(w => ({
      word: String(w.word || '').trim(),
      start: Number(w.start ?? 0),
      end: Number(w.end ?? 0),
    }))
  }));

  const fullText = normalizedSegments.map(s => s.text).join(' ').trim();
  const scriptStats = computeScriptStats(fullText);

  return {
    language: parsed.language || 'unknown',
    duration: Number(parsed.duration || (normalizedSegments.length > 0 ? normalizedSegments[normalizedSegments.length - 1].end : 0)),
    text: fullText,
    words: rawWords.length > 0 ? rawWords : normalizedSegments.flatMap(s => s.words),
    segments: normalizedSegments,
    meta: {
      provider: 'local',
      model: modelSize,
      requestedLanguage: options.language || 'auto',
      detectedLanguage: parsed.language || 'unknown',
      scriptStats,
      wordsEstimated: false
    }
  };
}
