import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHeatmapScore,
  computeSpeechPaceScore,
  computeLexiconScore,
  computeCandidateSignals,
} from '../../src/clip_engine/signals.js';

test('Clip Engine: signals.js', async (t) => {
  await t.test('computes average YouTube heatmap score accurately in candidate window', () => {
    const heatmap = [
      { start_time: 0, end_time: 10, value: 0.2 },
      { start_time: 10, end_time: 20, value: 0.8 },
      { start_time: 20, end_time: 30, value: 0.6 },
      { start_time: 30, end_time: 40, value: 0.1 },
    ];

    // Window 10 to 30 covers points with value 0.8 and 0.6 -> avg 0.7 -> score 70
    const score = computeHeatmapScore(heatmap, 10, 30);
    assert.equal(score, 70);
  });

  await t.test('missing heatmap renormalises weights cleanly without NaN or zero-division', () => {
    const candidate = {
      start: 10,
      end: 40,
      text: 'Why is this the greatest secret ever discovered?',
      words: Array.from({ length: 60 }, (_, i) => ({ word: 'word', start: 10 + i * 0.5, end: 10 + (i + 1) * 0.5 })),
      language: 'en',
    };

    // No heatmap provided
    const res = computeCandidateSignals(candidate, { heatmap: null });
    assert.ok(res.score >= 0 && res.score <= 100);
    assert.equal(res.breakdown.heatmap, null);
    assert.equal(res.breakdown.weights.heatmap, 0);

    const sumWeights = Object.values(res.breakdown.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumWeights - 1.0) < 0.001);
  });

  await t.test('speech pace score evaluates words per second', () => {
    // 30 words in 10s = 3 words/sec (ideal conversational pace)
    const words = Array.from({ length: 30 }, (_, i) => ({
      word: `w${i}`,
      start: 0 + i * 0.33,
      end: 0 + (i + 1) * 0.33,
    }));
    const score = computeSpeechPaceScore(words, 0, 10);
    assert.ok(score >= 80);
  });

  await t.test('detects multilingual lexical cues (questions, numbers, contradictions)', () => {
    const enText = 'Why did 3 people actually fail this test?';
    const hiText = 'क्यों ३ लोगों ने लेकिन यह किया?';
    const hinglishText = 'Kyu 3 log lekin ye karte hai?';

    const enScore = computeLexiconScore(enText, 'en');
    const hiScore = computeLexiconScore(hiText, 'hi');
    const hinglishScore = computeLexiconScore(hinglishText, 'hinglish');

    assert.ok(enScore > 60);
    assert.ok(hiScore > 60);
    assert.ok(hinglishScore > 60);
  });
});
