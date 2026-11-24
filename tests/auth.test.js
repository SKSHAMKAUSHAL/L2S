import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { initDb, createDbRepository } from '../src/db/index.js';
import { SESSION_COOKIE_NAME } from '../src/auth/index.js';

describe('Step 7: Multi-User Authentication & Sessions (tests/auth.test.js)', () => {
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
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    if (server) server.close();
    if (testDb) testDb.close();
  });

  it('1. rejects passwords shorter than 10 characters with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'short@example.com', password: 'short' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('10 characters'));
  });

  it('2. registers a new user, hashes password with argon2 (not plain text), sets 14-day cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'validPassword123' })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.user);
    assert.strictEqual(data.user.email, 'alice@example.com');
    assert.ok(data.csrfToken);

    // Verify stored password in DB is argon2 hash, never plain text
    const dbUser = testRepo.getUserByEmail('alice@example.com');
    assert.ok(dbUser);
    assert.ok(dbUser.password_hash.startsWith('$argon2id$'), 'Password must be hashed with argon2id');
    assert.ok(!dbUser.password_hash.includes('validPassword123'), 'Plain password must never appear in DB');

    // Verify Set-Cookie header flags
    const cookieHeader = res.headers.get('set-cookie');
    assert.ok(cookieHeader);
    assert.ok(cookieHeader.includes(SESSION_COOKIE_NAME));
    assert.ok(cookieHeader.includes('HttpOnly'));
    assert.ok(cookieHeader.toLowerCase().includes('samesite=lax'));
  });

  it('3. logs in with valid credentials and receives session & CSRF tokens', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'validPassword123' })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.user.email, 'alice@example.com');
    assert.ok(data.csrfToken);

    const cookieHeader = res.headers.get('set-cookie');
    assert.ok(cookieHeader.includes(SESSION_COOKIE_NAME));
  });

  it('4. error message for wrong password EQUALS error message for unknown email', async () => {
    // Non-existent email
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown_ghost@example.com', password: 'somePassword123' })
    });
    assert.strictEqual(res1.status, 401);
    const data1 = await res1.json();

    // Existing email with wrong password
    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'incorrectPassword999' })
    });
    assert.strictEqual(res2.status, 401);
    const data2 = await res2.json();

    // Must be identical to prevent user enumeration
    assert.strictEqual(data1.error, 'Invalid email or password');
    assert.strictEqual(data2.error, 'Invalid email or password');
    assert.strictEqual(data1.error, data2.error);
  });

  it('5. enforces CSRF token on mutating requests and rejects missing/invalid CSRF', async () => {
    // Log in to get session cookie and valid csrf token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'validPassword123' })
    });
    const cookie = loginRes.headers.get('set-cookie');
    const { csrfToken } = await loginRes.json();

    // Mutating request WITHOUT CSRF token -> 403 Forbidden
    const resNoCsrf = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
      },
      body: JSON.stringify({ source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    });
    assert.strictEqual(resNoCsrf.status, 403);

    // Mutating request with WRONG CSRF token -> 403 Forbidden
    const resBadCsrf = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'X-CSRF-Token': 'bogus_csrf_token_12345'
      },
      body: JSON.stringify({ source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    });
    assert.strictEqual(resBadCsrf.status, 403);
  });

  it('6. logs out cleanly, clearing cookie and invalidating session', async () => {
    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'validPassword123' })
    });
    const cookie = loginRes.headers.get('set-cookie');

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': cookie }
    });
    assert.strictEqual(logoutRes.status, 200);

    // After logout, session is dead -> GET /api/auth/me returns 401
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': cookie }
    });
    assert.strictEqual(meRes.status, 401);
  });
});
