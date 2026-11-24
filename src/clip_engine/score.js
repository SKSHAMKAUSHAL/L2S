// =============================================
// L2S — Clip Engine: Weighted Scorer
// =============================================
// Combines 0.50 LLM subscores + 0.30 heuristic + 0.20 engagement signals.
// Weighs LLM subscores by the active genre rubric and renormalises cleanly
// when any signal or LLM component is missing.

import { getGenreProfile } from '../genre_config.js';

/**
 * Compute weighted LLM subscore based on genre rubric
 */
export function computeGenreWeightedLLMScore(subscores = {}, genre = 'default') {
  const profile = getGenreProfile(genre);
  const w = profile?.weights || {};

  // Map genre config weights to available subscores
  const rawWeights = {
    hook: w.hook || 0.25,
    payoff: w.payoff || 0.30,
    emotion: w.emotion || 0.20,
    standalone: w.standalone || 0.15,
    novelty: 0.10,
  };

  const total = rawWeights.hook + rawWeights.payoff + rawWeights.emotion + rawWeights.standalone + rawWeights.novelty;
  const weights = {
    hook: rawWeights.hook / total,
    payoff: rawWeights.payoff / total,
    emotion: rawWeights.emotion / total,
    standalone: rawWeights.standalone / total,
    novelty: rawWeights.novelty / total,
  };

  const hook = typeof subscores.hook === 'number' ? subscores.hook : 60;
  const payoff = typeof subscores.payoff === 'number' ? subscores.payoff : 60;
  const emotion = typeof subscores.emotion === 'number' ? subscores.emotion : 60;
  const standalone = typeof subscores.standalone === 'number' ? subscores.standalone : 60;
  const novelty = typeof subscores.novelty === 'number' ? subscores.novelty : 60;

  const weighted = Math.round(
    hook * weights.hook +
    payoff * weights.payoff +
    emotion * weights.emotion +
    standalone * weights.standalone +
    novelty * weights.novelty
  );

  return {
    weightedScore: Math.min(100, Math.max(0, weighted)),
    weights,
  };
}

/**
 * Score a single candidate by combining LLM, heuristic, and signals
 *
 * @param {Object} candidate - Candidate clip
 * @param {Object} [options]
 * @param {string} [options.genre='default']
 * @param {number} [options.heuristicScore]
 * @param {Object} [options.signals] - Signals result from signals.js
 * @returns {{finalScore: number, scoreBreakdown: Object}}
 */
export function scoreCandidate(candidate, options = {}) {
  const { genre = 'default', heuristicScore = 65, signals } = options;

  let llmScore = null;
  let llmWeights = null;

  if (candidate.subscores) {
    const res = computeGenreWeightedLLMScore(candidate.subscores, genre);
    llmScore = res.weightedScore;
    llmWeights = res.weights;
  }

  const heur = typeof heuristicScore === 'number' ? heuristicScore : 65;
  const sig = signals?.score !== undefined ? signals.score : 65;

  // Determine master weights (0.50 LLM, 0.30 Heuristic, 0.20 Signals)
  let wLLM = llmScore !== null ? 0.50 : 0.0;
  let wHeur = 0.30;
  let wSig = 0.20;

  const sumWeights = wLLM + wHeur + wSig;
  const normLLM = wLLM / sumWeights;
  const normHeur = wHeur / sumWeights;
  const normSig = wSig / sumWeights;

  const finalScore = Math.round(
    (llmScore !== null ? llmScore * normLLM : 0) +
    heur * normHeur +
    sig * normSig
  );

  const clampedFinal = Math.min(100, Math.max(0, finalScore));

  const scoreBreakdown = {
    finalScore: clampedFinal,
    llm: {
      score: llmScore,
      subscores: candidate.subscores || null,
      rubricWeights: llmWeights,
    },
    heuristic: {
      score: heur,
    },
    signals: signals || null,
    weights: {
      llm: normLLM,
      heuristic: normHeur,
      signals: normSig,
    },
  };

  return {
    finalScore: clampedFinal,
    scoreBreakdown,
  };
}
