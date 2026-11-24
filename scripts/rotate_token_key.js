/**
 * scripts/rotate_token_key.js
 * CLI script to rotate OAuth tokens in the database to the newest encryption key.
 * Usage: node scripts/rotate_token_key.js
 */

import { getDb, createDbRepository } from '../src/db/index.js';
import { getEncryptionKeys, decryptToken, encryptToken } from '../src/security/crypto.js';

async function main() {
  const db = getDb();
  const repo = createDbRepository(db);
  const { currentKid } = getEncryptionKeys();

  console.log(`[rotate_token_key] Current active key ID: ${currentKid}`);

  const rows = db.prepare('SELECT id, user_id, provider, enc_blob FROM oauth_tokens').all();
  console.log(`[rotate_token_key] Found ${rows.length} token record(s) to inspect.`);

  let rotated = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.enc_blob);
      if (parsed.kid !== currentKid) {
        const plaintext = decryptToken(row.enc_blob);
        const reEncrypted = encryptToken(plaintext, currentKid);
        db.prepare('UPDATE oauth_tokens SET enc_blob = ? WHERE id = ?').run(reEncrypted, row.id);
        rotated++;
        console.log(`[rotate_token_key] Rotated token ${row.id} (user: ${row.user_id}, provider: ${row.provider}) from ${parsed.kid} to ${currentKid}`);
      }
    } catch (err) {
      console.error(`[rotate_token_key] Failed to rotate token ${row.id}: ${err.message}`);
    }
  }

  console.log(`[rotate_token_key] Done. Rotated ${rotated} token(s).`);
}

main().catch((err) => {
  console.error('[rotate_token_key] Error:', err);
  process.exit(1);
});
