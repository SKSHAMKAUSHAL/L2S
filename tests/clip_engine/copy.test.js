import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHashtags, formatHook, generateClipsCopy } from '../../src/clip_engine/copy.js';

test('Clip Engine: copy.js', async (t) => {
  await t.test('enforces hashtag rules: count 5-8, lowercase, deduped, structure with broad + genre', () => {
    const rawTags = ['#SHORTS', '#viral', '#shorts', 'mindset tips', '#MOTIVATION', 'grind_hard'];
    const normalized = normalizeHashtags(rawTags, 'motivational');

    assert.ok(normalized.length >= 5 && normalized.length <= 8);
    assert.ok(normalized.includes('#shorts'));
    assert.ok(normalized.includes('#viral'));
    assert.ok(normalized.includes('#motivational'));

    // Check lowercase, no spaces
    for (const tag of normalized) {
      assert.ok(tag.startsWith('#'));
      assert.equal(tag, tag.toLowerCase());
      assert.equal(tag.includes(' '), false);
    }

    // Check no duplicates
    const set = new Set(normalized);
    assert.equal(set.size, normalized.length);
  });

  await t.test('formats hook: 3-7 words, uppercase for English, preserves Hindi script', () => {
    const enHook = formatHook('This is an unbelievable secret you must see today right now', 'en');
    const enWords = enHook.split(/\s+/);
    assert.ok(enWords.length >= 3 && enWords.length <= 7);
    assert.equal(enHook, enHook.toUpperCase());

    const hiHook = formatHook('यह सबसे बड़ा रहस्य है जो सब छुपाते हैं', 'hi');
    const hiWords = hiHook.split(/\s+/);
    assert.ok(hiWords.length >= 3 && hiWords.length <= 7);
    assert.ok(/[\u0900-\u097F]/.test(hiHook));
  });

  await t.test('generates social copy for selected clips with mocked Groq client', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  clips: [{
                    clipId: 'c1',
                    hook: 'STOP MAKING THIS MISTAKE',
                    title: 'The Real Reason You Are Not Growing',
                    description: 'Most creators miss this fundamental shift. Have you tried this?',
                    hashtags: ['#shorts', '#viral', '#growth', '#mindset', '#success', '#creator'],
                  }],
                }),
              },
            }],
            usage: { total_tokens: 180 },
          }),
        },
      },
    };

    const clips = [{
      id: 'c1',
      text: 'Stop making this mistake if you want to grow.',
      hookSentence: 'Stop making this mistake.',
      language: 'en',
    }];

    const results = await generateClipsCopy(clips, { genre: 'motivational', llmClient: mockClient });
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'The Real Reason You Are Not Growing');
    assert.equal(results[0].hook, 'STOP MAKING THIS MISTAKE');
    assert.ok(results[0].hashtags.length >= 5);
  });
});
