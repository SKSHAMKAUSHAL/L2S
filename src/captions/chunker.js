// =============================================
// L2S — Caption Word Chunker
// =============================================
// Chunks timed words into 2-4 word captions for short-form video.
// Enforces line-length limits, punctuation and pause breaks, orphan avoidance,
// script-aware grapheme clustering, and seamless subtitle display durations.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Count visible grapheme clusters in a string (properly handles Devanagari & emojis)
 */
export function countGraphemes(str) {
  if (!str) return 0;
  let count = 0;
  for (const _ of segmenter.segment(str)) {
    count++;
  }
  return count;
}

/**
 * Check if a word ends with sentence-ending punctuation (. ? ! or Hindi danda । / ॥)
 */
export function isSentenceEnd(wordText) {
  if (!wordText || typeof wordText !== 'string') return false;
  return /[.!?।॥]$/.test(wordText.trim());
}

/**
 * Repair and normalize word timing array
 * Clamps negative times, enforces start <= end, and monotonic order.
 * Never throws on malformed or inverted data.
 */
export function sanitizeWords(words, offset = 0) {
  if (!Array.isArray(words) || words.length === 0) return [];

  const sanitized = [];
  let prevEnd = 0;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const text = (raw?.word || raw?.text || '').trim();
    if (!text) continue;

    let start = Math.max(0, (Number(raw.start) || 0) - offset);
    let end = Math.max(0, (Number(raw.end) || 0) - offset);

    // If times are inverted or zero duration, assign a minimum duration
    if (end <= start) {
      end = start + 0.2;
    }

    // Monotonic clamping: start cannot be before previous word start
    if (start < prevEnd && start < (sanitized[sanitized.length - 1]?.start || 0)) {
      start = sanitized[sanitized.length - 1]?.start || 0;
      if (end <= start) end = start + 0.2;
    }

    sanitized.push({
      ...raw,
      word: text,
      start,
      end,
    });

    prevEnd = end;
  }

  return sanitized;
}

/**
 * Main chunking function: groups words into readable subtitle units
 *
 * @param {Array<Object>} words - Raw words with { word, start, end }
 * @param {Object} [options={}] - Chunker configuration
 * @returns {Array<Object>} Array of caption units
 */
export function chunkWords(words, options = {}) {
  const offset = Number(options.offset) || 0;
  const sanitized = sanitizeWords(words, offset);
  if (sanitized.length === 0) return [];

  const wordsPerCaption = Math.min(4, Math.max(2, Number(options.wordsPerCaption) || 3));
  const charsPerLine = Number(options.charsPerLine) || 18;
  const maxLines = Number(options.maxLines) || 2;
  const pauseThreshold = Number(options.pauseThreshold) || 0.3;
  const maxGapToNext = Number(options.maxGapToNext) || 0.5;
  const tailPadding = Number(options.tailPadding) || 0.15;
  const minDisplayDuration = Number(options.minDisplayDuration) || 0.25;

  // Step 1: Split into pause/sentence-isolated segments
  const segments = [];
  let currentSegment = [sanitized[0]];

  for (let i = 1; i < sanitized.length; i++) {
    const prev = sanitized[i - 1];
    const curr = sanitized[i];
    const pause = curr.start - prev.end;

    if (isSentenceEnd(prev.word) || pause > pauseThreshold) {
      segments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // Step 2: Chunk each segment avoiding orphan single words
  const rawCaptions = [];

  for (const seg of segments) {
    let cursor = 0;
    while (cursor < seg.length) {
      const remaining = seg.length - cursor;

      let take = wordsPerCaption;

      // Handle small remaining slices to prevent single orphan words
      if (remaining <= wordsPerCaption) {
        take = remaining;
      } else if (remaining === wordsPerCaption + 1) {
        // e.g., if remaining is 4 and target is 3, split 2 + 2 instead of 3 + 1
        take = Math.floor(remaining / 2);
      } else if (remaining === 5 && wordsPerCaption === 3) {
        // 5 words with target 3 -> split into 3 + 2
        take = 3;
      }

      // Check line character limit constraint
      let slice = seg.slice(cursor, cursor + take);
      let totalGraphemes = countGraphemes(slice.map(w => w.word).join(' '));

      // If exceeding 2 lines worth of characters and take > 2, shrink take
      while (take > 2 && totalGraphemes > charsPerLine * maxLines) {
        take--;
        slice = seg.slice(cursor, cursor + take);
        totalGraphemes = countGraphemes(slice.map(w => w.word).join(' '));
      }

      const captionWords = slice;
      const start = captionWords[0].start;
      const lastWordEnd = captionWords[captionWords.length - 1].end;

      rawCaptions.push({
        start,
        rawEnd: lastWordEnd,
        words: captionWords,
        text: captionWords.map(w => w.word).join(' '),
      });

      cursor += take;
    }
  }

  // Step 3: Apply gap bridging, tail padding, and minimum display time
  const captions = [];

  for (let i = 0; i < rawCaptions.length; i++) {
    const cap = rawCaptions[i];
    const nextCap = rawCaptions[i + 1];

    let end;
    if (nextCap) {
      const gap = nextCap.start - cap.rawEnd;
      if (gap >= 0 && gap < maxGapToNext) {
        // Bridge small gaps so captions do not flicker between phrases
        end = nextCap.start;
      } else {
        end = cap.rawEnd + tailPadding;
      }
    } else {
      end = cap.rawEnd + tailPadding;
    }

    // Enforce minimum display duration
    end = Math.max(end, cap.start + minDisplayDuration);

    // Format text into maxLines
    const lines = formatLines(cap.words, charsPerLine, maxLines);

    captions.push({
      start: cap.start,
      end,
      words: cap.words,
      text: cap.text,
      lines,
    });
  }

  return captions;
}

/**
 * Format an array of words into lines capped at charsPerLine
 */
function formatLines(words, charsPerLine, maxLines) {
  if (words.length <= 2 || maxLines === 1) {
    return [words.map(w => w.word).join(' ')];
  }

  const lines = [];
  let currentWords = [];
  let currentLen = 0;

  for (const w of words) {
    const wLen = countGraphemes(w.word);
    const addedLen = currentLen === 0 ? wLen : currentLen + 1 + wLen;

    if (addedLen > charsPerLine && currentWords.length > 0 && lines.length < maxLines - 1) {
      lines.push(currentWords.map(x => x.word).join(' '));
      currentWords = [w];
      currentLen = wLen;
    } else {
      currentWords.push(w);
      currentLen = addedLen;
    }
  }

  if (currentWords.length > 0) {
    lines.push(currentWords.map(x => x.word).join(' '));
  }

  return lines;
}
