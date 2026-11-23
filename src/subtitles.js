// =============================================
// L2S — Subtitle Generator (SRT + ASS Facade)
// =============================================
// Keeps backward-compatible exports while delegating to the high-precision
// caption chunker and ASS engine.

import { generateASSScript, formatASSTime, escapeASSText, hasWordTimestamps } from './captions/ass_engine.js';
import { chunkWords } from './captions/chunker.js';
import {
  CAPTION_PRESETS,
  getCaptionPreset,
  hexToAssColor,
  assColorToHex,
  getSharedStyleModel,
} from './captions/presets.js';

export {
  CAPTION_PRESETS,
  getCaptionPreset,
  hexToAssColor,
  assColorToHex,
  getSharedStyleModel,
  generateASSScript as buildASSScript,
  formatASSTime,
  hasWordTimestamps,
  escapeASSText,
};

/**
 * Generate SRT subtitle file content
 */
export function generateSRT(words, _style = 'minimal', offset = 0) {
  if (!words || words.length === 0) return '';

  const captions = chunkWords(words, { offset, wordsPerCaption: 5, charsPerLine: 42 });
  if (captions.length === 0) return '';

  return captions.map((cap, i) => {
    return `${i + 1}\n${formatTime(cap.start)} --> ${formatTime(cap.end)}\n${cap.text}`;
  }).join('\n\n');
}

/**
 * Generate ASS subtitle file content using specified professional preset and options
 */
export function generateASS(words, style = 'hormozi', offset = 0, options = {}) {
  return generateASSScript(words, style, { offset, ...options });
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
  return String(num).padStart(length, '0');
}
