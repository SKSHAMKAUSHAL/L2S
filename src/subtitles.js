// =============================================
// L2S — Subtitle Generator (SRT + ASS)
// =============================================

import { buildASSScript, formatASSTime, hasWordTimestamps, escapeASSText } from './captions/ass_builder.js';
import { CAPTION_PRESETS, getCaptionPreset, hexToAssColor, assColorToHex, getSharedStyleModel } from './captions/presets.js';

export {
  CAPTION_PRESETS,
  getCaptionPreset,
  hexToAssColor,
  assColorToHex,
  getSharedStyleModel,
  buildASSScript,
  formatASSTime,
  hasWordTimestamps,
  escapeASSText,
};

const MAX_LINE_LENGTH = 42;
const MAX_DISPLAY_DURATION = 3.5;

/**
 * Generate SRT subtitle file content
 * Gracefully handles word-level timestamps and segment fallback
 */
export function generateSRT(words, _style = "minimal", offset = 0) {
  if (!words || words.length === 0) return "";

  // If word-level timestamps are present, group by words
  if (hasWordTimestamps(words)) {
    const groups = groupWordsIntoCaptions(words, offset);
    return groups.map((group, i) => formatSRTBlock(i + 1, group)).join("\n\n");
  }

  // Graceful fallback for segment-level or untimed transcripts
  return buildSegmentFallbackSRT(words, offset);
}

/**
 * Generate ASS subtitle file content using specified professional preset and options
 */
export function generateASS(words, style = "bold", offset = 0, options = {}) {
  return buildASSScript(words, style, { offset, ...options });
}

function groupWordsIntoCaptions(words, offset = 0) {
  if (!words || words.length === 0) return [];

  const groups = [];
  let currentStart = Math.max(0, (words[0].start || 0) - offset);
  let currentEnd = Math.max(0, (words[0].end || 0) - offset);
  let currentWords = [];
  let currentLength = 0;

  for (const word of words) {
    const wordText = (word.word || word.text || "").trim();
    if (!wordText) continue;

    const wordStart = Math.max(0, (word.start || 0) - offset);
    const wordEnd = Math.max(0, (word.end || (wordStart + 0.3)) - offset);

    const newLength = currentLength + wordText.length + (currentLength > 0 ? 1 : 0);
    const displayDuration = wordEnd - currentStart;

    if ((newLength > MAX_LINE_LENGTH || displayDuration > MAX_DISPLAY_DURATION) && currentLength > 0) {
      groups.push({ start: currentStart, end: currentEnd, words: currentWords });
      currentStart = wordStart;
      currentEnd = wordEnd;
      currentWords = [{ ...word, word: wordText, start: wordStart, end: wordEnd }];
      currentLength = wordText.length;
    } else {
      currentWords.push({ ...word, word: wordText, start: wordStart, end: wordEnd });
      currentEnd = wordEnd;
      currentLength = newLength;
    }
  }

  if (currentWords.length > 0) {
    groups.push({ start: currentStart, end: currentEnd, words: currentWords });
  }
  return groups;
}

function buildSegmentFallbackSRT(words, offset = 0) {
  const rawText = words.map(w => (typeof w === 'string' ? w : (w.word || w.text || ''))).join(' ').trim();
  if (!rawText) return "";

  const minStart = Math.max(0, (words[0]?.start ?? 0) - offset);
  const maxEnd = Math.max(minStart + 1.5, (words[words.length - 1]?.end ?? (minStart + 4)) - offset);

  const tokens = rawText.split(/\s+/).filter(Boolean);
  const chunkSize = 5;
  const chunkCount = Math.ceil(tokens.length / chunkSize);
  const totalDuration = maxEnd - minStart;
  const chunkDuration = totalDuration / Math.max(1, chunkCount);

  const blocks = [];
  for (let c = 0; c < chunkCount; c++) {
    const chunkTokens = tokens.slice(c * chunkSize, (c + 1) * chunkSize);
    const startSec = minStart + (c * chunkDuration);
    const endSec = Math.min(maxEnd, startSec + chunkDuration);
    const text = chunkTokens.join(' ');

    blocks.push(`${c + 1}\n${formatTime(startSec)} --> ${formatTime(endSec)}\n${text}`);
  }

  return blocks.join("\n\n");
}

function formatSRTBlock(index, group) {
  const text = group.words.map(w => (w.word || w.text || "").trim()).join(" ");
  return `${index}\n${formatTime(group.start)} --> ${formatTime(group.end)}\n${text}`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
}

function pad(num, length = 2) {
  return String(num).padStart(length, "0");
}
