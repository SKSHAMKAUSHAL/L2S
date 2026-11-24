import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderReframedClip } from '../src/reframe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'tests', 'output');

function isCommandAvailable(cmd) {
  try {
    const flag = cmd.startsWith('python') ? '--version' : '-version';
    const res = spawnSync(cmd, [flag], { windowsHide: true });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

function probeVideo(filePath) {
  const res = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', windowsHide: true });

  if (res.status !== 0) throw new Error(`ffprobe failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

describe('Step 6: Reframe Integration Test', () => {
  const hasFfmpeg = isCommandAvailable('ffmpeg');
  const hasFfprobe = isCommandAvailable('ffprobe');
  const hasPython = isCommandAvailable('python');

  if (!hasFfmpeg || !hasFfprobe || !hasPython) {
    it.skip('Skipped: ffmpeg, ffprobe, or python is not available', () => {});
    return;
  }

  it('renders a 9:16 reframed clip with 1080x1920 resolution and muxed audio', async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    let sampleVideo = path.join(ROOT_DIR, 'tests', 'fixtures', 'face_sample.mp4');
    let isSynthetic = false;

    if (!fs.existsSync(sampleVideo)) {
      // Create a 3-second 1920x1080 test video with audio
      sampleVideo = path.join(OUT_DIR, 'test_reframe_src.mp4');
      const genRes = spawnSync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', 'testsrc=duration=3:size=1920x1080:rate=30',
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=3',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        sampleVideo
      ], { windowsHide: true });

      assert.strictEqual(genRes.status, 0, 'Synthetic video generation failed');
      isSynthetic = true;
    }

    const testOutput = path.join(OUT_DIR, 'test_reframe_output.mp4');

    try {
      await renderReframedClip(sampleVideo, 0, 3, testOutput, {
        reframeMode: 'center',
        encoder: 'libx264',
        preset: 'ultrafast',
        crf: 23
      });

      assert.ok(fs.existsSync(testOutput), 'Output file does not exist');

      // Probe output with ffprobe
      const probe = probeVideo(testOutput);
      const videoStream = probe.streams?.find((s) => s.codec_type === 'video');
      const audioStream = probe.streams?.find((s) => s.codec_type === 'audio');
      const duration = Number(probe.format?.duration || 0);

      assert.ok(videoStream, 'Output has no video stream');
      assert.strictEqual(videoStream.width, 1080, 'Output width must be 1080');
      assert.strictEqual(videoStream.height, 1920, 'Output height must be 1920');

      assert.ok(audioStream, 'Output has no audio stream');
      assert.ok(Math.abs(duration - 3.0) <= 0.2, `Duration ${duration} does not match 3.0s (+-0.2s)`);
    } finally {
      if (fs.existsSync(testOutput)) {
        try { fs.unlinkSync(testOutput); } catch (e) {}
      }
      if (isSynthetic && fs.existsSync(sampleVideo)) {
        try { fs.unlinkSync(sampleVideo); } catch (e) {}
      }
    }
  });
});
