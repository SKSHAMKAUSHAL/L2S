// =============================================
// SKATE — OAuth 2.0 Authentication Manager
// =============================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// ─── Ensure .env is loaded ───────────────────
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

// ─── Token Storage ────────────────────────────
const SKATE_DIR = path.join(os.homedir(), '.skate');
const TOKENS_FILE = path.join(SKATE_DIR, 'tokens.json');

// Simple encryption key derived from machine-specific data
const ENCRYPT_KEY = crypto
  .createHash('sha256')
  .update(`skate-local-${os.hostname()}-${os.userInfo().username}`)
  .digest();

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPT_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data) {
  const [ivHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPT_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
      const decrypted = decrypt(raw);
      return JSON.parse(decrypted);
    }
  } catch (e) {
    console.warn('⚠️  Could not load tokens, starting fresh:', e.message);
  }
  return {};
}

function saveTokens(tokens) {
  fs.mkdirSync(SKATE_DIR, { recursive: true });
  const encrypted = encrypt(JSON.stringify(tokens));
  fs.writeFileSync(TOKENS_FILE, encrypted, 'utf8');
}

// In-memory token cache
let tokenCache = loadTokens();

// ─── YouTube (Google) OAuth 2.0 ───────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

/**
 * Generate YouTube OAuth authorization URL
 */
export function getYouTubeAuthUrl(redirectUri) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return null;

  const state = crypto.randomBytes(16).toString('hex');
  tokenCache._yt_state = state;
  saveTokens(tokenCache);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange YouTube authorization code for tokens
 */
export async function exchangeYouTubeCode(code, redirectUri) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials not configured in .env');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube token exchange failed: ${err}`);
  }

  const data = await res.json();

  // Fetch YouTube channel name from YouTube Data API (preferred)
  let username = 'YouTube User';
  try {
    const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (channelRes.ok) {
      const chData = await channelRes.json();
      if (chData.items && chData.items.length > 0) {
        username = chData.items[0].snippet?.title || username;
      }
    }
  } catch (e) {
    // Fallback to Google profile
  }

  // Fallback: fetch from Google userinfo if YouTube API didn't return a name
  if (username === 'YouTube User') {
    try {
      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        username = profile.name || profile.email || 'YouTube User';
      }
    } catch (e) {
      // Keep default
    }
  }

  tokenCache.youtube = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokenCache.youtube?.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    username,
    connectedAt: Date.now(),
  };

  delete tokenCache._yt_state;
  saveTokens(tokenCache);
  return tokenCache.youtube;
}

/**
 * Refresh YouTube access token
 */
export async function refreshYouTubeToken() {
  const yt = tokenCache.youtube;
  if (!yt?.refreshToken) throw new Error('No YouTube refresh token');

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials missing in .env');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: yt.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // If token is revoked or expired, clear the stored tokens so UI prompts reconnect
    if (err.includes('invalid_grant') || res.status === 400 || res.status === 401) {
      delete tokenCache.youtube;
      saveTokens(tokenCache);
      throw new Error('YouTube token was revoked or expired. Please reconnect.');
    }
    throw new Error(`YouTube token refresh failed: ${err}`);
  }

  const data = await res.json();
  tokenCache.youtube.accessToken = data.access_token;
  tokenCache.youtube.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  saveTokens(tokenCache);
  return tokenCache.youtube;
}

/**
 * Get a valid YouTube access token, refreshing if needed
 */
export async function getYouTubeToken() {
  const yt = tokenCache.youtube;
  if (!yt?.accessToken && !yt?.refreshToken) return null;

  // Refresh if expiring within 5 minutes or if accessToken is missing
  if (!yt.accessToken || (yt.expiresAt && Date.now() > yt.expiresAt - 300000)) {
    try {
      await refreshYouTubeToken();
    } catch (e) {
      console.warn('YouTube token refresh failed:', e.message);
      return null;
    }
  }

  return tokenCache.youtube?.accessToken || null;
}

// ─── Instagram (Meta) OAuth 2.0 ──────────────

const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const META_LONG_LIVED_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';

const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

/**
 * Generate Instagram OAuth authorization URL
 */
export function getInstagramAuthUrl(redirectUri) {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) return null;

  const state = crypto.randomBytes(16).toString('hex');
  tokenCache._ig_state = state;
  saveTokens(tokenCache);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: INSTAGRAM_SCOPES,
    response_type: 'code',
    state,
  });

  return `${META_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Instagram authorization code for tokens
 */
export async function exchangeInstagramCode(code, redirectUri) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  // Exchange code for access token
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

  // Step 2: Exchange for long-lived token (60 days)
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
      expiresIn = llData.expires_in || 5184000; // 60 days
    }
  } catch (e) {
    console.warn('Could not get long-lived Instagram token:', e.message);
  }

  // Step 3: Get Instagram Business Account ID
  let igUserId = null;
  let username = 'Instagram User';
  try {
    // Get pages linked to the user
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`
    );
    if (pagesRes.ok) {
      const pagesData = await pagesRes.json();
      if (pagesData.data && pagesData.data.length > 0) {
        const pageId = pagesData.data[0].id;
        const pageToken = pagesData.data[0].access_token;

        // Get IG business account linked to the page
        const igRes = await fetch(
          `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
        );
        if (igRes.ok) {
          const igData = await igRes.json();
          igUserId = igData.instagram_business_account?.id;
        }

        // Get IG username
        if (igUserId) {
          const userRes = await fetch(
            `https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${accessToken}`
          );
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

  tokenCache.instagram = {
    accessToken,
    igUserId,
    expiresAt: Date.now() + expiresIn * 1000,
    username,
    connectedAt: Date.now(),
  };

  delete tokenCache._ig_state;
  saveTokens(tokenCache);
  return tokenCache.instagram;
}

/**
 * Get Instagram access token (no auto-refresh — long-lived tokens last 60 days)
 */
export function getInstagramToken() {
  const ig = tokenCache.instagram;
  if (!ig?.accessToken) return null;

  // Check if expired
  if (ig.expiresAt && Date.now() > ig.expiresAt) {
    console.warn('Instagram token expired. User needs to re-connect.');
    return null;
  }

  return { accessToken: ig.accessToken, igUserId: ig.igUserId };
}

// ─── Connection Status ────────────────────────

/**
 * Get connection status for all platforms
 * Checks real token validity (not just presence)
 */
export function getConnectionStatus() {
  const yt = tokenCache.youtube;
  const ig = tokenCache.instagram;

  // YouTube: connected if has valid access token or refresh token
  // If refresh token is present but access token is missing/expired, it can still be refreshed
  const ytHasToken = !!(yt?.accessToken || yt?.refreshToken);
  const ytIsExpired = yt?.expiresAt && Date.now() > yt.expiresAt;
  const ytConnected = ytHasToken && (!ytIsExpired || !!yt?.refreshToken);

  // Instagram: connected if has valid access token and IG user ID
  // Instagram tokens expire in 60 days (long-lived), so check expiration
  const igHasToken = !!(ig?.accessToken && ig?.igUserId);
  const igIsExpired = ig?.expiresAt && Date.now() > ig.expiresAt;
  const igConnected = igHasToken && !igIsExpired;

  return {
    youtube: {
      connected: ytConnected,
      username: yt?.username || null,
      expiresAt: yt?.expiresAt || null,
      connectedAt: yt?.connectedAt || null,
      needsRefresh: ytHasToken && ytIsExpired && !!yt?.refreshToken,
    },
    instagram: {
      connected: igConnected,
      username: ig?.username || null,
      expiresAt: ig?.expiresAt || null,
      connectedAt: ig?.connectedAt || null,
      expired: igIsExpired,
    },
  };
}

/**
 * Check if OAuth credentials are configured in .env
 */
export function getCredentialStatus() {
  return {
    youtube: {
      configured: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    },
    instagram: {
      configured: !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    },
  };
}

// ─── Disconnect ───────────────────────────────

/**
 * Disconnect a platform (remove stored tokens)
 */
export function disconnectPlatform(platform) {
  if (platform === 'youtube') {
    delete tokenCache.youtube;
  } else if (platform === 'instagram') {
    delete tokenCache.instagram;
  }
  saveTokens(tokenCache);
}
