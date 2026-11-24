import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeClipReframe, computeSmoothCropPath } from '../src/reframe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('Step 6: Reframe Fallback & Error Handling', () => {
  it('1. analyzeClipReframe falls back to center crop on missing or invalid video path', async () => {
    let warningLogged = false;
    const result = await analyzeClipReframe('non_existent_fake_video.mp4', 0, 5, {
      noCache: true,
      onLog: (msg) => {
        if (msg.includes('Reframe analysis fallback triggered')) warningLogged = true;
      }
    });

    assert.ok(result, 'Expected result object even on error');
    assert.strictEqual(result.width, 1920);
    assert.strictEqual(result.height, 1080);
    assert.ok(result.smooth_path && result.smooth_path.length > 0);
    // Center crop coordinates: for 1920x1080 with 9:16 target (608 wide), center X is 656
    assert.strictEqual(result.smooth_path[0].cropX, 656);
    assert.strictEqual(result.smooth_path[0].cropY, 0);
    assert.ok(warningLogged, 'Expected fallback warning to be logged');
  });

  it('2. computeSmoothCropPath with empty samples returns default center crop', () => {
    const path = computeSmoothCropPath({
      width: 1920,
      height: 1080,
      scene_cuts: [],
      path: []
    });

    assert.strictEqual(path.length, 1);
    assert.strictEqual(path[0].cropX, 656);
    assert.strictEqual(path[0].cropY, 0);
    assert.strictEqual(path[0].cropW, 608);
    assert.strictEqual(path[0].cropH, 1080);
  });
});
