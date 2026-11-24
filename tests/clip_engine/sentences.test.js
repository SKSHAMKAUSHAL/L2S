import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSentences } from '../../src/clip_engine/sentences.js';

test('Clip Engine: sentences.js', async (t) => {
  await t.test('builds sentences splitting on punctuation (. ? ! and Hindi danda ।)', () => {
    const words = [
      { word: 'Hello', start: 0.0, end: 0.5 },
      { word: 'world.', start: 0.5, end: 1.0 },
      { word: 'How', start: 1.1, end: 1.4 },
      { word: 'are', start: 1.4, end: 1.7 },
      { word: 'you?', start: 1.7, end: 2.1 },
      { word: 'नमस्ते', start: 2.2, end: 2.8 },
      { word: 'दोस्तो।', start: 2.8, end: 3.5 },
      { word: 'Welcome!', start: 3.6, end: 4.2 },
    ];

    const sentences = buildSentences(words);
    assert.equal(sentences.length, 4);
    assert.equal(sentences[0].id, 'S0');
    assert.equal(sentences[0].text, 'Hello world.');
    assert.equal(sentences[0].start, 0.0);
    assert.equal(sentences[0].end, 1.0);

    assert.equal(sentences[1].id, 'S1');
    assert.equal(sentences[1].text, 'How are you?');

    assert.equal(sentences[2].id, 'S2');
    assert.equal(sentences[2].text, 'नमस्ते दोस्तो।');

    assert.equal(sentences[3].id, 'S3');
    assert.equal(sentences[3].text, 'Welcome!');
  });

  await t.test('splits on pauses > 0.7s without punctuation', () => {
    const words = [
      { word: 'This', start: 0.0, end: 0.4 },
      { word: 'is', start: 0.4, end: 0.7 },
      { word: 'thought', start: 0.7, end: 1.2 },
      // Pause of 0.9s (2.1 - 1.2)
      { word: 'and', start: 2.1, end: 2.4 },
      { word: 'another', start: 2.4, end: 2.8 },
      { word: 'thought', start: 2.8, end: 3.2 },
    ];

    const sentences = buildSentences(words);
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0].text, 'This is thought');
    assert.equal(sentences[1].text, 'and another thought');
  });

  await t.test('handles empty or malformed input safely', () => {
    assert.deepEqual(buildSentences([]), []);
    assert.deepEqual(buildSentences(null), []);
    assert.deepEqual(buildSentences([{ word: '' }, { word: '   ' }]), []);
  });

  await t.test('records accurate wordRange index', () => {
    const words = [
      { word: 'One', start: 0, end: 1 },
      { word: 'two.', start: 1, end: 2 },
      { word: 'Three', start: 2, end: 3 },
      { word: 'four.', start: 3, end: 4 },
    ];

    const sentences = buildSentences(words);
    assert.deepEqual(sentences[0].wordRange, [0, 1]);
    assert.deepEqual(sentences[1].wordRange, [2, 3]);
  });
});
