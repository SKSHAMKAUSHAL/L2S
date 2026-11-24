import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { initDb, createDbRepository } from '../src/db/index.js';
import { generateTokens } from '../src/auth/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Step 7: Per-User File Server & Range Streaming (tests/files.test.js)', () => {
  let server;
  let baseUrl;
  let testDb;
  let repo;
  let user;
  let authCookie;
  let testJob;
  let testFilePath;
  let testFileSize;
  const testJobId = 'job_files_test_' + Date.now();

  before(async () => {
    testDb = initDb(':memory:');
    repo = createDbRepository(testDb);
    const app = createApp({ repo });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    user = repo.createUser({ email: 'files_user@test.com', passwordHash: 'hash1234567890' });
    const tok = generateTokens();
    repo.createSession({ userId: user.id, rawToken: tok.sessionToken, csrfToken: tok.csrfToken, expiresAt: tok.expiresAt });
    authCookie = `l2s_session=${tok.sessionToken}`;

    testJob = repo.createJob({
      id: testJobId,
      userId: user.id,
      status: 'completed'
    });

    // Create physical storage file: storage/<userId>/<jobId>/clips/clip-01.mp4
    const userJobStorage = path.join(rootDir, 'storage', user.id, testJobId, 'clips');
    fs.mkdirSync(userJobStorage, { recursive: true });
    testFilePath = path.join(userJobStorage, 'clip-01.mp4');

    // Create 1000 bytes dummy content
    const dummyBuffer = Buffer.alloc(1000, 0x41); // 'A' repeated 1000 times
    fs.writeFileSync(testFilePath, dummyBuffer);
    testFileSize = 1000;
  });

  after(() => {
    if (server) server.close();
    if (testDb) testDb.close();
    // Clean storage directory
    const userDir = path.join(rootDir, 'storage', user.id);
    if (fs.existsSync(userDir)) {
      try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('1. serves full file with HTTP 200 and Accept-Ranges when no Range header is sent', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testJobId}/clips/clip-01.mp4`, {
      headers: { 'Cookie': authCookie }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(res.headers.get('content-length'), '1000');
    assert.strictEqual(res.headers.get('content-type'), 'video/mp4');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.length, 1000);
  });

  it('2. serves HTTP 206 Partial Content for byte range request with Content-Range header', async () => {
    // Request bytes 0 to 99 (first 100 bytes)
    const res = await fetch(`${baseUrl}/api/files/${testJobId}/clips/clip-01.mp4`, {
      headers: {
        'Cookie': authCookie,
        'Range': 'bytes=0-99'
      }
    });

    assert.strictEqual(res.status, 206, 'Must respond with 206 Partial Content');
    assert.strictEqual(res.headers.get('content-range'), 'bytes 0-99/1000');
    assert.strictEqual(res.headers.get('content-length'), '100');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.length, 100);
  });

  it('3. serves HTTP 206 for open-ended range request (bytes=500-)', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testJobId}/clips/clip-01.mp4`, {
      headers: {
        'Cookie': authCookie,
        'Range': 'bytes=500-'
      }
    });

    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('content-range'), 'bytes 500-999/1000');
    assert.strictEqual(res.headers.get('content-length'), '500');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.length, 500);
  });

  it('4. blocks path traversal attempts returning 400 or 404', async () => {
    const res1 = await fetch(`${baseUrl}/api/files/${testJobId}/../../package.json`, {
      headers: { 'Cookie': authCookie }
    });
    assert.ok(res1.status === 400 || res1.status === 404, `Expected 400/404 for traversal, got ${res1.status}`);

    const res2 = await fetch(`${baseUrl}/api/files/${testJobId}/%2e%2e%2f%2e%2e%2f.env`, {
      headers: { 'Cookie': authCookie }
    });
    assert.ok(res2.status === 400 || res2.status === 404, `Expected 400/404 for encoded traversal, got ${res2.status}`);
  });

  it('5. returns 404 for non-existent file or non-existent job', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testJobId}/clips/non_existent.mp4`, {
      headers: { 'Cookie': authCookie }
    });
    assert.strictEqual(res.status, 404);
  });
});
