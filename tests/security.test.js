import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'path';

describe('Security & Input Validation Tests', () => {
  function validateVideoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return { valid: false, reason: 'Empty or invalid type' };
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('/dev/')) {
      return { valid: false, reason: 'Potential command argument injection' };
    }
    const isHttp = /^https?:\/\//i.test(trimmed);
    const isLocal = /^[a-zA-Z0-9_.\/\\ -]+$/.test(trimmed);
    if (!isHttp && !isLocal) {
      return { valid: false, reason: 'Invalid protocol or unsafe characters' };
    }
    return { valid: true, url: trimmed };
  }

  function validateDirectoryPath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return { valid: false };
    if (rawPath.includes('\0') || rawPath.startsWith('-')) return { valid: false };
    return { valid: true, resolved: path.resolve(rawPath) };
  }

  test('rejects argument injection payloads in video URLs', () => {
    assert.strictEqual(validateVideoUrl('--config-location /etc/passwd').valid, false);
    assert.strictEqual(validateVideoUrl('-o output.sh').valid, false);
    assert.strictEqual(validateVideoUrl('/dev/null').valid, false);
  });

  test('accepts valid YouTube URLs and local file paths', () => {
    assert.strictEqual(validateVideoUrl('https://www.youtube.com/w atch?v=dQw4w9WgXcQ').valid, true);
    assert.strictEqual(validateVideoUrl('https://youtu.be/dQw4w9WgXcQ').valid, true);
    assert.strictEqual(validateVideoUrl('./temp/video/test.mp4').valid, true);
  });

  test('rejects null byte injection and command flags in directory paths', () => {
    assert.strictEqual(validateDirectoryPath('output\0evil').valid, false);
    assert.strictEqual(validateDirectoryPath('--output-dir').valid, false);
    assert.strictEqual(validateDirectoryPath('./output').valid, true);
  });
});
