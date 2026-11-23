// =============================================
// L2S — Shared Groq LLM Client & Budget Guard
// =============================================
// Unified Groq client with JSON-schema validation (Ajv), schema-guided
// automatic retries, exponential backoff for rate limits, and per-job token budgets.

import Groq from 'groq-sdk';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

export class BudgetExceededError extends Error {
  constructor(message, usage) {
    super(message);
    this.name = 'BudgetExceededError';
    this.usage = usage;
  }
}

/**
 * Create a per-job token budget tracker
 *
 * @param {number} maxTokens - Max allowed total tokens
 * @returns {Object} Budget tracker instance
 */
export function createBudget(maxTokens = 120000) {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  return {
    track(usage) {
      if (!usage) return;
      promptTokens += usage.promptTokens || usage.prompt_tokens || 0;
      completionTokens += usage.completionTokens || usage.completion_tokens || 0;
      totalTokens += usage.totalTokens || usage.total_tokens || (promptTokens + completionTokens);

      if (totalTokens > maxTokens) {
        throw new BudgetExceededError(
          `Token budget exceeded: used ${totalTokens} tokens (limit: ${maxTokens})`,
          { promptTokens, completionTokens, totalTokens, maxTokens }
        );
      }
    },
    used() {
      return { promptTokens, completionTokens, totalTokens, maxTokens };
    },
    check() {
      if (totalTokens > maxTokens) {
        throw new BudgetExceededError(
          `Token budget exceeded: used ${totalTokens} tokens (limit: ${maxTokens})`,
          { promptTokens, completionTokens, totalTokens, maxTokens }
        );
      }
    },
  };
}

let _defaultGroqClient = null;
function getGroqClient() {
  if (!_defaultGroqClient) {
    _defaultGroqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
    });
  }
  return _defaultGroqClient;
}

/**
 * Execute chat completion requesting strict JSON output with schema validation
 *
 * @param {Object} params
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {Object} [params.schema] - JSON schema for Ajv validation
 * @param {string} [params.model] - Groq model ID
 * @param {number} [params.temperature=0]
 * @param {number} [params.maxTokens]
 * @param {number} [params.timeoutMs=60000]
 * @param {Object} [params.budget] - Budget tracker from createBudget()
 * @param {Object} [params.client] - Injected client for unit testing
 * @returns {Promise<{ data: any, usage: Object }>}
 */
export async function chatJSON({
  system,
  user,
  schema,
  model,
  temperature = 0,
  maxTokens,
  timeoutMs = 60000,
  budget,
  client,
}) {
  const groq = client || getGroqClient();
  const targetModel = model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const validate = schema ? ajv.compile(schema) : null;

  const messages = [
    { role: 'system', content: `${system}\nYou MUST return a valid JSON object matching the requested schema. Do not include markdown codeblocks or preamble.` },
    { role: 'user', content: user },
  ];

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check budget before making request
    if (budget) budget.check();

    try {
      // Retry wrapper for network / rate limits (429, 5xx)
      const completion = await callWithRetry(
        () => groq.chat.completions.create({
          messages,
          model: targetModel,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        3
      );

      const usage = {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      };

      if (budget) {
        budget.track(usage);
      }

      const rawContent = completion.choices?.[0]?.message?.content?.trim() || '{}';

      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch (parseErr) {
        if (attempt < maxAttempts) {
          messages.push({ role: 'assistant', content: rawContent });
          messages.push({
            role: 'user',
            content: `Your previous response was not valid JSON. Error: ${parseErr.message}. Output ONLY valid JSON matching the schema.`,
          });
          continue;
        }
        throw new Error(`Failed to parse LLM JSON response: ${parseErr.message}`);
      }

      if (validate) {
        const valid = validate(parsed);
        if (!valid) {
          const errorsText = ajv.errorsText(validate.errors);
          if (attempt < maxAttempts) {
            messages.push({ role: 'assistant', content: rawContent });
            messages.push({
              role: 'user',
              content: `Your output did not match the required schema: ${errorsText}. Fix the schema mismatches and output valid JSON.`,
            });
            continue;
          }
          throw new Error(`LLM output schema validation failed: ${errorsText}`);
        }
      }

      return { data: parsed, usage };
    } catch (err) {
      lastError = err;
      if (err instanceof BudgetExceededError) {
        throw err;
      }
      if (attempt === maxAttempts) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('LLM call failed after retries');
}

/**
 * Call Groq API with exponential backoff on 429 and 5xx errors
 */
async function callWithRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const status = err.status || err.statusCode || (err.error && err.error.status);
      const isRateLimit = status === 429 || (err.message && err.message.includes('429'));
      const isServerError = status >= 500 && status < 600;

      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        let delayMs = 500 * Math.pow(2, attempt) + Math.random() * 200;
        const retryAfter = err.headers?.get ? err.headers.get('retry-after') : err.headers?.['retry-after'];
        if (retryAfter) {
          const parsedSec = Number(retryAfter);
          if (!isNaN(parsedSec)) delayMs = Math.max(delayMs, parsedSec * 1000);
        }
        await new Promise(res => setTimeout(res, delayMs));
        continue;
      }
      throw err;
    }
  }
}
