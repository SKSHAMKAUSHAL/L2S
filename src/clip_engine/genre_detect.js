// =============================================
// L2S — Clip Engine: AI Genre Detector
// =============================================
// Analyzes transcript samples using chatJSON to auto-detect the optimal genre.

import { chatJSON } from '../llm/client.js';

const GENRE_SCHEMA = {
  type: 'object',
  required: ['detectedGenre', 'confidence', 'reasoning'],
  properties: {
    detectedGenre: {
      type: 'string',
      enum: ['motivational', 'funny', 'educational', 'storytime', 'tech', 'gaming', 'news', 'fitness', 'finance', 'default'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string', maxLength: 200 },
  },
};

/**
 * Auto-detect video genre from transcript sample
 *
 * @param {Array<Object>} sentences - Sentences or transcript text
 * @param {Object} [options]
 * @param {Object} [options.budget]
 * @param {Object} [options.llmClient] - For unit testing
 * @returns {Promise<{detectedGenre: string, confidence: number, reasoning: string}>}
 */
export async function detectGenre(sentences = [], options = {}) {
  const { budget, llmClient } = options;

  if (!Array.isArray(sentences) || sentences.length === 0) {
    return { detectedGenre: 'default', confidence: 0.5, reasoning: 'No transcript provided' };
  }

  // Sample sentences across start, middle, and end of video
  const step = Math.max(1, Math.floor(sentences.length / 10));
  const samples = sentences
    .filter((_, idx) => idx % step === 0)
    .slice(0, 10)
    .map(s => s.text)
    .join('\n');

  const system = `You are a video classification expert. Classify this video into exactly ONE best-fit genre:
- motivational (personal growth, discipline, mindset, inspiration)
- funny (comedy, standup, jokes, humorous reactions)
- educational (tutorials, facts, science, explanations, history)
- storytime (narratives, personal experiences, plot twists)
- tech (gadgets, software, AI, coding, hardware reviews)
- gaming (gameplay, esports, game walkthroughs)
- news (current events, journalism, political commentary)
- fitness (workouts, bodybuilding, nutrition, health)
- finance (investing, crypto, money, business, real estate)
- default (general conversation, vlog, podcast)

Return ONLY a JSON object conforming to the schema.`;

  const user = `Classify this video based on these excerpts:\n\n${samples}`;

  try {
    const result = await chatJSON({
      system,
      user,
      schema: GENRE_SCHEMA,
      temperature: 0,
      budget,
      client: llmClient,
    });

    if (result?.data?.detectedGenre) {
      return result.data;
    }
  } catch {}

  return {
    detectedGenre: 'default',
    confidence: 0.5,
    reasoning: 'Fallback default classification',
  };
}
