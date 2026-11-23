// =============================================
// L2S — High-Precision ASS Subtitle Generator
// =============================================
// Formats Advanced SubStation Alpha (.ass) scripts matching
// the 1080x1920 9:16 canvas with centisecond precision, ASS injection
// escaping, segment fallback, and synchronized preset styling.

import { getCaptionPreset, hexToAssColor } from './presets.js';

/**
 * Escape text for ASS dialogue lines to prevent ASS command injection
 * Neutralizes '{', '}', and backslashes while converting newlines to \N.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Sanitized ASS-safe text
 */
export function escapeASSText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\\/g, '/')          // Prevent backslash escape injection
    .replace(/\{/g, '｛')         // Neutralize ASS override open brace
    .replace(/\}/g, '｝')         // Neutralize ASS override close brace
    .replace(/\r?\n/g, '\\N')     // Convert newlines to ASS line breaks
    .trim();
}

/**
 * Format float seconds into ASS timestamp: H:MM:SS.CC (centiseconds)
 *
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted centisecond timestamp
 */
export function formatASSTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const centis = Math.floor((s % 1) * 100);

  const hh = String(hours);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const cc = String(centis).padStart(2, '0');

  return `${hh}:${mm}:${ss}.${cc}`;
}

/**
 * Check if word-level timestamps are present and valid
 *
 * @param {Array<Object>} words - Array of word objects
 * @returns {boolean} True if real word-level timings are present
 */
export function hasWordTimestamps(words) {
  if (!Array.isArray(words) || words.length === 0) return false;
  let validWordCount = 0;
  for (const w of words) {
    const text = (w?.word || w?.text || '').trim();
    // An individual timed word should not contain spaces (which indicate a segment/phrase)
    const isSingleWord = text.length > 0 && !/\s+/.test(text);
    if (isSingleWord && typeof w?.start === 'number' && typeof w?.end === 'number' && w.end > w.start) {
      validWordCount++;
    }
  }
  // At least 50% of items must be individual words with real timestamps
  return (validWordCount / words.length) >= 0.5;
}

/**
 * Generate full ASS subtitle script matching 1080x1920 canvas
 *
 * @param {Array<Object>} words - Word objects with { word, start, end }
 * @param {string} [styleId='bold'] - Preset ID
 * @param {Object} [options={}] - Custom style overrides
 * @returns {string} Complete .ass file contents
 */
export function buildASSScript(words, styleId = 'bold', options = {}) {
  const preset = getCaptionPreset(styleId);

  const offset = Number(options.offset) || 0;
  const fontSize = Number(options.fontSize) || preset.fontSize;
  const marginV = Number(options.marginV ?? options.bottomMargin) || preset.marginV;
  const fontName = options.fontFamily || options.fontName || preset.fontName;
  const alignment = Number(options.alignment) || preset.alignment;
  const textCase = options.textCase || 'uppercase';

  const primaryColor = options.textColor ? hexToAssColor(options.textColor) : preset.primaryColor;
  const highlightColor = options.highlightColor ? hexToAssColor(options.highlightColor) : (preset.highlightColor || '&H0000FFFF');

  const header = `[Script Info]
Title: L2S Professional Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${preset.secondaryColor || '&H000000FF'},${preset.outlineColor},${preset.backColor},${preset.bold ? -1 : 0},${preset.italic ? -1 : 0},0,0,100,100,0,0,${preset.borderStyle},${preset.outlineWidth},${preset.shadowDepth},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (!words || words.length === 0) {
    return header;
  }

  // Handle segment-level fallback if word-level timestamps are not present
  if (!hasWordTimestamps(words)) {
    return header + buildSegmentFallbackEvents(words, offset, preset, textCase);
  }

  const groups = groupWords(words, offset, preset.maxWordsPerLine || 4);
  const events = [];

  for (const group of groups) {
    if (!group.words || group.words.length === 0) continue;

    // Pop style: Display single word or short phrase with entrance bounce
    if (preset.id === 'pop') {
      for (let i = 0; i < group.words.length; i++) {
        const w = group.words[i];
        const nextW = group.words[i + 1];
        const start = formatASSTime(w.start);
        const end = formatASSTime(nextW ? nextW.start : w.end + 0.15);
        const safeText = escapeASSText(applyTextCase(w.word, textCase));
        const text = `{\\fscx125\\fscy125\\c${highlightColor}}${safeText}`;
        events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
      }
      continue;
    }

    // Word-by-word karaoke style: Highlight active word in sequence
    for (let i = 0; i < group.words.length; i++) {
      const activeWord = group.words[i];
      const start = formatASSTime(activeWord.start);
      const nextWord = group.words[i + 1];
      const end = formatASSTime(nextWord ? nextWord.start : group.end);

      let lineText = '';
      for (let j = 0; j < group.words.length; j++) {
        const w = escapeASSText(applyTextCase(group.words[j].word, textCase));
        if (j === i) {
          // Highlight active word and scale slightly
          lineText += `{\\c${highlightColor}\\fscx112\\fscy112}${w}{\\c${primaryColor}\\fscx100\\fscy100} `;
        } else {
          lineText += `${w} `;
        }
      }

      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${lineText.trim()}`);
    }
  }

  return header + events.join('\n');
}

/**
 * Build segment-level dialogue events when fine word-level timings are missing
 */
function buildSegmentFallbackEvents(words, offset, preset, textCase) {
  const events = [];
  const rawText = words.map(w => w.word || w.text || '').join(' ').trim();
  if (!rawText) return '';

  const minStart = Math.max(0, (words[0]?.start ?? 0) - offset);
  const maxEnd = Math.max(minStart + 1.5, (words[words.length - 1]?.end ?? (minStart + 4)) - offset);

  // Split into chunks of ~5-7 words
  const tokens = rawText.split(/\s+/);
  const chunkSize = preset.maxWordsPerLine || 5;
  const chunkCount = Math.ceil(tokens.length / chunkSize);
  const totalDuration = maxEnd - minStart;
  const chunkDuration = totalDuration / Math.max(1, chunkCount);

  for (let c = 0; c < chunkCount; c++) {
    const chunkTokens = tokens.slice(c * chunkSize, (c + 1) * chunkSize);
    const startSec = minStart + (c * chunkDuration);
    const endSec = Math.min(maxEnd, startSec + chunkDuration);

    const safeText = escapeASSText(applyTextCase(chunkTokens.join(' '), textCase));
    events.push(`Dialogue: 0,${formatASSTime(startSec)},${formatASSTime(endSec)},Default,,0,0,0,,${safeText}`);
  }

  return events.join('\n');
}

/**
 * Apply text casing transformation
 */
function applyTextCase(text, textCase) {
  if (!text) return '';
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'capitalize':
      return text.replace(/\b\w/g, c => c.toUpperCase());
    case 'normal':
    default:
      return text;
  }
}

/**
 * Group words into natural sentence chunks
 */
function groupWords(words, offset = 0, maxWords = 4) {
  const groups = [];
  let currentWords = [];
  let currentStart = 0;

  for (let i = 0; i < words.length; i++) {
    const rawWord = words[i];
    const text = (rawWord.word || '').trim();
    if (!text) continue;

    const start = Math.max(0, (rawWord.start || 0) - offset);
    const end = Math.max(0, (rawWord.end || 0) - offset);

    if (currentWords.length === 0) {
      currentStart = start;
    }

    currentWords.push({ word: text, start, end });

    // Cut if reached max words or end-of-sentence punctuation (. ? !)
    const hasPunctuation = /[.!?]$/.test(text);
    if (currentWords.length >= maxWords || hasPunctuation) {
      groups.push({
        start: currentStart,
        end,
        words: currentWords,
      });
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    groups.push({
      start: currentStart,
      end: currentWords[currentWords.length - 1].end,
      words: currentWords,
    });
  }

  return groups;
}
