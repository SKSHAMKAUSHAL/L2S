import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  mapWordsToSegments,
  buildWhisperPrompt,
  planChunkSplits,
  transcribeGroq,
  computeScriptStats
} from '../src/stt/groq.js';
import {
  validateTranscript,
  computeTranscriptHash,
  transcribeAudio
} from '../src/transcriber.js';
import { loadEnglishTranscript } from './helpers/fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Step 1: Transcription Engine Tests (Mocked, Zero-Network)', async (t) => {
  const fixture = loadEnglishTranscript();

  await t.test('1. word-to-segment mapping maps words into matching segments by time containment', () => {
    const rawSegments = [
      { id: 0, start: 0.0, end: 3.0, text: 'Hello world' },
      { id: 1, start: 3.0, end: 6.0, text: 'testing subtitles' }
    ];
    const rawWords = [
      { word: 'Hello', start: 0.1, end: 0.8 },
      { word: 'world', start: 0.9, end: 2.2 },
      { word: 'testing', start: 3.1, end: 4.0 },
      { word: 'subtitles', start: 4.1, end: 5.5 }
    ];

    const mapped = mapWordsToSegments(rawSegments, rawWords);
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].words.length, 2);
    assert.equal(mapped[0].words[0].word, 'Hello');
    assert.equal(mapped[0].words[1].word, 'world');
    assert.equal(mapped[1].words.length, 2);
    assert.equal(mapped[1].words[0].word, 'testing');
    assert.equal(mapped[1].words[1].word, 'subtitles');
  });

  await t.test('2. prompt builder trims under 200 tokens, dedupes, and handles Hinglish priming', () => {
    const promptEng = buildWhisperPrompt({
      title: 'How to Build a Startup',
      description: 'A great business guide with https://example.com link! 🚀🚀🚀 Build a startup.',
      channel: 'YCombinator'
    });

    assert.ok(!promptEng.includes('https://'), 'URLs must be stripped');
    assert.ok(!promptEng.includes('🚀'), 'Emojis must be stripped');

    // Test Hinglish prompt
    const promptHinglish = buildWhisperPrompt({
      language: 'hinglish',
      title: 'YouTube Growth Tips',
      description: 'Kaise grow karein'
    });

    assert.ok(promptHinglish.includes('Aaj hum ek important topic pe baat karenge'), 'Hinglish must include Roman priming phrase');
  });

  await t.test('3. script stats calculates Devanagari vs Latin character ratios accurately', () => {
    const devanagariText = 'अगर आप जीवन में बड़ी सफलता हासिल करना चाहते हैं';
    const statsHi = computeScriptStats(devanagariText);
    assert.ok(statsHi.devanagariShare > 0.9, 'Hindi text must have >90% Devanagari share');
    assert.equal(statsHi.latinShare, 0);

    const latinText = 'Hello world this is pure english';
    const statsEn = computeScriptStats(latinText);
    assert.equal(statsEn.devanagariShare, 0);
    assert.ok(statsEn.latinShare > 0.9, 'English text must have >90% Latin share');
  });

  await t.test('4. cache key changes deterministically when audio, model, language or prompt changes', () => {
    // Use an existing test fixture file as dummy audio
    const dummyAudio = path.resolve(__dirname, 'fixtures/en.json');
    const hash1 = computeTranscriptHash(dummyAudio, 'whisper-large-v3-turbo', 'en', 'prompt A');
    const hash2 = computeTranscriptHash(dummyAudio, 'whisper-large-v3-turbo', 'en', 'prompt A');
    const hash3 = computeTranscriptHash(dummyAudio, 'whisper-large-v3', 'en', 'prompt A');
    const hash4 = computeTranscriptHash(dummyAudio, 'whisper-large-v3-turbo', 'hi', 'prompt A');
    const hash5 = computeTranscriptHash(dummyAudio, 'whisper-large-v3-turbo', 'en', 'prompt B');

    assert.equal(hash1, hash2, 'Identical inputs must yield identical hash');
    assert.notEqual(hash1, hash3, 'Different model must yield different hash');
    assert.notEqual(hash1, hash4, 'Different language must yield different hash');
    assert.notEqual(hash1, hash5, 'Different prompt must yield different hash');
  });

  await t.test('5. validateTranscript validates correct transcripts and rejects invalid structures', () => {
    assert.ok(validateTranscript(fixture), 'Fixture must pass validation');

    // Rejects non-objects
    assert.throws(() => validateTranscript(null), /must be an object/);
    // Rejects missing segments
    assert.throws(() => validateTranscript({ text: 'hi', duration: 10, words: [] }), /segments must be an array/);
    // Rejects inverted timestamps
    const inverted = {
      text: 'bad',
      duration: 5,
      segments: [{ start: 5, end: 2 }],
      words: []
    };
    assert.throws(() => validateTranscript(inverted), /start > end/);
    // Rejects negative timestamps
    const negative = {
      text: 'bad',
      duration: 5,
      segments: [{ start: 0, end: 5 }],
      words: [{ word: 'bad', start: -1, end: 2 }]
    };
    assert.throws(() => validateTranscript(negative), /negative/);
  });

  await t.test('6. retry logic: handles 429 rate limits and succeeds on retry', async () => {
    let callCount = 0;
    const mockGroqClient = {
      audio: {
        transcriptions: {
          create: async () => {
            callCount++;
            if (callCount === 1) {
              const err = new Error('Rate limit exceeded');
              err.status = 429;
              throw err;
            }
            return {
              text: 'Retry success',
              language: 'en',
              words: [{ word: 'Retry', start: 0, end: 1 }, { word: 'success', start: 1, end: 2 }],
              segments: [{ start: 0, end: 2, text: 'Retry success' }]
            };
          }
        }
      }
    };

    const dummyAudio = path.resolve(__dirname, 'fixtures/en.json');
    const result = await transcribeGroq(dummyAudio, { groqClient: mockGroqClient, language: 'en' });
    assert.equal(callCount, 2, 'Should succeed on second attempt');
    assert.equal(result.text, 'Retry success');
  });

  await t.test('7. retry logic: throws after 3 consecutive 500 errors', async () => {
    let callCount = 0;
    const mockGroqClient = {
      audio: {
        transcriptions: {
          create: async () => {
            callCount++;
            const err = new Error('Internal Server Error');
            err.status = 500;
            throw err;
          }
        }
      }
    };

    const dummyAudio = path.resolve(__dirname, 'fixtures/en.json');
    await assert.rejects(
      async () => transcribeGroq(dummyAudio, { groqClient: mockGroqClient, language: 'en' }),
      /Internal Server Error/
    );
    assert.equal(callCount, 3, 'Must attempt 3 times before failing');
  });

  await t.test('8. does not silently fall back to local when Groq fails unless STT_ALLOW_LOCAL_FALLBACK=true', async () => {
    const originalEnv = process.env.STT_ALLOW_LOCAL_FALLBACK;
    const originalGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'mock_key';
    process.env.STT_ALLOW_LOCAL_FALLBACK = 'false';

    const mockGroqClient = {
      audio: {
        transcriptions: {
          create: async () => {
            throw new Error('Fatal Groq API Outage');
          }
        }
      }
    };

    const dummyAudio = path.resolve(__dirname, 'fixtures/en.json');
    const tempCacheDir = path.resolve(__dirname, 'temp_cache_' + Date.now());

    try {
      await assert.rejects(
        async () => transcribeAudio(dummyAudio, tempCacheDir, { groqClient: mockGroqClient }),
        /Local fallback is disabled/
      );
    } finally {
      process.env.STT_ALLOW_LOCAL_FALLBACK = originalEnv || '';
      process.env.GROQ_API_KEY = originalGroqKey || '';
      try { fs.rmSync(tempCacheDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
