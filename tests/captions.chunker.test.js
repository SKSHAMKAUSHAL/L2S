import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkWords, sanitizeWords, countGraphemes, isSentenceEnd } from '../src/captions/chunker.js';
import { loadFixture } from './helpers/fixtures.js';

describe('Caption Chunker (Step 2)', () => {
  it('1. chunks words into 2-4 words per caption (default 3)', () => {
    const words = [
      { word: 'This', start: 0.0, end: 0.3 },
      { word: 'is', start: 0.35, end: 0.55 },
      { word: 'a', start: 0.6, end: 0.8 },
      { word: 'great', start: 0.85, end: 1.1 },
      { word: 'video', start: 1.15, end: 1.4 },
      { word: 'clip', start: 1.45, end: 1.8 },
    ];

    const chunks = chunkWords(words, { wordsPerCaption: 3 });
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].words.length, 3);
    assert.strictEqual(chunks[1].words.length, 3);
    for (const chunk of chunks) {
      assert.ok(chunk.words.length >= 2 && chunk.words.length <= 4);
    }
  });

  it('2. breaks on sentence-ending punctuation (. ? ! and Hindi danda ।)', () => {
    const words = [
      { word: 'First', start: 0.0, end: 0.3 },
      { word: 'sentence.', start: 0.35, end: 0.7 },
      { word: 'Second', start: 0.75, end: 1.0 },
      { word: 'sentence!', start: 1.05, end: 1.4 },
      { word: 'यह', start: 1.45, end: 1.7 },
      { word: 'सच', start: 1.75, end: 1.9 },
      { word: 'है।', start: 1.95, end: 2.2 },
      { word: 'अगला', start: 2.25, end: 2.5 },
      { word: 'भाग', start: 2.55, end: 2.8 },
    ];

    const chunks = chunkWords(words);
    // 'sentence.' ends chunk 0
    assert.strictEqual(chunks[0].text, 'First sentence.');
    // 'sentence!' ends chunk 1
    assert.strictEqual(chunks[1].text, 'Second sentence!');
    // 'है।' ends chunk 2
    assert.ok(chunks[2].text.includes('है।'));
  });

  it('3. breaks at pauses longer than 0.3 seconds', () => {
    const words = [
      { word: 'Before', start: 0.0, end: 0.4 },
      { word: 'pause', start: 0.45, end: 0.8 },
      // 0.6s gap (> 0.3s)
      { word: 'After', start: 1.4, end: 1.7 },
      { word: 'long', start: 1.75, end: 2.0 },
      { word: 'silence', start: 2.05, end: 2.4 },
    ];

    const chunks = chunkWords(words, { pauseThreshold: 0.3 });
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].text, 'Before pause');
    assert.strictEqual(chunks[1].text, 'After long silence');
  });

  it('4. avoids orphan single words (splits 4 into 2+2 instead of 3+1)', () => {
    const words = [
      { word: 'One', start: 0.0, end: 0.3 },
      { word: 'two', start: 0.35, end: 0.6 },
      { word: 'three', start: 0.65, end: 0.9 },
      { word: 'four', start: 0.95, end: 1.3 },
    ];

    const chunks = chunkWords(words, { wordsPerCaption: 3 });
    // Should NOT be 3 and 1, must be 2 and 2
    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].words.length, 2);
    assert.strictEqual(chunks[1].words.length, 2);
  });

  it('5. bridges gaps below 0.5s to avoid subtitle flicker', () => {
    const words = [
      { word: 'Hello', start: 0.0, end: 0.4 },
      { word: 'world', start: 0.45, end: 0.8 },
      // Next caption starts at 1.0 (gap = 0.2s, which is < 0.5s)
      { word: 'Next', start: 1.0, end: 1.3 },
      { word: 'caption', start: 1.35, end: 1.7 },
    ];

    const chunks = chunkWords(words, { wordsPerCaption: 2, maxGapToNext: 0.5 });
    assert.strictEqual(chunks.length, 2);
    // First caption end should be bridged to next caption start (1.0)
    assert.strictEqual(chunks[0].end, 1.0);
  });

  it('6. enforces minimum display duration (at least 0.25s)', () => {
    const words = [
      { word: 'Quick', start: 1.0, end: 1.05 },
      { word: 'word', start: 1.06, end: 1.10 },
    ];

    const chunks = chunkWords(words, { minDisplayDuration: 0.25 });
    assert.ok(chunks[0].end - chunks[0].start >= 0.25);
  });

  it('7. safely handles bad and corrupted input by clamping (never throws)', () => {
    const badWords = [
      { word: '', start: 0, end: 1 },                 // empty word
      { word: 'negative', start: -5, end: -2 },       // negative times
      { word: 'inverted', start: 3.5, end: 2.0 },     // start > end
      { word: 'overlap', start: 1.0, end: 1.2 },      // non-monotonic
      { word: 'normal', start: 4.0, end: 4.5 },
    ];

    assert.doesNotThrow(() => {
      const chunks = chunkWords(badWords);
      assert.ok(chunks.length > 0);
      for (const c of chunks) {
        assert.ok(c.start >= 0);
        assert.ok(c.end > c.start);
      }
    });

    // Null/undefined/empty input
    assert.deepStrictEqual(chunkWords(null), []);
    assert.deepStrictEqual(chunkWords([]), []);
    assert.deepStrictEqual(chunkWords(undefined), []);
  });

  it('8. shifts by offset and trims cleanly', () => {
    const words = [
      { word: 'Shifted', start: 10.0, end: 10.5 },
      { word: 'words', start: 10.6, end: 11.2 },
    ];

    const chunks = chunkWords(words, { offset: 10.0 });
    assert.strictEqual(chunks[0].words[0].start, 0.0);
    assert.strictEqual(chunks[0].words[0].end, 0.5);
  });

  it('9. processes Hindi (Devanagari) fixture with accurate grapheme line limits', () => {
    const hiFixture = loadFixture('hi');
    const allWords = hiFixture.segments.flatMap(s => s.words);
    const chunks = chunkWords(allWords);

    assert.ok(chunks.length > 5);
    for (const chunk of chunks) {
      assert.ok(chunk.words.length >= 2 && chunk.words.length <= 4);
      for (const line of chunk.lines) {
        // Grapheme length should be reasonably bounded (~18 chars)
        assert.ok(countGraphemes(line) <= 30);
      }
    }
  });

  it('10. processes Hinglish fixture preserving words and timings', () => {
    const hinglishFixture = loadFixture('hinglish');
    const allWords = hinglishFixture.segments.flatMap(s => s.words);
    const chunks = chunkWords(allWords);

    assert.ok(chunks.length > 5);
    for (const chunk of chunks) {
      assert.ok(chunk.start >= 0);
      assert.ok(chunk.end > chunk.start);
    }
  });
});
