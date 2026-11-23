import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectScript, scriptStats } from '../src/captions/script_utils.js';

describe('Script Utils (Step 3)', () => {
  it('1. detectScript accurately classifies devanagari, latin, mixed, digits, and punctuation', () => {
    assert.strictEqual(detectScript('नमस्ते'), 'devanagari');
    assert.strictEqual(detectScript('viral'), 'latin');
    assert.strictEqual(detectScript('Hinglish123'), 'latin');
    assert.strictEqual(detectScript('AIवीडियो'), 'mixed');
    assert.strictEqual(detectScript('12345'), 'other');
    assert.strictEqual(detectScript('...!?'), 'other');
    assert.strictEqual(detectScript(''), 'other');
    assert.strictEqual(detectScript(null), 'other');
  });

  it('2. scriptStats computes accurate character and word statistics', () => {
    const words = [
      { word: 'नमस्ते' },
      { word: 'duniya' },
      { word: '123' },
    ];

    const stats = scriptStats(words);
    assert.strictEqual(stats.totalWords, 3);
    assert.strictEqual(stats.devanagariWords, 1);
    assert.strictEqual(stats.latinWords, 1);
    assert.strictEqual(stats.otherWords, 1);
    assert.ok(stats.devanagariShare > 0.3);
    assert.ok(stats.latinShare > 0.3);
  });

  it('3. handles empty or invalid word arrays gracefully', () => {
    const statsEmpty = scriptStats([]);
    assert.strictEqual(statsEmpty.totalWords, 0);
    assert.strictEqual(statsEmpty.devanagariShare, 0);
    assert.strictEqual(statsEmpty.latinShare, 0);

    const statsNull = scriptStats(null);
    assert.strictEqual(statsNull.totalWords, 0);
  });
});
