// =============================================
// L2S — Clip Selector (Main Orchestrator)
// =============================================
// Clean entry point: selectClips(transcript, genre, numClips)
// Chains: segmenter → scorer → pre-filter → ranker → final clips

import { generateCandidateSegments } from './segmenter.js';
import { scoreSegments } from './scorer.js';
import { rankAndSelectClips, getVideoContext } from './ranker.js';
import { getGenreProfile } from './genre_config.js';
import { aiRegistry } from './ai/registry.js';

/**
 * Main entry point for the clip selection pipeline.
 *
 * @param {Object} transcript - Whisper transcript with segments + word-level timestamps
 * @param {string} genre - Genre key (e.g. "motivational", "comedy", "educational")
 * @param {number} numClips - Number of clips to select
 * @param {Object} [options] - Configuration options
 * @param {string} options.ollamaUrl - Ollama API URL (default: http://localhost:11434)
 * @param {string} options.model - Ollama model name (default: llama3.2:3b)
 * @param {Function} options.onLog - Logging callback (msg: string) => void
 * @returns {Promise<ClipCandidate[]>} Array of selected clip candidates
 */
export async function selectClips(transcript, genre, numClips, options = {}) {
  const {
    ollamaUrl = 'http://localhost:11434',
    model = 'llama3.2:3b',
    description = null,
    onLog = () => {},
  } = options;

  const profile = getGenreProfile(genre);
  onLog(`🎯 Genre: ${profile.label} | Selecting ${numClips} clips`);

  // ── Step 1: Generate candidate segments ────
  onLog('📊 Generating candidate segments (sliding windows)...');
  const candidates = generateCandidateSegments(transcript);
  onLog(`   Found ${candidates.length} candidate windows`);

  if (candidates.length === 0) {
    onLog('⚠️  No candidate segments generated — transcript may be too short');
    return [];
  }

  // ── Step 2: Heuristic scoring ──────────────
  onLog(`📈 Scoring ${candidates.length} candidates with 6-signal heuristics...`);
  const scored = scoreSegments(candidates, genre);

  // Log top scores for debugging
  const topScored = [...scored].sort((a, b) => b.heuristic.total - a.heuristic.total).slice(0, 5);
  for (const s of topScored) {
    onLog(`   [${s.id}] ${Math.round(s.start)}s-${Math.round(s.end)}s | Score: ${s.heuristic.total} | ${s.breakdownStr}`);
  }

  // ── Step 3: Get video context for LLM ─────
  onLog('📖 Summarizing video for LLM context...');
  const videoContext = await getVideoContext(scored, ollamaUrl, model);
  if (videoContext) {
    onLog(`   Context: ${videoContext.slice(0, 150)}...`);
  }

  // ── Step 4: LLM ranking + selection ────────
  const activeLLM = aiRegistry.getLLMProvider();
  onLog(`🧠 Running AI ranking via ${activeLLM.name} (${activeLLM.model})...`);
  const clips = await rankAndSelectClips(
    scored, genre, numClips, ollamaUrl, model,
    { videoContext, description, onLog }
  );

  onLog(`✅ Selected ${clips.length} clips:`);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    onLog(`   ${i + 1}. [${Math.round(c.start)}s-${Math.round(c.end)}s] Score: ${c.combinedScore} — ${c.justification.slice(0, 80)}`);
  }

  return clips;
}
