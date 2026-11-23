import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateASS, formatASSTime, escapeASSText } from '../src/subtitles.js';
import { CAPTION_PRESETS } from '../src/captions/presets.js';
import { loadFixture } from './helpers/fixtures.js';

describe('Caption ASS Engine (Step 2)', () => {
  const sampleWords = [
    { word: 'Create', start: 0.1, end: 0.4 },
    { word: 'viral', start: 0.45, end: 0.8 },
    { word: 'shorts', start: 0.85, end: 1.2 },
    { word: 'instantly', start: 1.25, end: 1.8 },
  ];

  it('1. output contains [Script Info], [V4+ Styles], and [Events] sections', () => {
    const ass = generateASS(sampleWords, 'hormozi');
    assert.ok(ass.includes('[Script Info]'), 'Must contain [Script Info]');
    assert.ok(ass.includes('[V4+ Styles]'), 'Must contain [V4+ Styles]');
    assert.ok(ass.includes('[Events]'), 'Must contain [Events]');
    assert.ok(ass.includes('PlayResX: 1080'), 'Must target 1080 canvas');
    assert.ok(ass.includes('PlayResY: 1920'), 'Must target 1920 canvas');
  });

  it('2. every preset (all 8) produces valid ASS script structure', () => {
    const presets = ['hormozi', 'neon', 'karaoke', 'minimal', 'box', 'cinematic', 'pop', 'underline'];

    for (const presetId of presets) {
      assert.ok(CAPTION_PRESETS[presetId], `Preset ${presetId} must exist in CAPTION_PRESETS`);
      const ass = generateASS(sampleWords, presetId);
      assert.ok(ass.includes('Style: Default,'), `Preset ${presetId} must define Default style`);
      assert.ok(ass.includes('Style: Devanagari,'), `Preset ${presetId} must define Devanagari style`);
      assert.ok(ass.includes('Dialogue: 0,'), `Preset ${presetId} must have Dialogue events`);
    }
  });

  it('3. dialogue timestamps are strictly non-decreasing and valid centiseconds', () => {
    const ass = generateASS(sampleWords, 'hormozi');
    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));
    assert.ok(dialogueLines.length > 0);

    const timeRegex = /^\d+:\d{2}:\d{2}\.\d{2}$/;

    for (const line of dialogueLines) {
      const parts = line.split(',');
      const startStr = parts[1];
      const endStr = parts[2];

      assert.match(startStr, timeRegex, `Start time ${startStr} must match ASS format`);
      assert.match(endStr, timeRegex, `End time ${endStr} must match ASS format`);

      const parseSec = (t) => {
        const [h, m, sc] = t.split(':');
        const [s, c] = sc.split('.');
        return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(c) / 100;
      };

      const startSec = parseSec(startStr);
      const endSec = parseSec(endStr);
      assert.ok(startSec <= endSec, `Start (${startStr}) must be <= End (${endStr})`);
    }
  });

  it('4. escapes backslashes and curly braces in text (no injection possible)', () => {
    const maliciousWords = [
      { word: 'Test{\\b1}injection', start: 0.0, end: 0.5 },
      { word: 'and\\Nnewline', start: 0.55, end: 1.0 },
      { word: '}closed{', start: 1.05, end: 1.5 },
    ];

    const ass = generateASS(maliciousWords, 'minimal');
    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));

    for (const line of dialogueLines) {
      const textPart = line.split(',').slice(9).join(',');
      // Unescaped literal braces in word text should be replaced with fullwidth
      assert.ok(!textPart.includes('Test{\\b1}'));
      assert.ok(textPart.includes('Test｛/b1｝') || !textPart.includes('Test{'));
    }
  });

  it('5. Devanagari lines select the Devanagari style with Noto Sans Devanagari font', () => {
    const hiFixture = loadFixture('hi');
    const hiWords = hiFixture.segments[0].words;
    const ass = generateASS(hiWords, 'hormozi');

    assert.ok(ass.includes('Style: Devanagari,Noto Sans Devanagari,'), 'Must define Noto Sans Devanagari');

    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));
    assert.ok(dialogueLines.length > 0);

    // Lines containing Hindi text must reference Devanagari style
    const hindiLine = dialogueLines.find(l => /[\u0900-\u097F]/.test(l));
    assert.ok(hindiLine, 'Should have at least one Hindi dialogue line');
    assert.ok(hindiLine.includes(',Devanagari,'), 'Hindi line must use Devanagari style');
  });

  it('6. Karaoke style outputs valid \\k tags', () => {
    const ass = generateASS(sampleWords, 'karaoke');
    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));
    assert.ok(dialogueLines.length > 0);
    assert.ok(dialogueLines[0].includes('{\\k'), 'Karaoke dialogue must contain \\k tags');
  });

  it('7. Pop style outputs dynamic scale tags', () => {
    const ass = generateASS(sampleWords, 'pop');
    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));
    assert.ok(dialogueLines.length > 0);
    assert.ok(dialogueLines[0].includes('\\t('), 'Pop style must contain \\t animation tags');
  });

  it('8. Underline style outputs \\u1 tags', () => {
    const ass = generateASS(sampleWords, 'underline');
    const dialogueLines = ass.split('\n').filter(l => l.startsWith('Dialogue: '));
    assert.ok(dialogueLines.length > 0);
    assert.ok(dialogueLines[0].includes('\\u1'), 'Underline style must contain \\u1 tag');
  });
});
