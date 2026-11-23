import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateCandidateSegments } from '../src/segmenter.js';

describe('Segmenter Candidate Window Generation', () => {
  const sampleTranscript = {
    duration: 120,
    language: 'en',
    segments: [
      { start: 0.0, end: 5.2, text: 'Have you ever wondered why some videos go massively viral?', words: [] },
      { start: 5.2, end: 12.0, text: 'In this video, I am going to reveal the three psychological secrets.', words: [] },
      { start: 12.0, end: 22.5, text: 'First, the human brain cannot resist an unresolved loop.', words: [] },
      { start: 22.5, end: 35.0, text: 'When you open a curiosity gap in the first 3 seconds, viewers stay glued.', words: [] },
      { start: 35.0, end: 48.0, text: 'Second, high emotion triggers sharing faster than any logic ever could.', words: [] },
      { start: 48.0, end: 62.0, text: 'People share what makes them feel excited, angry, or amazed.', words: [] },
      { start: 62.0, end: 75.0, text: 'And finally, the takeaway must be dead simple to implement.', words: [] },
      { start: 75.0, end: 90.0, text: 'If you apply these three rules today, your views will explode.', words: [] },
      { start: 90.0, end: 105.0, text: 'Make sure to follow for more viral growth strategies.', words: [] },
    ],
  };

  test('generates candidate segments from transcript', () => {
    const candidates = generateCandidateSegments(sampleTranscript, {
      minDuration: 20,
      maxDuration: 60,
      stepSeconds: 15,
    });

    assert.ok(Array.isArray(candidates));
    assert.ok(candidates.length > 0, 'Should generate candidate windows');
  });

  test('candidate segments respect duration bounds', () => {
    const minDur = 15;
    const maxDur = 90;
    const candidates = generateCandidateSegments(sampleTranscript, {
      windowSizes: [25, 40, 60],
      lengthPenaltyRange: [minDur, maxDur],
      slideStep: 10,
    });

    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      const duration = c.end - c.start;
      assert.ok(
        duration >= minDur && duration <= maxDur,
        `Duration ${duration} should be within bounds [${minDur}, ${maxDur}]`
      );
      assert.ok(typeof c.text === 'string' && c.text.length > 0);
      assert.ok(typeof c.id === 'string');
    }
  });

  test('handles empty or invalid transcript gracefully', () => {
    const emptyCandidates = generateCandidateSegments({ segments: [] });
    assert.deepStrictEqual(emptyCandidates, []);

    const nullCandidates = generateCandidateSegments(null);
    assert.deepStrictEqual(nullCandidates, []);
  });
});
