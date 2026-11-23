// =============================================
// L2S — Script Detection & Statistics Utilities
// =============================================
// Identifies script composition (Devanagari vs Latin) for words and sentences
// to inform transliteration and multi-script caption typography.

/**
 * Detect script category for a given word or text
 *
 * @param {string} text - Input text
 * @returns {'devanagari'|'latin'|'mixed'|'other'}
 */
export function detectScript(text) {
  if (!text || typeof text !== 'string') return 'other';
  const clean = text.trim();
  if (!clean) return 'other';

  const hasDev = /[\u0900-\u097F]/.test(clean);
  const hasLat = /[a-zA-Z]/.test(clean);

  if (hasDev && hasLat) return 'mixed';
  if (hasDev) return 'devanagari';
  if (hasLat) return 'latin';
  return 'other';
}

/**
 * Compute detailed script statistics over an array of words
 *
 * @param {Array<Object|string>} words - Words array or tokens
 * @returns {Object} Script breakdown and percentage shares
 */
export function scriptStats(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return {
      devanagariChars: 0,
      latinChars: 0,
      otherChars: 0,
      totalChars: 0,
      devanagariWords: 0,
      latinWords: 0,
      mixedWords: 0,
      otherWords: 0,
      totalWords: 0,
      devanagariShare: 0,
      latinShare: 0,
    };
  }

  let devanagariChars = 0;
  let latinChars = 0;
  let otherChars = 0;

  let devanagariWords = 0;
  let latinWords = 0;
  let mixedWords = 0;
  let otherWords = 0;

  for (const item of words) {
    const text = (typeof item === 'string' ? item : (item?.word || item?.text || '')).trim();
    if (!text) continue;

    const script = detectScript(text);
    if (script === 'devanagari') devanagariWords++;
    else if (script === 'latin') latinWords++;
    else if (script === 'mixed') mixedWords++;
    else otherWords++;

    for (const char of text) {
      if (/[\u0900-\u097F]/.test(char)) devanagariChars++;
      else if (/[a-zA-Z]/.test(char)) latinChars++;
      else otherChars++;
    }
  }

  const totalWords = devanagariWords + latinWords + mixedWords + otherWords;
  const totalChars = devanagariChars + latinChars + otherChars;

  // Compute character shares
  const devanagariShare = totalChars > 0 ? (devanagariChars / totalChars) : 0;
  const latinShare = totalChars > 0 ? (latinChars / totalChars) : 0;

  return {
    devanagariChars,
    latinChars,
    otherChars,
    totalChars,
    devanagariWords,
    latinWords,
    mixedWords,
    otherWords,
    totalWords,
    devanagariShare,
    latinShare,
  };
}
