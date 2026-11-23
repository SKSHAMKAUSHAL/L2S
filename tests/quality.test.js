import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  SOURCE_QUALITY_PROFILES,
  EXPORT_PROFILES,
  getSourceQualityFormat,
  getExportProfile,
  analyzeSourceFormats,
  validateSourceResolution,
} from '../src/video/quality_profiles.js';

describe('Video Quality & Export Profiles', () => {
  test('defines complete set of source quality formats', () => {
    const expected = ['best', '4k', '1440p', '1080p', '720p', '480p', '360p', 'audio'];
    for (const key of expected) {
      assert.ok(SOURCE_QUALITY_PROFILES[key], `Source quality '${key}' must exist`);
      assert.ok(SOURCE_QUALITY_PROFILES[key].format, `Source quality '${key}' must specify format string`);
      assert.ok(typeof SOURCE_QUALITY_PROFILES[key].maxHeight === 'number', `Source quality '${key}' must specify maxHeight`);
    }
  });

  test('defines complete set of export encoding profiles', () => {
    const expected = ['fast', 'balanced', 'high', 'max'];
    for (const key of expected) {
      const p = EXPORT_PROFILES[key];
      assert.ok(p, `Export profile '${key}' must exist`);
      assert.ok(p.nvencPreset && p.cpuPreset);
      assert.ok(p.audioBitrate);
      assert.strictEqual(p.pixelFormat, 'yuv420p', 'Must enforce yuv420p for universal playback');
      assert.ok(p.videoBitrate, 'Must specify target video bitrate');
      assert.ok(p.maxrate, 'Must specify max rate control cap');
      assert.ok(p.bufsize, 'Must specify buffer size');
    }
  });

  test('getSourceQualityFormat falls back to 1080p for unknown profile', () => {
    const format = getSourceQualityFormat('unknown_format');
    assert.strictEqual(format, SOURCE_QUALITY_PROFILES['1080p'].format);
  });

  test('getExportProfile falls back to balanced for unknown profile', () => {
    const p = getExportProfile('unknown_export');
    assert.strictEqual(p.id, 'balanced');
  });

  test('analyzeSourceFormats correctly detects max resolution and flags missing 4K', () => {
    const sampleFormats = [
      { format_id: '137', vcodec: 'avc1.640028', height: 1080, fps: 30 },
      { format_id: '136', vcodec: 'avc1.4d401f', height: 720, fps: 30 },
      { format_id: '140', acodec: 'mp4a.40.2', vcodec: 'none' },
    ];

    const analysis = analyzeSourceFormats(sampleFormats);
    assert.strictEqual(analysis.maxHeight, 1080);
    assert.strictEqual(analysis.maxResolution, '1080p Full HD');
    assert.strictEqual(analysis.is4kAvailable, false);
    assert.ok(analysis.availableResolutions.includes('1080p'));
    assert.ok(analysis.availableResolutions.includes('720p'));
    assert.strictEqual(analysis.availableResolutions.includes('4k'), false);
  });

  test('validateSourceResolution prevents false 4K claims and falls back to native source', () => {
    const metadata = { maxHeight: 1080, maxResolution: '1080p Full HD', is4kAvailable: false };

    // Requesting 4K on 1080p video should adjust down to native 1080p without artificial upscaling
    const check4k = validateSourceResolution('4k', metadata);
    assert.strictEqual(check4k.wasAdjusted, true);
    assert.strictEqual(check4k.effectiveQuality, '1080p');
    assert.ok(check4k.reason.includes('without artificial upscaling'));

    // Requesting 1080p on 1080p video should pass through as native
    const check1080 = validateSourceResolution('1080p', metadata);
    assert.strictEqual(check1080.wasAdjusted, false);
    assert.strictEqual(check1080.effectiveQuality, '1080p');
  });
});
