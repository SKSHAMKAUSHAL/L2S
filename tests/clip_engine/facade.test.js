import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAndSelectClips } from '../../src/ranker.js';
import { runClipEngine } from '../../src/clip_engine/index.js';

test('Clip Engine: facade.js and Determinism', async (t) => {
  const dummyTranscript = {
    language: 'en',
    words: [
      { word: 'Why', start: 0.0, end: 0.4 },
      { word: 'do', start: 0.4, end: 0.7 },
      { word: 'most', start: 0.7, end: 1.1 },
      { word: 'people', start: 1.1, end: 1.5 },
      { word: 'fail?', start: 1.5, end: 2.0 },
      { word: 'Because', start: 2.1, end: 2.8 },
      { word: 'they', start: 2.8, end: 3.2 },
      { word: 'quit', start: 3.2, end: 3.8 },
      { word: 'too', start: 3.8, end: 4.2 },
      { word: 'early.', start: 4.2, end: 5.0 },
      { word: 'Consistency', start: 5.5, end: 6.8 },
      { word: 'always', start: 6.8, end: 7.5 },
      { word: 'beats', start: 7.5, end: 8.2 },
      { word: 'raw', start: 8.2, end: 8.8 },
      { word: 'talent.', start: 8.8, end: 10.0 },
      { word: 'Never', start: 10.5, end: 11.2 },
      { word: 'give', start: 11.2, end: 12.0 },
      { word: 'up', start: 12.0, end: 13.0 },
      { word: 'on', start: 13.0, end: 13.8 },
      { word: 'your', start: 13.8, end: 14.5 },
      { word: 'greatest', start: 14.5, end: 15.5 },
      { word: 'dreams.', start: 15.5, end: 17.0 },
      { word: 'Work', start: 17.5, end: 18.2 },
      { word: 'hard', start: 18.2, end: 19.0 },
      { word: 'every', start: 19.0, end: 19.8 },
      { word: 'single', start: 19.8, end: 20.5 },
      { word: 'day.', start: 20.5, end: 22.0 },
    ],
    segments: [
      { start: 0, end: 22, text: 'Why do most people fail? Because they quit too early. Consistency always beats raw talent. Never give up on your greatest dreams. Work hard every single day.', words: [] },
    ],
  };

  const mockClient = {
    chat: {
      completions: {
        create: async (params) => {
          // If proposing candidates
          if (params.messages[0].content.includes('virality analyst')) {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    candidates: [{
                      startSentence: 'S0',
                      endSentence: 'S3',
                      hookSentence: 'Why do most people fail?',
                      setupSentence: 'Because they quit too early.',
                      payoffSentence: 'Never give up.',
                      reason: 'Strong psychological contrast and hook.',
                      subscores: { hook: 95, payoff: 90, emotion: 85, standalone: 90, novelty: 80 },
                      language: 'en',
                    }],
                  }),
                },
              }],
              usage: { total_tokens: 120 },
            };
          }

          // If generating copy
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  clips: [{
                    clipId: 'prop_0',
                    hook: 'WHY DO MOST PEOPLE FAIL',
                    title: 'The Real Reason People Give Up',
                    description: 'Consistency beats raw talent every single time. Do you agree?',
                    hashtags: ['#shorts', '#viral', '#motivational', '#mindset', '#success'],
                  }],
                }),
              },
            }],
            usage: { total_tokens: 110 },
          };
        },
      },
    },
  };

  await t.test('rankAndSelectClips facade preserves expected legacy field names', async () => {
    const scoredSegments = [{
      id: 'seg_0',
      start: 0,
      end: 8,
      text: 'Why do most people fail? Because they quit too early.',
      words: dummyTranscript.words,
      heuristic: { total: 75 },
    }];

    const clips = await rankAndSelectClips(scoredSegments, 'motivational', 1, null, null, {
      transcript: dummyTranscript,
      llmClient: mockClient,
    });

    assert.ok(clips.length >= 1);
    const clip = clips[0];

    // Assert all required fields
    assert.equal(typeof clip.start, 'number');
    assert.equal(typeof clip.end, 'number');
    assert.equal(typeof clip.text, 'string');
    assert.ok(Array.isArray(clip.words));
    assert.equal(typeof clip.heuristicScore, 'number');
    assert.ok(clip.combinedScore !== undefined);
    assert.equal(typeof clip.justification, 'string');
    assert.equal(typeof clip.hookCaption, 'string');
    assert.equal(typeof clip.title, 'string');
    assert.ok(clip.scoreBreakdown !== undefined);
  });

  await t.test('fallback path works gracefully when LLM fails', async () => {
    const mockFailingClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('Groq rate limited 429');
          },
        },
      },
    };

    const clips = await runClipEngine(dummyTranscript, {
      genre: 'motivational',
      clipCount: 1,
      llmClient: mockFailingClient,
    });

    assert.ok(Array.isArray(clips));
  });

  await t.test('determinism: same input with temperature 0 yields identical output twice', async () => {
    const run1 = await runClipEngine(dummyTranscript, {
      genre: 'motivational',
      clipCount: 1,
      llmClient: mockClient,
    });

    const run2 = await runClipEngine(dummyTranscript, {
      genre: 'motivational',
      clipCount: 1,
      llmClient: mockClient,
    });

    assert.deepEqual(run1, run2);
  });
});
