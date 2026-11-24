// =============================================
// SKATE — OAuth 2.0 Authentication Manager
// Multi-user, per-user encrypted tokens in SQLite
// =============================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { encryptToken, decryptToken } from './security/crypto.js';
import { generatePKCE, createSessionOAuthState, consumeOAuthState } from './security/pkce.js';

// ─── Ensure .env is loaded in development ────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

try {
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val && !process.env[key]) process.env[key] = val;
        }
      }
    }
  }
} catch (e) { /* ignore */ }

// ─── Google / YouTube OAuth Endpoints ─────────
export function getGoogleEndpoints() {
  return {
    authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    userinfoUrl: process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v2/userinfo',
    revokeUrl: process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  };
}

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'openid',
  'email',
  'profile',
].join(' ');

/**
 * Retrieve decrypted YouTube token payload for a specific user from SQLite
 * @param {string} userId 
 * @param {Object} repo 
 * @returns {Object|null}
 */
export function getStoredYouTubeToken(userId, repo) {
  if (!userId || !repo) return null;
  const row = repo.getOAuthToken(userId, 'youtube');
  if (!row || !row.enc_blob) return null;
  try {
    const decrypted = decryptToken(row.enc_blob);
    return JSON.parse(decrypted);
  } catch (err) {
    console.error(`[auth] Failed to decrypt YouTube token for user ${userId}:`, err.message);
    return null;
  }
}

/**
 * Save encrypted YouTube token payload for a user into SQLite
 * @param {string} userId 
 * @param {Object} tokenData 
 * @param {Object} repo 
 */
export function saveStoredYouTubeToken(userId, tokenData, repo) {
  if (!userId || !repo) return;
  const encBlob = encryptToken(JSON.stringify(tokenData));
  repo.saveOAuthToken({
    userId,
    provider: 'youtube',
    encBlob,
  });
}

/**
 * Generate YouTube OAuth authorization URL with PKCE and session-bound state
 * @param {Object} params
 * @param {string} params.userId
 * @param {Object} params.repo
 * @param {string} [params.redirectUri]
 * @returns {{ authUrl: string, state: string, codeChallenge: string }}
 */
export function getYouTubeAuthUrl({ userId, repo, redirectUri }) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    throw new Error('YOUTUBE_CLIENT_ID not configured in environment');
  }

  const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePKCE();
  const state = createSessionOAuthState(userId, codeVerifier);

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const effectiveRedirectUri = redirectUri || `${baseUrl}/api/auth/callback/youtube`;

  // Check if user already has a refresh token stored
  const existingToken = repo ? getStoredYouTubeToken(userId, repo) : null;
  const hasRefreshToken = Boolean(existingToken?.refreshToken && !existingToken?.needsReconnect);

  const { authUrl } = getGoogleEndpoints();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: effectiveRedirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  });

  // prompt=consent and access_type=offline only when no refresh token is stored
  if (!hasRefreshToken) {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  return {
    authUrl: `${authUrl}?${params.toString()}`,
    state,
    codeChallenge,
  };
}

/**
 * Exchange YouTube authorization code for tokens, fetch userinfo, and save encrypted in DB
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.codeVerifier
 * @param {string} params.redirectUri
 * @param {string} params.userId
 * @param {Object} params.repo
 */
export async function exchangeYouTubeCode({ code, codeVerifier, redirectUri, userId, repo }) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials not configured in environment');
  }

  const { tokenUrl, userinfoUrl } = getGoogleEndpoints();

  const bodyParams = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  if (codeVerifier) {
    bodyParams.set('code_verifier', codeVerifier);
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube token exchange failed: ${err}`);
  }

  const data = await res.json();
  const accessToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  // Preserve existing refresh token if Google didn't issue a new one
  const existing = repo ? getStoredYouTubeToken(userId, repo) : null;
  const refreshToken = data.refresh_token || existing?.refreshToken || null;

  // Fetch connected Google account profile name from userinfo
  let username = 'YouTube User';
  let email = null;
  try {
    const profileRes = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      username = profile.name || profile.email || 'YouTube User';
      email = profile.email || null;
    }
  } catch (e) {
    // Keep default username
  }

  const tokenPayload = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.scope || YOUTUBE_SCOPES,
    tokenType: data.token_type || 'Bearer',
    username,
    email,
    needsReconnect: false,
    connectedAt: Date.now(),
  };

  saveStoredYouTubeToken(userId, tokenPayload, repo);

  return {
    connected: true,
    username,
    email,
    expiresAt: tokenPayload.expiresAt,
    needsReconnect: false,
  };
}

/**
 * Refresh YouTube access token for a user
 * @param {string} userId 
 * @param {Object} repo 
 * @returns {Promise<string>} New access token
 */
export async function refreshYouTubeToken(userId, repo) {
  const tokenData = getStoredYouTubeToken(userId, repo);
  if (!tokenData || !tokenData.refreshToken) {
    throw new Error('No YouTube refresh token available for user');
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials missing in environment');
  }

  const { tokenUrl } = getGoogleEndpoints();

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // If token is revoked or expired, mark needs_reconnect in DB
    if (err.includes('invalid_grant') || res.status === 400 || res.status === 401) {
      tokenData.needsReconnect = true;
      saveStoredYouTubeToken(userId, tokenData, repo);
      const reconnectErr = new Error('YouTube token was revoked or expired. Please reconnect.');
      reconnectErr.code = 'INVALID_GRANT';
      reconnectErr.needsReconnect = true;
      throw reconnectErr;
    }
    throw new Error(`YouTube token refresh failed: ${err}`);
  }

  const data = await res.json();
  tokenData.accessToken = data.access_token;
  tokenData.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  if (data.refresh_token) {
    tokenData.refreshToken = data.refresh_token;
  }
  tokenData.needsReconnect = false;
  saveStoredYouTubeToken(userId, tokenData, repo);

  return tokenData.accessToken;
}

/**
 * Get a valid YouTube access token for user, refreshing if expiring within 5 min
 * @param {string} userId 
 * @param {Object} repo 
 * @returns {Promise<string|null>}
 */
export async function getValidYouTubeToken(userId, repo) {
  const tokenData = getStoredYouTubeToken(userId, repo);
  if (!tokenData) return null;
  if (tokenData.needsReconnect) return null;

  // Refresh if missing access token or expiring within 5 minutes
  const isExpiring = !tokenData.accessToken || (tokenData.expiresAt && Date.now() > tokenData.expiresAt - 300000);
  if (isExpiring) {
    if (!tokenData.refreshToken) return null;
    try {
      return await refreshYouTubeToken(userId, repo);
    } catch (err) {
      console.warn(`[auth] Auto-refresh YouTube token failed for user ${userId}:`, err.message);
      return null;
    }
  }

  return tokenData.accessToken;
}

/**
 * Disconnect YouTube for a user: revokes token with Google, then deletes row from DB
 * @param {string} userId 
 * @param {Object} repo 
 */
export async function disconnectYouTube(userId, repo) {
  const tokenData = getStoredYouTubeToken(userId, repo);
  if (tokenData) {
    const tokenToRevoke = tokenData.accessToken || tokenData.refreshToken;
    if (tokenToRevoke) {
      const { revokeUrl } = getGoogleEndpoints();
      try {
        await fetch(`${revokeUrl}?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (err) {
        console.warn(`[auth] Google token revocation network call failed:`, err.message);
      }
    }
    repo.deleteOAuthToken(userId, 'youtube');
  }
  return { success: true };
}

// ─── Instagram (Meta) OAuth 2.0 (Gated behind FEATURE_INSTAGRAM) ──────────

const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const META_LONG_LIVED_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';

const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

export function isInstagramEnabled() {
  return process.env.FEATURE_INSTAGRAM === 'true';
}

export function getInstagramAuthUrl(redirectUri) {
  if (!isInstagramEnabled()) return null;
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) return null;

  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: INSTAGRAM_SCOPES,
    response_type: 'code',
    state,
  });

  return `${META_AUTH_URL}?${params.toString()}`;
}

export async function exchangeInstagramCode(code, redirectUri, userId, repo) {
  if (!isInstagramEnabled()) {
    throw new Error('Instagram feature is currently disabled');
  }

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  const tokenUrl = `${META_TOKEN_URL}?${new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })}`;

  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Instagram token exchange failed: ${err}`);
  }

  const tokenData = await tokenRes.json();
  let accessToken = tokenData.access_token;
  let expiresIn = tokenData.expires_in || 3600;

  try {
    const longLivedUrl = `${META_LONG_LIVED_URL}?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: accessToken,
    })}`;

    const llRes = await fetch(longLivedUrl);
    if (llRes.ok) {
      const llData = await llRes.json();
      accessToken = llData.access_token;
      expiresIn = llData.expires_in || 5184000;
    }
  } catch (e) {
    console.warn('Could not get long-lived Instagram token:', e.message);
  }

  let igUserId = null;
  let username = 'Instagram User';
  try {
    const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`);
    if (pagesRes.ok) {
      const pagesData = await pagesRes.json();
      if (pagesData.data && pagesData.data.length > 0) {
        const pageId = pagesData.data[0].id;
        const pageToken = pagesData.data[0].access_token;

        const igRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
        if (igRes.ok) {
          const igData = await igRes.json();
          igUserId = igData.instagram_business_account?.id;
        }

        if (igUserId) {
          const userRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${accessToken}`);
          if (userRes.ok) {
            const userData = await userRes.json();
            username = userData.username ? `@${userData.username}` : 'Instagram User';
          }
        }
      }
    }
  } catch (e) {
    console.warn('Could not fetch IG account info:', e.message);
  }

  const payload = {
    accessToken,
    igUserId,
    expiresAt: Date.now() + expiresIn * 1000,
    username,
    connectedAt: Date.now(),
  };

  if (userId && repo) {
    const encBlob = encryptToken(JSON.stringify(payload));
    repo.saveOAuthToken({
      userId,
      provider: 'instagram',
      encBlob,
    });
  }

  return payload;
}

// ─── Connection Status ────────────────────────

/**
 * Get connection status for a user
 * Never returns access or refresh tokens to callers.
 * @param {string} userId 
 * @param {Object} repo 
 */
export function getConnectionStatus(userId, repo) {
  const yt = userId && repo ? getStoredYouTubeToken(userId, repo) : null;
  const ytConnected = Boolean(yt && !yt.needsReconnect && (yt.refreshToken || (yt.expiresAt && Date.now() < yt.expiresAt)));

  let igStatus = {
    enabled: isInstagramEnabled(),
    connected: false,
    username: null,
    expiresAt: null,
  };

  if (isInstagramEnabled() && userId && repo) {
    const row = repo.getOAuthToken(userId, 'instagram');
    if (row && row.enc_blob) {
      try {
        const ig = JSON.parse(decryptToken(row.enc_blob));
        const igConnected = Boolean(ig?.accessToken && ig?.igUserId && Date.now() < ig.expiresAt);
        igStatus = {
          enabled: true,
          connected: igConnected,
          username: ig.username || null,
          expiresAt: ig.expiresAt || null,
        };
      } catch {}
    }
  }

  return {
    youtube: {
      connected: ytConnected,
      username: yt?.username || null,
      email: yt?.email || null,
      expiresAt: yt?.expiresAt || null,
      needsReconnect: Boolean(yt?.needsReconnect),
      connectedAt: yt?.connectedAt || null,
    },
    instagram: igStatus,
  };
}

/**
 * Check if OAuth credentials are configured in environment
 */
export function getCredentialStatus() {
  return {
    youtube: {
      configured: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    },
    instagram: {
      configured: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
      enabled: isInstagramEnabled(),
    },
  };
}
