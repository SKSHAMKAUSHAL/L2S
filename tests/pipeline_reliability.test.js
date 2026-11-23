import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifyMediaFile } from '../src/video/verifier.js';
import { validateTimeRange, sanitizeAndValidateClips } from '../src/video/validator.js';
import { getFreeDiskSpace, ensureSufficientDiskSpace, validateFileSize, safeCleanupDirectory } from '../src/system/disk_guard.js';
import { PipelineJob, JobCoordinator, JOB_STATES, sanitizeClientError } from '../src/pipeline_job.js';
import { CacheManager } from '../src/cache_manager.js';

describe('Prompt 4 — Pipeline Reliability, Integrity & Performance', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `l2s_test_p4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {}
  });

  // ─── 1. Output Verification & False-Success Prevention ──────
  test('verifyMediaFile rejects nonexistent or 0-byte output files', async () => {
    const missingPath = path.join(tempDir, 'nonexistent.mp4');
    const result1 = await verifyMediaFile(missingPath);
    assert.strictEqual(result1.valid, false);
    assert.ok(result1.error.includes('does not exist'));

    const emptyPath = path.join(tempDir, 'empty.mp4');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));
    const result2 = await verifyMediaFile(emptyPath);
    assert.strictEqual(result2.valid, false);
    assert.ok(result2.error.includes('File size too small'));
  });

  test('verifyMediaFile rejects corrupt media containers with FFprobe', async () => {
    const corruptPath = path.join(tempDir, 'corrupt.mp4');
    // Write 2KB of random non-video garbage
    fs.writeFileSync(corruptPath, Buffer.alloc(2048, 0xFF));
    const result = await verifyMediaFile(corruptPath);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('FFprobe failed') || result.error.includes('Invalid'));
  });

  // ─── 2. Boundary & Timestamp Validation ─────────────────────
  test('validateTimeRange validates finite numbers, positive values and durations', () => {
    // Valid range
    const valid = validateTimeRange({ start: 10, end: 25.5, maxDuration: 60 });
    assert.strictEqual(valid.valid, true);
    assert.strictEqual(valid.duration, 15.5);

    // Negative start
    const neg = validateTimeRange({ start: -5, end: 20 });
    assert.strictEqual(neg.valid, false);
    assert.ok(neg.error.includes('cannot be negative'));

    // End <= Start
    const inverted = validateTimeRange({ start: 30, end: 20 });
    assert.strictEqual(inverted.valid, false);
    assert.ok(inverted.error.includes('strictly greater'));

    // Non-finite values
    const nanVal = validateTimeRange({ start: NaN, end: 20 });
    assert.strictEqual(nanVal.valid, false);

    // Exceeding media duration
    const outOfBounds = validateTimeRange({ start: 50, end: 120, maxDuration: 60 });
    assert.strictEqual(outOfBounds.valid, false);
    assert.ok(outOfBounds.error.includes('exceeds total media duration'));
  });

  test('sanitizeAndValidateClips filters out invalid intervals', () => {
    const clips = [
      { start: 0, end: 15, text: 'Good clip 1' },
      { start: -5, end: 10, text: 'Bad negative clip' },
      { start: 20, end: 20.2, text: 'Too short clip' },
      { start: 30, end: 45, text: 'Good clip 2' },
      { start: 100, end: 120, text: 'Out of bounds' },
    ];

    const { validClips, rejected } = sanitizeAndValidateClips(clips, 60);
    assert.strictEqual(validClips.length, 2);
    assert.strictEqual(rejected.length, 3);
    assert.strictEqual(validClips[0].text, 'Good clip 1');
    assert.strictEqual(validClips[1].text, 'Good clip 2');
  });

  // ─── 3. Disk Space Guard & Resource Limits ──────────────────
  test('getFreeDiskSpace returns positive byte capacity', () => {
    const freeBytes = getFreeDiskSpace(tempDir);
    assert.ok(typeof freeBytes === 'number');
    assert.ok(freeBytes > 0);
  });

  test('ensureSufficientDiskSpace throws DISK_FULL when required bytes exceed storage', () => {
    // Request an absurd 1000 Terabytes
    assert.throws(() => {
      ensureSufficientDiskSpace(tempDir, 1000 * 1024 * 1024 * 1024 * 1024);
    }, (err) => {
      return err.code === 'DISK_FULL' && err.message.includes('Insufficient disk space');
    });
  });

  test('validateFileSize throws when file exceeds maximum limit', () => {
    const testFile = path.join(tempDir, 'size_test.dat');
    fs.writeFileSync(testFile, Buffer.alloc(1024 * 1024)); // 1 MB
    assert.strictEqual(validateFileSize(testFile, 5 * 1024 * 1024), true);

    assert.throws(() => {
      validateFileSize(testFile, 500 * 1024); // Limit to 500 KB
    }, /exceeds maximum allowed limit/i);
  });

  test('safeCleanupDirectory cleans job files while protecting source media', () => {
    const sourceVideo = path.join(tempDir, 'source_user_video.mp4');
    const tempRaw = path.join(tempDir, 'clip-01-raw.mp4');
    const tempAudio = path.join(tempDir, 'audio.wav');

    fs.writeFileSync(sourceVideo, 'original source video');
    fs.writeFileSync(tempRaw, 'temp raw render');
    fs.writeFileSync(tempAudio, 'temp extracted audio');

    // Clean only .wav and -raw.mp4, protecting sourceVideo
    const cleaned = safeCleanupDirectory(tempDir, {
      extensions: ['.wav', '-raw.mp4'],
      protectedFile: sourceVideo,
    });

    assert.strictEqual(cleaned, 2);
    assert.ok(fs.existsSync(sourceVideo), 'Original user video MUST be preserved');
    assert.ok(!fs.existsSync(tempRaw), 'Temp raw video should be removed');
    assert.ok(!fs.existsSync(tempAudio), 'Temp audio should be removed');
  });

  // ─── 4. Job State Machine & Concurrency Control ─────────────
  test('PipelineJob enforces strict deterministic state transitions', () => {
    const job = new PipelineJob({ id: 'job_test_1', source: 'https://youtu.be/abc' });
    assert.strictEqual(job.state, JOB_STATES.QUEUED);

    // queued -> running
    job.transitionTo(JOB_STATES.RUNNING);
    assert.strictEqual(job.state, JOB_STATES.RUNNING);
    assert.ok(job.startedAt > 0);

    // running -> completed
    job.transitionTo(JOB_STATES.COMPLETED);
    assert.strictEqual(job.state, JOB_STATES.COMPLETED);
    assert.strictEqual(job.isTerminal(), true);

    // Illegal transition from terminal state completed -> running
    assert.throws(() => {
      job.transitionTo(JOB_STATES.RUNNING);
    }, /Invalid job state transition/i);
  });

  test('JobCoordinator rejects duplicate job submissions when active job is running', () => {
    const coordinator = new JobCoordinator();
    const job1 = coordinator.createJob({ id: 'job_1', source: 'https://youtu.be/1' });
    job1.transitionTo(JOB_STATES.RUNNING);

    // Attempting to submit job 2 while job 1 is running must throw
    assert.throws(() => {
      coordinator.createJob({ id: 'job_2', source: 'https://youtu.be/2' });
    }, (err) => {
      return err.code === 'JOB_CONCURRENCY_LIMIT';
    });

    // Complete job 1
    coordinator.completeJob('job_1');

    // Now job 2 can be created
    const job2 = coordinator.createJob({ id: 'job_2', source: 'https://youtu.be/2' });
    assert.strictEqual(job2.id, 'job_2');
  });

  test('JobCoordinator handles cancellation cleanly', () => {
    const coordinator = new JobCoordinator();
    const job = coordinator.createJob({ id: 'job_cancel_test', source: 'https://youtu.be/x' });
    job.transitionTo(JOB_STATES.RUNNING);

    const cancelled = coordinator.cancelActiveJob('User cancelled');
    assert.strictEqual(cancelled, true);
    assert.strictEqual(job.state, JOB_STATES.STOPPED);
    assert.strictEqual(job.isTerminal(), true);
  });

  // ─── 5. Multi-Factor Composite Cache Keys ───────────────────
  test('CacheManager produces different keys when model, quality, or engine changes', () => {
    const cache = new CacheManager(tempDir);
    const source = 'https://youtu.be/sample';

    const keyOllama = cache.generateKey(source, { engine: 'ollama', model: 'llama3.2:3b', quality: '1080p' });
    const keyGroq = cache.generateKey(source, { engine: 'groq', model: 'openai/gpt-oss-20b', quality: '1080p' });
    const key720p = cache.generateKey(source, { engine: 'ollama', model: 'llama3.2:3b', quality: '720p' });

    assert.notStrictEqual(keyOllama, keyGroq, 'Changing provider/model must invalidate cache');
    assert.notStrictEqual(keyOllama, key720p, 'Changing quality profile must invalidate cache');

    // Identical parameters must yield identical key
    const keyRepeat = cache.generateKey(source, { quality: '1080p', model: 'llama3.2:3b', engine: 'ollama' });
    assert.strictEqual(keyOllama, keyRepeat, 'Deterministically ordered params must produce matching key');
  });

  test('CacheManager writes atomically without leaving corrupt temp files', () => {
    const cache = new CacheManager(tempDir);
    const source = 'test_source_id';
    const transcript = { language: 'en', segments: [{ text: 'Atomic cache test' }] };

    cache.saveTranscript(source, { model: 'tiny.en' }, transcript);
    const retrieved = cache.getTranscript(source, { model: 'tiny.en' });

    assert.deepStrictEqual(retrieved, transcript);
  });

  // ─── 6. Client Error & Secret Sanitization ──────────────────
  test('sanitizeClientError redacts absolute paths, user directories and API keys', () => {
    const rawError = new Error('FFmpeg failed at C:\\Users\\sksha\\Downloads\\L2S\\temp\\video.mp4 with key gsk_supersecret1234567890');
    const sanitized = sanitizeClientError(rawError, 'C:\\Users\\sksha\\Downloads\\L2S');

    assert.ok(!sanitized.msg.includes('sksha'), 'Windows user profile must be redacted');
    assert.ok(!sanitized.msg.includes('gsk_supersecret'), 'API key must be redacted');
    assert.ok(sanitized.msg.includes('gsk_***REDACTED***'));
  });
});
