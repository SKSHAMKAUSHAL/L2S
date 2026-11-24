// =============================================
// L2S — Clip Engine: Sentences Builder
// =============================================
// Unicode-aware sentence boundary extraction from word timestamps.
// Splits on standard punctuation (. ? !), Hindi danda (।), and pauses > 0.7s.

const PUNCTUATION_REGEX = /[.?!।]/u;

/**
 * Extract clean word text
 */
function cleanWord(w) {
  if (!w) return '';
  return (w.word || w.text || '').trim();
}

/**
 * Build sentences with exact start, end, text, and word ranges.
 *
 * @param {Array<{word: string, start: number, end: number}>} words
 * @returns {Array<{id: string, start: number, end: number, text: string, words: Array, wordRange: [number, number]}>}
 */
export function buildSentences(words = []) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  // Filter out invalid items and normalize timestamps
  const validWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const text = cleanWord(w);
    if (!text) continue;
    validWords.push({
      word: text,
      start: typeof w.start === 'number' && !isNaN(w.start) ? Math.max(0, w.start) : 0,
      end: typeof w.end === 'number' && !isNaN(w.end) ? Math.max(0, w.end) : 0,
    });
  }

  if (validWords.length === 0) return [];

  const sentences = [];
  let currentWords = [];
  let startIndex = 0;

  for (let i = 0; i < validWords.length; i++) {
    const currentWord = validWords[i];
    const nextWord = validWords[i + 1];

    currentWords.push(currentWord);

    const hasPunctuation = PUNCTUATION_REGEX.test(currentWord.word);
    const hasLongPause = nextWord ? (nextWord.start - currentWord.end > 0.7) : false;
    const isLastWord = i === validWords.length - 1;

    if (hasPunctuation || hasLongPause || isLastWord) {
      const sentenceText = currentWords.map(w => w.word).join(' ');
      const start = currentWords[0].start;
      const end = currentWords[currentWords.length - 1].end;

      sentences.push({
        id: `S${sentences.length}`,
        start,
        end,
        text: sentenceText,
        words: [...currentWords],
        wordRange: [startIndex, i],
      });

      currentWords = [];
      startIndex = i + 1;
    }
  }

  return sentences;
}
