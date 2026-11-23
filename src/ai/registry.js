// =============================================
// L2S — AI Provider Registry & Abstraction Bus
// =============================================

import '../env.js';
import { VALID_LLM_PROVIDERS, VALID_STT_PROVIDERS } from './contracts.js';
import { OllamaProvider } from './providers/ollama.js';
import { GroqProvider } from './providers/groq.js';
import { GroqWhisperSTT } from './stt/whisper_groq.js';
import { LocalWhisperSTT } from './stt/whisper_local.js';
import { detectHardwareAndRecommendedModel } from './hardware_detector.js';

class AIProviderRegistry {
  constructor() {
    this.llmProviders = new Map();
    this.sttProviders = new Map();

    // Default choices: Ollama for local or Groq if GROQ_API_KEY is available
    this.activeLLMId = 'ollama';
    this.activeSTTId = process.env.GROQ_API_KEY ? 'groq_whisper' : 'local_whisper';

    // Cloud privacy protection (strictly no silent fallback between local and cloud)
    this.allowCloudFallback = false;

    this.registerDefaults();
  }

  registerDefaults() {
    // Strictly register Ollama and Groq only (no unapproved providers)
    this.registerLLM(new OllamaProvider());
    this.registerLLM(new GroqProvider());

    // Register STT Providers
    this.registerSTT(new GroqWhisperSTT());
    this.registerSTT(new LocalWhisperSTT());
  }

  registerLLM(provider) {
    if (!VALID_LLM_PROVIDERS.includes(provider.id)) {
      throw new Error(`Cannot register LLM provider '${provider.id}'. Only 'ollama' and 'groq' are supported.`);
    }
    this.llmProviders.set(provider.id, provider);
  }

  registerSTT(provider) {
    if (!VALID_STT_PROVIDERS.includes(provider.id)) {
      throw new Error(`Cannot register STT provider '${provider.id}'. Only 'local_whisper' and 'groq_whisper' are supported.`);
    }
    this.sttProviders.set(provider.id, provider);
  }

  getLLMProvider(id = null) {
    const targetId = id || this.activeLLMId;
    const provider = this.llmProviders.get(targetId);
    if (!provider) {
      throw new Error(`LLM provider '${targetId}' not registered`);
    }
    return provider;
  }

  getSTTProvider(id = null) {
    const targetId = id || this.activeSTTId;
    const provider = this.sttProviders.get(targetId);
    if (!provider) {
      throw new Error(`STT provider '${targetId}' not registered`);
    }
    return provider;
  }

  setActiveLLM(id) {
    if (!VALID_LLM_PROVIDERS.includes(id)) {
      throw new Error(`Unknown LLM provider '${id}'. Only 'ollama' and 'groq' are supported.`);
    }
    if (!this.llmProviders.has(id)) {
      throw new Error(`Cannot set unregistered LLM provider '${id}'`);
    }
    this.activeLLMId = id;
    return this.getLLMProvider(id);
  }

  setActiveSTT(id) {
    if (!VALID_STT_PROVIDERS.includes(id)) {
      throw new Error(`Unknown STT provider '${id}'. Only 'local_whisper' and 'groq_whisper' are supported.`);
    }
    if (!this.sttProviders.has(id)) {
      throw new Error(`Cannot set unregistered STT provider '${id}'`);
    }
    this.activeSTTId = id;
    return this.getSTTProvider(id);
  }

  setModel(providerId, modelName) {
    const provider = this.llmProviders.get(providerId);
    if (!provider || !modelName) return false;
    provider.model = modelName.trim();
    if (providerId === 'ollama') {
      process.env.MODEL = provider.model;
    } else if (providerId === 'groq') {
      process.env.GROQ_MODEL = provider.model;
    }
    return true;
  }

  async getAvailableModels(providerId) {
    const provider = this.llmProviders.get(providerId || this.activeLLMId);
    if (!provider) return [];
    if (typeof provider.fetchAvailableModels === 'function') {
      return await provider.fetchAvailableModels();
    }
    return [provider.model];
  }

  updateProviderKey(id, apiKey) {
    const provider = this.llmProviders.get(id);
    if (provider && provider.type === 'cloud') {
      provider.apiKey = (apiKey || '').trim();
      if (id === 'groq') {
        process.env.GROQ_API_KEY = provider.apiKey;
        const groqStt = this.sttProviders.get('groq_whisper');
        if (groqStt) groqStt.apiKey = provider.apiKey;
      }
      return true;
    }
    return false;
  }

  async getStatusSummary() {
    const hardware = detectHardwareAndRecommendedModel();
    const systemWarnings = [];

    const llmList = [];
    for (const [id, provider] of this.llmProviders.entries()) {
      const check = await provider.testConnection().catch(err => ({ ok: false, error: err.message, warning: err.message }));
      const availableModels = await this.getAvailableModels(id).catch(() => [provider.model]);
      const isActive = id === this.activeLLMId;

      const warning = check.warning || (!provider.isConfigured() ? `${provider.name} is missing configuration.` : null);
      if (isActive && warning) {
        systemWarnings.push(`Active LLM (${provider.name}): ${warning}`);
      }

      llmList.push({
        id,
        name: provider.name,
        type: provider.type,
        model: provider.model,
        availableModels,
        active: isActive,
        configured: provider.isConfigured(),
        status: check.ok ? 'connected' : 'offline',
        maskedKey: typeof provider.getMaskedKey === 'function' ? provider.getMaskedKey() : null,
        warning,
        details: check,
      });
    }

    const sttList = [];
    for (const [id, provider] of this.sttProviders.entries()) {
      const check = await provider.testConnection().catch(err => ({ ok: false, error: err.message, warning: err.message }));
      const isActive = id === this.activeSTTId;

      const warning = check.warning || (!provider.isConfigured() ? `${provider.name} is missing configuration.` : null);
      if (isActive && warning) {
        systemWarnings.push(`Active STT (${provider.name}): ${warning}`);
      }

      sttList.push({
        id,
        name: provider.name,
        type: provider.type,
        model: provider.model || provider.modelSize,
        active: isActive,
        configured: provider.isConfigured(),
        status: check.ok ? 'connected' : 'offline',
        maskedKey: typeof provider.getMaskedKey === 'function' ? provider.getMaskedKey() : null,
        warning,
        details: check,
      });
    }

    return {
      activeLLM: this.activeLLMId,
      activeSTT: this.activeSTTId,
      allowCloudFallback: this.allowCloudFallback,
      warnings: systemWarnings,
      hardware,
      llmProviders: llmList,
      sttProviders: sttList,
    };
  }
}

export const aiRegistry = new AIProviderRegistry();
