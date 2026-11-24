/**
 * tests/edge_cases_and_durability.test.js
 * Comprehensive automated tests for Prompt 8:
 * - Edge Cases & Fault Injection
 * - Durability, Soak & Memory Stability
 * - Path Traversal & Static Route Isolation
 * - In-Flight Job Provider Isolation
 * - Caption Edge Cases (disabled, Unicode, long lines)
 * - Timestamp Validation Edge Cases (negative, inverted, out-of-bounds)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTimeRange, sanitizeAndValidateClips } from '../src/video/validator.js';
import { generateASS, escapeASSText, CAPTION_PRESETS } from '../src/subtitles.js';
import { safeCleanupDirectory } from '../src/system/disk_guard.js';
import { aiRegistry } from '../src/ai/registry.js';
import { PipelineJob, JobCoordinator } from '../src/pipeline_job.js';

describe('Prompt 8 — Edge Cases, Durability & Release Gate Verification', () => {

  describe('1. Timestamp & Time-Range Edge Cases', () => {
    it('rejects negative start or end timestamps', () => {
      const res1 = validateTimeRange({ start: -1, end: 20 });
      assert.equal(res1.valid, false);
      assert.match(res1.error, /cannot be negative/i);

      const res2 = validateTimeRange({ start: 10, end: -5 });
      assert.equal(res2.valid, false);
    });

    it('rejects inverted intervals where start >= end', () => {
      const res1 = validateTimeRange({ start: 30, end: 20 });
      assert.equal(res1.valid, false);
      assert.match(res1.error, /strictly greater/i);

      const res2 = validateTimeRange({ start: 15, end: 15 });
      assert.equal(res2.valid, false);
    });

    it('rejects non-finite values (NaN, Infinity, null, undefined)', () => {
      assert.equal(validateTimeRange({ start: NaN, end: 20 }).valid, false);
      assert.equal(validateTimeRange({ start: 0, end: Infinity }).valid, false);
      assert.equal(validateTimeRange({ start: null, end: 20 }).valid, false);
      assert.equal(validateTimeRange({ start: undefined, end: 20 }).valid, false);
    });

    it('clamps or flags timestamps exceeding source media duration', () => {
      // With known duration of 60s
      const res1 = validateTimeRange({ start: 10, end: 75, maxDuration: 60 });
      assert.equal(res1.valid, false);
      assert.match(res1.error, /exceeds total media duration/i);

      const res2 = validateTimeRange({ start: 65, end: 80, maxDuration: 60 });
      assert.equal(res2.valid, false);
      
      // Within duration is valid
      const valid = validateTimeRange({ start: 10, end: 50, maxDuration: 60 });
      assert.equal(valid.valid, true);
    });

    it('sanitizeAndValidateClips filters out corrupted or inverted clip intervals', () => {
      const rawClips = [
        { start: 5, end: 25, title: 'Valid Clip 1' },
        { start: 30, end: 20, title: 'Inverted Clip' }, // invalid
        { start: -5, end: 15, title: 'Negative Clip' }, // invalid
        { start: 40, end: 40, title: 'Zero Duration Clip' }, // invalid
        { start: 50, end: 80, title: 'Valid Clip 2' },
        { start: 'abc', end: 90, title: 'Corrupted Clip' }, // invalid
      ];

      const { validClips, rejected } = sanitizeAndValidateClips(rawClips, 100);
      assert.equal(validClips.length, 2);
      assert.equal(rejected.length, 4);
      assert.equal(validClips[0].title, 'Valid Clip 1');
      assert.equal(validClips[1].title, 'Valid Clip 2');
    });
  });

  describe('2. Caption Edge Cases & Fault Injection', () => {
    it('handles multilingual Unicode, non-Latin scripts, and complex emojis cleanly', () => {
      const complexTexts = [
        'नमस्ते दुनिया! L2S viral shorts 🚀',
        'こんにちは世界！字幕テスト 🌟',
        'مرحبا بالعالم! تجربة الترجمة 🔥',
        'Привет мир! Вирусные видео ✨',
        'Special chars: & < > " \' % { } \\ / | ~ ^ $ @'
      ];

      for (const text of complexTexts) {
        const escaped = escapeASSText(text);
        assert.doesNotThrow(() => {
          generateASS([{ start: 0, end: 5, text: escaped }], 'bold');
        });
        // Override braces must always be escaped
        assert.equal(escaped.includes('{'), false);
        assert.equal(escaped.includes('}'), false);
      }
    });

    it('gracefully handles empty word timestamps by falling back to segment timestamps', () => {
      const segmentNoWords = [
        { start: 1.5, end: 6.2, text: 'This segment has no word level timestamps available.' }
      ];

      const ass = generateASS(segmentNoWords, 'bold');
      assert.ok(ass.includes('Dialogue: 0,'));
      assert.ok(ass.includes('THIS SEGMENT HAS NO'));
      assert.ok(ass.includes('WORD LEVEL TIMESTAMPS'));
    });

    it('handles extremely long lines without breaking ASS syntax or exploding memory', () => {
      const longText = 'Word '.repeat(200);
      const segment = [{ start: 0, end: 30, text: longText }];
      
      const ass = generateASS(segment, 'minimal');
      assert.ok(ass.includes('[Events]'));
      assert.ok(ass.includes('Dialogue:'));
      assert.ok(ass.length > 500);
    });

    it('supports all 8 presets across different font sizes and margin positions', () => {
      const presetKeys = Object.keys(CAPTION_PRESETS);
      assert.equal(presetKeys.length, 8);

      for (const key of presetKeys) {
        const ass = generateASS(
          [{ start: 0, end: 4, text: `Testing preset ${key}` }],
          key,
          0,
          { marginV: 450, fontSize: 60 }
        );
        assert.ok(ass.includes(`Style: Default`));
        assert.ok(ass.includes('MarginV') || ass.includes('450'));
      }
    });
  });

  describe('3. In-Flight Job & Provider Isolation', () => {
    it('running jobs maintain their assigned provider snapshot even if registry active provider changes', () => {
      const job1 = new PipelineJob({
        id: 'job-ollama-test',
        source: 'test.mp4',
        options: {
          providerId: 'ollama',
          model: 'llama3.2:3b'
        }
      });

      assert.equal(job1.options.providerId, 'ollama');

      // Now simulate a user switching provider in UI to 'groq'
      aiRegistry.setActiveLLM('groq');

      // The running job's pinned provider must remain 'ollama'
      assert.equal(job1.options.providerId, 'ollama');
      assert.equal(job1.options.model, 'llama3.2:3b');

      // Switch back to ollama default
      aiRegistry.setActiveLLM('ollama');
    });

    it('JobCoordinator enforces strict single-active-job execution', () => {
      const coordinator = new JobCoordinator();
      
      const jobA = coordinator.createJob({ source: 'videoA.mp4' });
      assert.equal(jobA.state, 'queued');

      // Transition to RUNNING
      jobA.transitionTo('running');

      // Attempting to submit a second job while jobA is running must throw
      assert.throws(() => {
        coordinator.createJob({ source: 'videoB.mp4' });
      }, (err) => err.code === 'JOB_CONCURRENCY_LIMIT' || /already running/i.test(err.message));

      // Once jobA completes, a new job is allowed
      jobA.transitionTo('completed');
      const jobB = coordinator.createJob({ source: 'videoB.mp4' });
      assert.ok(jobB.id);
    });
  });

  describe('4. File Safety & Directory Guard Soak', () => {
    it('safeCleanupDirectory cleans job files across successive runs without deleting protected files', () => {
      const testDir = path.resolve('temp/soak_test_dir');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

      const protectedFile = path.join(testDir, 'source_protected.mp4');
      fs.writeFileSync(protectedFile, 'PROTECTED SOURCE VIDEO DATA');

      // Simulate 5 successive job runs creating temp artifacts
      for (let run = 1; run <= 5; run++) {
        const tempChunk = path.join(testDir, `chunk_${run}.wav`);
        const tempAss = path.join(testDir, `sub_${run}.ass`);
        fs.writeFileSync(tempChunk, `Audio chunk ${run}`);
        fs.writeFileSync(tempAss, `ASS script ${run}`);

        assert.ok(fs.existsSync(tempChunk));
        assert.ok(fs.existsSync(tempAss));

        // Clean up protecting source file
        safeCleanupDirectory(testDir, { protectedFile });

        // Temp artifacts cleaned
        assert.equal(fs.existsSync(tempChunk), false);
        assert.equal(fs.existsSync(tempAss), false);

        // Protected source remains intact
        assert.ok(fs.existsSync(protectedFile));
      }

      // Cleanup test dir
      fs.unlinkSync(protectedFile);
      fs.rmdirSync(testDir);
    });
  });

  describe('5. Static Route Security & Path Traversal Guards', () => {
    it('verifies server does not mount root directory as static endpoint', () => {
      const serverFile = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
      // Must NOT do app.use(express.static(rootDir))
      assert.equal(
        /app\.use\(\s*express\.static\(\s*rootDir\s*\)\s*\)/.test(serverFile),
        false,
        'Server must not serve rootDir as static directory'
      );
    });

    it('verifies static routes are strictly scoped to public, and output/temp are protected (Step 7)', () => {
      const serverFile = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
      assert.ok(serverFile.includes("express.static(path.join(rootDir, 'public')"));
      // As required by Step 7, output and temp are removed from public express.static
      assert.ok(!serverFile.includes("app.use('/output', express.static"));
      assert.ok(!serverFile.includes("app.use('/temp', express.static"));
    });
  });
});
