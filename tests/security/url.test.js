import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateYouTubeUrl, validateInstagramUrl, validateMediaUrl } from '../../src/security/url.js';

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

  it('accepts valid Instagram Reel and post URLs', () => {
    const validInstagram = [
      { input: 'https://www.instagram.com/reel/C3zYx7bI1_a/', code: 'C3zYx7bI1_a', type: 'reel' },
      { input: 'https://instagram.com/reels/C3zYx7bI1_a/', code: 'C3zYx7bI1_a', type: 'reel' },
      { input: 'https://m.instagram.com/p/C3zYx7bI1_a', code: 'C3zYx7bI1_a', type: 'p' },
      { input: 'https://www.instagram.com/tv/C3zYx7bI1_a/', code: 'C3zYx7bI1_a', type: 'tv' },
    ];

    for (const { input, code, type } of validInstagram) {
      const res = validateInstagramUrl(input);
      assert.equal(res.valid, true);
      assert.equal(res.platform, 'instagram');
      assert.equal(res.shortcode, code);
      assert.equal(res.canonicalUrl, `https://www.instagram.com/${type}/${code}/`);
    }
  });

  it('rejects invalid or malicious Instagram URLs', () => {
    const invalidCases = [
      'http://www.instagram.com/reel/C3zYx7bI1_a/', // http
      'https://instagram.com.evil.com/reel/C3zYx7bI1_a/', // spoofed domain
      'https://www.instagram.com/explore/', // not a reel/post
      'https://www.instagram.com/reel/abc', // too short code (<5)
      '--output /tmp/evil', // flag injection
      'https://user@instagram.com/reel/C3zYx7bI1_a/', // userinfo
    ];

    for (const input of invalidCases) {
      assert.throws(
        () => validateInstagramUrl(input),
        Error,
        `Expected invalid Instagram URL to throw: ${input}`
      );
    }
  });

  it('validateMediaUrl correctly discriminates YouTube vs Instagram', () => {
    const yt = validateMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(yt.platform, 'youtube');
    assert.equal(yt.id, 'dQw4w9WgXcQ');

    const ig = validateMediaUrl('https://www.instagram.com/reel/C3zYx7bI1_a/');
    assert.equal(ig.platform, 'instagram');
    assert.equal(ig.id, 'C3zYx7bI1_a');

    assert.throws(() => validateMediaUrl('https://tiktok.com/@user/video/12345'), Error);
  });
});
