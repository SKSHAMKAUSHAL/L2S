import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputBase = path.resolve(rootDir, 'output');
const testJobId = 'test_job_api_captions';
const testJobDir = path.resolve(outputBase, testJobId);

test('Caption Editor API Endpoints (Step 4)', async (t) => {
  // Ensure clean test fixture directory
  fs.mkdirSync(testJobDir, { recursive: true });
  fs.mkdirSync(path.join(testJobDir, 'clips'), { recursive: true });

  const initialCaptions = {
    words: [
      { word: 'Hello', start: 0.0, end: 0.5 },
      { word: 'world', start: 0.5, end: 1.0 },
      { word: 'testing', start: 1.0, end: 1.8 },
    ],
    preset: 'hormozi',
    overrides: { fontSize: 52, position: 420 },
    language: 'en',
    version: 1,
  };

  fs.writeFileSync(
    path.join(testJobDir, 'clip_1.captions.json'),
    JSON.stringify(initialCaptions, null, 2),
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

  await t.test('GET /api/clips/:jobId/:clipIndex/captions returns saved captions', async () => {
    const res = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.version, 1);
    assert.equal(data.words.length, 3);
    assert.equal(data.words[0].word, 'Hello');
  });

  await t.test('GET non-existent clip captions returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/clips/${testJobId}/99/captions`);
    assert.equal(res.status, 404);
  });

  await t.test('Path traversal attempts are rejected with 400 or 404', async () => {
    // Attempt with URL encoded ../../.env
    const res1 = await fetch(`${baseUrl}/api/clips/..%2f..%2f.env/1/captions`);
    assert.ok(res1.status === 400 || res1.status === 404);

    const res2 = await fetch(`${baseUrl}/api/clips/${testJobId}/%2e%2e%2f1/captions`);
    assert.ok(res2.status === 400 || res2.status === 404);

    const res3 = await fetch(`${baseUrl}/api/clips/testJob/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: [] }),
    });
    // Valid regex but not traversal, test actual traversal on PUT:
    const res4 = await fetch(`${baseUrl}/api/clips/..%2f.env/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: [] }),
    });
    assert.ok(res4.status === 400 || res4.status === 404);
  });

  await t.test('PUT /api/clips/:jobId/:clipIndex/captions accepts valid edits', async () => {
    const updatedWords = [
      { word: 'Hi', start: 0.0, end: 0.4 },
      { word: 'there', start: 0.4, end: 0.9 },
      { word: 'everyone', start: 0.9, end: 1.8 },
    ];
    const res = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: updatedWords,
        preset: 'neon',
        overrides: { fontSize: 60, position: 400 },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.captions.preset, 'neon');
    assert.equal(data.captions.words.length, 3);
    assert.equal(data.captions.words[0].word, 'Hi');
    assert.equal(data.captions.version, 2);

    // Verify written to disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(testJobDir, 'clip_1.captions.json'), 'utf8'));
    assert.equal(onDisk.words[0].word, 'Hi');
    assert.equal(onDisk.preset, 'neon');
  });

  await t.test('PUT rejects invalid cases: wrong types, too long words, bad times', async () => {
    // 1. words not array
    const r1 = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: 'not-an-array' }),
    });
    assert.equal(r1.status, 400);

    // 2. Word over 40 chars
    const r2 = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [{ word: 'a'.repeat(45), start: 0, end: 1 }],
      }),
    });
    assert.equal(r2.status, 400);

    // 3. Invalid timestamps (start > end)
    const r3 = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [{ word: 'test', start: 2.0, end: 1.0 }],
      }),
    });
    assert.equal(r3.status, 400);

    // 4. Non-decreasing timestamps
    const r4 = await fetch(`${baseUrl}/api/clips/${testJobId}/1/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [
          { word: 'first', start: 2.0, end: 2.5 },
          { word: 'second', start: 1.0, end: 1.5 },
        ],
      }),
    });
    assert.equal(r4.status, 400);
  });

  await t.test('POST /api/clips/:jobId/captions/replace updates words across clips', async () => {
    // Create a clip_2.captions.json
    fs.writeFileSync(
      path.join(testJobDir, 'clip_2.captions.json'),
      JSON.stringify(
        {
          words: [
            { word: 'everyone', start: 0.1, end: 0.8 },
            { word: 'welcome', start: 0.8, end: 1.5 },
          ],
          preset: 'hormozi',
          version: 1,
        },
        null,
        2
      ),
      'utf8'
    );

    const res = await fetch(`${baseUrl}/api/clips/${testJobId}/captions/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ find: 'everyone', replace: 'folks', caseSensitive: false }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    // clip_1 had 'everyone', clip_2 had 'everyone' -> 2 changed
    assert.equal(data.changedWords, 2);

    const clip1 = JSON.parse(fs.readFileSync(path.join(testJobDir, 'clip_1.captions.json'), 'utf8'));
    assert.equal(clip1.words[2].word, 'folks');

    const clip2 = JSON.parse(fs.readFileSync(path.join(testJobDir, 'clip_2.captions.json'), 'utf8'));
    assert.equal(clip2.words[0].word, 'folks');
  });
});
