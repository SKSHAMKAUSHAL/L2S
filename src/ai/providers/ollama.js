// =============================================
// L2S — Ollama Local LLM Provider Adapter
// =============================================

import { BaseLLMProvider, extractAndParseJSON } from '../contracts.js';
import { detectHardwareAndRecommendedModel } from '../hardware_detector.js';

export class OllamaProvider extends BaseLLMProvider {
  constructor(config = {}) {
    const hw = detectHardwareAndRecommendedModel();
    const model = config.model || process.env.MODEL || hw.recommendedModel || 'llama3.2:3b';
    super('ollama', 'Ollama (Local AI)', 'local', model);

    this.url = config.url || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.hardware = hw;
  }

  isConfigured() {
    return true; // Always considered configured since it runs locally
  }

  async testConnection() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.url}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          ok: false,
          available: false,
          model: this.model,
          error: `Ollama returned HTTP ${res.status}`,
          warning: 'Ollama returned an error status. Verify daemon health.',
          hardware: this.hardware,
        };
      }

      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      const modelPresent = models.some(m => m.startsWith(this.model) || m.includes(this.model));

      return {
        ok: true,
        available: true,
        model: this.model,
        installedModels: models,
        modelInstalled: modelPresent,
        warning: modelPresent ? null : `Model '${this.model}' is not pulled in Ollama. Run: ollama pull ${this.model}`,
        hardware: this.hardware,
      };
    } catch (e) {
      return {
        ok: false,
        available: false,
        model: this.model,
        error: e.name === 'AbortError' ? 'Connection timed out' : 'Ollama not running',
        warning: 'Ollama daemon is not running. Start it with: ollama serve',
        hardware: this.hardware,
      };
    }
  }

  async fetchAvailableModels() {
    try {
      const res = await fetch(`${this.url}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const installed = (data.models || []).map(m => m.name);
        if (installed.length > 0) return installed;
      }
    } catch (e) {
      // Fallback defaults if daemon is offline
    }
    return ['llama3.2:3b', 'llama3.2:1b', 'llama3.1:8b', 'mistral:7b', 'qwen2.5:7b', 'gemma2:2b'];
  }

  async generateText({ systemPrompt, prompt, timeoutMs = 60000, temperature = 0.25, maxTokens = 1200 }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      };
      if (systemPrompt) body.system = systemPrompt;

      const res = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}${errText ? ' — ' + errText.slice(0, 200) : ''}`);
      }

      const data = await res.json();
      return (data.response || '').trim();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`Ollama timed out after ${Math.round(timeoutMs / 1000)}s. Is Ollama running? Try: ollama serve`);
      }
      throw err;
    }
  }

  async generateStructuredJSON({ systemPrompt, prompt, schema = null, timeoutMs = 60000, temperature = 0.2, maxTokens = 1200 }) {
    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\nIMPORTANT: Return ONLY valid JSON (no markdown, no code fences, no extra text).`
      : 'Return ONLY a valid JSON array or object. No markdown, no explanations.';

    const raw = await this.generateText({
      systemPrompt: fullSystem,
      prompt,
      timeoutMs,
      temperature,
      maxTokens,
    });

    try {
      return extractAndParseJSON(raw);
    } catch (parseErr) {
      throw new Error(`Ollama returned malformed JSON: ${parseErr.message} — Raw output: ${raw.slice(0, 150)}`);
    }
  }
}
