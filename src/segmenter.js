// =============================================
// L2S — Sliding Window Segment Generator
// =============================================
// Generates overlapping candidate segments from a transcript,
// aligned to sentence boundaries. Never cuts mid-word.

import { SCORING_CONFIG } from './genre_config.js';

/**
 * Generate overlapping candidate segments from a transcript.
 * Uses multiple window sizes with a sliding step, snapping to sentence boundaries.
 *
 * @param {Object} transcript - Whisper transcript { segments: [{ start, end, text, words }] }
 * @param {Object} [configOverrides] - Override SCORING_CONFIG values
 * @returns {CandidateSegment[]} Array of { id, start, end, text, words }
 */
export function generateCandidateSegments(transcript, configOverrides = {}) {
  if (!transcript || !Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    return [];
  }

  const config = { ...SCORING_CONFIG, ...configOverrides };
  const words = extractAllWords(transcript);

  if (words.length === 0) {
    // Fallback: use segment-level chunking when no word timestamps
    return generateFromSegments(transcript.segments, config);
  }

  // Find all sentence boundaries in the word list
  const sentenceBoundaries = findSentenceBoundaries(words);

  // Generate candidates across multiple window sizes
  const candidates = [];
  const seenKeys = new Set(); // deduplicate identical start/end pairs

  for (const windowSize of config.windowSizes) {
    const step = config.slideStep;
    const totalDuration = words[words.length - 1].end - words[0].start;

    for (let offset = 0; offset < totalDuration; offset += step) {
      const windowStart = words[0].start + offset;
      const windowEnd = windowStart + windowSize;

      // Snap start to nearest sentence boundary at or after windowStart
      const snappedStart = snapToSentenceStart(words, sentenceBoundaries, windowStart);
      if (snappedStart === -1) continue;

      // Snap end to nearest sentence boundary at or before windowEnd
      const snappedEnd = snapToSentenceEnd(words, sentenceBoundaries, windowEnd);
      if (snappedEnd === -1 || snappedEnd <= snappedStart) continue;

      // Extract words in this range
      const segmentWords = words.filter(w => w.start >= snappedStart && w.end <= snappedEnd);
      if (segmentWords.length < 5) continue; // too few words

      const duration = snappedEnd - snappedStart;
      if (duration < config.lengthPenaltyRange[0] || duration > config.lengthPenaltyRange[1]) continue;

      // Deduplicate: skip if we've seen this exact start/end (within 0.5s tolerance)
      const key = `${Math.round(snappedStart * 2)}_${Math.round(snappedEnd * 2)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      candidates.push({
        id: `seg_${candidates.length}`,
        start: snappedStart,
        end: snappedEnd,
        text: segmentWords.map(w => w.word).join(' '),
        words: segmentWords,
      });
    }
  }

  return candidates;
}

/**
 * Extract all words from transcript segments into a flat, sorted array.
 */
function extractAllWords(transcript) {
  if (!transcript || !Array.isArray(transcript.segments)) return [];
  const allWords = [];

  for (const seg of transcript.segments) {
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        if (w.word && typeof w.start === 'number' && typeof w.end === 'number') {
          allWords.push({
            word: w.word.trim(),
            start: w.start,
            end: w.end,
          });
        }
      }
    }
  }

  // Sort by start time (should already be sorted, but ensure it)
  allWords.sort((a, b) => a.start - b.start);
  return allWords;
}

/**
 * Find indices of words that end sentences (punctuation-based).
 * Returns a Set of word indices where sentences end.
 */
function findSentenceBoundaries(words) {
  const boundaries = new Set();
  const SENTENCE_ENDERS = /[.!?]+$/;

  for (let i = 0; i < words.length; i++) {
    const cleaned = words[i].word.replace(/[^a-zA-Z0-9'.!?]/g, '');
    if (SENTENCE_ENDERS.test(cleaned)) {
      boundaries.add(i);
    }
  }

  // Also detect boundaries via long pauses (> 1.5s gap between words)
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= 1.5) {
      boundaries.add(i - 1);
    }
  }

  return boundaries;
}

/**
 * Snap a target start time to the beginning of the nearest sentence.
 * Finds the first word that starts a new sentence at or after targetTime.
 * Returns the start time of that word, or -1 if none found.
 */
function snapToSentenceStart(words, sentenceBoundaries, targetTime) {
  // Find the first sentence boundary that ends before or at targetTime,
  // then the sentence starts at boundary + 1
  for (let i = 0; i < words.length; i++) {
    if (words[i].start >= targetTime) {
      // Check if i is at a sentence start (i=0 or i-1 is a sentence boundary)
      if (i === 0 || sentenceBoundaries.has(i - 1)) {
        return words[i].start;
      }
      // Otherwise walk backwards to find the sentence start
      for (let j = i; j >= 0; j--) {
        if (j === 0) return words[0].start;
        if (sentenceBoundaries.has(j - 1)) return words[j].start;
      }
      return words[i].start; // fallback
    }
  }
  return -1;
}

/**
 * Snap a target end time to the end of the nearest completed sentence.
 * Finds the last sentence boundary at or before targetTime.
 * Returns the end time of that boundary word, or -1 if none found.
 */
function snapToSentenceEnd(words, sentenceBoundaries, targetTime) {
  let bestEnd = -1;

  for (const boundaryIdx of sentenceBoundaries) {
    if (words[boundaryIdx].end <= targetTime) {
      bestEnd = words[boundaryIdx].end;
    }
  }

  // If no sentence boundary found before targetTime, use the last word before targetTime
  if (bestEnd === -1) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].end <= targetTime) {
        bestEnd = words[i].end;
        break;
      }
    }
  }

  return bestEnd;
}

/**
 * Fallback: generate candidates from segment-level data (no word timestamps).
 */
function generateFromSegments(segments, config) {
  if (!segments || segments.length === 0) return [];

  const candidates = [];
  const totalDuration = segments[segments.length - 1].end - segments[0].start;

  for (const windowSize of config.windowSizes) {
    const step = config.slideStep;

    for (let offset = 0; offset < totalDuration; offset += step) {
      const windowStart = segments[0].start + offset;
      const windowEnd = windowStart + windowSize;

      const matchingSegs = segments.filter(
        s => s.start < windowEnd && s.end > windowStart
      );
      if (matchingSegs.length === 0) continue;

      const actualStart = Math.max(windowStart, matchingSegs[0].start);
      const actualEnd = Math.min(windowEnd, matchingSegs[matchingSegs.length - 1].end);
      const duration = actualEnd - actualStart;

      if (duration < config.lengthPenaltyRange[0] || duration > config.lengthPenaltyRange[1]) continue;

      const text = matchingSegs.map(s => s.text).join(' ').trim();
      if (!text) continue;

      candidates.push({
        id: `seg_${candidates.length}`,
        start: actualStart,
        end: actualEnd,
        text,
        words: [],
      });
    }
  }

  return candidates;
}
