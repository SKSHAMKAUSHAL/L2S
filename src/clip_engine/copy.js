// =============================================
// L2S — Clip Engine: Copy & Social Generator (Groq LLM)
// =============================================
// Generates hooks, titles (<60 chars), descriptions (1-2 sentences + CTA),
// and 5-8 structured hashtags (#shorts, #viral, 2 genre, 2-4 niche) in a single batched LLM call.

import { chatJSON } from '../llm/client.js';
import { getGenreProfile } from '../genre_config.js';

const COPY_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        required: ['clipId', 'hook', 'title', 'description', 'hashtags'],
        properties: {
          clipId: { type: 'string' },
          hook: { type: 'string' },
          title: { type: 'string', maxLength: 60 },
          description: { type: 'string' },
          hashtags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 5,
            maxItems: 8,
          },
        },
      },
    },
  },
  required: ['clips'],
};

/**
 * Clean and normalize hashtags to guarantee 5-8 valid tags
 */
export function normalizeHashtags(tags = [], genre = 'default') {
  const cleaned = [];
  const seen = new Set();

  for (const t of tags) {
    if (typeof t !== 'string') continue;
    let tag = t.trim().toLowerCase();
    if (!tag.startsWith('#')) tag = `#${tag}`;
    tag = tag.replace(/[\s\-_]+/g, '').slice(0, 30);
    if (/^#[a-z0-9_\u0900-\u097F]+$/i.test(tag) && !seen.has(tag)) {
      seen.add(tag);
      cleaned.push(tag);
    }
  }

  // Ensure broad tags
  if (!seen.has('#shorts')) {
    cleaned.unshift('#shorts');
    seen.add('#shorts');
  }
  if (!seen.has('#viral')) {
    cleaned.splice(1, 0, '#viral');
    seen.add('#viral');
  }

  // Ensure genre anchor
  const genreTag = `#${genre.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (!seen.has(genreTag) && genreTag.length > 2) {
    cleaned.splice(2, 0, genreTag);
    seen.add(genreTag);
  }

  // Ensure between 5 and 8 tags
  const fallbacks = ['#trending', '#foryou', '#reels', '#explore'];
  for (const fb of fallbacks) {
    if (cleaned.length >= 5) break;
    if (!seen.has(fb)) {
      cleaned.push(fb);
      seen.add(fb);
    }
  }

  return cleaned.slice(0, 8);
}

/**
 * Format hook according to script / language
 */
export function formatHook(hookText = '', language = 'en') {
  if (!hookText) return '';
  const words = hookText.trim().split(/\s+/).filter(Boolean);
  const trimmedWords = words.slice(0, 7);
  const raw = trimmedWords.join(' ');

  if (language === 'hi' || /[\u0900-\u097F]/.test(raw)) {
    return raw;
  }
  return raw.toUpperCase();
}

/**
 * Fallback copy generator
 */
function generateFallbackCopy(clip, genre = 'default') {
  const firstSentence = (clip.text || '').split(/[.?!।]/)[0] || 'Viral Moment';
  const hookWords = firstSentence.trim().split(/\s+/).slice(0, 5).join(' ');
  const title = (firstSentence.length > 55 ? firstSentence.slice(0, 52) + '...' : firstSentence).trim();
  const description = `${firstSentence}. What do you think about this? Let us know in the comments!`;
  const hashtags = normalizeHashtags(['#shorts', '#viral', `#${genre}`, '#trending', '#foryou'], genre);

  return {
    hook: formatHook(hookWords, clip.language),
    title,
    description,
    hashtags,
  };
}

/**
 * Generate copy for all selected clips in ONE batched Groq call
 *
 * @param {Array<Object>} selectedClips
 * @param {Object} [options]
 * @param {string} [options.genre='default']
 * @param {Object} [options.budget]
 * @param {Object} [options.llmClient] - For unit testing
 * @returns {Promise<Array<Object>>} Clips with populated hook, title, description, and hashtags
 */
export async function generateClipsCopy(selectedClips = [], options = {}) {
  if (!Array.isArray(selectedClips) || selectedClips.length === 0) {
    return [];
  }

  const { genre = 'default', budget, llmClient } = options;
  const profile = getGenreProfile(genre);

  const clipEntries = selectedClips.map((c, idx) => {
    const id = c.id || `clip_${idx}`;
    return {
      clipId: id,
      language: c.language || 'en',
      textSample: (c.text || '').slice(0, 350),
      rawHook: c.hookSentence || '',
      index: idx,
    };
  });

  const promptClips = clipEntries
    .map(e => `[${e.clipId}] Language: ${e.language}\nText: "${e.textSample}"`)
    .join('\n\n');

  const system = `You are a social media copywriter for viral YouTube Shorts and Instagram Reels.
Genre context: ${profile.label} (${profile.llmModifier || ''}).

For EACH clip provided, generate:
1. hook: 3-7 words, powerful, curiosity-inducing, grounded in clip text. For English, use UPPERCASE. For Hindi, use Devanagari. For Hinglish, use Roman letters.
2. title: Max 58 characters. Compelling and honest, no false clickbait.
3. description: 1-2 punchy sentences capturing the core idea plus a question or call-to-action.
4. hashtags: Array of 5 to 8 hashtags: 2 broad (#shorts, #viral) + 2 genre tags + 2-4 niche topic tags from the clip. Lowercase, alphanumeric, max 30 chars.

Return ONLY a JSON object with a "clips" array.`;

  const user = `Generate copy for these clips:\n\n${promptClips}`;

  try {
    const result = await chatJSON({
      system,
      user,
      schema: COPY_SCHEMA,
      temperature: 0,
      budget,
      client: llmClient,
    });

    const returnedClips = result?.data?.clips || [];
    const resultMap = new Map(returnedClips.map(rc => [rc.clipId, rc]));

    return selectedClips.map((clip, idx) => {
      const id = clip.id || `clip_${idx}`;
      const copy = resultMap.get(id);

      if (copy) {
        return {
          ...clip,
          hook: formatHook(copy.hook || clip.hookSentence, clip.language),
          title: (copy.title || clip.title || 'Viral Short').slice(0, 60),
          description: copy.description || '',
          hashtags: normalizeHashtags(copy.hashtags, genre),
        };
      }

      // Fallback for this individual clip
      const fb = generateFallbackCopy(clip, genre);
      return {
        ...clip,
        hook: fb.hook,
        title: fb.title,
        description: fb.description,
        hashtags: fb.hashtags,
      };
    });
  } catch {
    // Entire call failed -> use robust template fallbacks
    return selectedClips.map(clip => {
      const fb = generateFallbackCopy(clip, genre);
      return {
        ...clip,
        hook: fb.hook,
        title: fb.title,
        description: fb.description,
        hashtags: fb.hashtags,
      };
    });
  }
}
