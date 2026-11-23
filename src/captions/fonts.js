// =============================================
// L2S — Caption Fonts & Script Detection
// =============================================
// Manages OFL licensed fonts for high-quality multi-script video captions.
// Detects Devanagari vs Latin characters to ensure Hindi text renders correctly
// without missing font glyph boxes.

import path from 'path';
import fs from 'fs';

export const FONTS_DIR = path.resolve('assets/fonts');

export const SCRIPT_FONTS = {
  devanagari: 'Noto Sans Devanagari',
  latin_bold: 'Montserrat',
  latin_display: 'Anton',
  latin_serif: 'Playfair Display',
};

// Check if a string contains any Devanagari script characters
export function isDevanagari(text) {
  if (!text || typeof text !== 'string') return false;
  return /[\u0900-\u097F]/.test(text);
}

// Detect script classification for a word or phrase
export function detectScript(text) {
  if (!text || typeof text !== 'string') return 'other';
  const hasDev = /[\u0900-\u097F]/.test(text);
  const hasLat = /[a-zA-Z]/.test(text);

  if (hasDev && hasLat) return 'mixed';
  if (hasDev) return 'devanagari';
  if (hasLat) return 'latin';
  return 'other';
}

// Return the appropriate font family name for a given caption text and preset
export function resolveFontForText(text, preset) {
  if (isDevanagari(text)) {
    return preset?.fonts?.devanagari || SCRIPT_FONTS.devanagari;
  }
  return preset?.fonts?.latin || preset?.fontName || SCRIPT_FONTS.latin_bold;
}

// Ensure the assets/fonts directory exists
export function ensureFontsAvailable() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }
  return fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));
}
