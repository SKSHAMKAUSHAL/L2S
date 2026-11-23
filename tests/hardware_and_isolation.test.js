// =============================================
// Tests: Hardware Auto-Detection & Strict Cloud Isolation
// =============================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectHardwareAndRecommendedModel } from '../src/ai/hardware_detector.js';
import { aiRegistry } from '../src/ai/registry.js';
import { buildASSScript, formatASSTime } from '../src/captions/ass_builder.js';
import { generateSRT, generateASS } from '../src/subtitles.js';

describe('Hardware Auto-Detection Engine', () => {
  it('detects host hardware specs accurately', () => {
    const hw = detectHardwareAndRecommendedModel();
    assert.ok(hw, 'Hardware info should exist');
    assert.ok(hw.cpu.cores > 0, 'CPU cores should be greater than 0');
    assert.ok(hw.ram.totalGB > 0, 'Total RAM should be greater than 0');
    assert.ok(typeof hw.gpu.hasNvidia === 'boolean', 'GPU detection should report boolean');
    assert.ok(['llama3.2:1b', 'llama3.2:3b', 'llama3.1:8b'].includes(hw.recommendedModel), 'Should recommend a known Ollama model');
  });

  it('provides a descriptive reason for model choice', () => {
    const hw = detectHardwareAndRecommendedModel();
    assert.ok(hw.reason && hw.reason.length > 10, 'Reason should be detailed');
    assert.ok(hw.tier, 'Tier should be specified');
  });
});

describe('Strict Cloud Model Isolation & Key Guards', () => {
  it('strictly reports unconfigured status when cloud key is missing', async () => {
    aiRegistry.setActiveLLM('groq');
    const groq = aiRegistry.getLLMProvider('groq');
    const wasKey = groq.apiKey;
    
    // Temporarily clear key
    groq.apiKey = '';
    assert.equal(groq.isConfigured(), false);

    // Attempting generation should reject with missing key error
    await assert.rejects(
      async () => {
        await groq.generateStructuredJSON({ systemPrompt: 'test', prompt: 'test' });
      },
      /Groq API Key is missing/i
    );

    // Restore key if any
    groq.apiKey = wasKey;
    aiRegistry.setActiveLLM('ollama');
  });

  it('updates provider key dynamically through registry', () => {
    const success = aiRegistry.updateProviderKey('groq', 'gsk_dummy_test_key_12345');
    assert.equal(success, true);
    const groq = aiRegistry.getLLMProvider('groq');
    assert.equal(groq.apiKey, 'gsk_dummy_test_key_12345');
    assert.equal(groq.isConfigured(), true);

    // Clean up
    groq.apiKey = process.env.GROQ_API_KEY || '';
  });
});

describe('Subtitle Formats Comparison & Precision (.SRT vs .ASS)', () => {
  const sampleWords = [
    { word: 'Hello', start: 0.0, end: 0.5 },
    { word: 'world', start: 0.5, end: 1.0 },
    { word: 'viral', start: 1.0, end: 1.6 },
  ];

  it('generates standard SubRip .SRT format', () => {
    const srt = generateSRT(sampleWords);
    assert.ok(srt.includes('1'), 'Should have index 1');
    assert.ok(srt.includes('-->'), 'Should have arrow separator');
    assert.ok(srt.includes('Hello'), 'Text should contain spoken words');
  });

  it('generates Advanced SubStation Alpha .ASS format with styling and coordinates', () => {
    const ass = buildASSScript(sampleWords, 'bold');
    assert.ok(ass.includes('[Script Info]'), 'Must include Script Info header');
    assert.ok(ass.includes('[V4+ Styles]'), 'Must include V4+ Styles section');
    assert.ok(ass.includes('[Events]'), 'Must include Events section');
    assert.ok(ass.includes('PlayResX: 1080'), 'Must specify vertical resolution');
    assert.ok(ass.includes('Dialogue:'), 'Must include dialogue event lines');
  });
});
