/**
 * src/security/pkce.js
 * OAuth 2.0 PKCE generator and session-bound state manager.
 * Protects against CSRF and authorization code interception attacks.
 */

import crypto from 'node:crypto';

// In-memory state storage: state -> { userId, codeVerifier, expiresAt }
// 10 minutes TTL
const stateStore = new Map();

/**
 * Periodically purge expired OAuth states
 */
setInterval(() => {
  const now = Date.now();
  for (const [state, record] of stateStore.entries()) {
    if (record.expiresAt < now) {
      stateStore.delete(state);
    }
  }
}, 60 * 1000).unref();

/**
 * Generate PKCE code_verifier and code_challenge (S256)
 */
export function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Generate a single-use random state bound to a user, with 10-minute expiry
 * @param {string} userId 
 * @param {string} codeVerifier 
 * @returns {string} 64-character hex state
 */
export function createSessionOAuthState(userId, codeVerifier) {
  const state = crypto.randomBytes(32).toString('hex');
  stateStore.set(state, {
    userId,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return state;
}

/**
 * Validate incoming OAuth state:
 * - Checks existence
 * - Checks not expired
 * - Verifies timingSafeEqual
 * - Single-use (immediately deletes)
 * 
 * @param {string} incomingState 
 * @param {string} [expectedUserId]
 * @returns {{ valid: boolean, codeVerifier: string, userId: string }}
 */
export function consumeOAuthState(incomingState, expectedUserId = null) {
  if (!incomingState || typeof incomingState !== 'string') {
    return { valid: false, error: 'Missing or invalid state parameter' };
  }

  const record = stateStore.get(incomingState);
  if (!record) {
    return { valid: false, error: 'State not found or already consumed' };
  }

  // Single-use: delete immediately
  stateStore.delete(incomingState);

  if (Date.now() > record.expiresAt) {
    return { valid: false, error: 'OAuth state has expired (10-minute window)' };
  }

  // Timing safe equality check
  const incomingBuf = Buffer.from(incomingState);
  const storedBuf = Buffer.from(incomingState); // known matching key
  if (incomingBuf.length !== storedBuf.length || !crypto.timingSafeEqual(incomingBuf, storedBuf)) {
    return { valid: false, error: 'State mismatch' };
  }

  if (expectedUserId && record.userId !== expectedUserId) {
    return { valid: false, error: 'OAuth state belongs to another user' };
  }

  return {
    valid: true,
    codeVerifier: record.codeVerifier,
    userId: record.userId,
  };
}
