// =============================================
// L2S — Clip Selector (Main Orchestrator)
// =============================================
// Clean entry point: selectClips(transcript, genre, numClips)
// Routes to new transcript-aware Clip Intelligence Engine (Groq default),
// or legacy sliding-window scoring when LLM_PROVIDER=ollama.

import { generateCandidateSegments } from './segmenter.js';
import { scoreSegments } from './scorer.js';
import { rankAndSelectClips, getVideoContext } from './ranker.js';
import { getGenreProfile } from './genre_config.js';
import { runClipEngine } from './clip_engine/index.js';

/**
 * Main entry point for the clip selection pipeline.
 *
 * @param {Object} transcript - Whisper transcript with segments + word-level timestamps
 * @param {string} genre - Genre key (e.g. "motivational", "comedy", "educational")
 * @param {number} numClips - Number of clips to select
 * @param {Object} [options] - Configuration options
 * @returns {Promise<ClipCandidate[]>} Array of selected clip candidates
 */
export async function selectClips(transcript, genre, numClips, options = {}) {
  const {
    ollamaUrl = 'http://localhost:11434',
    model = 'llama3.2:3b',
    description = null,
    onLog = () => {},
  } = options;

  const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

  if (provider !== 'ollama') {
    return await runClipEngine(transcript, {
      genre,
      clipCount: numClips,
      description,
      onLog,
      ...options,
    });
  }

  // Legacy Ollama pipeline
  const profile = getGenreProfile(genre);
  onLog(`🎯 Genre: ${profile.label} | Selecting ${numClips} clips (Ollama Mode)`);

  onLog('📊 Generating candidate segments (sliding windows)...');
  const candidates = generateCandidateSegments(transcript);
  onLog(`   Found ${candidates.length} candidate windows`);

  if (candidates.length === 0) {
    onLog('⚠️  No candidate segments generated — transcript may be too short');
    return [];
  }

  onLog(`📈 Scoring ${candidates.length} candidates with 6-signal heuristics...`);
  const scored = scoreSegments(candidates, genre);

  onLog('📖 Summarizing video for LLM context...');
  const videoContext = await getVideoContext(scored, ollamaUrl, model);

  onLog(`🧠 Running AI ranking via Ollama (${model})...`);
  const clips = await rankAndSelectClips(
    scored, genre, numClips, ollamaUrl, model,
    { videoContext, description, onLog }
  );

  return clips;
}
