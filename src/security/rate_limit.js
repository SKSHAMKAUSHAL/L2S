/**
 * src/security/rate_limit.js
 * Express rate limiting configurations as mandated by Step 8.
 */

import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter: 300 requests per 15 minutes
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Login rate limiter: 10 requests per 15 minutes
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again after 15 minutes.' },
});

/**
 * Registration rate limiter: 5 requests per hour
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account registrations from this IP, please try again after 1 hour.' },
});

/**
 * Job creation rate limiter: 10 requests per hour for free plan users
 */
export const jobCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: (req) => (req.user && req.user.plan === 'paid' ? 100 : 10),
  keyGenerator: (req) => (req.user ? `user_${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Job creation limit reached (10 jobs per hour on free plan).' },
});
