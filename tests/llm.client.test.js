import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatJSON, createBudget, BudgetExceededError } from '../src/llm/client.js';

describe('Shared LLM Client (Step 3)', () => {
  it('1. valid JSON response parses and passes schema validation', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ score: 95, summary: 'Great clip' }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        },
      },
    };

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        summary: { type: 'string' },
      },
      required: ['score', 'summary'],
    };

    const res = await chatJSON({
      system: 'You are a test evaluator',
      user: 'Evaluate this',
      schema,
      client: mockClient,
    });

    assert.deepStrictEqual(res.data, { score: 95, summary: 'Great clip' });
    assert.strictEqual(res.usage.totalTokens, 15);
  });

  it('2. invalid JSON triggers retry with error message and succeeds on subsequent try', async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: async ({ messages }) => {
            callCount++;
            if (callCount === 1) {
              return {
                choices: [{ message: { content: 'Not valid json at all!' } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              };
            }
            // Verify that the error message was sent back
            assert.ok(messages.some(m => m.content.includes('not valid JSON')));
            return {
              choices: [{ message: { content: JSON.stringify({ status: 'ok' }) } }],
              usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
            };
          },
        },
      },
    };

    const res = await chatJSON({
      system: 'Test',
      user: 'Test',
      client: mockClient,
    });

    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(res.data, { status: 'ok' });
  });

  it('3. schema mismatch is retried, then throws if still invalid after max attempts', async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            callCount++;
            // Returns string score instead of number
            return {
              choices: [{ message: { content: JSON.stringify({ score: 'not_a_number' }) } }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            };
          },
        },
      },
    };

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
      },
      required: ['score'],
    };

    await assert.rejects(
      async () => {
        await chatJSON({
          system: 'Test',
          user: 'Test',
          schema,
          client: mockClient,
        });
      },
      /schema validation failed/
    );

    assert.strictEqual(callCount, 3);
  });

  it('4. retries 429 rate limit with exponential backoff and succeeds', async () => {
    let attempts = 0;
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            attempts++;
            if (attempts === 1) {
              const err = new Error('Rate limit 429');
              err.status = 429;
              throw err;
            }
            return {
              choices: [{ message: { content: JSON.stringify({ success: true }) } }],
              usage: { total_tokens: 10 },
            };
          },
        },
      },
    };

    const res = await chatJSON({
      system: 'Test',
      user: 'Test',
      client: mockClient,
    });

    assert.strictEqual(attempts, 2);
    assert.strictEqual(res.data.success, true);
  });

  it('5. token budget tracker throws BudgetExceededError when limit exceeded', async () => {
    const budget = createBudget(50);

    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
            usage: { total_tokens: 60 },
          }),
        },
      },
    };

    await assert.rejects(
      async () => {
        await chatJSON({
          system: 'Test',
          user: 'Test',
          budget,
          client: mockClient,
        });
      },
      (err) => {
        assert.ok(err instanceof BudgetExceededError);
        assert.ok(err.message.includes('Token budget exceeded'));
        return true;
      }
    );
  });
});
