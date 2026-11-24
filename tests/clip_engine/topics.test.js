import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentTopics } from '../../src/clip_engine/topics.js';

test('Clip Engine: topics.js', async (t) => {
  await t.test('splits synthetic transcript with 3 clearly distinct topics into 3 segments', () => {
    // 3 distinct topics, each lasting 35-40 seconds
    const sentences = [
      // Topic 1: Cooking (sentences 0 to 8)
      { id: 'S0', start: 0, end: 4, text: 'Today we are cooking Italian pasta in the kitchen.' },
      { id: 'S1', start: 4, end: 8, text: 'We prepare the fresh tomato sauce and olive oil.' },
      { id: 'S2', start: 8, end: 12, text: 'Boil the noodles until they are perfectly al dente.' },
      { id: 'S3', start: 12, end: 16, text: 'Add garlic, oregano, and grated parmesan cheese.' },
      { id: 'S4', start: 16, end: 20, text: 'Simmer the sauce gently in the saucepan.' },
      { id: 'S5', start: 20, end: 24, text: 'Toss the pasta with the rich homemade sauce.' },
      { id: 'S6', start: 24, end: 28, text: 'Garnish with fresh basil leaves and pepper.' },
      { id: 'S7', start: 28, end: 32, text: 'Serve this delicious meal hot to dinner guests.' },
      { id: 'S8', start: 32, end: 36, text: 'That finishes our complete culinary cooking guide.' },

      // Topic 2: Space Astronomy (sentences 9 to 17)
      { id: 'S9', start: 40, end: 44, text: 'Now let us turn our eyes toward rocket science and space.' },
      { id: 'S10', start: 44, end: 48, text: 'NASA has launched a powerful mission to explore Mars.' },
      { id: 'S11', start: 48, end: 52, text: 'The rocket reached escape velocity and entered orbit.' },
      { id: 'S12', start: 52, end: 56, text: 'Astronomers detected distant galaxies with the telescope.' },
      { id: 'S13', start: 56, end: 60, text: 'Gravity pulls celestial bodies toward the black hole.' },
      { id: 'S14', start: 60, end: 64, text: 'Cosmic radiation and solar flares threaten astronauts.' },
      { id: 'S15', start: 64, end: 68, text: 'Satellite telemetry transmits photos of the red planet.' },
      { id: 'S16', start: 68, end: 72, text: 'Interstellar travel represents humanity great frontier.' },
      { id: 'S17', start: 72, end: 76, text: 'Space exploration reveals cosmic secrets of astrophysics.' },

      // Topic 3: Personal Finance (sentences 18 to 26)
      { id: 'S18', start: 80, end: 84, text: 'Switching subjects completely, let us discuss investing money.' },
      { id: 'S19', start: 84, end: 88, text: 'Compound interest can grow your retirement portfolio.' },
      { id: 'S20', start: 88, end: 92, text: 'Always diversify your index funds and dividend stocks.' },
      { id: 'S21', start: 92, end: 96, text: 'Track your monthly budget and reduce high interest debt.' },
      { id: 'S22', start: 96, end: 100, text: 'Open a high yield savings account for emergency funds.' },
      { id: 'S23', start: 100, end: 104, text: 'Financial independence comes from consistent wealth accumulation.' },
      { id: 'S24', start: 104, end: 108, text: 'Analyze market valuation ratios before purchasing shares.' },
      { id: 'S25', start: 108, end: 112, text: 'Passive income cashflow protects your financial future.' },
      { id: 'S26', start: 112, end: 116, text: 'Building smart financial habits guarantees long term wealth.' },
    ];

    const topics = segmentTopics(sentences, { blockSize: 4, minSegmentDuration: 25 });
    assert.equal(topics.length, 3);
    assert.equal(topics[0].id, 'T0');
    assert.equal(topics[1].id, 'T1');
    assert.equal(topics[2].id, 'T2');
    assert.ok(topics[0].end <= 40);
    assert.ok(topics[1].end <= 80);
    assert.ok(topics[2].end >= 110);
  });

  await t.test('merges segments shorter than 30 seconds', () => {
    const sentences = [
      { id: 'S0', start: 0, end: 5, text: 'First sentence of brief introduction.' },
      { id: 'S1', start: 5, end: 10, text: 'Second sentence of brief introduction.' },
      { id: 'S2', start: 10, end: 15, text: 'Third sentence of brief introduction.' },
    ];

    const topics = segmentTopics(sentences, { minSegmentDuration: 30 });
    assert.equal(topics.length, 1);
    assert.equal(topics[0].id, 'T0');
    assert.equal(topics[0].start, 0);
    assert.equal(topics[0].end, 15);
  });
});
