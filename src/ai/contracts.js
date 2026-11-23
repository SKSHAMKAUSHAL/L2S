// =============================================
// L2S — AI Provider Capability Contracts & Interfaces
// =============================================
// Formal contracts for LLM text generation, speech-to-text,
// and health/availability reporting. Strictly supports
// 'ollama' (local) and 'groq' (cloud) for LLM inference.

/**
 * Valid LLM Provider IDs
 */
export const VALID_LLM_PROVIDERS = Object.freeze(['ollama', 'groq']);

/**
 * Valid STT Provider IDs
 */
export const VALID_STT_PROVIDERS = Object.freeze(['local_whisper', 'groq_whisper']);

/**
 * Base LLM Provider Contract
 */
export class BaseLLMProvider {
  constructor(id, name, type, model) {
    if (!VALID_LLM_PROVIDERS.includes(id)) {
      throw new Error(`Invalid LLM provider ID: '${id}'. Only 'ollama' and 'groq' are supported.`);
    }
    this.id = id;
    this.name = name;
    this.type = type; // 'local' | 'cloud'
    this.model = model;
  }

  isConfigured() {
    throw new Error('isConfigured() must be implemented by provider');
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  async fetchAvailableModels() {
    throw new Error('fetchAvailableModels() must be implemented by provider');
  }

  async generateText({ systemPrompt, prompt, timeoutMs, temperature, maxTokens }) {
    throw new Error('generateText() must be implemented by provider');
  }

  async generateStructuredJSON({ systemPrompt, prompt, schema, timeoutMs, temperature, maxTokens }) {
    throw new Error('generateStructuredJSON() must be implemented by provider');
  }
}

/**
 * Base STT Provider Contract
 */
export class BaseSTTProvider {
  constructor(id, name, type, model) {
    if (!VALID_STT_PROVIDERS.includes(id)) {
      throw new Error(`Invalid STT provider ID: '${id}'. Only 'local_whisper' and 'groq_whisper' are supported.`);
    }
    this.id = id;
    this.name = name;
    this.type = type; // 'local' | 'cloud'
    this.model = model;
  }

  isConfigured() {
    throw new Error('isConfigured() must be implemented by provider');
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  async transcribe(audioPath, onProgress, options = {}) {
    throw new Error('transcribe() must be implemented by provider');
  }
}

/**
 * Utility to mask secrets safely (e.g., gsk_1234567890 -> gsk_***7890)
 */
export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Utility to extract and parse JSON array or object from text safely
 */
export function extractAndParseJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Cannot parse JSON from empty or non-string response');
  }

  let cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (match) {
    cleaned = match[0];
  }

  return JSON.parse(cleaned);
}
