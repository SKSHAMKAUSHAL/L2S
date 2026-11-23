import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputBase = path.resolve(rootDir, 'output');
const testJobId = 'test_job_rerender_e2e';
const testJobDir = path.resolve(outputBase, testJobId);
const clipsDir = path.join(testJobDir, 'clips');

function fileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test('Clip Re-render API and Concurrency Guard (Step 4)', async (t) => {
  // Check if ffmpeg exists
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    t.skip('ffmpeg not installed or not in PATH');
    return;
  }

  fs.mkdirSync(clipsDir, { recursive: true });

  const clipPath = path.join(clipsDir, 'clip-01.mp4');
  const captionsPath = path.join(testJobDir, 'clip_1.captions.json');

  // Generate a valid 5-second test video (1080x1920)
  execFileSync('ffmpeg', [
    '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=5',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '5',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-y',
    clipPath,
  ], { stdio: 'ignore' });

  const originalHash = fileHash(clipPath);

  // Write initial caption file
  fs.writeFileSync(
    captionsPath,
    JSON.stringify({
      words: [
        { word: 'Re-render', start: 0.5, end: 1.5 },
        { word: 'Test', start: 1.5, end: 3.0 },
      ],
      preset: 'hormozi',
      overrides: { fontSize: 80, position: 400 },
      language: 'en',
      version: 1,
    }, null, 2),
    'utf8'
  );

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    try {
      fs.rmSync(testJobDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('POST /api/clips/:jobId/:clipIndex/rerender burns new captions and updates file', async () => {
    const res = await fetch(`${baseUrl}/api/clips/${testJobId}/1/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.fileUrl.includes('clip-01.mp4'));

    assert.ok(fs.existsSync(clipPath));
    const newHash = fileHash(clipPath);
    // Burned subtitle frames must differ from raw black frames
    assert.notEqual(newHash, originalHash);

    // Verify duration with ffprobe
    const probeOutput = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      clipPath,
    ], { encoding: 'utf8' }).trim();

    const duration = parseFloat(probeOutput);
    assert.ok(Math.abs(duration - 5.0) < 0.5, `Expected duration close to 5.0s, got ${duration}`);
  });

  await t.test('Concurrent rerender returns 409', async () => {
    // Fire two requests concurrently
    const [req1, req2] = await Promise.all([
      fetch(`${baseUrl}/api/clips/${testJobId}/1/rerender`, { method: 'POST' }),
      fetch(`${baseUrl}/api/clips/${testJobId}/1/rerender`, { method: 'POST' }),
    ]);

    const statuses = [req1.status, req2.status];
    // One must succeed (200) and the other must be rejected with 409 Conflict
    assert.ok(
      statuses.includes(409),
      `Expected at least one request to return 409 Conflict, got [${statuses.join(', ')}]`
    );
  });
});
