// =============================================
// L2S — Groq Whisper Cloud STT Adapter
// =============================================
// Robust Cloud Speech-to-Text via Groq Whisper API.
// Features:
// 1. Auto-compression of uncompressed/large WAV to 48kbps mono MP3 (shrinks audio by ~8x).
// 2. Automatic audio chunking for long media (> 24MB, e.g. 1hr+ podcasts) with seamless timestamp stitching.
// 3. Rate-limit (429) backoff retry and 413 entity-too-large adaptive chunking recovery.
// 4. Safe temporary file cleanup in all code paths.

import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';
import { BaseSTTProvider, maskApiKey } from '../contracts.js';
import { spawnTracked } from '../../process_manager.js';

const MAX_GROQ_FILE_SIZE = 24 * 1024 * 1024; // 24 MB safe threshold (Groq hard limit is 25 MB)
const CHUNK_DURATION_SEC = 600; // 10 minutes per chunk (~3.6 MB at 48kbps)

/**
 * Execute child process safely using spawnTracked
 */
function runCommandAsync(command, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

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
 * Probe audio duration in seconds using ffprobe
 */
async function getAudioDuration(audioPath) {
  try {
    const res = await runCommandAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], 15000);
    const dur = parseFloat(res.stdout.trim());
    if (!isNaN(dur) && dur > 0) return dur;
  } catch (e) {
    // ffprobe failed or timed out
  }
  return 0;
}

/**
 * Extract or compress audio to 16kHz mono 48kbps MP3
 */
async function extractOrCompressAudio(inputPath, outputPath, startSec = null, durationSec = null) {
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
    throw new Error(`Audio compression failed: ${res.stderr?.trim() || 'FFmpeg exited with code ' + res.code}`);
  }
  return outputPath;
}

export class GroqWhisperSTT extends BaseSTTProvider {
  constructor(config = {}) {
    const model = config.model || process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
    super('groq_whisper', 'Groq Whisper (Cloud, Ultra-Fast)', 'cloud', model);

    this.apiKey = typeof config.apiKey === 'string' ? config.apiKey : (process.env.GROQ_API_KEY || '');
  }

  getApiKey() {
    return (this.apiKey !== undefined ? this.apiKey : (process.env.GROQ_API_KEY || '')).trim();
  }

  getMaskedKey() {
    return maskApiKey(this.getApiKey());
  }

  isConfigured() {
    return Boolean(this.getApiKey().length > 0);
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return {
        ok: false,
        available: false,
        model: this.model,
        error: 'GROQ_API_KEY not configured',
        warning: 'GROQ_API_KEY is missing for Groq Whisper transcription.',
      };
    }
    return {
      ok: true,
      available: true,
      model: this.model,
      warning: null,
    };
  }

  async transcribe(audioPath, onProgress) {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Groq API Key not found for Whisper transcription. Please configure GROQ_API_KEY in Settings or .env.');
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at: ${audioPath}`);
    }

    const groq = new Groq({ apiKey: key });
    const tempFiles = [];

    try {
      const stats = fs.statSync(audioPath);
      const ext = path.extname(audioPath).toLowerCase();
      const isLargeOrWav = stats.size > 20 * 1024 * 1024 || ext === '.wav';

      let targetAudioPath = audioPath;

      // 1. If audio is WAV or > 20MB, compress to 48kbps mono MP3 first (8x smaller, pristine speech recognition)
      if (isLargeOrWav) {
        if (onProgress) onProgress('Optimizing audio size for Groq Cloud Whisper...');
        const tempCompressed = path.join(
          path.dirname(audioPath),
          `opt_${Date.now()}_${path.basename(audioPath, ext)}.mp3`
        );
        tempFiles.push(tempCompressed);
        await extractOrCompressAudio(audioPath, tempCompressed);
        targetAudioPath = tempCompressed;
      }

      const targetStats = fs.statSync(targetAudioPath);

      // 2. If target audio is within Groq's 25MB limit (handles videos up to ~65-70 min at 48k):
      if (targetStats.size <= MAX_GROQ_FILE_SIZE) {
        if (onProgress) onProgress('Transcribing via Groq Whisper Cloud API...');
        try {
          return await this._transcribeSingleFile(groq, targetAudioPath);
        } catch (err) {
          // If Groq still returns 413 (e.g. strict payload headers), adaptively fall back to chunking
          const msg = String(err.message || '');
          if (msg.includes('413') || msg.includes('request_too_large') || msg.includes('Too Large')) {
            if (onProgress) onProgress('Payload exceeded cloud threshold. Switching to adaptive audio chunking...');
            return await this._chunkAndTranscribe(groq, audioPath, onProgress);
          }
          throw err;
        }
      }

      // 3. For extra-long audio (>24MB, e.g. 1.5 - 3+ hour videos), chunk into 10-minute slices
      return await this._chunkAndTranscribe(groq, audioPath, onProgress);
    } finally {
      // Clean up all temporary files safely
      for (const f of tempFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch (e) {}
      }
    }
  }

  async _extractChunk(inputPath, outputPath, startSec, durationSec) {
    return await extractOrCompressAudio(inputPath, outputPath, startSec, durationSec);
  }

  async _chunkAndTranscribe(groq, audioPath, onProgress) {
    return this._transcribeChunked(groq, audioPath, onProgress);
  }

  async _transcribeChunked(groq, audioPath, onProgress, totalDuration = null, chunkDuration = null, numChunks = null) {
    const dur = (totalDuration !== null && totalDuration !== undefined)
      ? totalDuration
      : (await getAudioDuration(audioPath));
    const CHUNK_DURATION = chunkDuration || CHUNK_DURATION_SEC;
    const count = (numChunks !== null && numChunks !== undefined)
      ? numChunks
      : (dur > 0
          ? Math.ceil(dur / CHUNK_DURATION)
          : Math.max(1, Math.ceil(fs.statSync(audioPath).size / (MAX_GROQ_FILE_SIZE / 2))));

    if (onProgress) {
      onProgress(`Audio is long. Splitting into ${count} parts for Groq Cloud transcription...`);
    }

    const allSegments = [];
    let detectedLanguage = 'unknown';
    const tempChunkFiles = [];

    try {
      for (let i = 0; i < count; i++) {
        const startSec = i * CHUNK_DURATION;
        const durationSec = dur > 0 ? Math.min(CHUNK_DURATION, dur - startSec) : CHUNK_DURATION;
        if (durationSec <= 0) break;

        const chunkPath = path.join(
          path.dirname(audioPath),
          `chunk_${i}_${Date.now()}.mp3`
        );
        tempChunkFiles.push(chunkPath);

        if (onProgress) {
          const startMin = Math.floor(startSec / 60);
          const endMin = Math.floor((startSec + durationSec) / 60);
          onProgress(`Transcribing part ${i + 1}/${count} (${startMin}m - ${endMin}m)...`);
        }

        await this._extractChunk(audioPath, chunkPath, startSec, durationSec);

        const transcription = await this._callGroqWithRetry(groq, chunkPath);

        if (transcription.language && detectedLanguage === 'unknown') {
          detectedLanguage = transcription.language;
        }

        const chunkSegments = (transcription.segments || []).map((seg, idx) => {
          const adjStart = Number((seg.start + startSec).toFixed(3));
          const adjEnd = Number((seg.end + startSec).toFixed(3));
          const words = (transcription.words || [])
            .filter(w => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05)
            .map(w => ({
              word: w.word,
              start: Number((w.start + startSec).toFixed(3)),
              end: Number((w.end + startSec).toFixed(3)),
            }));

          return {
            id: allSegments.length + idx,
            start: adjStart,
            end: adjEnd,
            text: (seg.text || '').trim(),
            words,
          };
        });

        allSegments.push(...chunkSegments);

        // Remove chunk file as soon as it is transcribed
        try {
          if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
        } catch (e) {}
      }

      const finalDuration = dur > 0
        ? dur
        : (allSegments.length > 0 ? allSegments[allSegments.length - 1].end : 0);

      return {
        language: detectedLanguage,
        duration: Number(finalDuration),
        segments: allSegments,
      };
    } finally {
      for (const cf of tempChunkFiles) {
        try {
          if (fs.existsSync(cf)) fs.unlinkSync(cf);
        } catch (e) {}
      }
    }
  }

  async _transcribeSingleFile(groq, filePath) {
    const transcription = await this._callGroqWithRetry(groq, filePath);

    const segments = (transcription.segments || []).map(seg => ({
      id: seg.id,
      start: Number(seg.start ?? 0),
      end: Number(seg.end ?? 0),
      text: (seg.text || '').trim(),
      words: (transcription.words || [])
        .filter(w => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05)
        .map(w => ({
          word: w.word,
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        })),
    }));

    return {
      language: transcription.language || 'unknown',
      duration: Number(transcription.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0)),
      segments,
    };
  }

  async _callGroqWithRetry(groq, filePath, maxRetries = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await groq.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: this.model,
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
        });
      } catch (err) {
        lastErr = err;
        const msg = String(err.message || '');
        if (msg.includes('429') || msg.includes('rate_limit')) {
          const delayMs = attempt * 2500;
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
