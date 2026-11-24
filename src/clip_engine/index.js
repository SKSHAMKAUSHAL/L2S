// =============================================
// L2S — Clip Intelligence Engine (Main Pipeline)
// =============================================
// Transcript-aware viral clip extraction inspired by OpusClip and Vizard.
// Orchestrates:
// 1. Sentences: Unicode-aware sentence boundary extraction
// 2. Topics: TextTiling TF-IDF cosine segmentation
// 3. Propose: Groq chatJSON candidate proposals with genre rubrics
// 4. Signals: Multimodal audio energy, YouTube heatmap, speech pace & lexicon
// 5. Score: 0.50 LLM subscores + 0.30 heuristic + 0.20 engagement signals
// 6. Refine: Sentence snapping, 0.15s/0.30s safe padding, connector resolution
// 7. Select: Non-Maximum Suppression, max 2 per topic, 20s minimum gap
// 8. Copy: On-screen hook, title (<60 chars), description, and 5-8 hashtags

import { buildSentences } from './sentences.js';
import { segmentTopics } from './topics.js';
import { proposeCandidates } from './propose.js';
import { computeCandidateSignals, extractAudioLoudness } from './signals.js';
import { scoreCandidate } from './score.js';
import { refineCandidate } from './refine.js';
import { selectDiverseClips } from './select.js';
import { generateClipsCopy } from './copy.js';
import { detectGenre } from './genre_detect.js';
import { createBudget } from '../llm/client.js';

export {
  buildSentences,
  segmentTopics,
  proposeCandidates,
  computeCandidateSignals,
  extractAudioLoudness,
  scoreCandidate,
  refineCandidate,
  selectDiverseClips,
  generateClipsCopy,
  detectGenre,
};

/**
 * Run the complete Clip Intelligence Engine on a transcript
 *
 * @param {Object} transcript - Full transcript with words / segments
 * @param {Object} [options]
 * @param {string} [options.genre='default']
 * @param {number|string} [options.clipCount]
 * @param {string} [options.audioPath] - Optional path to video/audio for loudness analysis
 * @param {Array} [options.heatmap] - Optional YouTube most replayed heatmap points
 * @param {string} [options.description] - User description filter
 * @param {Function} [options.onLog]
 * @param {Object} [options.llmClient] - For unit testing / mocking
 * @returns {Promise<Array<Object>>} Selected, scored, refined clips with titles, hooks, and hashtags
 */
export async function runClipEngine(transcript, options = {}) {
  const {
    genre: rawGenre = 'default',
    clipCount,
    audioPath,
    heatmap,
    description,
    onLog = () => {},
    llmClient,
  } = options;

  const maxTokens = Number(process.env.CLIP_ENGINE_MAX_TOKENS) || 120000;
  const budget = createBudget(maxTokens);

  // 1. Build sentences
  const allWords = transcript.words || transcript.segments?.flatMap(s => s.words || []) || [];
  onLog(`Building sentences from ${allWords.length} words...`);
  const sentences = buildSentences(allWords);

  if (sentences.length === 0) {
    onLog('⚠️ No sentences found in transcript');
    return [];
  }

  const totalDuration = Math.max(1, sentences[sentences.length - 1].end - sentences[0].start);

  // 2. Auto-detect genre if requested
  let activeGenre = rawGenre;
  if (rawGenre === 'auto' || rawGenre === 'auto-detect' || !rawGenre) {
    onLog('🤖 Auto-detecting genre via Groq LLM...');
    const detection = await detectGenre(sentences, { budget, llmClient });
    activeGenre = detection.detectedGenre;
    onLog(`   Detected Genre: ${activeGenre} (confidence: ${Math.round(detection.confidence * 100)}%)`);
  }

  // 3. Segment into topic segments (TextTiling)
  onLog(`Segmenting transcript into topics across ${sentences.length} sentences...`);
  const topicSegments = segmentTopics(sentences);
  onLog(`   Identified ${topicSegments.length} topic segments`);

  // 4. Propose candidate clips via LLM (with heuristic fallback)
  onLog(`Proposing candidate clips for ${activeGenre} genre...`);
  const proposalResult = await proposeCandidates(sentences, {
    genre: activeGenre,
    clipCount,
    budget,
    llmClient,
    transcript,
  });

  const candidates = proposalResult.candidates;
  onLog(`   Proposed ${candidates.length} candidate clips (fallback: ${proposalResult.meta.fallback})`);

  if (candidates.length === 0) {
    return [];
  }

  // Optional: Extract audio loudness once if audio file exists
  let loudnessPoints = null;
  if (audioPath) {
    onLog('Extracting audio loudness curve with FFmpeg ebur128...');
    loudnessPoints = extractAudioLoudness(audioPath);
  }

  // 5. Compute multimodal signals & combine weighted score for each candidate
  onLog('Scoring candidates with LLM subscores, heuristic checks, and engagement signals...');
  const scoredCandidates = [];

  for (const cand of candidates) {
    const signals = computeCandidateSignals(cand, { heatmap, loudnessPoints });
    const scoreResult = scoreCandidate(cand, {
      genre: activeGenre,
      heuristicScore: cand.heuristicScore ?? 65,
      signals,
    });

    scoredCandidates.push({
      ...cand,
      finalScore: scoreResult.finalScore,
      scoreBreakdown: scoreResult.scoreBreakdown,
    });
  }

  // 6. Boundary refinement (snapping, safe padding, connector resolution)
  onLog('Refining cut boundaries and safe padding...');
  const refinedCandidates = scoredCandidates.map(c =>
    refineCandidate(c, sentences, allWords)
  );

  // 7. Greedy diversity selection with NMS and 20s gap
  onLog('Selecting diverse clips with Non-Maximum Suppression and topic spreading...');
  const selectResult = selectDiverseClips(refinedCandidates, topicSegments, totalDuration, { clipCount });
  const selectedClips = selectResult.clips;
  onLog(`   Selected ${selectedClips.length} diverse clips (Target was: ${selectResult.meta.targetCount})`);

  if (selectedClips.length === 0) {
    return [];
  }

  // 8. Generate viral copy (hook, title, description, hashtags) in single batched LLM call
  onLog('Generating viral hooks, titles, descriptions, and hashtags...');
  const finalClips = await generateClipsCopy(selectedClips, {
    genre: activeGenre,
    budget,
    llmClient,
  });

  // Log final budget usage
  const budgetUsage = budget.used();
  onLog(`[ClipEngine] Token budget used: ${budgetUsage.totalTokens} / ${maxTokens} tokens`);

  // Map to standard pipeline format while preserving rich fields
  return finalClips.map((clip, idx) => ({
    start: clip.start,
    end: clip.end,
    duration: clip.duration || Math.round(clip.end - clip.start),
    text: clip.text,
    words: clip.words || [],
    heuristicScore: clip.scoreBreakdown?.heuristic?.score || 50,
    llmScore: clip.scoreBreakdown?.llm?.score || clip.finalScore,
    combinedScore: clip.finalScore,
    score: clip.finalScore,
    justification: clip.reason || '',
    hookCaption: clip.hook || clip.hookSentence || '',
    title: clip.title || `Clip ${idx + 1}`,
    description: clip.description || '',
    hashtags: clip.hashtags?.join(' ') || '',
    hook: clip.hook || '',
    scoreBreakdown: clip.scoreBreakdown,
    language: clip.language || transcript.language || 'en',
    topicId: clip.topicId || 'T0',
  }));
}
