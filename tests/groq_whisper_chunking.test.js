/**
 * tests/groq_whisper_chunking.test.js
 * Verification for Groq Cloud Whisper auto-compression, 413 avoidance, and chunking logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GroqWhisperSTT } from '../src/ai/stt/whisper_groq.js';

describe('Groq Whisper STT Auto-Compression & Chunking (413 Prevention)', () => {
  it('initializes with cloud type and whisper-large-v3-turbo model', () => {
    const stt = new GroqWhisperSTT();
    assert.equal(stt.id, 'groq_whisper');
    assert.equal(stt.type, 'cloud');
    assert.ok(stt.model.includes('whisper'));
  });

  it('rejects transcription if API key is missing', async () => {
    const stt = new GroqWhisperSTT({ apiKey: '' });
    await assert.rejects(
      async () => {
        await stt.transcribe('nonexistent.wav');
      },
      /Groq API Key not found/i
    );
  });

  it('shifts timestamps accurately across chunks in _transcribeChunked', async () => {
    const stt = new GroqWhisperSTT({ apiKey: 'gsk_dummy_test_key_1234567890' });

    // Mock _callGroqWithRetry to simulate 2 chunks of transcriptions
    let callCount = 0;
    stt._callGroqWithRetry = async (groq, chunkPath) => {
      callCount++;
      if (callCount === 1) {
        return {
          language: 'english',
          duration: 600,
          segments: [
            { id: 0, start: 5.0, end: 12.5, text: 'Hello from chunk one.' },
          ],
          words: [
            { word: 'Hello', start: 5.0, end: 5.5 },
            { word: 'from', start: 5.6, end: 6.0 },
          ],
        };
      } else {
        return {
          language: 'english',
          duration: 300,
          segments: [
            { id: 0, start: 2.0, end: 8.0, text: 'Hello from chunk two.' },
          ],
          words: [
            { word: 'Hello', start: 2.0, end: 2.5 },
          ],
        };
      }
    };

    // Mock _extractChunk to prevent running ffmpeg during timestamp logic test
    stt._extractChunk = async (inputPath, outputPath, startSec, durationSec) => {
      fs.writeFileSync(outputPath, 'fake mp3 slice');
      return outputPath;
    };

    // Test simulated chunk stitching
    const mockAudio = path.resolve('tests/fixtures/test_audio.wav');
    // Ensure dir exists
    fs.mkdirSync(path.dirname(mockAudio), { recursive: true });
    fs.writeFileSync(mockAudio, 'mock wav data');

    try {
      // Direct verification of chunk aggregation logic
      const result = await stt._transcribeChunked(
        {},
        mockAudio,
        () => {},
        900, // 900 seconds total duration (15 min)
        600, // 600 seconds chunk size (10 min)
        2    // 2 chunks
      );

      assert.equal(result.segments.length, 2);
      // Chunk 1: offset 0
      assert.equal(result.segments[0].start, 5.0);
      assert.equal(result.segments[0].end, 12.5);
      assert.equal(result.segments[0].words[0].start, 5.0);

      // Chunk 2: offset 600s
      assert.equal(result.segments[1].start, 602.0); // 2.0 + 600
      assert.equal(result.segments[1].end, 608.0);   // 8.0 + 600
      assert.equal(result.segments[1].words[0].start, 602.0); // 2.0 + 600
      assert.equal(result.duration, 900);
    } finally {
      if (fs.existsSync(mockAudio)) fs.unlinkSync(mockAudio);
    }
  });

  it('safely handles 429 rate limit backoff in _callGroqWithRetry', async () => {
    const stt = new GroqWhisperSTT({ apiKey: 'gsk_dummy_test_key_1234567890' });
    let attempts = 0;

    const mockGroq = {
      audio: {
        transcriptions: {
          create: async (params) => {
            // Close stream immediately if present to avoid dangling descriptors
            if (params.file && typeof params.file.destroy === 'function') {
              params.file.destroy();
            }
            attempts++;
            if (attempts < 2) {
              const err = new Error('429 rate_limit_exceeded');
              throw err;
            }
            return { language: 'en', segments: [], text: 'Success after retry' };
          },
        },
      },
    };

    const tempFile = path.resolve('tests/fixtures/retry_test.mp3');
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, 'mp3 data');

    try {
      const res = await stt._callGroqWithRetry(mockGroq, tempFile, 3);
      assert.equal(res.text, 'Success after retry');
      assert.equal(attempts, 2);
    } finally {
      await new Promise(r => setTimeout(r, 100));
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch (e) {}
      }
    }
  });
});
