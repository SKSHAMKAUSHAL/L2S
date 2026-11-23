// =============================================
// L2S — Multi-Signal Heuristic Scorer
// =============================================
// Scores each candidate segment on 6 signals, weighted by genre.
// This is the cheap pre-filter that runs before the LLM.

import { SCORING_CONFIG, getGenreProfile } from './genre_config.js';

/**
 * Score a candidate segment using 6 heuristic signals.
 *
 * @param {Object} segment - { id, start, end, text, words }
 * @param {string} genre - Genre key (e.g. "motivational", "comedy")
 * @param {Object} [genreProfile] - Override genre profile
 * @returns {Object} Scored segment with breakdown
 */
export function scoreSegment(segment, genre, genreProfile = null) {
  const profile = genreProfile || getGenreProfile(genre);
  const { weights } = profile;
  const text = segment.text || '';
  const wordsArr = text.toLowerCase().split(/\s+/).filter(Boolean);
  const duration = segment.end - segment.start;

  // Compute each signal (0–100)
  const hook = scoreHookStrength(segment, wordsArr);
  const standalone = scoreStandalone(wordsArr, text);
  const payoff = scorePayoff(wordsArr, text);
  const emotion = scoreEmotion(wordsArr, segment);
  const topicDensity = scoreTopicDensity(wordsArr, profile);
  const lengthFit = scoreLengthFit(duration);

  // Weighted total
  const total = Math.round(
    hook * (weights.hook || 0) +
    standalone * (weights.standalone || 0) +
    payoff * (weights.payoff || 0) +
    emotion * (weights.emotion || 0) +
    topicDensity * (weights.topicDensity || 0) +
    lengthFit * (weights.lengthFit || 0)
  );

  const breakdown = {
    hook: Math.round(hook),
    standalone: Math.round(standalone),
    payoff: Math.round(payoff),
    emotion: Math.round(emotion),
    topicDensity: Math.round(topicDensity),
    lengthFit: Math.round(lengthFit),
    total,
  };

  return {
    ...segment,
    heuristic: breakdown,
    breakdownStr: `H:${breakdown.hook} S:${breakdown.standalone} P:${breakdown.payoff} E:${breakdown.emotion} T:${breakdown.topicDensity} L:${breakdown.lengthFit} = ${total}`,
  };
}

/**
 * Score a batch of segments.
 */
export function scoreSegments(segments, genre) {
  const profile = getGenreProfile(genre);
  return segments.map(seg => scoreSegment(seg, genre, profile));
}

// ─────────────────────────────────────────────
// Signal 1: Hook Strength (first 3 seconds)
// ─────────────────────────────────────────────
function scoreHookStrength(segment, wordsArr) {
  if (wordsArr.length === 0) return 0;

  const hookWords = getHookWords(segment);
  const hookText = hookWords.join(' ').toLowerCase();

  let score = 30; // baseline

  // Reward: opens with a question
  if (hookText.includes('?') || /^(why|how|what|when|who|where|did|do|does|is|are|can|could|would|should|have)\b/.test(hookText)) {
    score += 25;
  }

  // Reward: opens with a number or statistic
  if (/\b\d+\b/.test(hookText)) {
    score += 15;
  }

  // Reward: opens with a bold claim or superlative
  const boldClaims = ['never', 'always', 'best', 'worst', 'only', 'every', 'nobody', 'everyone', 'most people', 'the truth', 'the secret', 'the problem'];
  for (const claim of boldClaims) {
    if (hookText.includes(claim)) {
      score += 15;
      break;
    }
  }

  // Reward: emotional/exclamatory opening
  if (hookText.includes('!') || /\b(incredible|insane|unbelievable|shocking|amazing|crazy)\b/.test(hookText)) {
    score += 10;
  }

  // Penalty: opens with filler words
  const firstWord = wordsArr[0] || '';
  const firstTwoWords = wordsArr.slice(0, 2).join(' ');
  for (const filler of SCORING_CONFIG.fillerWords) {
    if (firstWord === filler || firstTwoWords === filler) {
      score -= 25;
      break;
    }
  }

  // Penalty: opens with continuation words (needs prior context)
  for (const cont of SCORING_CONFIG.continuationOpeners) {
    if (hookText.startsWith(cont)) {
      score -= 20;
      break;
    }
  }

  return clamp(score, 0, 100);
}

/**
 * Get the words from the first ~3 seconds of a segment.
 */
function getHookWords(segment) {
  const hookEnd = segment.start + SCORING_CONFIG.hookWindowSeconds;

  if (segment.words && segment.words.length > 0) {
    return segment.words
      .filter(w => w.start < hookEnd)
      .map(w => w.word);
  }

  // Fallback: approximate — first ~20% of words
  const allWords = (segment.text || '').split(/\s+/);
  const hookCount = Math.max(3, Math.ceil(allWords.length * 0.2));
  return allWords.slice(0, hookCount);
}

// ─────────────────────────────────────────────
// Signal 2: Standalone Comprehensibility
// ─────────────────────────────────────────────
function scoreStandalone(wordsArr, text) {
  if (wordsArr.length === 0) return 0;

  let score = 70; // start optimistic

  // Penalty: first sentence has dangling pronouns without antecedent
  const firstSentence = text.split(/[.!?]/)[0]?.toLowerCase() || '';
  const firstSentenceWords = firstSentence.split(/\s+/).filter(Boolean);

  for (const ref of SCORING_CONFIG.danglingReferences) {
    // Only penalize if the pronoun appears in the first 5 words (likely needs context)
    const idx = firstSentenceWords.indexOf(ref);
    if (idx >= 0 && idx < 5) {
      score -= 12;
      break; // only penalize once for first-sentence pronouns
    }
  }

  // Penalty: starts with continuation opener
  const firstTwo = wordsArr.slice(0, 2).join(' ');
  for (const cont of SCORING_CONFIG.continuationOpeners) {
    if (firstTwo.startsWith(cont) || wordsArr[0] === cont) {
      score -= 15;
      break;
    }
  }

  // Penalty: contains "as I mentioned", "like I said", etc.
  const contextRefs = ['as i mentioned', 'like i said', 'remember when', 'going back to', 'earlier i said', 'this thing i mentioned'];
  for (const ref of contextRefs) {
    if (text.toLowerCase().includes(ref)) {
      score -= 10;
    }
  }

  // Reward: segment introduces its own topic/subject clearly
  const introPatterns = ['today', 'let me tell you', 'here\'s', 'the thing about', 'imagine', 'picture this', 'have you ever'];
  for (const intro of introPatterns) {
    if (text.toLowerCase().startsWith(intro) || firstSentence.includes(intro)) {
      score += 10;
      break;
    }
  }

  return clamp(score, 0, 100);
}

// ─────────────────────────────────────────────
// Signal 3: Payoff / Structure
// ─────────────────────────────────────────────
function scorePayoff(wordsArr, text) {
  if (wordsArr.length === 0) return 0;

  const lower = text.toLowerCase();
  let score = 20; // baseline

  // Divide text into thirds
  const thirdLen = Math.floor(wordsArr.length / 3);
  const firstThird = wordsArr.slice(0, thirdLen).join(' ');
  const lastThird = wordsArr.slice(-thirdLen).join(' ');
  const last15Pct = wordsArr.slice(-Math.max(3, Math.ceil(wordsArr.length * 0.15))).join(' ');

  // Setup markers in first third
  const setupMarkers = ['problem', 'issue', 'challenge', 'question', 'wonder', 'struggle', 'confused'];
  for (const m of setupMarkers) {
    if (firstThird.includes(m)) { score += 10; break; }
  }

  // Transition/tension markers in middle
  const tensionMarkers = ['but', 'however', 'although', 'yet', 'despite', 'until', 'then'];
  for (const m of tensionMarkers) {
    if (lower.includes(m)) { score += 10; break; }
  }

  // Payoff markers in the last 15%
  for (const marker of SCORING_CONFIG.payoffMarkers) {
    if (last15Pct.includes(marker)) {
      score += 25;
      break;
    }
  }

  // Reward: last third contains resolution language
  const resolutionWords = ['realized', 'learned', 'discovered', 'answer', 'solution', 'worked', 'changed', 'finally', 'result'];
  for (const r of resolutionWords) {
    if (lastThird.includes(r)) { score += 10; break; }
  }

  // Reward: contains a question AND an answer (mini Q&A arc)
  if (lower.includes('?') && (lower.includes('the answer') || lower.includes('it\'s') || lower.includes('because'))) {
    score += 10;
  }

  // Penalty: ends mid-sentence (no sentence-ending punctuation in last 10 words)
  const lastWords = wordsArr.slice(-10).join(' ');
  if (!/[.!?]/.test(lastWords)) {
    score -= 15;
  }

  return clamp(score, 0, 100);
}

// ─────────────────────────────────────────────
// Signal 4: Emotional / Energy Signal
// ─────────────────────────────────────────────
function scoreEmotion(wordsArr, segment) {
  if (wordsArr.length === 0) return 0;

  let score = 20; // baseline

  // Emotional word density
  const emotionalWords = new Set(SCORING_CONFIG.emotionalWords);
  let emotionCount = 0;
  for (const w of wordsArr) {
    if (emotionalWords.has(w.replace(/[^a-z]/g, ''))) emotionCount++;
  }
  const emotionRatio = emotionCount / wordsArr.length;

  if (emotionRatio >= 0.08) score += 30;
  else if (emotionRatio >= 0.05) score += 25;
  else if (emotionRatio >= 0.03) score += 15;
  else if (emotionRatio >= 0.01) score += 5;

  // Exclamation marks
  const text = segment.text || '';
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(15, exclamations * 5);

  // Superlatives
  const superlatives = (text.match(/\b(most|best|worst|biggest|smallest|fastest|greatest|least|largest|highest|lowest)\b/gi) || []).length;
  score += Math.min(15, superlatives * 5);

  // Speaking rate variance (proxy for excitement from word timestamps)
  if (segment.words && segment.words.length >= 10) {
    const rateVariance = computeSpeakingRateVariance(segment.words);
    if (rateVariance > 2.0) score += 15;      // high variance = dynamic delivery
    else if (rateVariance > 1.0) score += 8;
  }

  // All-caps words (emphasis proxy)
  const capsWords = (text.match(/\b[A-Z]{2,}\b/g) || []).length;
  score += Math.min(10, capsWords * 3);

  return clamp(score, 0, 100);
}

/**
 * Compute speaking rate variance across a segment's words.
 * High variance = speaker speeds up/slows down = more dynamic.
 */
function computeSpeakingRateVariance(words) {
  if (words.length < 6) return 0;

  // Compute words-per-second in 3-second windows
  const rates = [];
  const windowSize = 3; // seconds
  let i = 0;

  while (i < words.length) {
    const windowEnd = words[i].start + windowSize;
    let count = 0;
    let j = i;
    while (j < words.length && words[j].start < windowEnd) {
      count++;
      j++;
    }
    if (j > i) {
      const actualDuration = words[Math.min(j, words.length) - 1].end - words[i].start;
      if (actualDuration > 0) {
        rates.push(count / actualDuration);
      }
    }
    i = j || i + 1;
  }

  if (rates.length < 2) return 0;

  // Compute standard deviation of rates
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance);
}

// ─────────────────────────────────────────────
// Signal 5: Topic Density (Genre Relevance)
// ─────────────────────────────────────────────
function scoreTopicDensity(wordsArr, profile) {
  if (wordsArr.length === 0 || !profile.keywords || profile.keywords.length === 0) {
    return 50; // neutral score when no genre keywords
  }

  const text = wordsArr.join(' ');
  let matchCount = 0;

  for (const keyword of profile.keywords) {
    // Support multi-word keywords
    if (keyword.includes(' ')) {
      if (text.includes(keyword)) matchCount += 2; // multi-word matches count double
    } else {
      if (wordsArr.includes(keyword)) matchCount++;
    }
  }

  const density = matchCount / wordsArr.length;

  if (density >= 0.06) return 95;
  if (density >= 0.04) return 80;
  if (density >= 0.02) return 65;
  if (density >= 0.01) return 45;
  if (matchCount > 0) return 30;
  return 10;
}

// ─────────────────────────────────────────────
// Signal 6: Length Fit
// ─────────────────────────────────────────────
function scoreLengthFit(durationSec) {
  const [idealMin, idealMax] = SCORING_CONFIG.idealLengthRange;
  const [hardMin, hardMax] = SCORING_CONFIG.lengthPenaltyRange;

  // Reject segments outside hard limits
  if (durationSec < hardMin || durationSec > hardMax) return 0;

  // Perfect score within ideal range
  if (durationSec >= idealMin && durationSec <= idealMax) return 100;

  // Gaussian-like falloff outside ideal range
  const idealCenter = (idealMin + idealMax) / 2;
  const distance = Math.abs(durationSec - idealCenter);
  const sigma = (idealMax - idealMin); // spread

  const score = 100 * Math.exp(-0.5 * (distance / sigma) ** 2);
  return clamp(Math.round(score), 5, 100);
}

// ─── Utility ─────────────────────────────────
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
