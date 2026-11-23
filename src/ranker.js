// =============================================
// L2S — AI Ranker (Ollama Integration)
// =============================================
// Structured LLM scoring with genre-aware prompts,
// boundary refinement, and diversity-enforced selection.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SCORING_CONFIG, getGenreProfile } from './genre_config.js';
import { aiRegistry } from './ai/registry.js';

// ─── LLM System Prompt ──────────────────────
const BASE_SYSTEM_PROMPT = `You are a world-class viral clip analyst for short-form video (TikTok, YouTube Shorts, Instagram Reels).

For EACH segment, evaluate and return a structured JSON rubric.

Scoring criteria (each 0–10):
- hook_score: Does the first 3 seconds grab attention? Questions, bold claims, numbers, or emotional statements score high. Filler words or needing prior context scores low.
- standalone_score: Can this be understood with ZERO context from the rest of the video? Penalize dangling pronouns ("that thing"), continuation words ("so anyway"), or references to prior content.
- payoff_score: Does it have a mini arc — setup, tension, resolution/punchline/insight? Does the ending deliver?
- emotion_score: Does it trigger laughter, awe, surprise, curiosity, or inspiration?
- overall_score: Your holistic virality score (0–100). Weight according to the genre instructions.

Score thresholds for overall_score:
- 0–30: Weak — filler, incomplete, no hook
- 31–50: Below average — watchable but forgettable
- 51–70: Decent — some potential but missing key elements
- 71–85: Strong — good hook + emotion, shareable
- 86–100: Exceptional — scroll-stopping, guaranteed engagement

Be CRITICAL. Incomplete sentences, cut-off thoughts, or context-dependent segments must score below 40.
Return ONLY a valid JSON array. No markdown, no explanation, no code fences.`;

// ─── Build structured ranking prompt ────────
function buildRankingPrompt(segments, genreModifier, videoContext, description) {
  const contextBlock = videoContext
    ? `\nVIDEO CONTEXT (understand what makes clips relevant to this specific video):\n"${videoContext}"\n`
    : '';

  const descriptionBlock = description
    ? `\nUSER SPECIFIC REQUEST / HIGH-LEVEL PROMPT: The user explicitly wants clips about: "${description}". You MUST heavily prioritize segments that match this description. If a segment perfectly matches this description, give it a high overall_score.\n`
    : '';

  return `${contextBlock}${descriptionBlock}
${genreModifier || ''}

Evaluate these transcript segments for short-form viral potential.
For each segment, return a JSON object with these EXACT fields:
- segment_id (string): the ID exactly as given
- hook_score (number 0-10)
- standalone_score (number 0-10)
- payoff_score (number 0-10)
- emotion_score (number 0-10)
- overall_score (number 0-100)
- justification (string): 1-sentence explanation of the score
- suggested_hook_caption (string): punchy overlay text with emoji, max 60 chars

Segments to evaluate:
${segments.map(s => `[${s.id}] ${Math.round(s.start)}s-${Math.round(s.end)}s (${Math.round(s.end - s.start)}s): "${s.text.slice(0, 350)}"`).join('\n\n')}

Return ONLY a JSON array. Example:
[{"segment_id":"seg_0","hook_score":8,"standalone_score":7,"payoff_score":9,"emotion_score":6,"overall_score":82,"justification":"Opens with provocative question, delivers clear insight","suggested_hook_caption":"Nobody talks about this 🤯"}]`;
}

// ─── Query LLM via Active Provider ───────────
async function queryLLM(prompt, systemPrompt, timeoutMs = 60000) {
  const provider = aiRegistry.getLLMProvider();
  if (!provider.isConfigured()) {
    throw new Error(`${provider.name} is active, but not configured. Please check your settings or credentials.`);
  }
  return await provider.generateText({ systemPrompt, prompt, timeoutMs });
}

// ─── Get Video Context ──────────────────────
/**
 * Ask active LLM to summarize the video from transcript samples.
 */
export async function getVideoContext(segments, _ollamaUrl, _model) {
  if (!segments || segments.length === 0) return null;

  const step = Math.max(1, Math.floor(segments.length / 15));
  const sample = segments
    .filter((_, i) => i % step === 0)
    .slice(0, 15)
    .map(s => `${Math.round(s.start)}s: "${(s.text || '').slice(0, 150)}"`)
    .join('\n');

  const prompt = `Based on these transcript excerpts from a video, write a 2-sentence summary of what this video is about and the main topic/theme. Be specific about the subject matter.

Transcript excerpts:
${sample}

Response format: Just the 2-sentence summary. Nothing else.`;

  try {
    const response = await queryLLM(
      prompt,
      'You are a video summarizer. Return only a brief summary.',
      25000
    );
    return response.trim().slice(0, 400);
  } catch (e) {
    console.warn('[ranker] Could not get video context:', e.message);
    return null;
  }
}

// ─── Rank and Select Clips ──────────────────
/**
 * Main ranking function: LLM-score pre-filtered segments, refine boundaries,
 * then greedily select diverse, non-overlapping clips.
 *
 * @param {Object[]} scoredSegments - Segments with heuristic scores from scorer.js
 * @param {string} genre - Genre key
 * @param {number} numClips - Number of clips to select
 * @param {string} [_ollamaUrl] - Legacy parameter (ignored, provider resolved via registry)
 * @param {string} [_model] - Legacy parameter (ignored, provider resolved via registry)
 * @param {Object} options - { videoContext, onLog }
 * @returns {Promise<ClipCandidate[]>}
 */
export async function rankAndSelectClips(scoredSegments, genre, numClips, _ollamaUrl, _model, options = {}) {
  const { videoContext = null, description = null, onLog = () => {} } = options;
  const profile = getGenreProfile(genre);
  const provider = aiRegistry.getLLMProvider();

  // ── Step 1: Pre-filter scaled intelligently to target clip count ────
  const getHeuristicScore = (s) => (s?.heuristic?.total ?? s?.heuristicScore ?? s?.score ?? 50);
  const sorted = [...scoredSegments].sort((a, b) => getHeuristicScore(b) - getHeuristicScore(a));
  const targetCount = Math.max(1, numClips || 5);
  // Intelligently scale candidate pool based on requested clips
  // Formula: Math.min(30, Math.max(targetCount * 2, 10)) to reduce LLM calls by 4x-6x
  const maxCandidates = Math.min(30, Math.max(targetCount * 2, 10));
  const cutoff = Math.min(sorted.length, Math.max(maxCandidates, Math.ceil(sorted.length * 0.15)));

  let candidates = sorted
    .filter(s => getHeuristicScore(s) >= SCORING_CONFIG.preFilterMinScore)
    .slice(0, cutoff);

  if (candidates.length < targetCount) {
    // If not enough passed min score, fill with top heuristic segments
    candidates = sorted.slice(0, Math.min(sorted.length, Math.max(targetCount * 2, 8)));
  }

  onLog(`Pre-filtered ${scoredSegments.length} → ${candidates.length} candidates for ${targetCount} clips (heuristic scoring)`);

  if (candidates.length === 0) {
    onLog('No candidates found, using top segments by heuristic (heuristic-only mode)');
    return sorted.slice(0, targetCount).map(buildFallbackCandidate);
  }

  // ── Step 2: LLM scoring in batches ────────
  const batchSize = SCORING_CONFIG.llmBatchSize;
  const maxConcurrent = SCORING_CONFIG.llmMaxConcurrent;
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${profile.llmModifier}`;
  const allLlmResults = [];

  // Split candidates into batches
  const batches = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push(candidates.slice(i, i + batchSize));
  }

  onLog(`Sending ${batches.length} batch(es) to ${provider.name} (${provider.model})...`);

  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += maxConcurrent) {
    const concurrentBatches = batches.slice(i, i + maxConcurrent);

    const results = await Promise.allSettled(
      concurrentBatches.map(batch => scoreBatchWithLLM(batch, systemPrompt, profile, videoContext, description))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allLlmResults.push(...result.value);
      } else if (result.status === 'rejected') {
        onLog(`LLM batch failed: ${result.reason?.message || 'Unknown error'}`);
      }
    }
  }

  onLog(`LLM scored ${allLlmResults.length} segments`);

  // ── Step 3: Merge heuristic + LLM scores ──
  const merged = candidates.map(seg => {
    const llmResult = allLlmResults.find(r => r.segment_id === seg.id);

    if (llmResult) {
      return {
        ...seg,
        llmScore: llmResult.overall_score,
        llmBreakdown: {
          hook: llmResult.hook_score,
          standalone: llmResult.standalone_score,
          payoff: llmResult.payoff_score,
          emotion: llmResult.emotion_score,
        },
        justification: llmResult.justification || '',
        hookCaption: llmResult.suggested_hook_caption || '',
        combinedScore: Math.round(((seg.heuristic?.total ?? seg.heuristicScore ?? 50) + llmResult.overall_score) / 2),
      };
    }

    // No LLM result — use heuristic only
    return {
      ...seg,
      llmScore: null,
      llmBreakdown: null,
      justification: `Heuristic only: ${seg.breakdownStr}`,
      hookCaption: '',
      combinedScore: (seg.heuristic?.total ?? seg.heuristicScore ?? 50),
    };
  });

  // ── Step 4: Boundary refinement ───────────
  const refined = merged.map(seg => refineBoundaries(seg));

  // ── Step 5: Greedy diversity selection ─────
  const selected = greedyDiverseSelect(refined, numClips);

  onLog(`Selected ${selected.length} diverse clips`);

  return selected.map(buildClipCandidate);
}

// ─── Score a batch of segments via LLM ──────
async function scoreBatchWithLLM(segments, systemPrompt, profile, videoContext, description) {
  const prompt = buildRankingPrompt(segments, profile.llmModifier, videoContext, description);

  // Cache based on content hash
  const hash = crypto.createHash('md5').update(prompt + systemPrompt).digest('hex');
  const cacheDir = path.join(os.homedir(), '.skate', 'cache', 'llm');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${hash}.json`);

  let response;
  if (fs.existsSync(cacheFile)) {
    response = fs.readFileSync(cacheFile, 'utf-8');
  } else {
    response = await queryLLM(prompt, systemPrompt, 120000);
    fs.writeFileSync(cacheFile, response);
  }

  return parseLLMResponse(response);
}

// ─── Parse structured LLM response ──────────
function parseLLMResponse(response) {
  let cleaned = response
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Extract JSON array
  const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(r => ({
      segment_id: r.segment_id || '',
      hook_score: clamp(Number(r.hook_score) || 0, 0, 10),
      standalone_score: clamp(Number(r.standalone_score) || 0, 0, 10),
      payoff_score: clamp(Number(r.payoff_score) || 0, 0, 10),
      emotion_score: clamp(Number(r.emotion_score) || 0, 0, 10),
      overall_score: clamp(Number(r.overall_score) || 0, 0, 100),
      justification: r.justification || '',
      suggested_hook_caption: r.suggested_hook_caption || '',
    })).filter(r => r.segment_id);
  } catch {
    // Fallback: try object-by-object extraction
    const results = [];
    const objRegex = /\{[^{}]+\}/g;
    let match;

    while ((match = objRegex.exec(cleaned)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.segment_id && typeof obj.overall_score === 'number') {
          results.push({
            segment_id: obj.segment_id,
            hook_score: clamp(Number(obj.hook_score) || 0, 0, 10),
            standalone_score: clamp(Number(obj.standalone_score) || 0, 0, 10),
            payoff_score: clamp(Number(obj.payoff_score) || 0, 0, 10),
            emotion_score: clamp(Number(obj.emotion_score) || 0, 0, 10),
            overall_score: clamp(Number(obj.overall_score) || 0, 0, 100),
            justification: obj.justification || '',
            suggested_hook_caption: obj.suggested_hook_caption || '',
          });
        }
      } catch { /* skip malformed */ }
    }

    return results;
  }
}

// ─── Boundary Refinement ────────────────────
/**
 * Refine segment boundaries:
 * 1. Snap start to sentence start containing the hook
 * 2. Snap end to sentence end completing the payoff
 * 3. Trim leading/trailing silence via word-timestamp gaps
 */
function refineBoundaries(segment) {
  if (!segment.words || segment.words.length === 0) return segment;

  let newStart = segment.start;
  let newEnd = segment.end;

  // VAD-like trim: if first word starts > 0.5s after segment start, trim
  const firstWord = segment.words[0];
  if (firstWord && (firstWord.start - segment.start) > 0.5) {
    newStart = Math.max(firstWord.start - 0.1, segment.start); // keep 100ms buffer
  }

  // VAD-like trim: if last word ends > 0.5s before segment end, trim
  const lastWord = segment.words[segment.words.length - 1];
  if (lastWord && (segment.end - lastWord.end) > 0.5) {
    newEnd = Math.min(lastWord.end + 0.1, segment.end); // keep 100ms buffer
  }

  return {
    ...segment,
    start: newStart,
    end: newEnd,
  };
}

// ─── Greedy Diversity Selection ─────────────
/**
 * Greedily select top-K non-overlapping, low-redundancy segments.
 */
function greedyDiverseSelect(candidates, numClips) {
  const sorted = [...candidates].sort((a, b) => b.combinedScore - a.combinedScore);
  const selected = [];

  for (const candidate of sorted) {
    if (selected.length >= numClips) break;

    // Check time overlap with already-selected clips
    const hasTimeOverlap = selected.some(sel => {
      const overlapStart = Math.max(sel.start, candidate.start);
      const overlapEnd = Math.min(sel.end, candidate.end);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      const candidateDuration = candidate.end - candidate.start;
      return (overlapDuration / candidateDuration) > SCORING_CONFIG.redundancyOverlapThreshold;
    });

    if (hasTimeOverlap) continue;

    // Check text similarity with already-selected clips
    const hasTextOverlap = selected.some(sel => {
      const similarity = jaccardTrigramSimilarity(sel.text, candidate.text);
      return similarity > SCORING_CONFIG.redundancySimilarityThreshold;
    });

    if (hasTextOverlap) continue;

    selected.push(candidate);
  }

  return selected;
}

/**
 * Compute Jaccard similarity on word trigrams between two texts.
 * Returns 0–1 (0 = no overlap, 1 = identical).
 */
function jaccardTrigramSimilarity(textA, textB) {
  const trigramsA = getWordTrigrams(textA);
  const trigramsB = getWordTrigrams(textB);

  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getWordTrigrams(text) {
  const words = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const trigrams = new Set();
  for (let i = 0; i <= words.length - 3; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return trigrams;
}

// ─── Build final ClipCandidate ──────────────
function buildClipCandidate(segment) {
  return {
    start: segment.start,
    end: segment.end,
    text: segment.text,
    words: segment.words || [],
    heuristicScore: segment.heuristic?.total || 0,
    llmScore: segment.llmScore,
    combinedScore: segment.combinedScore || segment.heuristic?.total || 0,
    justification: segment.justification || '',
    hookCaption: segment.hookCaption || '',
    scoreBreakdown: {
      heuristic: segment.heuristic || {},
      llm: segment.llmBreakdown || null,
    },
  };
}

function buildFallbackCandidate(segment) {
  return buildClipCandidate({
    ...segment,
    justification: `Heuristic fallback: ${segment.breakdownStr || 'N/A'}`,
    hookCaption: '',
    combinedScore: segment.heuristic?.total || 0,
  });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
