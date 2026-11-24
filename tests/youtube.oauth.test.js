import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { initDb, createDbRepository } from '../src/db/index.js';
import { getYouTubeAuthUrl, exchangeYouTubeCode, getConnectionStatus } from '../src/auth.js';
import { createFakeGoogleServer } from './helpers/fake_google_server.js';
import { generateTokens, SESSION_COOKIE_NAME } from '../src/auth/index.js';

describe('YouTube OAuth & Token Isolation (tests/youtube.oauth.test.js)', () => {
  let fakeGoogle;
  let googleUrls;
  let repo;
  let db;
  let app;
  let server;
  let baseUrl;

  let userA, sessionA, cookieA;
  let userB, sessionB, cookieB;

  before(async () => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id-123.apps.googleusercontent.com';
    process.env.YOUTUBE_CLIENT_SECRET = 'GOCSPX-test-client-secret-xyz';
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

    fakeGoogle = createFakeGoogleServer();
    googleUrls = await fakeGoogle.start();

    process.env.GOOGLE_AUTH_URL = googleUrls.authUrl;
    process.env.GOOGLE_TOKEN_URL = googleUrls.tokenUrl;
    process.env.GOOGLE_USERINFO_URL = googleUrls.userinfoUrl;
    process.env.GOOGLE_REVOKE_URL = googleUrls.revokeUrl;
    process.env.GOOGLE_UPLOAD_URL = googleUrls.uploadUrl;

    db = initDb(':memory:');
    repo = createDbRepository(db);

    app = createApp({ repo });
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
    process.env.BASE_URL = baseUrl;

    userA = repo.createUser({ email: 'userA@test.com', passwordHash: 'hash-a-1234567890' });
    userB = repo.createUser({ email: 'userB@test.com', passwordHash: 'hash-b-1234567890' });

    const tokA = generateTokens();
    repo.createSession({ userId: userA.id, rawToken: tokA.sessionToken, csrfToken: tokA.csrfToken, expiresAt: tokA.expiresAt });
    sessionA = tokA;
    cookieA = `${SESSION_COOKIE_NAME}=${tokA.sessionToken}`;

    const tokB = generateTokens();
    repo.createSession({ userId: userB.id, rawToken: tokB.sessionToken, csrfToken: tokB.csrfToken, expiresAt: tokB.expiresAt });
    sessionB = tokB;
    cookieB = `${SESSION_COOKIE_NAME}=${tokB.sessionToken}`;
  });

  after(async () => {
    if (server) await new Promise(r => server.close(r));
    if (fakeGoogle) await fakeGoogle.stop();
  });

  it('1. Auth URL contains PKCE, session-bound state, and correct scopes (no youtube.readonly)', async () => {
    const res = await fetch(`${baseUrl}/api/connect/youtube`, {
      headers: { Cookie: cookieA },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.ok(data.authUrl, 'Must return authUrl');
    assert.ok(data.state, 'Must return state');
    assert.ok(data.codeChallenge, 'Must return codeChallenge');

    const url = new URL(data.authUrl);
    assert.strictEqual(url.searchParams.get('client_id'), process.env.YOUTUBE_CLIENT_ID);
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(url.searchParams.get('code_challenge'), data.codeChallenge);
    assert.strictEqual(url.searchParams.get('state'), data.state);

    const scopes = url.searchParams.get('scope');
    assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube.upload'), 'Must request youtube.upload');
    assert.ok(scopes.includes('openid'), 'Must request openid');
    assert.ok(scopes.includes('email'), 'Must request email');
    assert.ok(scopes.includes('profile'), 'Must request profile');
    assert.ok(!scopes.includes('youtube.readonly'), 'Must NOT request youtube.readonly');
  });

  it('2. OAuth callback with invalid, tampered or missing state is rejected with 400', async () => {
    // Missing state
    const res1 = await fetch(`${baseUrl}/api/auth/callback/youtube?code=fake_code`);
    assert.strictEqual(res1.status, 400);

    // Tampered state
    const res2 = await fetch(`${baseUrl}/api/auth/callback/youtube?code=fake_code&state=non_existent_fake_state_1234567890`);
    assert.strictEqual(res2.status, 400);
  });

  it('3. Successful OAuth exchange stores tokens encrypted at rest in SQLite', async () => {
    // Generate fresh auth URL to seed real session state
    const connectRes = await fetch(`${baseUrl}/api/connect/youtube`, {
      headers: { Cookie: cookieA },
    });
    const connectData = await connectRes.json();
    const validState = connectData.state;

    // Call callback with valid state
    const callbackRes = await fetch(`${baseUrl}/api/auth/callback/youtube?code=test_auth_code_user_a&state=${validState}`);
    assert.strictEqual(callbackRes.status, 200);

    // Inspect raw database row in oauth_tokens table
    const rawRow = db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?').get(userA.id, 'youtube');
    assert.ok(rawRow, 'Token row must exist in SQLite');
    assert.ok(rawRow.enc_blob, 'enc_blob must exist');

    // Assert raw DB value does NOT contain plaintext token strings
    assert.ok(!rawRow.enc_blob.includes('fake_access_token'), 'Database must not contain plaintext access token');
    assert.ok(!rawRow.enc_blob.includes('fake_refresh_token'), 'Database must not contain plaintext refresh token');

    // Verify enc_blob is valid encrypted JSON
    const parsedBlob = JSON.parse(rawRow.enc_blob);
    assert.strictEqual(parsedBlob.v, 1);
    assert.ok(parsedBlob.tag, 'Must have GCM auth tag');
    assert.ok(parsedBlob.nonce, 'Must have GCM nonce');
    assert.ok(parsedBlob.ciphertext, 'Must have ciphertext');
  });

  it('4. Two users maintain isolated tokens; User B cannot see User A tokens', async () => {
    // User A status
    const resA = await fetch(`${baseUrl}/api/connection-status`, {
      headers: { Cookie: cookieA },
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    assert.strictEqual(dataA.connections.youtube.connected, true);
    assert.strictEqual(dataA.connections.youtube.username, 'Test Creator Channel');

    // User B status (has never connected)
    const resB = await fetch(`${baseUrl}/api/connection-status`, {
      headers: { Cookie: cookieB },
    });
    assert.strictEqual(resB.status, 200);
    const dataB = await resB.json();
    assert.strictEqual(dataB.connections.youtube.connected, false);
    assert.strictEqual(dataB.connections.youtube.username, null);
  });

  it('5. The API never returns raw access_token or refresh_token in responses', async () => {
    // 1. connection-status
    const res1 = await fetch(`${baseUrl}/api/connection-status`, {
      headers: { Cookie: cookieA },
    });
    const text1 = await res1.text();
    assert.ok(!text1.includes('fake_access_token'), 'connection-status must not leak access_token');
    assert.ok(!text1.includes('fake_refresh_token'), 'connection-status must not leak refresh_token');

    // 2. /api/auth/me
    const res2 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookieA },
    });
    const text2 = await res2.text();
    assert.ok(!text2.includes('fake_access_token'), '/api/auth/me must not leak access_token');
    assert.ok(!text2.includes('fake_refresh_token'), '/api/auth/me must not leak refresh_token');
  });
});
