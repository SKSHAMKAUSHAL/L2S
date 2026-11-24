import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiverseClips } from '../../src/clip_engine/select.js';

test('Clip Engine: select.js', async (t) => {
  await t.test('NMS removes candidates with time overlap > 30% of shorter clip', () => {
    const candidates = [
      { id: 'c1', start: 10, end: 40, finalScore: 90 }, // 30s
      { id: 'c2', start: 20, end: 50, finalScore: 85 }, // 30s, overlaps by 20s (20/30 = 66% > 30%)
      { id: 'c3', start: 70, end: 100, finalScore: 80 }, // separated by 30s gap
    ];

    const result = selectDiverseClips(candidates, [], 300, { clipCount: 5 });
    assert.equal(result.clips.length, 2);
    assert.equal(result.clips[0].id, 'c1');
    assert.equal(result.clips[1].id, 'c3');
  });

  await t.test('allows at most 2 clips per topic segment', () => {
    const topicSegments = [
      { id: 'T0', start: 0, end: 200 },
      { id: 'T1', start: 200, end: 400 },
    ];

    const candidates = [
      { id: 'c1', start: 10, end: 40, finalScore: 95 }, // in T0
      { id: 'c2', start: 65, end: 95, finalScore: 90 }, // in T0
      { id: 'c3', start: 120, end: 150, finalScore: 85 }, // in T0 (3rd in T0 -> should be skipped)
      { id: 'c4', start: 220, end: 250, finalScore: 80 }, // in T1
    ];

    const result = selectDiverseClips(candidates, topicSegments, 500, { clipCount: 5 });
    assert.equal(result.clips.length, 3);
    const selectedIds = result.clips.map(c => c.id);
    assert.deepEqual(selectedIds, ['c1', 'c2', 'c4']);
  });

  await t.test('enforces auto count formula: clamp(round(durationMinutes / 4), 3, 12)', () => {
    // 8-minute video: 8 / 4 = 2 -> clamped to min 3
    const res8 = selectDiverseClips([], [], 8 * 60);
    assert.equal(res8.meta.targetCount, 3);

    // 24-minute video: 24 / 4 = 6
    const res24 = selectDiverseClips([], [], 24 * 60);
    assert.equal(res24.meta.targetCount, 6);

    // 60-minute video: 60 / 4 = 15 -> clamped to max 12
    const res60 = selectDiverseClips([], [], 60 * 60);
    assert.equal(res60.meta.targetCount, 12);
  });
});
