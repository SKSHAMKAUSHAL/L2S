import test from 'node:test';
import assert from 'node:assert/strict';
import * as subtitles from '../src/subtitles.js';
import * as scorer from '../src/scorer.js';
import * as segmenter from '../src/segmenter.js';
import { loadEnglishTranscript, loadHindiTranscript, loadHinglishTranscript } from './helpers/fixtures.js';

test('Smoke Test: core exports exist and basic ASS generation functions', async (t) => {
  await t.test('asserts exported functions in subtitles, scorer, and segmenter exist', () => {
    assert.equal(typeof subtitles.generateASS, 'function', 'generateASS must exist');
    assert.equal(typeof subtitles.generateSRT, 'function', 'generateSRT must exist');
    assert.equal(typeof scorer.scoreSegment, 'function', 'scoreSegment must exist');
    assert.equal(typeof scorer.scoreSegments, 'function', 'scoreSegments must exist');
    assert.equal(typeof segmenter.generateCandidateSegments, 'function', 'generateCandidateSegments must exist');
  });

  await t.test('generates ASS from a tiny hard-coded word list and asserts output has [Events] and Dialogue', () => {
    const tinyWords = [
      { word: 'Hello', start: 0.1, end: 0.5 },
      { word: 'world', start: 0.5, end: 1.0 },
      { word: 'testing', start: 1.0, end: 1.6 }
    ];

    const ass = subtitles.generateASS(tinyWords, 'hormozi', 0);
    assert.ok(ass.includes('[Events]'), 'Output must contain [Events]');
    assert.ok(ass.includes('Dialogue:'), 'Output must contain at least one Dialogue line');
  });

  await t.test('verifies all three test fixtures load correctly', () => {
    const en = loadEnglishTranscript();
    const hi = loadHindiTranscript();
    const hinglish = loadHinglishTranscript();

    assert.equal(en.language, 'en');
    assert.ok(en.words.length >= 30, 'English fixture has ~40 words');
    assert.equal(hi.language, 'hi');
    assert.ok(hi.words.length >= 30, 'Hindi fixture has ~40 words');
    assert.equal(hinglish.language, 'hi');
    assert.ok(hinglish.words.length >= 30, 'Hinglish fixture has ~40 words');
  });
});
