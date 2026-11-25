// =============================================
// L2S — Groq Speech-to-Text Engine
// =============================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Groq from 'groq-sdk';
import { spawnTracked } from '../process_manager.js';

const MAX_GROQ_FILE_SIZE = 24 * 1024 * 1024; // 24 MB safe threshold (Groq hard limit is 25 MB)
const CHUNK_DURATION_SEC = 600; // 10 minutes

/**
 * Execute child process safely using spawnTracked
 */
export function runCommandAsync(command, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Probe audio duration in seconds
 */
export async function getAudioDuration(audioPath) {
  try {
    const res = await runCommandAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], 15000);
    const dur = parseFloat(res.stdout.trim());
    if (!isNaN(dur) && dur > 0) return dur;
  } catch (e) {}
  return 0;
}

/**
 * Calculate share of Devanagari vs Latin characters in text
 */
export function computeScriptStats(text = '') {
  let devanagariCount = 0;
  let latinCount = 0;
  let totalLetters = 0;

  for (const char of text) {
    const code = char.codePointAt(0);
    if (!code) continue;
    // Devanagari block: U+0900 to U+097F
    if (code >= 0x0900 && code <= 0x097F) {
      devanagariCount++;
      totalLetters++;
    } else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) {
      latinCount++;
      totalLetters++;
    }
  }

  const devanagariShare = totalLetters > 0 ? devanagariCount / totalLetters : 0;
  const latinShare = totalLetters > 0 ? latinCount / totalLetters : 0;

  return {
    devanagariShare: Math.round(devanagariShare * 1000) / 1000,
    latinShare: Math.round(latinShare * 1000) / 1000,
    totalLetters
  };
}

/**
 * Build Whisper prompt under 200 tokens, stripped of URLs, emojis, and duplicate words
 */
export function buildWhisperPrompt(options = {}) {
  const parts = [];

  if (options.title) parts.push(options.title);
  if (options.channel) parts.push(options.channel);
  if (options.description) parts.push(options.description.slice(0, 300));
  if (Array.isArray(options.glossary) && options.glossary.length > 0) {
    parts.push(options.glossary.join(', '));
  }

  // Hinglish specific priming phrase to steer Whisper to Roman letters
  if (options.language === 'hinglish') {
    parts.unshift('Aaj hum ek important topic pe baat karenge, bilkul simple tareeke se.');
  }

  let text = parts.join(' ');
  // Strip URLs and Emojis
  text = text.replace(/https?:\/\/\S+/gi, '');
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  text = text.replace(/[^\p{L}\p{N}\s,.-]/gu, ' ');

  // Deduplicate words and keep within ~200 tokens (approx 150 words)
  const words = text.split(/\s+/).filter(Boolean);
  const seen = new Set();
  const deduped = [];

  for (const w of words) {
    const lower = w.toLowerCase();
    if (!seen.has(lower) && deduped.length < 150) {
      seen.add(lower);
      deduped.push(w);
    }
  }

  return deduped.join(' ');
}

/**
 * Find silence-aware chunk split points within ±10s of target boundaries
 */
export async function planChunkSplits(audioPath, totalDuration, chunkSec = 600) {
  if (totalDuration <= chunkSec + 30) {
    return [{ start: 0, duration: totalDuration }];
  }

  // Find silence segments using ffmpeg silencedetect
  let silencePoints = [];
  try {
    const res = await runCommandAsync('ffmpeg', [
      '-i', audioPath,
      '-af', 'silencedetect=noise=-30dB:d=0.3',
      '-f', 'null', '-'
    ], 300000);

    const matches = [...(res.stderr || '').matchAll(/silence_start:\s*([\d.]+)/g)];
    silencePoints = matches.map(m => parseFloat(m[1])).filter(p => !isNaN(p));
  } catch (e) {
    // Silencedetect not critical, fall back to exact intervals
  }

  const chunks = [];
  let currentStart = 0;

  while (currentStart < totalDuration) {
    const idealEnd = currentStart + chunkSec;
    if (idealEnd >= totalDuration - 30) {
      // Last chunk
      chunks.push({ start: currentStart, duration: totalDuration - currentStart });
      break;
    }

    // Find nearest silence point within ±10s of idealEnd
    const nearestSilence = silencePoints.find(p => Math.abs(p - idealEnd) <= 10 && p > currentStart + 60);
    const splitPoint = nearestSilence || idealEnd;

    chunks.push({ start: currentStart, duration: splitPoint - currentStart });
    currentStart = splitPoint;
  }

  return chunks;
}

/**
 * Re-encode audio to 16kHz mono 48kbps MP3
 */
export async function prepareOptimizedAudio(inputPath, outputPath, startSec = null, durationSec = null) {
  const args = ['-y'];
  if (startSec !== null && startSec !== undefined) {
    args.push('-ss', String(startSec));
  }
  args.push('-i', inputPath);
  if (durationSec !== null && durationSec !== undefined) {
    args.push('-t', String(durationSec));
  }
  args.push('-vn', '-acodec', 'libmp3lame', '-b:a', '48k', '-ar', '16000', '-ac', '1', outputPath);

  const res = await runCommandAsync('ffmpeg', args, 600000);
  if (res.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`FFmpeg audio prep failed: ${res.stderr?.trim() || 'Exit code ' + res.code}`);
  }
  return outputPath;
}

/**
 * Map top-level words array to segments by time containment
 */
export function mapWordsToSegments(rawSegments = [], rawWords = []) {
  if (!rawWords || rawWords.length === 0) {
    return rawSegments.map((s, idx) => ({
      id: s.id ?? idx,
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
      text: String(s.text || '').trim(),
      words: []
    }));
  }

  let wordIdx = 0;
  return rawSegments.map((seg, idx) => {
    const sStart = Number(seg.start ?? 0);
    const sEnd = Number(seg.end ?? 0);
    const segWords = [];

    while (wordIdx < rawWords.length) {
      const w = rawWords[wordIdx];
      const wMid = (w.start + w.end) / 2;

      if (wMid < sStart - 0.2) {
        wordIdx++;
        continue;
      }
      if (wMid > sEnd + 0.2) {
        break;
      }
      segWords.push({
        word: String(w.word || '').trim(),
        start: Number(w.start),
        end: Number(w.end)
      });
      wordIdx++;
    }

    return {
      id: seg.id ?? idx,
      start: sStart,
      end: sEnd,
      text: String(seg.text || '').trim(),
      words: segWords
    };
  });
}

/**
 * Transcribe single audio file via Groq with retries
 */
async function callGroqWhisperSingle(groqClient, audioFilePath, options = {}, onProgress) {
  const model = options.model || (
    (options.language === 'hi' || options.language === 'hinglish')
      ? 'whisper-large-v3'
      : (process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo')
  );

  const prompt = options.prompt || buildWhisperPrompt(options);
  const requestedLanguage = options.language || 'auto';
  // Groq accepts 2-letter ISO code: 'hi' for Hindi and Hinglish; omitted for auto
  const sendLanguage = (requestedLanguage === 'hi' || requestedLanguage === 'hinglish') ? 'hi' : (requestedLanguage !== 'auto' ? requestedLanguage : undefined);

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (typeof onProgress === 'function' && attempt > 1) {
        onProgress(`Retrying Groq STT (attempt ${attempt}/${maxRetries})...`);
      }

      const fileStream = fs.createReadStream(audioFilePath);
      const params = {
        file: fileStream,
        model,
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
      };

      if (sendLanguage) params.language = sendLanguage;
      if (prompt) params.prompt = prompt;

      const response = await groqClient.audio.transcriptions.create(params);
      return { response, model };
    } catch (err) {
      lastError = err;
      const status = err.status || err.statusCode || (err.message?.includes('429') ? 429 : 500);

      if (status === 429 || (status >= 500 && status < 600)) {
        let retryAfterMs = 1500 * Math.pow(2, attempt - 1) + Math.random() * 500;
        const retryHeader = err.headers?.['retry-after'] || err.response?.headers?.get?.('retry-after');
        if (retryHeader) {
          const parsedHeader = parseFloat(retryHeader);
          if (!isNaN(parsedHeader)) retryAfterMs = Math.max(retryAfterMs, parsedHeader * 1000);
        }

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryAfterMs));
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Transcribe Audio using Groq Cloud Engine
 */
export async function transcribeGroq(audioPath, options = {}, onProgress) {
  const apiKey = (options.apiKey || process.env.GROQ_API_KEY || '').trim();
  if (!apiKey && !options.groqClient) {
    throw new Error('GROQ_API_KEY is required for Groq Whisper transcription.');
  }

  const groqClient = options.groqClient || new Groq({ apiKey });
  const totalDuration = await getAudioDuration(audioPath);
  const prompt = buildWhisperPrompt(options);

  // Check file size
  const stat = fs.statSync(audioPath);
  const needsCompression = stat.size > 20 * 1024 * 1024 || path.extname(audioPath).toLowerCase() === '.wav';

  let optimizedPath = audioPath;
  const tempFiles = [];

  try {
    if (needsCompression) {
      if (typeof onProgress === 'function') onProgress('Optimizing audio to 48kbps mono MP3 for Groq upload...');
      optimizedPath = path.join(path.dirname(audioPath), `prep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);
      tempFiles.push(optimizedPath);
      await prepareOptimizedAudio(audioPath, optimizedPath);
    }

    const optimizedStat = fs.statSync(optimizedPath);
    const needsChunking = optimizedStat.size > MAX_GROQ_FILE_SIZE || totalDuration > CHUNK_DURATION_SEC + 30;

    let allSegments = [];
    let allWords = [];
    let detectedLanguage = 'unknown';
    let activeModel = options.model || (
      (options.language === 'hi' || options.language === 'hinglish')
        ? 'whisper-large-v3'
        : (process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo')
    );

    if (!needsChunking) {
      if (typeof onProgress === 'function') onProgress(`Transcribing audio with Groq (${activeModel})...`);
      const { response, model } = await callGroqWhisperSingle(groqClient, optimizedPath, { ...options, prompt }, onProgress);
      activeModel = model;
      detectedLanguage = response.language || 'unknown';

      const rawWords = response.words || [];
      const rawSegments = response.segments || [];
      allWords = rawWords.map(w => ({ word: String(w.word || '').trim(), start: Number(w.start), end: Number(w.end) }));
      allSegments = mapWordsToSegments(rawSegments, allWords);
    } else {
      // Chunked processing
      const splits = await planChunkSplits(optimizedPath, totalDuration, CHUNK_DURATION_SEC);
      if (typeof onProgress === 'function') {
        onProgress(`Audio exceeds size limit (${Math.round(optimizedStat.size / (1024*1024))}MB). Processing in ${splits.length} silence-aligned chunks...`);
      }

      for (let i = 0; i < splits.length; i++) {
        const chunk = splits[i];
        const chunkFile = path.join(path.dirname(audioPath), `chunk_${i}_${Date.now()}.mp3`);
        tempFiles.push(chunkFile);

        await prepareOptimizedAudio(optimizedPath, chunkFile, chunk.start, chunk.duration);

        if (typeof onProgress === 'function') {
          onProgress(`Transcribing chunk ${i + 1}/${splits.length} (${Math.round(chunk.start)}s - ${Math.round(chunk.start + chunk.duration)}s)...`);
        }

        const { response } = await callGroqWhisperSingle(groqClient, chunkFile, { ...options, prompt }, onProgress);
        if (response.language && detectedLanguage === 'unknown') detectedLanguage = response.language;

        const chunkOffset = chunk.start;
        const chunkWords = (response.words || []).map(w => ({
          word: String(w.word || '').trim(),
          start: Math.round((Number(w.start) + chunkOffset) * 1000) / 1000,
          end: Math.round((Number(w.end) + chunkOffset) * 1000) / 1000,
        }));

        const chunkSegments = (response.segments || []).map(s => ({
          start: Math.round((Number(s.start) + chunkOffset) * 1000) / 1000,
          end: Math.round((Number(s.end) + chunkOffset) * 1000) / 1000,
          text: String(s.text || '').trim(),
        }));

        const mappedChunkSegments = mapWordsToSegments(chunkSegments, chunkWords);
        allWords.push(...chunkWords);
        allSegments.push(...mappedChunkSegments);
      }
    }

    // Fallback: If Groq returned no words, estimate word timestamps evenly across segment text
    let wordsEstimated = false;
    if (allWords.length === 0 && allSegments.length > 0) {
      wordsEstimated = true;
      allWords = [];

      allSegments = allSegments.map(seg => {
        const segTokens = (seg.text || '').split(/\s+/).filter(Boolean);
        if (segTokens.length === 0) return seg;

        const dur = Math.max(0.1, seg.end - seg.start);
        const wordDur = dur / segTokens.length;
        const estimatedWords = segTokens.map((tok, wIdx) => ({
          word: tok,
          start: Math.round((seg.start + wIdx * wordDur) * 1000) / 1000,
          end: Math.round((seg.start + (wIdx + 1) * wordDur) * 1000) / 1000
        }));

        allWords.push(...estimatedWords);
        return { ...seg, words: estimatedWords };
      });
    }

    // Normalize timestamps across noisy Whisper predictions and chunk seams
    allWords = allWords
      .filter(w => w && w.word && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map(w => ({
        word: w.word,
        start: Math.max(0, w.start),
        end: Math.max(0, w.end),
      }))
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < allWords.length; i++) {
      const w = allWords[i];
      if (w.end < w.start) w.end = w.start;
      if (i > 0) {
        const prev = allWords[i - 1];
        if (w.start < prev.start) w.start = prev.start;
        if (prev.end > w.start + 0.05) {
          prev.end = Math.max(prev.start, w.start);
        }
        if (w.end < w.start) w.end = w.start;
      }
    }

    allSegments = allSegments
      .filter(s => s && Number.isFinite(s.start) && Number.isFinite(s.end))
      .map(s => ({
        ...s,
        start: Math.max(0, s.start),
        end: Math.max(Math.max(0, s.start), s.end),
      }))
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < allSegments.length; i++) {
      if (i > 0 && allSegments[i].start < allSegments[i - 1].start) {
        allSegments[i].start = allSegments[i - 1].start;
        if (allSegments[i].end < allSegments[i].start) {
          allSegments[i].end = allSegments[i].start;
        }
      }
    }

    if (allWords.length > 0 && allSegments.length > 0) {
      allSegments = mapWordsToSegments(allSegments, allWords);
    }

    const fullText = allSegments.map(s => s.text).join(' ').trim();
    const scriptStats = computeScriptStats(fullText);

    return {
      language: detectedLanguage,
      duration: Math.round(totalDuration * 1000) / 1000,
      text: fullText,
      words: allWords,
      segments: allSegments,
      meta: {
        provider: 'groq',
        model: activeModel,
        requestedLanguage: options.language || 'auto',
        detectedLanguage,
        scriptStats,
        wordsEstimated
      }
    };
  } finally {
    // Clean up all temporary audio and chunk files
    for (const f of tempFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
  }
}
