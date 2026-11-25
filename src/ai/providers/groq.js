// =============================================
// L2S — Groq Cloud LLM Provider Adapter
// =============================================

import { BaseLLMProvider, extractAndParseJSON, maskApiKey } from '../contracts.js';

const PREFERRED_CHAT_MODELS = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

function isChatModel(id = '') {
  const lower = id.toLowerCase();
  return (
    !lower.includes('whisper') &&
    !lower.includes('guard') &&
    !lower.includes('orpheus') &&
    !lower.includes('tts') &&
    !lower.includes('safeguard')
  );
}

export class GroqProvider extends BaseLLMProvider {
  constructor(config = {}) {
    const model = config.model || process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    super('groq', 'Groq Cloud (Ultra-Fast LPUs)', 'cloud', model);

    this.apiKey = typeof config.apiKey === 'string' ? config.apiKey : (process.env.GROQ_API_KEY || '');
    this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  }

  getApiKey() {
    return (this.apiKey !== undefined ? this.apiKey : (process.env.GROQ_API_KEY || '')).trim();
  }

  getMaskedKey() {
    return maskApiKey(this.getApiKey());
  }

  isConfigured() {
    return Boolean(this.getApiKey().length > 0);
  }

  async testConnection() {
    const key = this.getApiKey();
    if (!key) {
      return {
        ok: false,
        available: false,
        model: this.model,
        error: 'GROQ_API_KEY is not configured',
        warning: 'GROQ_API_KEY is missing. Add it to .env or update in Settings.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          available: false,
          model: this.model,
          error: `Groq Authentication Failed (${res.status}): ${errText.slice(0, 100)}`,
          warning: 'Groq API rejected authentication. Check that your GROQ_API_KEY is valid.',
        };
      }

      const data = await res.json();
      const models = Array.isArray(data.data) ? data.data.map(m => m.id) : [];

      // If current model isn't in available models, pick highest priority live chat LLM
      if (models.length > 0 && !models.includes(this.model)) {
        const preferredMatch = PREFERRED_CHAT_MODELS.find(pm => models.includes(pm));
        const fallbackMatch = models.find(isChatModel);
        const chatModel = preferredMatch || fallbackMatch || models[0];
        if (chatModel) this.model = chatModel;
      }

      return {
        ok: true,
        available: true,
        model: this.model,
        availableModels: models,
        warning: null,
      };
    } catch (e) {
      return {
        ok: false,
        available: false,
        model: this.model,
        error: e.name === 'AbortError' ? 'Connection timed out' : e.message,
        warning: 'Could not connect to Groq Cloud API. Verify your internet connection.',
      };
    }
  }

  async fetchAvailableModels() {
    const key = this.getApiKey();
    if (!key) return [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data.data)) return [];
      // Filter to chat/LLM models (exclude audio, TTS, and prompt-guard models)
      return data.data.map(m => m.id).filter(isChatModel);
    } catch (e) {
      return [
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
      ];
    }
  }

  async generateText({ systemPrompt, prompt, timeoutMs = 45000, temperature = 0.3, maxTokens = 1500 }) {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Groq API Key is missing. Add GROQ_API_KEY to your .env file or settings.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (res.status === 429) {
          throw new Error(`Groq rate limit exceeded (HTTP 429): ${errText.slice(0, 150)}`);
        }
        throw new Error(`Groq API Error (${res.status}): ${errText}`);
      }
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || '').trim();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Groq request timed out');
      }
      throw err;
    }
  }

  async generateStructuredJSON({ systemPrompt, prompt, schema = null, timeoutMs = 45000, temperature = 0.2, maxTokens = 1500 }) {
    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\nIMPORTANT: Return ONLY valid JSON (no markdown fences, no explanatory text).`
      : 'Return ONLY valid JSON.';

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
      throw new Error(`Groq returned malformed JSON: ${parseErr.message} — Raw output: ${raw.slice(0, 150)}`);
    }
  }
}
