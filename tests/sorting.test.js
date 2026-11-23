import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mergeSort, quickSelect, getTopK } from '../src/sorting_algorithms.js';

describe('Sorting and Selection Algorithms', () => {
  const clips = [
    { id: 'c1', score: 45 },
    { id: 'c2', score: 92 },
    { id: 'c3', score: 78 },
    { id: 'c4', score: 60 },
    { id: 'c5', score: 88 },
    { id: 'c6', score: 30 },
  ];

  test('mergeSort sorts descending by score', () => {
    const sorted = mergeSort(clips, (a, b) => b.score - a.score);
    const scores = sorted.map(c => c.score);
    assert.deepStrictEqual(scores, [92, 88, 78, 60, 45, 30]);
  });

  test('mergeSort handles empty or single-element arrays', () => {
    assert.deepStrictEqual(mergeSort([]), []);
    assert.deepStrictEqual(mergeSort([{ score: 10 }]), [{ score: 10 }]);
  });

  test('quickSelect finds k-th largest element', () => {
    const arr = [...clips];
    const top1 = quickSelect(arr, 0, (a, b) => b.score - a.score);
    assert.strictEqual(top1.score, 92);

    const top2 = quickSelect(arr, 1, (a, b) => b.score - a.score);
    assert.strictEqual(top2.score, 88);
  });

  test('getTopK returns the top k elements in sorted order', () => {
    const top3 = getTopK(clips, 3, (a, b) => b.score - a.score);
    assert.strictEqual(top3.length, 3);
    assert.strictEqual(top3[0].score, 92);
    assert.strictEqual(top3[1].score, 88);
    assert.strictEqual(top3[2].score, 78);
  });
});
