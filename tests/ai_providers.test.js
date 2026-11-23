import { test, describe } from 'node:test';
import assert from 'node:assert';
import { aiRegistry } from '../src/ai/registry.js';
import { OllamaProvider } from '../src/ai/providers/ollama.js';
import { GroqProvider } from '../src/ai/providers/groq.js';

describe('Model-Independent AI Architecture & Registry', () => {
  test('initializes default LLM and STT providers', () => {
    const activeLLM = aiRegistry.getLLMProvider();
    assert.ok(activeLLM, 'Should have an active LLM provider');
    assert.strictEqual(activeLLM.id, 'ollama');

    const activeSTT = aiRegistry.getSTTProvider();
    assert.ok(activeSTT, 'Should have an active STT provider');
  });

  test('allows switching active LLM provider seamlessly', () => {
    aiRegistry.setActiveLLM('groq');
    assert.strictEqual(aiRegistry.getLLMProvider().id, 'groq');

    // Restore to ollama
    aiRegistry.setActiveLLM('ollama');
    assert.strictEqual(aiRegistry.getLLMProvider().id, 'ollama');
  });

  test('rejects unregistered provider IDs gracefully', () => {
    assert.throws(() => {
      aiRegistry.setActiveLLM('non_existent_provider');
    }, /unknown|not registered/i);
  });

  test('OllamaProvider defaults to llama3.2:3b for RTX 2050 compatibility', () => {
    const provider = new OllamaProvider();
    assert.strictEqual(provider.model, 'llama3.2:3b');
    assert.strictEqual(provider.type, 'local');
    assert.strictEqual(provider.isConfigured(), true);
  });

  test('getStatusSummary provides non-sensitive status report', async () => {
    const summary = await aiRegistry.getStatusSummary();
    assert.ok(Array.isArray(summary.llmProviders));
    assert.ok(Array.isArray(summary.sttProviders));
    assert.ok(summary.llmProviders.some(p => p.id === 'ollama'));
    assert.ok(summary.llmProviders.some(p => p.id === 'groq'));
  });
});
