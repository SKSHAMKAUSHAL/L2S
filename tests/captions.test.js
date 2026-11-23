import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CAPTION_PRESETS, getCaptionPreset } from '../src/captions/presets.js';
import { buildASSScript, formatASSTime } from '../src/captions/ass_builder.js';
import { generateSRT, generateASS } from '../src/subtitles.js';

describe('Professional Caption Studio & ASS Engine', () => {
  const sampleWords = [
    { word: 'This', start: 0.1, end: 0.4 },
    { word: 'is', start: 0.4, end: 0.6 },
    { word: 'the', start: 0.6, end: 0.8 },
    { word: 'most', start: 0.8, end: 1.2 },
    { word: 'incredible', start: 1.2, end: 1.8 },
    { word: 'viral', start: 1.8, end: 2.3 },
    { word: 'secret.', start: 2.3, end: 2.9 },
  ];

  test('provides all 8 professional caption presets', () => {
    const requiredPresets = ['minimal', 'cinematic', 'hormozi', 'karaoke', 'pop', 'box', 'underline', 'neon'];
    for (const key of requiredPresets) {
      const preset = CAPTION_PRESETS[key];
      assert.ok(preset, `Preset '${key}' must exist`);
      assert.ok(preset.fontName, `Preset '${key}' must specify a fontName`);
      assert.ok(preset.fontSize > 0, `Preset '${key}' must have positive fontSize`);
      assert.ok(preset.previewCss, `Preset '${key}' must include preview CSS`);
    }
  });

  test('formats ASS timestamps with centisecond precision', () => {
    assert.strictEqual(formatASSTime(0), '0:00:00.00');
    assert.strictEqual(formatASSTime(5.5), '0:00:05.50');
    assert.strictEqual(formatASSTime(65.123), '0:01:05.12');
    assert.strictEqual(formatASSTime(3665.75), '1:01:05.75');
  });

  test('generates valid ASS script structure with v4.00+ header and events', () => {
    const script = buildASSScript(sampleWords, 'bold');
    assert.ok(script.includes('[Script Info]'));
    assert.ok(script.includes('PlayResX: 1080'));
    assert.ok(script.includes('PlayResY: 1920'));
    assert.ok(script.includes('[V4+ Styles]'));
    assert.ok(script.includes('[Events]'));
    assert.ok(script.includes('Dialogue:'));
  });

  test('supports Pop style dynamic word bounce tags', () => {
    const popScript = buildASSScript(sampleWords, 'pop');
    assert.ok(popScript.includes('\\fscx125\\fscy125'));
    assert.ok(popScript.includes('SECRET'));
  });

  test('generateSRT creates standard subtitle blocks with index and arrows', () => {
    const srt = generateSRT(sampleWords);
    assert.ok(srt.includes('1'));
    assert.ok(srt.includes('-->'));
    assert.ok(srt.includes('This is the most'));
  });
});
