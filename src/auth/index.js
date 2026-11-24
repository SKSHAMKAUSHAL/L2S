/**
 * src/auth/index.js
 * Multi-user authentication, argon2 hashing, 14-day sessions, and CSRF protection.
 */

import crypto from 'node:crypto';
import argon2 from 'argon2';

const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreSAeVoScLeaq4HHbgHJaYBgkBgQ';
export const SESSION_COOKIE_NAME = 'l2s_session';
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function hashPassword(plainText) {
  if (typeof plainText !== 'string' || plainText.length < 10) {
    throw new Error('Password must be at least 10 characters long');
  }
  return argon2.hash(plainText, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

export async function verifyPassword(hash, plainText) {
  try {
    return await argon2.verify(hash, plainText);
  } catch (e) {
    return false;
  }
}

export function generateTokens() {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  return { sessionToken, csrfToken, expiresAt };
}

export async function registerUser(repo, { email, password, plan = 'free' }) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    const err = new Error('Valid email address is required');
    err.status = 400;
    throw err;
  }
  if (!password || typeof password !== 'string' || password.length < 10) {
    const err = new Error('Password must be at least 10 characters long');
    err.status = 400;
    throw err;
  }

  const existing = repo.getUserByEmail(email);
  if (existing) {
    const err = new Error('Email already registered');
    err.status = 400;
    throw err;
  }

  const passwordHash = await hashPassword(password);
  const user = repo.createUser({ email, passwordHash, plan });
  const { sessionToken, csrfToken, expiresAt } = generateTokens();
  repo.createSession({ userId: user.id, rawToken: sessionToken, csrfToken, expiresAt });

  return { user, sessionToken, csrfToken };
}

export async function loginUser(repo, { email, password }) {
  const genericError = new Error('Invalid email or password');
  genericError.status = 401;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    throw genericError;
  }

  const user = repo.getUserByEmail(email);
  if (!user) {
    // Constant-time mitigation: verify against dummy hash to prevent timing attacks
    await verifyPassword(DUMMY_HASH, password);
    throw genericError;
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    throw genericError;
  }

  const { sessionToken, csrfToken, expiresAt } = generateTokens();
  repo.createSession({ userId: user.id, rawToken: sessionToken, csrfToken, expiresAt });

  return {
    user: { id: user.id, email: user.email, plan: user.plan, credits_seconds: user.credits_seconds },
    sessionToken,
    csrfToken
  };
}

export function setSessionCookie(res, sessionToken) {
  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

export function createAuthMiddleware(repo) {
  return function requireAuth(req, res, next) {
    // Check session cookie or Authorization header
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }

    if (!rawToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = repo.getSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    // CSRF Check for state-mutating HTTP methods
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (mutatingMethods.includes(req.method.toUpperCase())) {
      // Bearer token authentication is inherently immune to ambient-cookie CSRF attacks
      const isBearerAuth = req.headers.authorization && req.headers.authorization.startsWith('Bearer ');
      if (!isBearerAuth) {
        const csrfHeader = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || (req.body && req.body._csrf);
        if (!csrfHeader || csrfHeader !== session.csrf_token) {
          return res.status(403).json({
            error: 'Invalid or missing CSRF token',
            code: 'CSRF_INVALID',
            message: 'Your security CSRF token is missing or expired. Please refresh the page.'
          });
        }
      }
    }

    req.user = {
      id: session.user_id,
      email: session.email,
      plan: session.plan,
      credits_seconds: session.credits_seconds
    };
    req.session = session;
    req.rawSessionToken = rawToken;

    next();
  };
}
