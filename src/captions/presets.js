// =============================================
// L2S — Professional Caption Presets
// =============================================
// 8 battle-tested caption presets for viral short-form video.
// Implements a unified shared configuration model that drives both
// FFmpeg ASS rendering and live HTML5 preview parity.

/**
 * Convert standard hex color (#RRGGBB) to ASS color format (&H00BBGGRR)
 * ASS uses BGR order with a 2-hex alpha prefix (00 = opaque, FF = fully transparent).
 */
export function hexToAssColor(hex, alpha = '00') {
  if (!hex || typeof hex !== 'string') return '&H00FFFFFF';
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  if (clean.length !== 6) return '&H00FFFFFF';

  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);

  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/**
 * Convert ASS color format (&H[AA]BBGGRR) to standard CSS hex (#RRGGBB)
 */
export function assColorToHex(assColor) {
  if (!assColor || typeof assColor !== 'string') return '#FFFFFF';
  const clean = assColor.replace(/&H/i, '').replace(/&/i, '').trim();

  // If 8 characters (&HAABBGGRR), ignore alpha AA
  let bgr = clean;
  if (clean.length === 8) {
    bgr = clean.slice(2);
  }
  if (bgr.length < 6) return '#FFFFFF';

  const b = bgr.slice(0, 2);
  const g = bgr.slice(2, 4);
  const r = bgr.slice(4, 6);

  return `#${r}${g}${b}`.toUpperCase();
}

export const CAPTION_PRESETS = {
  minimal: {
    id: 'minimal',
    name: 'Clean Minimal',
    category: 'Corporate / Tech / Business',
    description: 'Clean sans-serif with a soft semi-transparent background box. Zero distraction.',
    fontName: 'Arial',
    fallbackFonts: ['Helvetica', 'sans-serif'],
    fontSize: 70,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',      // White
    secondaryColor: '&H00E0E0E0',
    highlightColor: '&H00FFFFFF',
    outlineColor: '&H00101010',      // Charcoal outline
    backColor: '&H80000000',         // 50% black box
    outlineWidth: 2,
    shadowDepth: 0,
    borderStyle: 3,                  // Opaque background box
    alignment: 2,                    // Bottom center
    marginV: 360,                    // Platform safe margin
    maxWordsPerLine: 5,
    previewCss: {
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif',
      fontWeight: '700',
      color: '#FFFFFF',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      padding: '8px 18px',
      borderRadius: '8px',
      textShadow: 'none',
      border: 'none',
    },
  },

  cinematic: {
    id: 'cinematic',
    name: 'Cinematic',
    category: 'Storytelling / Documentary',
    description: 'Classic tracked serif with subtle drop shadow for emotional, narrative storytelling.',
    fontName: 'Georgia',
    fallbackFonts: ['Times New Roman', 'serif'],
    fontSize: 76,
    bold: false,
    italic: true,
    primaryColor: '&H00F0F0F0',
    secondaryColor: '&H00D0D0D0',
    highlightColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 2,
    shadowDepth: 4,
    borderStyle: 1,
    alignment: 2,
    marginV: 380,
    maxWordsPerLine: 6,
    previewCss: {
      fontFamily: '"Georgia", "Times New Roman", serif',
      fontWeight: '400',
      fontStyle: 'italic',
      color: '#F0F0F0',
      letterSpacing: '0.08em',
      textShadow: '0 4px 12px rgba(0, 0, 0, 0.85)',
      backgroundColor: 'transparent',
    },
  },

  bold: {
    id: 'bold',
    name: 'Bold Highlight',
    category: 'Viral TikTok / Reels (Default)',
    description: 'Ultra-bold condensed typography with vivid yellow active-word highlighting.',
    fontName: 'Arial Black',
    fallbackFonts: ['Impact', 'Arial', 'sans-serif'],
    fontSize: 90,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',      // White
    highlightColor: '&H0000FFFF',    // Vivid Yellow (BGR in ASS)
    outlineColor: '&H00000000',      // Solid black outline
    backColor: '&H00000000',
    outlineWidth: 6,
    shadowDepth: 3,
    borderStyle: 1,
    alignment: 2,
    marginV: 420,
    maxWordsPerLine: 4,
    previewCss: {
      fontFamily: '"Arial Black", Impact, system-ui, sans-serif',
      fontWeight: '900',
      color: '#FFFFFF',
      textShadow: '-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 10px rgba(0,0,0,0.9)',
      highlightColor: '#FFE600',
      backgroundColor: 'transparent',
    },
  },

  karaoke: {
    id: 'karaoke',
    name: 'Word-by-Word Karaoke',
    category: 'High-Tempo / Speeches',
    description: 'Words light up sequentially in neon green as the speaker articulates them.',
    fontName: 'Arial Black',
    fallbackFonts: ['Impact', 'Arial', 'sans-serif'],
    fontSize: 85,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H0000FF00',    // Neon Green
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 6,
    shadowDepth: 2,
    borderStyle: 1,
    alignment: 2,
    marginV: 420,
    maxWordsPerLine: 4,
    previewCss: {
      fontFamily: '"Arial Black", Impact, system-ui, sans-serif',
      fontWeight: '900',
      color: '#FFFFFF',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
      highlightColor: '#00FF66',
      backgroundColor: 'transparent',
    },
  },

  pop: {
    id: 'pop',
    name: 'Animated Word Pop',
    category: 'Fast-Paced Shorts / Punchy',
    description: 'Only 1 to 2 words on screen at once, bouncing with high visual energy.',
    fontName: 'Arial Black',
    fallbackFonts: ['Impact', 'Arial', 'sans-serif'],
    fontSize: 110,
    bold: true,
    italic: false,
    primaryColor: '&H0000FFFF',      // Electric Yellow
    highlightColor: '&H0000E5FF',    // Electric Cyan
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 8,
    shadowDepth: 4,
    borderStyle: 1,
    alignment: 5,                    // Middle center
    marginV: 0,
    maxWordsPerLine: 2,
    scalePercent: 120,
    previewCss: {
      fontFamily: '"Arial Black", Impact, system-ui, sans-serif',
      fontWeight: '900',
      color: '#FFE600',
      textTransform: 'uppercase',
      textShadow: '-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 6px 15px rgba(0,0,0,0.95)',
      highlightColor: '#00E5FF',
      backgroundColor: 'transparent',
    },
  },

  podcast: {
    id: 'podcast',
    name: 'Podcast Studio',
    category: 'Interviews / Conversations',
    description: 'Clean two-line bottom third with smooth readability and subtle contrast.',
    fontName: 'Arial',
    fallbackFonts: ['Helvetica', 'sans-serif'],
    fontSize: 68,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H00FFA500',    // Warm Amber
    outlineColor: '&H00000000',
    backColor: '&H60000000',
    outlineWidth: 3,
    shadowDepth: 2,
    borderStyle: 1,
    alignment: 2,
    marginV: 320,
    maxWordsPerLine: 5,
    previewCss: {
      fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
      fontWeight: '700',
      color: '#FFFFFF',
      textShadow: '0 2px 8px rgba(0,0,0,0.8)',
      highlightColor: '#FFA500',
      backgroundColor: 'transparent',
    },
  },

  educational: {
    id: 'educational',
    name: 'Educational / Explainer',
    category: 'Tutorials / Science / Facts',
    description: 'Rounded highlight badges emphasizing key takeaway concepts and definitions.',
    fontName: 'Trebuchet MS',
    fallbackFonts: ['Segoe UI', 'Arial', 'sans-serif'],
    fontSize: 75,
    bold: true,
    italic: false,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H00FFCC00',    // Cyan in ASS BGR
    outlineColor: '&H00201005',
    backColor: '&H00000000',
    outlineWidth: 4,
    shadowDepth: 3,
    borderStyle: 1,
    alignment: 2,
    marginV: 400,
    maxWordsPerLine: 4,
    previewCss: {
      fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
      fontWeight: '700',
      color: '#FFFFFF',
      textShadow: '-2px -2px 0 #0f172a, 2px -2px 0 #0f172a, -2px 2px 0 #0f172a, 2px 2px 0 #0f172a',
      highlightColor: '#38BDF8',
      backgroundColor: 'transparent',
    },
  },

  gaming: {
    id: 'gaming',
    name: 'Gaming / High Energy',
    category: 'Gaming / Memes / Reactions',
    description: 'Heavy slanted typography with an intense 8px outline for high-intensity action.',
    fontName: 'Impact',
    fallbackFonts: ['Arial Black', 'sans-serif'],
    fontSize: 98,
    bold: true,
    italic: true,
    primaryColor: '&H000055FF',      // High-energy Orange/Red
    highlightColor: '&H0000FFFF',    // Neon Yellow
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 8,
    shadowDepth: 4,
    borderStyle: 1,
    alignment: 2,
    marginV: 440,
    maxWordsPerLine: 3,
    previewCss: {
      fontFamily: 'Impact, "Arial Black", sans-serif',
      fontWeight: '900',
      fontStyle: 'italic',
      color: '#FF4500',
      textTransform: 'uppercase',
      textShadow: '-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 8px 16px rgba(0,0,0,1)',
      highlightColor: '#FFFF00',
      backgroundColor: 'transparent',
    },
  },
};

/**
 * Retrieve a preset safely by ID with fallback to 'bold'
 */
export function getCaptionPreset(id = 'bold') {
  return CAPTION_PRESETS[id] || CAPTION_PRESETS.bold;
}

/**
 * Generate a complete shared style model that synchronizes CSS preview and ASS export
 *
 * @param {string} presetId - Preset identifier
 * @param {Object} [overrides={}] - User custom adjustments
 * @returns {Object} Unified style model
 */
export function getSharedStyleModel(presetId = 'bold', overrides = {}) {
  const base = getCaptionPreset(presetId);

  const fontName = overrides.fontFamily || overrides.fontName || base.fontName;
  const fontSize = Number(overrides.fontSize) || base.fontSize;
  const textColorHex = overrides.textColor ? overrides.textColor : assColorToHex(base.primaryColor);
  const highlightColorHex = overrides.highlightColor ? overrides.highlightColor : assColorToHex(base.highlightColor);
  const marginV = Number(overrides.marginV ?? overrides.bottomMargin) || base.marginV;
  const alignment = Number(overrides.alignment) || base.alignment;
  const textCase = overrides.textCase || 'uppercase';

  // ASS parameters
  const ass = {
    fontName,
    fontSize,
    primaryColor: hexToAssColor(textColorHex),
    highlightColor: hexToAssColor(highlightColorHex),
    outlineColor: base.outlineColor,
    backColor: base.backColor,
    outlineWidth: base.outlineWidth,
    shadowDepth: base.shadowDepth,
    borderStyle: base.borderStyle,
    alignment,
    marginV,
    bold: base.bold,
    italic: base.italic,
    maxWordsPerLine: base.maxWordsPerLine,
  };

  // Browser CSS parameters
  const css = {
    ...base.previewCss,
    fontFamily: `"${fontName}", ${base.fallbackFonts ? base.fallbackFonts.join(', ') : 'sans-serif'}`,
    fontSize: `${Math.round(fontSize * 0.52)}px`, // Scaled for mobile stage preview
    color: textColorHex,
    highlightColor: highlightColorHex,
    textTransform: textCase,
    bottom: alignment === 5 ? '50%' : `${Math.round(marginV / 19.2)}%`,
    transform: alignment === 5 ? 'translate(-50%, -50%)' : 'translateX(-50%)',
  };

  return {
    id: base.id,
    name: base.name,
    ass,
    css,
    platformSafe: {
      bottomPx: marginV,
      isPlatformSafe: marginV >= 350,
      description: marginV >= 350
        ? '✅ Safe area: Captions will not be obscured by TikTok / Reels title or action buttons.'
        : '⚠️ Caution: Captions are placed low and may be obscured by video titles on mobile.',
    },
  };
}
