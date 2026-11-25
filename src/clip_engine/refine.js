// =============================================
// L2S — Clip Engine: Boundary Refiner
// =============================================
// Snaps cut points to sentence & word boundaries, applies 0.15s/0.30s safe padding
// without overlapping neighbouring words, resolves initial connectors/pronouns,
// and enforces duration bounds [15s, 90s].

const CONNECTOR_WORDS = new Set([
  'so', 'and', 'but', 'because', 'this', 'that', 'then',
  'ye', 'yeh', 'woh', 'voh', 'toh', 'to', 'aur', 'lekin', 'kyunki',
  'इसलिए', 'और', 'लेकिन', 'क्योंकि', 'यह', 'वह', 'तो', 'फिर',
]);

/**
 * Check if the sentence starts with an unresolved connector or pronoun
 */
function startsWithConnector(sentenceText = '') {
  const firstWord = (sentenceText.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^\p{L}]/gu, '');
  return CONNECTOR_WORDS.has(firstWord);
}

/**
 * Refine candidate boundaries
 *
 * @param {Object} candidate
 * @param {Array<Object>} allSentences - Ordered sentence objects
 * @param {Array<Object>} allWords - Ordered word objects across entire transcript
 * @param {Object} [options]
 * @param {number} [options.minDuration=15]
 * @param {number} [options.maxDuration=90]
 * @param {number} [options.targetMin=25]
 * @param {number} [options.targetMax=60]
 * @returns {Object} Refined candidate
 */
export function refineCandidate(candidate, allSentences = [], allWords = [], options = {}) {
  const {
    minDuration = 15,
    maxDuration = 90,
  } = options;

  if (!candidate || !allSentences.length) {
    return candidate;
  }

  const sentencesWithIdx = allSentences.map((s, idx) => ({ ...s, index: idx }));
  const sMap = new Map();
  sentencesWithIdx.forEach(s => sMap.set(s.id, s));

  let startSentence = sMap.get(candidate.startSentence);
  let endSentence = sMap.get(candidate.endSentence);

  if (!startSentence && typeof candidate.start === 'number') {
    startSentence = sentencesWithIdx.find(s => s.end > candidate.start) || sentencesWithIdx[0];
  } else if (!startSentence) {
    startSentence = sentencesWithIdx[0];
  }

  if (!endSentence && typeof candidate.end === 'number') {
    endSentence = [...sentencesWithIdx].reverse().find(s => s.start < candidate.end) || sentencesWithIdx[sentencesWithIdx.length - 1];
  } else if (!endSentence) {
    endSentence = sentencesWithIdx[sentencesWithIdx.length - 1];
  }

  if (startSentence.index > endSentence.index) {
    const temp = startSentence;
    startSentence = endSentence;
    endSentence = temp;
  }

  let penaltyApplied = false;

  // 1. Standalone connector / unresolved pronoun check
  if (startsWithConnector(startSentence.text)) {
    if (startSentence.index > 0) {
      const prevSentence = sentencesWithIdx[startSentence.index - 1];
      const gap = startSentence.start - prevSentence.end;

      if (gap <= 10 && (endSentence.end - prevSentence.start) <= maxDuration) {
        // Extend start back to include the preceding context
        startSentence = prevSentence;
      } else {
        penaltyApplied = true;
      }
    } else {
      penaltyApplied = true;
    }
  }

  // 2. Duration enforcement: expand if too short, shrink if too long
  let startIndex = startSentence.index;
  let endIndex = endSentence.index;

  // Expand forward or backward if shorter than minDuration (15s)
  while ((sentencesWithIdx[endIndex].end - sentencesWithIdx[startIndex].start) < minDuration) {
    if (endIndex + 1 < sentencesWithIdx.length && (sentencesWithIdx[endIndex + 1].end - sentencesWithIdx[startIndex].start) <= maxDuration) {
      endIndex++;
    } else if (startIndex - 1 >= 0 && (sentencesWithIdx[endIndex].end - sentencesWithIdx[startIndex - 1].start) <= maxDuration) {
      startIndex--;
    } else {
      break;
    }
  }

  // Shrink from the end if longer than maxDuration (90s)
  while ((sentencesWithIdx[endIndex].end - sentencesWithIdx[startIndex].start) > maxDuration && endIndex > startIndex) {
    endIndex--;
  }

  startSentence = sentencesWithIdx[startIndex];
  endSentence = sentencesWithIdx[endIndex];

  // 3. Exact word boundary snapping
  const candidateSentences = sentencesWithIdx.slice(startSentence.index, endSentence.index + 1);
  const candidateWords = candidateSentences.flatMap(s => s.words || []);
  const text = candidateSentences.map(s => s.text).join(' ');

  const firstWord = candidateWords[0];
  const lastWord = candidateWords[candidateWords.length - 1];

  let rawStart = firstWord ? firstWord.start : startSentence.start;
  let rawEnd = lastWord ? lastWord.end : endSentence.end;

  // 4. Safe padding: 0.15s before first word, 0.30s after last word, NEVER cutting into neighbours
  let paddedStart = rawStart;
  let paddedEnd = rawEnd;

  if (allWords.length > 0 && firstWord) {
    const firstWordGlobalIdx = allWords.findIndex(w => w === firstWord || (w.start === firstWord.start && w.word === firstWord.word));
    if (firstWordGlobalIdx > 0) {
      const prevWord = allWords[firstWordGlobalIdx - 1];
      const gapBefore = firstWord.start - prevWord.end;
      if (gapBefore > 0) {
        paddedStart = firstWord.start - Math.min(0.15, gapBefore * 0.45);
      } else {
        paddedStart = firstWord.start;
      }
    } else {
      paddedStart = Math.max(0, firstWord.start - 0.15);
    }
  } else {
    paddedStart = Math.max(0, rawStart - 0.15);
  }

  if (allWords.length > 0 && lastWord) {
    const lastWordGlobalIdx = allWords.findIndex(w => w === lastWord || (w.end === lastWord.end && w.word === lastWord.word));
    if (lastWordGlobalIdx >= 0 && lastWordGlobalIdx < allWords.length - 1) {
      const nextWord = allWords[lastWordGlobalIdx + 1];
      const gapAfter = nextWord.start - lastWord.end;
      if (gapAfter > 0) {
        paddedEnd = lastWord.end + Math.min(0.30, gapAfter * 0.45);
      } else {
        paddedEnd = lastWord.end;
      }
    } else {
      paddedEnd = rawEnd + 0.30;
    }
  } else {
    paddedEnd = rawEnd + 0.30;
  }

  // Final sanity clamp: ensure start < end and non-negative
  paddedStart = Math.max(0, paddedStart);
  paddedEnd = Math.max(paddedStart + 1.0, paddedEnd);
  const duration = Math.round(paddedEnd - paddedStart);

  let adjustedScore = candidate.finalScore ?? candidate.score ?? 70;
  if (penaltyApplied) {
    adjustedScore = Math.max(10, adjustedScore - 10);
  }

  return {
    ...candidate,
    start: paddedStart,
    end: paddedEnd,
    duration,
    text,
    words: candidateWords,
    startSentence: startSentence.id,
    endSentence: endSentence.id,
    finalScore: adjustedScore,
    connectorPenaltyApplied: penaltyApplied,
  };
}
