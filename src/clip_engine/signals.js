// =============================================
// L2S — Clip Engine: Multimodal Signals (Audio, Heatmap, Pace, Lexicon)
// =============================================
// Computes engagement signals per candidate:
// 1. YouTube "Most Replayed" heatmap average
// 2. Audio energy / loudness variance via FFmpeg
// 3. Speech pace variance from word-level timestamps
// 4. Multilingual lexical cues (questions, numbers, contradictions, superlatives)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load multilingual lexicon
let lexicon = { questions: {}, numbers: {}, contradictions: {}, superlatives: {} };
try {
  const lexPath = path.join(__dirname, 'lexicon.json');
  if (fs.existsSync(lexPath)) {
    lexicon = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
  }
} catch {}

/**
 * Extract audio loudness profile across an entire audio file once with FFmpeg ebur128.
 * Returns array of { t: seconds, momentary: LUFS }
 */
export function extractAudioLoudness(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return null;
  }

  try {
    // Run ebur128 with 1s interval
    const output = execFileSync('ffmpeg', [
      '-nostats',
      '-i', audioPath,
      '-filter_complex', 'ebur128=metadata=1',
      '-f', 'null',
      '-',
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Parse lines like: [Parsed_ebur128_0 @ ...] t: 1.2 M: -23.4 S: -24.1
    const points = [];
    const regex = /t:\s*([\d.]+)\s+M:\s*([-\d.]+)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      const t = parseFloat(match[1]);
      const m = parseFloat(match[2]);
      if (!isNaN(t) && !isNaN(m)) {
        points.push({ t, m });
      }
    }

    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

/**
 * Compute average YouTube heatmap score inside candidate range
 */
export function computeHeatmapScore(heatmap, start, end) {
  if (!Array.isArray(heatmap) || heatmap.length === 0) {
    return null;
  }

  let totalValue = 0;
  let count = 0;

  for (const point of heatmap) {
    const pStart = point.start_time ?? point.start ?? 0;
    const pEnd = point.end_time ?? point.end ?? pStart + 1;
    const val = point.value ?? point.normalized_value ?? point.weight ?? 0;

    // Check overlap with candidate [start, end]
    const overlap = Math.max(0, Math.min(pEnd, end) - Math.max(pStart, start));
    if (overlap > 0) {
      totalValue += Number(val) || 0;
      count++;
    }
  }

  if (count === 0) return 50;
  const avg = totalValue / count;
  // If avg is 0.0 - 1.0, scale to 0-100; if already 0-100, keep as is
  return Math.min(100, Math.max(0, avg > 1 ? avg : avg * 100));
}

/**
 * Compute audio energy score from pre-extracted loudness points
 */
export function computeAudioEnergyScore(loudnessPoints, start, end) {
  if (!Array.isArray(loudnessPoints) || loudnessPoints.length === 0) {
    return null;
  }

  const windowPoints = loudnessPoints.filter(p => p.t >= start && p.t <= end);
  if (windowPoints.length === 0) return 50;

  const values = windowPoints.map(p => p.m).sort((a, b) => a - b);
  const p10 = values[Math.floor(values.length * 0.1)] || values[0];
  const p90 = values[Math.floor(values.length * 0.9)] || values[values.length - 1];
  const dynamicRange = Math.abs(p90 - p10); // LUFS dynamic range

  // Higher dynamic range (e.g. 8-15 LUFS) indicates emotional highs & punchlines
  const rangeScore = Math.min(100, Math.max(20, dynamicRange * 7));
  return rangeScore;
}

/**
 * Compute speech pace variance score
 */
export function computeSpeechPaceScore(words, start, end) {
  if (!Array.isArray(words) || words.length < 5) {
    return 50;
  }

  const duration = Math.max(1, end - start);
  const avgWps = words.length / duration;

  // Ideal speech rate is 2.2 to 3.5 words/second
  let paceScore = 70;
  if (avgWps >= 2.2 && avgWps <= 3.6) {
    paceScore = 90;
  } else if (avgWps >= 1.6 && avgWps <= 4.2) {
    paceScore = 75;
  } else {
    paceScore = 50;
  }

  // Slice into 3-second windows to compute variance
  const windowSize = 3.0;
  const rates = [];
  for (let t = start; t < end; t += windowSize) {
    const count = words.filter(w => w.start >= t && w.start < t + windowSize).length;
    rates.push(count / windowSize);
  }

  if (rates.length >= 2) {
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
    // Moderate variance (energy shifts) is great for retention
    if (variance > 0.4 && variance < 2.5) {
      paceScore = Math.min(100, paceScore + 10);
    }
  }

  return paceScore;
}

/**
 * Compute lexical virality score from multilingual cues
 */
export function computeLexiconScore(text = '', language = 'en') {
  if (!text) return 50;
  const lower = text.toLowerCase();

  let matches = 0;
  const langKey = language.startsWith('hi') ? 'hi' : (language.includes('hing') ? 'hinglish' : 'en');

  // Check questions
  const qList = [...(lexicon.questions[langKey] || []), ...(lexicon.questions.en || [])];
  if (qList.some(q => lower.includes(q.toLowerCase()))) matches += 2;

  // Check numbers
  const nList = [...(lexicon.numbers[langKey] || []), ...(lexicon.numbers.en || [])];
  if (nList.some(n => lower.includes(n.toLowerCase()))) matches += 2;

  // Check contradictions
  const cList = [...(lexicon.contradictions[langKey] || []), ...(lexicon.contradictions.en || [])];
  if (cList.some(c => lower.includes(c.toLowerCase()))) matches += 2;

  // Check superlatives
  const sList = [...(lexicon.superlatives[langKey] || []), ...(lexicon.superlatives.en || [])];
  if (sList.some(s => lower.includes(s.toLowerCase()))) matches += 2;

  return Math.min(100, 45 + matches * 8);
}

/**
 * Compute all signals for a candidate and return combined signals score
 *
 * @param {Object} candidate - Candidate clip with start, end, text, words
 * @param {Object} [options]
 * @param {Array} [options.heatmap] - YouTube most replayed heatmap
 * @param {Array} [options.loudnessPoints] - Pre-extracted loudness points
 * @returns {{score: number, breakdown: Object}}
 */
export function computeCandidateSignals(candidate, options = {}) {
  const { heatmap, loudnessPoints } = options;
  const { start, end, text, words, language = 'en' } = candidate;

  const heatmapScore = computeHeatmapScore(heatmap, start, end);
  const audioScore = computeAudioEnergyScore(loudnessPoints, start, end);
  const paceScore = computeSpeechPaceScore(words, start, end);
  const lexiconScore = computeLexiconScore(text, language);

  // Dynamic weight renormalisation
  let weights = {
    heatmap: heatmapScore !== null ? 0.30 : 0.0,
    audio: audioScore !== null ? 0.30 : 0.0,
    pace: 0.20,
    lexicon: 0.20,
  };

  const totalWeight = weights.heatmap + weights.audio + weights.pace + weights.lexicon;
  const normWeights = {
    heatmap: weights.heatmap / totalWeight,
    audio: weights.audio / totalWeight,
    pace: weights.pace / totalWeight,
    lexicon: weights.lexicon / totalWeight,
  };

  const finalScore = Math.round(
    (heatmapScore !== null ? heatmapScore * normWeights.heatmap : 0) +
    (audioScore !== null ? audioScore * normWeights.audio : 0) +
    paceScore * normWeights.pace +
    lexiconScore * normWeights.lexicon
  );

  return {
    score: Math.min(100, Math.max(0, finalScore)),
    breakdown: {
      heatmap: heatmapScore,
      audio: audioScore,
      pace: paceScore,
      lexicon: lexiconScore,
      weights: normWeights,
    },
  };
}
