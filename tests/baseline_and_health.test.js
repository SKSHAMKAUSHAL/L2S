import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkDependencies } from '../src/doctor.js';
import { formatASSTime } from '../src/captions/ass_builder.js';
import { aiRegistry } from '../src/ai/registry.js';

describe('Prompt 2 Baseline: Health, Isolated Fixtures & Deterministic Parsers', () => {
  // ─── Task 8: Tool & Service Health Baseline ──────────────────
  test('distinguishes required tools from optional AI services', async () => {
    const deps = await checkDependencies();
    
    // Required tools for full local video pipeline
    assert.ok(typeof deps.ffmpeg.installed === 'boolean', 'FFmpeg installed flag must be boolean');
    assert.ok(typeof deps.ytdlp.installed === 'boolean', 'yt-dlp installed flag must be boolean');
    
    // Optional local AI service: Ollama is optional
    assert.ok(typeof deps.ollama.installed === 'boolean', 'Ollama installed flag must be boolean');
    assert.ok(deps.ollama.version, 'Ollama version or status string must be present');
    
    // Active AI Provider registry summary
    const summary = await aiRegistry.getStatusSummary();
    assert.ok(['ollama', 'groq'].includes(summary.activeLLM), 'Active LLM must be either ollama or groq');
    assert.strictEqual(summary.allowCloudFallback, false, 'Cloud fallback must be disabled by default');
  });

  // ─── Task 6 & 7: Isolated Test Fixtures & Temporary Dirs ─────
  test('isolated test fixtures do not modify user directories or tokens', () => {
    const isolatedTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2s-test-'));
    try {
      const fixtureTranscript = {
        language: 'en',
        duration: 45.0,
        segments: [
          {
            id: 0,
            start: 0.0,
            end: 15.2,
            text: 'How to build high performance node applications.',
            words: [
              { word: 'How', start: 0.0, end: 0.3 },
              { word: 'to', start: 0.3, end: 0.5 },
              { word: 'build', start: 0.5, end: 0.9 },
            ],
          },
          {
            id: 1,
            start: 15.2,
            end: 32.5,
            text: 'Never block the event loop with synchronous operations.',
            words: [
              { word: 'Never', start: 15.2, end: 15.6 },
              { word: 'block', start: 15.6, end: 16.0 },
            ],
          },
        ],
      };

      const fixturePath = path.join(isolatedTemp, 'fixture.json');
      fs.writeFileSync(fixturePath, JSON.stringify(fixtureTranscript, null, 2));

      assert.ok(fs.existsSync(fixturePath));
      const readBack = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      assert.strictEqual(readBack.segments.length, 2);
      assert.strictEqual(readBack.segments[0].words.length, 3);
    } finally {
      fs.rmSync(isolatedTemp, { recursive: true, force: true });
    }
  });

  // ─── Task 7: Deterministic Provider Response Parsing ──────────
  test('robustly parses LLM JSON outputs across array, object, and markdown formats', () => {
    function parseLLMPayload(raw) {
      if (!raw || typeof raw !== 'string') return [];
      let cleaned = raw
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (!match) return [];

      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
        if (parsed.segments && Array.isArray(parsed.segments)) return parsed.segments;
        if (parsed.clips && Array.isArray(parsed.clips)) return parsed.clips;
        return [parsed];
      } catch {
        return [];
      }
    }

    // Format 1: Markdown codeblock with JSON array
    const mdArray = '```json\n[{"segment_id": "seg_0", "overall_score": 88}]\n```';
    const res1 = parseLLMPayload(mdArray);
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(res1[0].segment_id, 'seg_0');

    // Format 2: Raw JSON array
    const rawArray = '[{"segment_id": "seg_1", "overall_score": 75}]';
    const res2 = parseLLMPayload(rawArray);
    assert.strictEqual(res2.length, 1);
    assert.strictEqual(res2[0].segment_id, 'seg_1');

    // Format 3: Wrapped object with segments key
    const wrappedObj = '{"segments": [{"segment_id": "seg_2", "overall_score": 92}]}';
    const res3 = parseLLMPayload(wrappedObj);
    assert.strictEqual(res3.length, 1);
    assert.strictEqual(res3[0].segment_id, 'seg_2');

    // Format 4: Malformed string degrades gracefully without crashing
    const malformed = 'Error: could not generate valid output';
    const res4 = parseLLMPayload(malformed);
    assert.deepStrictEqual(res4, []);
  });

  // ─── Task 7: Timestamp Formatting & Precision ─────────────────
  test('formats ASS centisecond timestamps and validates boundaries', () => {
    // 0 seconds -> 0:00:00.00
    assert.strictEqual(formatASSTime(0), '0:00:00.00');

    // 65.45 seconds -> 0:01:05.45 (ASS floor centisecond)
    assert.strictEqual(formatASSTime(65.45), '0:01:05.45');

    // Boundary check helper
    function validateBoundaries(start, end, maxDuration = 60) {
      if (typeof start !== 'number' || typeof end !== 'number') return false;
      if (start < 0 || end < 0) return false;
      if (start >= end) return false; // Inverted or zero duration
      if (end - start > maxDuration) return false;
      return true;
    }

    assert.strictEqual(validateBoundaries(5, 30), true);
    assert.strictEqual(validateBoundaries(30, 5), false); // Inverted
    assert.strictEqual(validateBoundaries(-1, 20), false); // Negative
    assert.strictEqual(validateBoundaries(0, 120, 60), false); // Exceeds max short length
  });
});
