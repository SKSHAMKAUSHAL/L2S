import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { REDACTED_PATHS } from '../../src/security/logger.js';

describe('Step 8: Structured Logging & Credential Redaction (logging.test.js)', () => {
  it('strictly redacts tokens, credentials, cookies, and secrets from log payloads', () => {
    let capturedLog = '';
    const destination = {
      write(chunk) {
        capturedLog += chunk;
      },
    };

    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: REDACTED_PATHS,
          censor: '[REDACTED]',
        },
      },
      destination
    );

    const sensitiveData = {
      password: 'SuperSecretPassword123!',
      access_token: 'ya29.sensitive_oauth_token',
      refresh_token: '1//refresh_token_secret',
      client_secret: 'GOCSPX-secret_client_key',
      GROQ_API_KEY: 'gsk_real_api_key_secret',
      nested: {
        password: 'nested_secret_password',
        access_token: 'nested_access_token',
      },
      safeField: 'This is public data',
    };

    testLogger.info(sensitiveData, 'User action recorded');

    // Parse output JSON
    const parsed = JSON.parse(capturedLog);

    assert.equal(parsed.password, '[REDACTED]');
    assert.equal(parsed.access_token, '[REDACTED]');
    assert.equal(parsed.refresh_token, '[REDACTED]');
    assert.equal(parsed.client_secret, '[REDACTED]');
    assert.equal(parsed.GROQ_API_KEY, '[REDACTED]');
    assert.equal(parsed.nested.password, '[REDACTED]');
    assert.equal(parsed.nested.access_token, '[REDACTED]');
    assert.equal(parsed.safeField, 'This is public data');

    // Confirm raw sensitive values do NOT appear anywhere in the output
    assert.equal(capturedLog.includes('SuperSecretPassword123!'), false);
    assert.equal(capturedLog.includes('ya29.sensitive_oauth_token'), false);
    assert.equal(capturedLog.includes('gsk_real_api_key_secret'), false);
  });
});
