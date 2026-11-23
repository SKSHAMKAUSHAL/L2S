// =============================================
// L2S — High-Precision ASS Subtitle Engine
// =============================================
// Generates professional Advanced SubStation Alpha (.ass) scripts
// targeting the 1080x1920 9:16 portrait video format.
// Features multi-script font styling (Devanagari + Latin), safe-area positioning,
// injection-safe character escaping, and dynamic per-word highlight animations.

import { getCaptionPreset, hexToAssColor } from './presets.js';
import { chunkWords } from './chunker.js';
import { isDevanagari, SCRIPT_FONTS } from './fonts.js';

/**
 * Format time in seconds to ASS timestamp format: H:MM:SS.CC (centisecond precision)
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
 * Escape raw text for ASS dialogue lines to prevent override-tag injection
 * Escapes backslashes, replaces curly braces with fullwidth variants,
 * and formats newlines as ASS line break \N.
 */
export function escapeASSText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\\/g, '/')          // Neutralize backslash injection
    .replace(/\{/g, '｛')         // Neutralize open brace
    .replace(/\}/g, '｝')         // Neutralize close brace
    .replace(/\r?\n/g, '\\N')     // Convert newline to ASS line break
    .trim();
}

/**
 * Check if word-level timestamps are present and valid
 */
export function hasWordTimestamps(words) {
  if (!Array.isArray(words) || words.length === 0) return false;
  let validWordCount = 0;
  for (const w of words) {
    const text = (w?.word || w?.text || '').trim();
    const isSingleWord = text.length > 0 && !/\s+/.test(text);
    if (isSingleWord && typeof w?.start === 'number' && typeof w?.end === 'number' && w.end > w.start) {
      validWordCount++;
    }
  }
  return (validWordCount / words.length) >= 0.5;
}

/**
 * Generate full ASS script string from words array and style options
 */
export function generateASSScript(words, styleId = 'hormozi', options = {}) {
  const preset = getCaptionPreset(styleId);

  const offset = Number(options.offset) || 0;
  const fontSize = Number(options.fontSize) || preset.fontSize;
  const marginV = Number(options.marginV ?? options.bottomMargin) || preset.marginV;
  const latinFont = options.fontFamily || options.fontName || preset.fonts?.latin || preset.fontName || SCRIPT_FONTS.latin_bold;
  const devanagariFont = preset.fonts?.devanagari || SCRIPT_FONTS.devanagari;
  const alignment = Number(options.alignment) || preset.alignment;

  const isUppercase = options.uppercase !== undefined ? options.uppercase : (preset.uppercase || false);

  const primaryColor = options.textColor ? hexToAssColor(options.textColor) : preset.primaryColor;
  const highlightColor = options.highlightColor ? hexToAssColor(options.highlightColor) : preset.highlightColor;
  const secondaryColor = preset.secondaryColor || '&H000000FF';

  // Build header with two font styles: Default (Latin) and Devanagari (Hindi)
  const header = `[Script Info]
Title: L2S Professional Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${latinFont},${fontSize},${primaryColor},${secondaryColor},${preset.outlineColor},${preset.backColor || '&H00000000'},${preset.bold ? -1 : 0},${preset.italic ? -1 : 0},0,0,100,100,0,0,${preset.borderStyle},${preset.outlineWidth},${preset.shadowDepth},${alignment},40,40,${marginV},1
Style: Devanagari,${devanagariFont},${fontSize},${primaryColor},${secondaryColor},${preset.outlineColor},${preset.backColor || '&H00000000'},${preset.bold ? -1 : 0},${preset.italic ? -1 : 0},0,0,100,100,0,0,${preset.borderStyle},${preset.outlineWidth},${preset.shadowDepth},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (!words || words.length === 0) {
    return header;
  }

  // Chunk words into cohesive subtitle units
  const captions = chunkWords(words, {
    offset,
    wordsPerCaption: options.wordsPerCaption || preset.wordsPerCaption || 3,
  });

  if (captions.length === 0) {
    return header;
  }

  const events = [];

  for (const caption of captions) {
    const captionHasHindi = isDevanagari(caption.text);
    const styleName = captionHasHindi ? 'Devanagari' : 'Default';

    // Highlight Style: Karaoke (\k tags)
    if (preset.highlightStyle === 'karaoke') {
      const karaokeTokens = caption.words.map(w => {
        const rawText = isUppercase ? w.word.toUpperCase() : w.word;
        const safeWord = escapeASSText(rawText);
        const durationCentis = Math.max(1, Math.round(((w.end - w.start) * 100)));
        return `{\\k${durationCentis}}${safeWord}`;
      }).join(' ');

      const start = formatASSTime(caption.start);
      const end = formatASSTime(caption.end);
      events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${karaokeTokens}`);
      continue;
    }

    // Highlight Style: Minimal / None (Single event per caption)
    if (preset.highlightStyle === 'none') {
      const rawText = isUppercase ? caption.text.toUpperCase() : caption.text;
      const safeText = escapeASSText(rawText);
      const start = formatASSTime(caption.start);
      const end = formatASSTime(caption.end);
      events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${safeText}`);
      continue;
    }

    // Word-by-word active highlight styles (Hormozi, Pop, Underline, Neon, Box, Color)
    for (let i = 0; i < caption.words.length; i++) {
      const activeWord = caption.words[i];
      const startSec = Math.max(caption.start, activeWord.start);
      const nextWord = caption.words[i + 1];
      const endSec = Math.min(caption.end, Math.max(startSec + 0.1, nextWord ? nextWord.start : caption.end));

      const start = formatASSTime(startSec);
      const end = formatASSTime(endSec);

      let textTokens = [];
      for (let j = 0; j < caption.words.length; j++) {
        const w = caption.words[j];
        const rawText = isUppercase ? w.word.toUpperCase() : w.word;
        const safeWord = escapeASSText(rawText);

        if (j === i) {
          // Format active word according to preset highlight style
          switch (preset.highlightStyle) {
            case 'scale': // Hormozi scale up
              textTokens.push(`{\\c${highlightColor}\\fscx115\\fscy115}${safeWord}{\\c${primaryColor}\\fscx100\\fscy100}`);
              break;

            case 'pop': // Animated entrance bounce
              textTokens.push(`{\\fscx125\\fscy125\\c${highlightColor}\\t(0,80,\\fscx120\\fscy120)\\t(80,180,\\fscx100\\fscy100)}${safeWord}{\\c${primaryColor}\\fscx100\\fscy100}`);
              break;

            case 'underline': // Accent underline
              textTokens.push(`{\\c${highlightColor}\\u1}${safeWord}{\\c${primaryColor}\\u0}`);
              break;

            case 'glow': // Neon intense glow
              textTokens.push(`{\\c${highlightColor}\\3c${highlightColor}\\shad5}${safeWord}{\\c${primaryColor}\\3c${preset.outlineColor}\\shad${preset.shadowDepth}}`);
              break;

            case 'box': // Solid box
            case 'color': // Simple color highlight
            default:
              textTokens.push(`{\\c${highlightColor}}${safeWord}{\\c${primaryColor}}`);
              break;
          }
        } else {
          textTokens.push(safeWord);
        }
      }

      events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${textTokens.join(' ')}`);
    }
  }

  return header + events.join('\n');
}
