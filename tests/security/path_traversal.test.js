import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/server.js';
import { initDb, createDbRepository } from '../../src/db/index.js';
import { generateTokens } from '../../src/auth/index.js';

describe('Step 8: Path Traversal Defenses Across All Endpoints (path_traversal.test.js)', () => {
  let server;
  let baseUrl;
  let testDb;
  let testRepo;
  let authHeaders;

  before(async () => {
    testDb = initDb(':memory:');
    testRepo = createDbRepository(testDb);

    const user = testRepo.createUser({
      email: 'traversal_tester@example.com',
      passwordHash: 'dummyhash1234567890',
    });
    const { sessionToken, csrfToken } = generateTokens();
    testRepo.createSession({
      userId: user.id,
      rawToken: sessionToken,
      csrfToken,
      expiresAt: new Date(Date.now() + 86400000),
    });

    authHeaders = {
      'Cookie': `l2s_session=${sessionToken}`,
      'X-CSRF-Token': csrfToken,
    };

    const app = createApp({ repo: testRepo });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    if (server) server.close();
    if (testDb) testDb.close();
  });

  const traversalPayloads = [
    '..%2f..%2f.env',
    '..%5c..%5c.env',
    '../../etc/passwd',
    '....//....//.env',
    '%2e%2e%2f%2e%2e%2f.env',
  ];

  it('rejects path traversal attempts on /api/files/:jobId/*', async () => {
    for (const payload of traversalPayloads) {
      const res = await fetch(`${baseUrl}/api/files/test_job/${payload}`, {
        headers: authHeaders,
      });
      assert.ok(
        res.status === 400 || res.status === 404,
        `Expected 400 or 404 for payload ${payload}, got ${res.status}`
      );
    }
  });

  it('rejects path traversal attempts on /api/clips/:jobId/:clipIndex/captions (GET & PUT)', async () => {
    for (const payload of traversalPayloads) {
      const getRes = await fetch(`${baseUrl}/api/clips/${payload}/1/captions`, {
        headers: authHeaders,
      });
      assert.ok(
        getRes.status === 400 || getRes.status === 404,
        `Expected 400 or 404 on GET for ${payload}, got ${getRes.status}`
      );

      const putRes = await fetch(`${baseUrl}/api/clips/${payload}/1/captions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ words: [] }),
      });
      assert.ok(
        putRes.status === 400 || putRes.status === 404,
        `Expected 400 or 404 on PUT for ${payload}, got ${putRes.status}`
      );
    }
  });

  it('rejects path traversal attempts on /api/jobs/:id', async () => {
    for (const payload of traversalPayloads) {
      const res = await fetch(`${baseUrl}/api/jobs/${payload}`, {
        headers: authHeaders,
      });
      assert.equal(res.status, 404);
    }
  });
});
