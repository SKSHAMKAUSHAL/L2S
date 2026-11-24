import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../../src/server.js';
import { initDb, createDbRepository } from '../../src/db/index.js';
import { generateTokens } from '../../src/auth/index.js';

describe('Step 8: HTTP Security Headers, CORS & WebSocket Security (headers.test.js)', () => {
  let server;
  let baseUrl;
  let wsUrl;
  let testDb;
  let testRepo;
  let authCookie;

  before(async () => {
    process.env.APP_ORIGIN = 'https://app.example.com';
    testDb = initDb(':memory:');
    testRepo = createDbRepository(testDb);

    const user = testRepo.createUser({
      email: 'headers_test@example.com',
      passwordHash: 'dummyhash1234567890',
    });
    const { sessionToken, csrfToken } = generateTokens();
    testRepo.createSession({
      userId: user.id,
      rawToken: sessionToken,
      csrfToken,
      expiresAt: new Date(Date.now() + 86400000),
    });
    authCookie = `l2s_session=${sessionToken}`;

    const app = createApp({ repo: testRepo });
    server = http.createServer(app);

    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      const allowedOrigin = process.env.APP_ORIGIN;
      if (origin && allowedOrigin && allowedOrigin !== '*' && origin !== allowedOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close();
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  after(() => {
    delete process.env.APP_ORIGIN;
    if (server) server.close();
    if (testDb) testDb.close();
  });

  it('verifies helmet headers and content security policy are strictly configured', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);

    const nosniff = res.headers.get('x-content-type-options');
    assert.equal(nosniff, 'nosniff');

    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header must be present');
    assert.ok(csp.includes("default-src 'self'"), 'CSP must include default-src self');
    // Confirm script-src does not allow unsafe-inline
    const scriptSrcDirectives = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    assert.ok(scriptSrcDirectives, 'script-src directive must exist');
    assert.equal(scriptSrcDirectives.includes("'unsafe-inline'"), false, 'script-src must NOT allow unsafe-inline');
  });

  it('denies CORS requests originating from an unauthorized third-party origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://attacker.evil.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.equal(res.status, 403, 'CORS preflight from unknown origin must be denied with 403');
  });

  it('allows CORS requests originating from authorized APP_ORIGIN', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://app.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
  });

  it('rejects WebSocket upgrades originating from an unknown origin', async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Origin': 'https://attacker.evil.com',
          'Cookie': authCookie,
        },
      });

      ws.on('open', () => {
        assert.fail('WebSocket from untrusted origin should not succeed');
      });

      ws.on('error', () => {
        resolve(); // Expected handshake rejection
      });

      ws.on('close', () => {
        resolve();
      });
    });
  });
});
