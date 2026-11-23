// =============================================
// L2S — Caption Presets Specification
// =============================================
// 8 professional caption presets optimized for viral short-form video.
// Includes dual-script font definitions (Latin + Devanagari), safe margins,
// and highlight behaviors for ASS and HTML5 parity.

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

export function assColorToHex(assColor) {
  if (!assColor || typeof assColor !== 'string') return '#FFFFFF';
  const clean = assColor.replace(/&H/i, '').replace(/&/i, '').trim();

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
  hormozi: {
    id: 'hormozi',
    name: 'Hormozi Viral',
    category: 'Viral Social (Default)',
    description: 'Uppercase ultra-bold typography with punchy yellow active-word highlight.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 85,
    bold: true,
    italic: false,
    uppercase: true,
    wordsPerCaption: 3,
    highlightStyle: 'scale',
    primaryColor: '&H00FFFFFF',      // White
    secondaryColor: '&H000000FF',
    highlightColor: '&H0000FFFF',    // Vivid Yellow (BGR in ASS)
    outlineColor: '&H00000000',      // Solid Black
    backColor: '&H00000000',
    outlineWidth: 6,
    shadowDepth: 2,
    borderStyle: 1,
    alignment: 2,                    // Bottom center
    marginV: 380,                    // Safe area ~65-70% height
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", Impact, sans-serif',
      fontWeight: '900',
      textTransform: 'uppercase',
      color: '#FFFFFF',
      textShadow: '-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000',
      highlightColor: '#FFE600',
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon Cyber',
    category: 'High Energy / Gaming',
    description: 'Electric cyan and purple glow outline with vivid vibrancy.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 80,
    bold: true,
    italic: false,
    uppercase: true,
    wordsPerCaption: 3,
    highlightStyle: 'glow',
    primaryColor: '&H00FFFF00',      // Cyan in BGR
    secondaryColor: '&H00FF00FF',
    highlightColor: '&H00FF00FF',    // Vivid Magenta in BGR
    outlineColor: '&H00330033',      // Deep purple outline
    backColor: '&H00000000',
    outlineWidth: 5,
    shadowDepth: 4,
    borderStyle: 1,
    alignment: 2,
    marginV: 380,
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", sans-serif',
      fontWeight: '800',
      textTransform: 'uppercase',
      color: '#00FFFF',
      textShadow: '0 0 10px #FF00FF, 0 0 20px #FF00FF',
      highlightColor: '#FF00FF',
    },
  },

  karaoke: {
    id: 'karaoke',
    name: 'Karaoke Fill',
    category: 'Speeches / Pacing',
    description: 'Words light up sequentially in vivid neon green as spoken.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 80,
    bold: true,
    italic: false,
    uppercase: false,
    wordsPerCaption: 4,
    highlightStyle: 'karaoke',
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H0000FF00',    // Neon Green in BGR
    highlightColor: '&H0000FF00',
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 5,
    shadowDepth: 2,
    borderStyle: 1,
    alignment: 2,
    marginV: 380,
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", sans-serif',
      fontWeight: '800',
      color: '#FFFFFF',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
      highlightColor: '#00FF66',
    },
  },

  minimal: {
    id: 'minimal',
    name: 'Clean Minimal',
    category: 'Tech / Explainer',
    description: 'Clean sans-serif typography with thin outline for zero distraction.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 70,
    bold: true,
    italic: false,
    uppercase: false,
    wordsPerCaption: 4,
    highlightStyle: 'none',
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H00E0E0E0',
    highlightColor: '&H00F0F0F0',
    outlineColor: '&H001A1A1A',
    backColor: '&H00000000',
    outlineWidth: 3,
    shadowDepth: 0,
    borderStyle: 1,
    alignment: 2,
    marginV: 360,
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", sans-serif',
      fontWeight: '600',
      color: '#FFFFFF',
      textShadow: '0 2px 4px rgba(0,0,0,0.7)',
      highlightColor: '#FFFFFF',
    },
  },

  box: {
    id: 'box',
    name: 'Solid Box',
    category: 'Interviews / High Contrast',
    description: 'Solid translucent background box behind text for maximum legibility.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 72,
    bold: true,
    italic: false,
    uppercase: true,
    wordsPerCaption: 3,
    highlightStyle: 'box',
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H00D0D0D0',
    highlightColor: '&H0000E5FF',    // Electric Cyan in BGR
    outlineColor: '&H00000000',
    backColor: '&HB0000000',         // 70% black box
    outlineWidth: 2,
    shadowDepth: 0,
    borderStyle: 3,                  // Opaque background box
    alignment: 2,
    marginV: 380,
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", sans-serif',
      fontWeight: '700',
      textTransform: 'uppercase',
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0.75)',
      padding: '6px 14px',
      borderRadius: '6px',
      highlightColor: '#FFE600',
    },
  },

  cinematic: {
    id: 'cinematic',
    name: 'Cinematic Serif',
    category: 'Documentary / Stories',
    description: 'Tracked serif typography with deep shadow for emotional storytelling.',
    fonts: {
      latin: 'Playfair Display',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Playfair Display',
    fontSize: 76,
    bold: false,
    italic: true,
    uppercase: false,
    wordsPerCaption: 4,
    highlightStyle: 'color',
    primaryColor: '&H00EAEAEA',
    secondaryColor: '&H00D0D0D0',
    highlightColor: '&H0033B5E5',    // Warm Amber / Gold in BGR
    outlineColor: '&H00050505',
    backColor: '&H00000000',
    outlineWidth: 2,
    shadowDepth: 4,
    borderStyle: 1,
    alignment: 2,
    marginV: 360,
    previewCss: {
      fontFamily: '"Playfair Display", "Noto Sans Devanagari", Georgia, serif',
      fontStyle: 'italic',
      fontWeight: '400',
      color: '#EAEAEA',
      textShadow: '0 4px 10px rgba(0,0,0,0.85)',
      highlightColor: '#E5B533',
    },
  },

  pop: {
    id: 'pop',
    name: 'Animated Pop',
    category: 'Fast-Paced Shorts / Punchy',
    description: 'Compact 1-2 word captions with dynamic scale bounce.',
    fonts: {
      latin: 'Anton',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Anton',
    fontSize: 95,
    bold: true,
    italic: false,
    uppercase: true,
    wordsPerCaption: 2,
    highlightStyle: 'pop',
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H0000FFFF',
    highlightColor: '&H0000FFFF',    // Vivid Yellow in BGR
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 7,
    shadowDepth: 3,
    borderStyle: 1,
    alignment: 5,                    // Middle center
    marginV: 0,
    previewCss: {
      fontFamily: 'Anton, "Noto Sans Devanagari", Impact, sans-serif',
      fontWeight: '900',
      textTransform: 'uppercase',
      color: '#FFFFFF',
      textShadow: '-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000',
      highlightColor: '#FFE600',
    },
  },

  underline: {
    id: 'underline',
    name: 'Accent Underline',
    category: 'Education / Business',
    description: 'Accent underline on the active spoken word.',
    fonts: {
      latin: 'Montserrat',
      devanagari: 'Noto Sans Devanagari',
    },
    fontName: 'Montserrat',
    fontSize: 82,
    bold: true,
    italic: false,
    uppercase: false,
    wordsPerCaption: 3,
    highlightStyle: 'underline',
    primaryColor: '&H00FFFFFF',
    secondaryColor: '&H003355FF',
    highlightColor: '&H003355FF',    // Bright Coral in BGR
    outlineColor: '&H00000000',
    backColor: '&H00000000',
    outlineWidth: 4,
    shadowDepth: 2,
    borderStyle: 1,
    alignment: 2,
    marginV: 380,
    previewCss: {
      fontFamily: '"Montserrat", "Noto Sans Devanagari", sans-serif',
      fontWeight: '800',
      color: '#FFFFFF',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
      highlightColor: '#FF5533',
    },
  },
};

const LEGACY_ALIASES = {
  bold: 'hormozi',
  podcast: 'box',
  gaming: 'neon',
  educational: 'underline',
};

/**
 * Retrieve a preset safely by ID with fallback to 'hormozi'
 */
export function getCaptionPreset(id = 'hormozi') {
  if (!id) return CAPTION_PRESETS.hormozi;
  const key = String(id).toLowerCase().trim();
  const resolved = LEGACY_ALIASES[key] || key;
  return CAPTION_PRESETS[resolved] || CAPTION_PRESETS.hormozi;
}

/**
 * Generate a complete shared style model that synchronizes CSS preview and ASS export
 */
export function getSharedStyleModel(presetId = 'hormozi', overrides = {}) {
  const base = getCaptionPreset(presetId);

  const fontName = overrides.fontFamily || overrides.fontName || base.fontName;
  const fontSize = Number(overrides.fontSize) || base.fontSize;
  const textColorHex = overrides.textColor ? overrides.textColor : assColorToHex(base.primaryColor);
  const highlightColorHex = overrides.highlightColor ? overrides.highlightColor : assColorToHex(base.highlightColor);
  const marginV = Number(overrides.marginV ?? overrides.bottomMargin) || base.marginV;
  const alignment = Number(overrides.alignment) || base.alignment;
  const textCase = overrides.textCase || (base.uppercase ? 'uppercase' : 'normal');

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
    wordsPerCaption: base.wordsPerCaption,
    highlightStyle: base.highlightStyle,
  };

  const css = {
    ...base.previewCss,
    fontFamily: `"${fontName}", ${base.fonts?.devanagari ? `"${base.fonts.devanagari}", ` : ''}sans-serif`,
    fontSize: `${Math.round(fontSize * 0.52)}px`,
    color: textColorHex,
    highlightColor: highlightColorHex,
    textTransform: textCase === 'uppercase' ? 'uppercase' : 'none',
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
