import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloaderPath = path.resolve(__dirname, '../../src/downloader.js');

describe('Step 8: Downloader CLI Arguments & Insecurity Checks (downloader.test.js)', () => {
  it('confirms source code never contains --no-check-certificates or --cookies-from-browser', () => {
    const code = fs.readFileSync(downloaderPath, 'utf8');

    assert.equal(
      code.includes('--no-check-certificates'),
      false,
      'Downloader must never use --no-check-certificates'
    );

    assert.equal(
      code.includes('--cookies-from-browser'),
      false,
      'Downloader must never probe host browser cookies'
    );

    assert.equal(
      code.includes('cookies.txt'),
      false,
      'Downloader must never search for cookies.txt'
    );
  });

  it('confirms argument lists include --no-playlist, socket timeout, and -- before target URL', () => {
    const code = fs.readFileSync(downloaderPath, 'utf8');

    assert.ok(code.includes("'--no-playlist'"), 'Must include --no-playlist');
    assert.ok(code.includes("'--socket-timeout'"), 'Must include --socket-timeout');
    assert.ok(code.includes("'--retries'"), 'Must include --retries');
    assert.ok(code.includes("'--'"), "Must include '--' separator before URL");
  });
});
