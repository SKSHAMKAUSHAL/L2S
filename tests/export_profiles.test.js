import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { verifyMediaFile } from '../src/video/verifier.js';
import { detectEncoderAsync, renderClips } from '../src/renderer.js';
import { EXPORT_PROFILES, getExportProfile } from '../src/video/quality_profiles.js';

describe('Prompt 6 — Export Presets, Rendering Optimization & Hardware Benchmarks', () => {
  const fixturePath = path.resolve(process.cwd(), 'output', 'TeCrjPZ9fds', 'clips', 'clip-01.mp4');
  const testOutputDir = path.resolve(process.cwd(), 'temp', 'test_export_benchmarks');

  before(() => {
    fs.mkdirSync(testOutputDir, { recursive: true });
  });

  after(() => {
    try {
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      }
    } catch (e) { /* ignore cleanup errors */ }
  });

  test('detectEncoderAsync detects operational hardware encoder', async () => {
    const encoder = await detectEncoderAsync();
    assert.ok(encoder, 'Encoder object must be returned');
    assert.ok(encoder.codec, 'Encoder must specify a codec');
    assert.ok(encoder.preset, 'Encoder must specify a preset');
    assert.ok(['h264_nvenc', 'libx264'].includes(encoder.codec),
      `Encoder codec must be h264_nvenc or libx264, got ${encoder.codec}`);
  });

  test('verifyMediaFile extracts full container metadata including pixelFormat and bitrate', async () => {
    if (!fs.existsSync(fixturePath)) {
      return; // Skip if user fixture was cleaned
    }

    const verification = await verifyMediaFile(fixturePath, { minDuration: 1.0 });
    assert.strictEqual(verification.valid, true, `Verification must succeed: ${verification.error}`);
    assert.strictEqual(verification.width, 1080);
    assert.strictEqual(verification.height, 1920);
    assert.strictEqual(verification.pixelFormat, 'yuv420p', 'Must be universal yuv420p pixel format');
    assert.strictEqual(verification.videoCodec, 'h264');
    assert.ok(verification.duration > 20, 'Duration must be > 20s');
    assert.ok(verification.bitrate > 1000000, 'Bitrate must be positive');
  });

  test('benchmark: executes render across all 4 export profiles and records performance metrics', async () => {
    if (!fs.existsSync(fixturePath)) {
      return;
    }

    const profilesToTest = ['fast', 'balanced', 'high', 'max'];
    const benchmarkResults = [];

    for (const profileId of profilesToTest) {
      const profile = getExportProfile(profileId);
      const subOutputDir = path.join(testOutputDir, profileId);
      fs.mkdirSync(subOutputDir, { recursive: true });

      const testChunk = [
        {
          chunk: { start: 0.0, end: 1.5, text: 'Benchmarking export profile rendering' },
          custom: {
            exportQuality: profileId,
            aspectRatio: '9:16',
            zoom: 1.0,
            captionsEnabled: false,
          },
        },
      ];

      const t0 = Date.now();
      const renderedJobs = await renderClips(fixturePath, testChunk, 'bold', subOutputDir);
      const durationMs = Date.now() - t0;

      assert.strictEqual(renderedJobs.length, 1);
      const clipPath = renderedJobs[0].clipPath;
      assert.ok(fs.existsSync(clipPath), `Rendered clip must exist at ${clipPath}`);

      const verification = await verifyMediaFile(clipPath, { minDuration: 0.5 });
      assert.strictEqual(verification.valid, true, `Verification failed for ${profileId}: ${verification.error}`);
      assert.strictEqual(verification.width, 1080);
      assert.strictEqual(verification.height, 1920);
      assert.strictEqual(verification.pixelFormat, 'yuv420p');

      const stat = fs.statSync(clipPath);
      benchmarkResults.push({
        profile: profileId,
        renderTimeMs: durationMs,
        fileSizeBytes: stat.size,
        codec: verification.videoCodec,
        resolution: `${verification.width}x${verification.height}`,
      });
    }

    // Verify all 4 benchmarks produced valid output
    assert.strictEqual(benchmarkResults.length, 4);

    // High and Max quality presets have higher bitrates and should generate larger or equal file sizes for the same content
    const fastResult = benchmarkResults.find(r => r.profile === 'fast');
    const maxResult = benchmarkResults.find(r => r.profile === 'max');
    assert.ok(fastResult.fileSizeBytes > 0);
    assert.ok(maxResult.fileSizeBytes > 0);
    assert.ok(maxResult.fileSizeBytes >= fastResult.fileSizeBytes,
      `Max quality (${maxResult.fileSizeBytes} B) should have higher or equal bitrate than Fast (${fastResult.fileSizeBytes} B)`);
  });
});
