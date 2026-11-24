import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { initDb, createDbRepository } from '../src/db/index.js';
import {
  saveStoredYouTubeToken,
  getStoredYouTubeToken,
  getValidYouTubeToken,
  refreshYouTubeToken,
  getConnectionStatus,
} from '../src/auth.js';
import { createFakeGoogleServer } from './helpers/fake_google_server.js';

describe('YouTube Token Auto-Refresh & Reconnect Handling (tests/youtube.refresh.test.js)', () => {
  let fakeGoogle;
  let googleUrls;
  let db;
  let repo;
  let user;

  before(async () => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.YOUTUBE_CLIENT_SECRET = 'GOCSPX-secret';
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString('base64');

    fakeGoogle = createFakeGoogleServer();
    googleUrls = await fakeGoogle.start();

    process.env.GOOGLE_AUTH_URL = googleUrls.authUrl;
    process.env.GOOGLE_TOKEN_URL = googleUrls.tokenUrl;
    process.env.GOOGLE_USERINFO_URL = googleUrls.userinfoUrl;
    process.env.GOOGLE_REVOKE_URL = googleUrls.revokeUrl;
    process.env.GOOGLE_UPLOAD_URL = googleUrls.uploadUrl;

    db = initDb(':memory:');
    repo = createDbRepository(db);

    user = repo.createUser({ email: 'refresh-test@example.com', passwordHash: 'hash-pwd-1234567890' });
  });

  after(async () => {
    if (fakeGoogle) await fakeGoogle.stop();
  });

  it('1. Expired access token refreshes automatically when getValidYouTubeToken is called', async () => {
    // Seed an expired token in DB
    const expiredPayload = {
      accessToken: 'old_expired_token_123',
      refreshToken: 'valid_refresh_token_xyz',
      expiresAt: Date.now() - 600000, // expired 10 minutes ago
      scope: 'https://www.googleapis.com/auth/youtube.upload openid email profile',
      username: 'Test Creator',
      needsReconnect: false,
    };
    saveStoredYouTubeToken(user.id, expiredPayload, repo);

    // Call getValidYouTubeToken
    const freshToken = await getValidYouTubeToken(user.id, repo);
    assert.ok(freshToken, 'Must return a fresh access token');
    assert.ok(freshToken.startsWith('fake_refreshed_access_token_'), 'Token must be the refreshed token from Google');

    // Verify DB record was updated with new token and future expiration
    const updated = getStoredYouTubeToken(user.id, repo);
    assert.strictEqual(updated.accessToken, freshToken);
    assert.ok(updated.expiresAt > Date.now() + 3000000, 'Expiration must be in the future (~1 hour)');
    assert.strictEqual(updated.needsReconnect, false);
  });

  it('2. invalid_grant error from Google marks connection as needsReconnect: true', async () => {
    // Configure fake Google to return invalid_grant on refresh
    fakeGoogle.setTokenRefreshHandler((params, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }));
    });

    // Seed expired token
    const revokedPayload = {
      accessToken: 'old_token_revoked',
      refreshToken: 'revoked_refresh_token',
      expiresAt: Date.now() - 5000,
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      username: 'Revoked Creator',
      needsReconnect: false,
    };
    saveStoredYouTubeToken(user.id, revokedPayload, repo);

    // Calling refresh directly throws reconnect error
    await assert.rejects(
      async () => {
        await refreshYouTubeToken(user.id, repo);
      },
      (err) => {
        assert.ok(err.needsReconnect || err.message.includes('reconnect'), 'Error must specify reconnect');
        return true;
      }
    );

    // Verify DB row is updated with needsReconnect: true
    const updated = getStoredYouTubeToken(user.id, repo);
    assert.strictEqual(updated.needsReconnect, true);

    // Verify getConnectionStatus reports connected: false, needsReconnect: true
    const status = getConnectionStatus(user.id, repo);
    assert.strictEqual(status.youtube.connected, false);
    assert.strictEqual(status.youtube.needsReconnect, true);

    // Verify getValidYouTubeToken returns null when needsReconnect is true
    const token = await getValidYouTubeToken(user.id, repo);
    assert.strictEqual(token, null);
  });
});
