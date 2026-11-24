/**
 * src/security/crypto.js
 * AES-256-GCM Authenticated Encryption with key rotation support.
 * Complies with Step 8 security requirements.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12; // 96-bit recommended for GCM
const DEFAULT_KID = 'k1';

/**
 * Parses and returns active encryption keys from environment
 * Supports TOKEN_ENC_KEY (base64 32 bytes) or TOKEN_ENC_KEYS JSON map.
 */
export function getEncryptionKeys() {
  const isProd = process.env.NODE_ENV === 'production';
  const singleKey = process.env.TOKEN_ENC_KEY;
  const multiKeys = process.env.TOKEN_ENC_KEYS;

  const keyMap = new Map();

  if (multiKeys) {
    try {
      const parsed = JSON.parse(multiKeys);
      for (const [kid, b64] of Object.entries(parsed)) {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length === 32) {
          keyMap.set(kid, buf);
        }
      }
    } catch {}
  }

  if (singleKey) {
    const buf = Buffer.from(singleKey, 'base64');
    if (buf.length === 32) {
      const kid = process.env.CURRENT_KID || DEFAULT_KID;
      keyMap.set(kid, buf);
    }
  }

  // Refuse to start in production if key is missing or invalid
  if (keyMap.size === 0) {
    if (isProd) {
      throw new Error('FATAL: TOKEN_ENC_KEY must be a 32-byte base64 encoded string in production');
    }
    // Development fallback (deterministic 32-byte dummy for dev only)
    keyMap.set(DEFAULT_KID, crypto.createHash('sha256').update('l2s-dev-token-encryption-key-local').digest());
  }

  const currentKid = process.env.CURRENT_KID || (keyMap.has(DEFAULT_KID) ? DEFAULT_KID : Array.from(keyMap.keys())[0]);

  return { keyMap, currentKid };
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * @param {string} plaintext 
 * @param {string} [specificKid]
 * @returns {string} Serialized JSON object: { v: 1, kid, nonce, tag, ciphertext }
 */
export function encryptToken(plaintext, specificKid = null) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('Plaintext must be a string');
  }

  const { keyMap, currentKid } = getEncryptionKeys();
  const kid = specificKid || currentKid;
  const key = keyMap.get(kid);

  if (!key) {
    throw new Error(`Encryption key '${kid}' not found`);
  }

  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();

  const payload = {
    v: 1,
    kid,
    nonce: nonce.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext,
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt a token blob using AES-256-GCM.
 * @param {string|object} blob 
 * @returns {string} Plaintext
 */
export function decryptToken(blob) {
  let parsed = blob;
  if (typeof blob === 'string') {
    try {
      parsed = JSON.parse(blob);
    } catch {
      throw new Error('Invalid encryption payload: JSON parse failed');
    }
  }

  if (!parsed || parsed.v !== 1 || !parsed.kid || !parsed.nonce || !parsed.tag || !parsed.ciphertext) {
    throw new Error('Invalid encryption blob format');
  }

  const { keyMap } = getEncryptionKeys();
  const key = keyMap.get(parsed.kid);

  if (!key) {
    throw new Error(`Decryption failed: Unknown key ID '${parsed.kid}'`);
  }

  const nonce = Buffer.from(parsed.nonce, 'hex');
  const tag = Buffer.from(parsed.tag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(parsed.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
