import { test, describe } from 'node:test';
import assert from 'node:assert';
import { scoreSegment, scoreSegments } from '../src/scorer.js';

describe('Multi-Signal Heuristic Scorer', () => {
  const strongHookSegment = {
    id: 'seg-1',
    start: 0,
    end: 32,
    text: 'Did you know that 99% of people fail at productivity? The secret is simple: stop making to-do lists, and start scheduling your tasks on a calendar. Try this tomorrow!',
    words: [],
  };

  const weakFillerSegment = {
    id: 'seg-2',
    start: 100,
    end: 132,
    text: 'Um, so yeah, basically like I was saying earlier, that thing we talked about is kinda whatever.',
    words: [],
  };

  test('scores strong hook higher than filler segment', () => {
    const scoredStrong = scoreSegment(strongHookSegment, 'educational');
    const scoredWeak = scoreSegment(weakFillerSegment, 'educational');

    assert.ok(
      scoredStrong.heuristic.hook > scoredWeak.heuristic.hook,
      `Strong hook (${scoredStrong.heuristic.hook}) should beat weak hook (${scoredWeak.heuristic.hook})`
    );
    assert.ok(
      scoredStrong.heuristic.total > scoredWeak.heuristic.total,
      `Strong segment overall score (${scoredStrong.heuristic.total}) should beat weak segment (${scoredWeak.heuristic.total})`
    );
  });

  test('calculates length fit score within ideal 20-45s window', () => {
    const idealSeg = { id: 'ideal', start: 0, end: 30, text: 'This is a test segment.', words: [] };
    const tooLongSeg = { id: 'long', start: 0, end: 200, text: 'This is a test segment.', words: [] };

    const scoredIdeal = scoreSegment(idealSeg, 'default');
    const scoredLong = scoreSegment(tooLongSeg, 'default');

    assert.strictEqual(scoredIdeal.heuristic.lengthFit, 100);
    assert.strictEqual(scoredLong.heuristic.lengthFit, 0);
  });

  test('scoreSegments batches correctly across array', () => {
    const segments = [strongHookSegment, weakFillerSegment];
    const scored = scoreSegments(segments, 'motivational');

    assert.strictEqual(scored.length, 2);
    assert.ok(scored[0].heuristic.total > 0);
    assert.ok(scored[1].heuristic.total > 0);
    assert.ok(typeof scored[0].breakdownStr === 'string');
  });
});
