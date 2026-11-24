import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateYouTubeUrl } from '../../src/security/url.js';

describe('Step 8: URL Validation & SSRF Abuse Tests (url.test.js)', () => {
  it('accepts valid standard YouTube URLs and returns canonical form', () => {
    const validCases = [
      { input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://youtu.be/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { input: 'https://www.youtube.com/embed/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
    ];

    for (const { input, id } of validCases) {
      const result = validateYouTubeUrl(input);
      assert.equal(result.valid, true);
      assert.equal(result.videoId, id);
      assert.equal(result.canonicalUrl, `https://www.youtube.com/watch?v=${id}`);
    }
  });

  it('rejects SSRF, protocol abuse, host spoofs, and malicious payloads', () => {
    const maliciousCases = [
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // Non-https
      'file:///etc/passwd',                         // file protocol
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', // Subdomain spoof
      'https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ', // Path spoof
      'https://user@youtube.com/watch?v=dQw4w9WgXcQ',     // Userinfo
      'https://127.0.0.1/watch?v=dQw4w9WgXcQ',            // Localhost IPv4
      'https://169.254.169.254/latest/meta-data',         // AWS metadata
      'https://[::1]/watch?v=dQw4w9WgXcQ',                // IPv6 literal
      'javascript:alert(1)',                              // JavaScript scheme
      '--exec id',                                        // CLI flag injection
      '-o /tmp/x',                                        // CLI flag injection
      'https://www.youtube.com/playlist?list=PL12345',    // Playlist URL
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345', // Playlist query
      'https://www.youtube.com/watch?v=' + 'a'.repeat(5000),      // Overlong URL
      '',                                                 // Empty string
      null,                                               // Null
      undefined,                                          // Undefined
      12345,                                              // Number
      {},                                                 // Object
    ];

    for (const testCase of maliciousCases) {
      assert.throws(
        () => validateYouTubeUrl(testCase),
        Error,
        `Expected validation to fail for input: ${testCase}`
      );
    }
  });
});
