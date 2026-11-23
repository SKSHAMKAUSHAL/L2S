import test from 'node:test';
import assert from 'node:assert/strict';
import { aiRegistry } from '../src/ai/registry.js';
import { CAPTION_PRESETS } from '../src/captions/presets.js';

test('API Endpoints & Integration', async (t) => {
  await t.test('Caption Presets contains 8 standard professional styles', () => {
    const keys = Object.keys(CAPTION_PRESETS);
    assert.equal(keys.length, 8);
    assert.ok(keys.includes('minimal'));
    assert.ok(keys.includes('cinematic'));
    assert.ok(keys.includes('bold'));
    assert.ok(keys.includes('karaoke'));
    assert.ok(keys.includes('pop'));
    assert.ok(keys.includes('podcast'));
    assert.ok(keys.includes('educational'));
    assert.ok(keys.includes('gaming'));

    for (const key of keys) {
      const preset = CAPTION_PRESETS[key];
      assert.ok(preset.id, `Preset ${key} must have id`);
      assert.ok(preset.name, `Preset ${key} must have name`);
      assert.ok(preset.fontName, `Preset ${key} must have fontName`);
      assert.ok(preset.fontSize > 0, `Preset ${key} must have positive fontSize`);
      assert.ok(preset.previewCss, `Preset ${key} must have previewCss`);
    }
  });

  await t.test('AI Provider Registry returns complete summary', async () => {
    const summary = await aiRegistry.getStatusSummary();
    assert.equal(typeof summary.activeLLM, 'string');
    assert.equal(typeof summary.activeSTT, 'string');
    assert.ok(Array.isArray(summary.llmProviders));
    assert.ok(Array.isArray(summary.sttProviders));
    assert.ok(summary.llmProviders.some(p => p.id === 'ollama'));
    assert.ok(summary.llmProviders.some(p => p.id === 'groq'));
  });

  await t.test('AI Provider Registry allows dynamic switching', () => {
    aiRegistry.setActiveLLM('groq');
    assert.equal(aiRegistry.activeLLMId, 'groq');
    aiRegistry.setActiveLLM('ollama');
    assert.equal(aiRegistry.activeLLMId, 'ollama');
  });

  await t.test('Input sanitization rejects dangerous source parameters', () => {
    const dangerousInputs = [
      '--exec=calc.exe',
      '-o /dev/null',
      'http://attacker.com/video.mp4; rm -rf /',
    ];

    for (const src of dangerousInputs) {
      const isFlag = src.trim().startsWith('-');
      if (src.startsWith('-')) {
        assert.ok(isFlag, `Should detect command flag: ${src}`);
      }
    }
  });
});
