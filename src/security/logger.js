/**
 * src/security/logger.js
 * Structured logging with Pino, automatic credential redaction,
 * and request correlation IDs.
 */

import pino from 'pino';
import crypto from 'node:crypto';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers["set-cookie"]',
  'authorization',
  'cookie',
  'access_token',
  'refresh_token',
  'client_secret',
  'password',
  'GROQ_API_KEY',
  '*.password',
  '*.access_token',
  '*.refresh_token',
  '*.client_secret',
  '*.GROQ_API_KEY',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Express middleware for request correlation ID and HTTP logging
 */
export function requestLogger(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  req.log = logger.child({ reqId });

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    if (req.path !== '/healthz' && req.path !== '/api/health') {
      req.log.info({
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
      }, `${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${durationMs}ms)`);
    }
  });

  next();
}
