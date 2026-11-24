import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCandidate } from '../../src/clip_engine/refine.js';

test('Clip Engine: refine.js', async (t) => {
  await t.test('snaps to sentence boundaries with safe padding', () => {
    const allWords = [
      { word: 'Before', start: 0.0, end: 0.8 },
      { word: 'First', start: 1.0, end: 1.5 },
      { word: 'sentence', start: 1.5, end: 2.0 },
      { word: 'ends.', start: 2.0, end: 2.5 },
      { word: 'Second', start: 2.6, end: 3.0 },
      { word: 'sentence', start: 3.0, end: 3.5 },
      { word: 'concludes.', start: 3.5, end: 4.0 },
      { word: 'After', start: 4.5, end: 5.0 },
    ];

    const sentences = [
      { id: 'S0', start: 1.0, end: 2.5, text: 'First sentence ends.', words: allWords.slice(1, 4) },
      { id: 'S1', start: 2.6, end: 4.0, text: 'Second sentence concludes.', words: allWords.slice(4, 7) },
    ];

    const candidate = {
      startSentence: 'S0',
      endSentence: 'S1',
      score: 85,
    };

    const refined = refineCandidate(candidate, sentences, allWords, { minDuration: 2 });
    // First word starts at 1.0; previous word ends at 0.8. Pad before is max 0.15s, so 1.0 - 0.15 = 0.85 >= 0.82
    assert.ok(refined.start <= 1.0);
    assert.ok(refined.start >= 0.8);

    // Last word ends at 4.0; next word starts at 4.5. Pad after is 0.30s -> 4.30 <= 4.48
    assert.ok(refined.end >= 4.0);
    assert.ok(refined.end <= 4.5);
  });

  await t.test('resolves initial connector (so, and, but, lekin) by extending start', () => {
    const allWords = [
      { word: 'Here', start: 0.0, end: 1.0 },
      { word: 'is', start: 1.0, end: 1.5 },
      { word: 'context.', start: 1.5, end: 2.5 },
      { word: 'So', start: 3.0, end: 3.5 },
      { word: 'this', start: 3.5, end: 4.0 },
      { word: 'happened.', start: 4.0, end: 5.0 },
    ];

    const sentences = [
      { id: 'S0', start: 0.0, end: 2.5, text: 'Here is context.', words: allWords.slice(0, 3) },
      { id: 'S1', start: 3.0, end: 5.0, text: 'So this happened.', words: allWords.slice(3, 6) },
    ];

    const candidate = {
      startSentence: 'S1',
      endSentence: 'S1',
      score: 80,
    };

    const refined = refineCandidate(candidate, sentences, allWords, { minDuration: 2 });
    // Should extend to S0 because S1 begins with connector 'So' and S0 is within 10s
    assert.equal(refined.startSentence, 'S0');
    assert.ok(refined.start < 1.0);
  });

  await t.test('property test: random fixtures never cut inside a word and stay within bounds', () => {
    for (let run = 0; run < 50; run++) {
      const numWords = 30 + Math.floor(Math.random() * 40);
      const allWords = [];
      let t = 0;

      for (let w = 0; w < numWords; w++) {
        const dur = 0.2 + Math.random() * 0.4;
        const gap = 0.05 + Math.random() * 0.3;
        allWords.push({
          word: `word_${w}`,
          start: Number(t.toFixed(2)),
          end: Number((t + dur).toFixed(2)),
        });
        t += dur + gap;
      }

      // Group into sentences of 4-8 words
      const sentences = [];
      let sStart = 0;
      while (sStart < allWords.length) {
        const sLen = Math.min(allWords.length - sStart, 4 + Math.floor(Math.random() * 4));
        const sWords = allWords.slice(sStart, sStart + sLen);
        sentences.push({
          id: `S${sentences.length}`,
          start: sWords[0].start,
          end: sWords[sWords.length - 1].end,
          text: sWords.map(w => w.word).join(' '),
          words: sWords,
        });
        sStart += sLen;
      }

      const s1 = Math.floor(Math.random() * (sentences.length - 1));
      const s2 = s1 + Math.floor(Math.random() * (sentences.length - s1));

      const candidate = {
        startSentence: sentences[s1].id,
        endSentence: sentences[s2].id,
        finalScore: 80,
      };

      const refined = refineCandidate(candidate, sentences, allWords, { minDuration: 10, maxDuration: 60 });

      assert.ok(refined.start >= 0, `start negative: ${refined.start}`);
      assert.ok(refined.end > refined.start, `end not greater than start: ${refined.end} <= ${refined.start}`);

      // Crucial test: NO word in allWords straddles the cut point!
      for (const w of allWords) {
        // Cut point cannot land strictly between a word's start and end
        const cutsThroughStart = refined.start > w.start && refined.start < w.end;
        const cutsThroughEnd = refined.end > w.start && refined.end < w.end;
        assert.equal(cutsThroughStart, false, `Refined start ${refined.start} cuts inside word [${w.start}, ${w.end}]`);
        assert.equal(cutsThroughEnd, false, `Refined end ${refined.end} cuts inside word [${w.start}, ${w.end}]`);
      }
    }
  });
});
