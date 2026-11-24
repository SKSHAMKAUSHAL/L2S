import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.js';
import { initDb, createDbRepository } from '../src/db/index.js';
import { generateTokens, SESSION_COOKIE_NAME } from '../src/auth/index.js';

describe('Step 7: Authorization & Cross-Tenant Isolation (tests/authz.test.js)', () => {
  let server;
  let baseUrl;
  let wsUrl;
  let testDb;
  let testRepo;
  let app;

  let userA, sessionA, cookieA, csrfA;
  let userB, sessionB, cookieB, csrfB;
  let jobA;

  before(async () => {
    testDb = initDb(':memory:');
    testRepo = createDbRepository(testDb);
    app = createApp({ repo: testRepo });
    server = http.createServer(app);

    // WebSocket upgrade handler with auth
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const cookieHeader = req.headers.cookie || '';
      const cookies = {};
      cookieHeader.split(';').forEach((c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) cookies[k] = decodeURIComponent(v);
      });

      const token = cookies[SESSION_COOKIE_NAME];
      const session = token ? testRepo.getSession(token) : null;

      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = session.user_id;
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;

    // Create User A
    userA = testRepo.createUser({ email: 'userA@test.com', passwordHash: 'hashA_1234567890' });
    const tokA = generateTokens();
    testRepo.createSession({ userId: userA.id, rawToken: tokA.sessionToken, csrfToken: tokA.csrfToken, expiresAt: tokA.expiresAt });
    cookieA = `l2s_session=${tokA.sessionToken}`;
    csrfA = tokA.csrfToken;

    // Create User B
    userB = testRepo.createUser({ email: 'userB@test.com', passwordHash: 'hashB_1234567890' });
    const tokB = generateTokens();
    testRepo.createSession({ userId: userB.id, rawToken: tokB.sessionToken, csrfToken: tokB.csrfToken, expiresAt: tokB.expiresAt });
    cookieB = `l2s_session=${tokB.sessionToken}`;
    csrfB = tokB.csrfToken;

    // User A creates a job and a clip
    jobA = testRepo.createJob({
      id: 'job_user_a_100',
      userId: userA.id,
      status: 'completed',
      sourceType: 'local',
      sourceRef: 'sample.mp4'
    });

    testRepo.createClip({
      id: 'clip_user_a_1',
      jobId: jobA.id,
      userId: userA.id,
      idx: 1,
      start: 0,
      end: 10,
      score: 95,
      title: 'User A Clip',
      filePath: 'storage/' + userA.id + '/' + jobA.id + '/clips/clip-01.mp4'
    });
  });

  after(() => {
    if (server) server.close();
    if (testDb) testDb.close();
  });

  it('1. User B gets 404 (not 403) when requesting User A job, clip captions, file, or cancellation', async () => {
    // User B tries to view User A's job
    const resJob = await fetch(`${baseUrl}/api/jobs/${jobA.id}`, {
      headers: { 'Cookie': cookieB }
    });
    assert.strictEqual(resJob.status, 404, 'User B must get 404 for User A job');

    // User B tries to get User A's clip captions
    const resCaptions = await fetch(`${baseUrl}/api/clips/${jobA.id}/1/captions`, {
      headers: { 'Cookie': cookieB }
    });
    assert.strictEqual(resCaptions.status, 404, 'User B must get 404 for User A captions');

    // User B tries to access User A's file
    const resFile = await fetch(`${baseUrl}/api/files/${jobA.id}/clip-01.mp4`, {
      headers: { 'Cookie': cookieB }
    });
    assert.strictEqual(resFile.status, 404, 'User B must get 404 for User A files');

    // User B tries to cancel User A's job
    const resCancel = await fetch(`${baseUrl}/api/jobs/${jobA.id}/cancel`, {
      method: 'POST',
      headers: {
        'Cookie': cookieB,
        'X-CSRF-Token': csrfB
      }
    });
    assert.strictEqual(resCancel.status, 404, 'User B must get 404 when attempting to cancel User A job');
  });

  it('2. unauthenticated requests get 401 on every protected route in the router stack', async () => {
    // Extract real routes from Express router stack
    const publicAllowlist = new Set([
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/health',
      '/healthz',
      '/api/status/hardware'
    ]);

    const routesToCheck = [];
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const p = layer.route.path;
        if (typeof p === 'string' && p.startsWith('/api/') && !publicAllowlist.has(p)) {
          const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
          methods.forEach((method) => {
            routesToCheck.push({ path: p, method });
          });
        }
      }
    });

    assert.ok(routesToCheck.length >= 10, `Expected at least 10 protected API routes, found ${routesToCheck.length}`);

    // Verify each route returns 401 when called without auth
    for (const { path: routePath, method } of routesToCheck) {
      // Substitute placeholders if any
      const testPath = routePath
        .replace(':jobId', 'some_job_id')
        .replace(':clipIndex', '1')
        .replace(':platform', 'youtube')
        .replace(':id', 'some_id')
        .replace('*', 'test.mp4');

      const res = await fetch(`${baseUrl}${testPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify({}) : undefined
      });

      assert.strictEqual(
        res.status,
        401,
        `Expected 401 Unauthorized for unauthenticated ${method} ${routePath}, got ${res.status}`
      );
    }
  });

  it('3. WebSocket connection without session cookie is immediately rejected/closed', async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        assert.fail('WebSocket without auth cookie should not open successfully');
      });
      ws.on('error', () => {
        // Expected handshake rejection
        resolve();
      });
      ws.on('close', (code) => {
        // Expected closure
        resolve();
      });
    });
  });

  it('4. WebSocket connection with valid session cookie connects successfully', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { 'Cookie': cookieA }
      });
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  });
});
