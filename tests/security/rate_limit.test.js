import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/server.js';
import { initDb, createDbRepository } from '../../src/db/index.js';

describe('Step 8: Rate Limiting Enforcement (rate_limit.test.js)', () => {
  let server;
  let baseUrl;
  let testDb;
  let testRepo;

  before(async () => {
    testDb = initDb(':memory:');
    testRepo = createDbRepository(testDb);

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

  it('enforces login rate limit: 11th login attempt returns 429 Too Many Requests', async () => {
    let lastStatus = 0;

    for (let i = 1; i <= 11; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test_${i}@example.com`, password: 'WrongPassword123' }),
      });
      lastStatus = res.status;
      if (i <= 10) {
        assert.equal(res.status, 401, `Attempt ${i} should return 401`);
      }
    }

    assert.equal(lastStatus, 429, '11th login attempt must return 429 Too Many Requests');
  });
});
