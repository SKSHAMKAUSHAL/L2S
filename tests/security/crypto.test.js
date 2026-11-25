import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptToken, decryptToken, getEncryptionKeys } from '../../src/security/crypto.js';

describe('Step 8: Token Encryption & Key Rotation (crypto.test.js)', () => {
  it('successfully completes round-trip encryption and decryption with AES-256-GCM', () => {
    const secret = JSON.stringify({ access_token: 'secret_token_123', refresh_token: 'refresh_456' });
    const encrypted = encryptToken(secret);

    assert.equal(typeof encrypted, 'string');
    const parsed = JSON.parse(encrypted);
    assert.equal(parsed.v, 1);
    assert.ok(parsed.kid);
    assert.ok(parsed.nonce);
    assert.ok(parsed.tag);
    assert.ok(parsed.ciphertext);

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, secret);
  });

  it('rejects tampered ciphertext or altered authentication tags', () => {
    const plaintext = 'sensitive_oauth_token';
    const encrypted = JSON.parse(encryptToken(plaintext));

    // 1. Modify ciphertext (flip last character to ensure tamper)
    const lastChar = encrypted.ciphertext.slice(-1);
    const flip = lastChar === '0' ? '1' : '0';
    const tamperedCipher = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -1) + flip };
    assert.throws(
      () => decryptToken(JSON.stringify(tamperedCipher)),
      /Unsupported state or unable to authenticate data|bad decrypt|auth/i
    );

    // 2. Modify tag (flip first character to guarantee tamper)
    const firstTagChar = encrypted.tag.slice(0, 1);
    const flipTag = firstTagChar === '0' ? '1' : '0';
    const tamperedTag = { ...encrypted, tag: flipTag + encrypted.tag.slice(1) };
    assert.throws(
      () => decryptToken(JSON.stringify(tamperedTag)),
      /Unsupported state or unable to authenticate data|bad decrypt|auth/i
    );
  });

  it('supports key rotation: decrypts old blobs encrypted under previous key ID', () => {
    const key1 = crypto.randomBytes(32).toString('base64');
    const key2 = crypto.randomBytes(32).toString('base64');

    const originalKeys = process.env.TOKEN_ENC_KEYS;
    const originalKid = process.env.CURRENT_KID;

    try {
      process.env.TOKEN_ENC_KEYS = JSON.stringify({ k1: key1, k2: key2 });
      process.env.CURRENT_KID = 'k1';

      // Encrypt with key k1
      const blobK1 = encryptToken('token_under_key_1', 'k1');
      assert.equal(JSON.parse(blobK1).kid, 'k1');

      // Rotate active key to k2
      process.env.CURRENT_KID = 'k2';

      // Encrypt new token under k2
      const blobK2 = encryptToken('token_under_key_2');
      assert.equal(JSON.parse(blobK2).kid, 'k2');

      // Verify old token under k1 still decrypts cleanly!
      assert.equal(decryptToken(blobK1), 'token_under_key_1');
      assert.equal(decryptToken(blobK2), 'token_under_key_2');
    } finally {
      process.env.TOKEN_ENC_KEYS = originalKeys;
      process.env.CURRENT_KID = originalKid;
    }
  });

  it('refuses to start in production without a valid 32-byte TOKEN_ENC_KEY', () => {
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.TOKEN_ENC_KEY;
    const origKeys = process.env.TOKEN_ENC_KEYS;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.TOKEN_ENC_KEY;
      delete process.env.TOKEN_ENC_KEYS;

      assert.throws(
        () => getEncryptionKeys(),
        /FATAL: TOKEN_ENC_KEY must be a 32-byte base64 encoded string in production/i
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.TOKEN_ENC_KEY = origKey;
      process.env.TOKEN_ENC_KEYS = origKeys;
    }
  });
});
