import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  CAPTION_PRESETS,
  getCaptionPreset,
  hexToAssColor,
  assColorToHex,
  getSharedStyleModel,
  buildASSScript,
  formatASSTime,
  hasWordTimestamps,
  escapeASSText,
} from '../src/subtitles.js';
import { generateSRT, generateASS } from '../src/subtitles.js';

describe('Prompt 5 — Professional Caption Studio, Presets & Parity Tests', () => {
  const sampleWordsWithTiming = [
    { word: 'Welcome', start: 0.1, end: 0.45 },
    { word: 'to', start: 0.45, end: 0.65 },
    { word: 'the', start: 0.65, end: 0.85 },
    { word: 'future', start: 0.85, end: 1.35 },
    { word: 'of', start: 1.35, end: 1.55 },
    { word: 'automated', start: 1.55, end: 2.15 },
    { word: 'video', start: 2.15, end: 2.65 },
    { word: 'creation!', start: 2.65, end: 3.25 },
  ];

  const untimedSegments = [
    { text: 'In today episode we discuss artificial intelligence and creative pipelines.', start: 10.0, end: 16.5 },
  ];

  // ─── Test Suite 1: Visual/CSS Style Parity & Shared Model ───────────
  describe('Requirement 1: Visual / CSS Style Parity & Shared Model', () => {
    test('shared style model produces mathematical parity between CSS and ASS colors', () => {
      // White
      assert.strictEqual(hexToAssColor('#FFFFFF'), '&H00FFFFFF');
      assert.strictEqual(assColorToHex('&H00FFFFFF'), '#FFFFFF');

      // Yellow: #FFE600 -> BGR &H0000E6FF
      assert.strictEqual(hexToAssColor('#FFE600'), '&H0000E6FF');
      assert.strictEqual(assColorToHex('&H0000E6FF'), '#FFE600');

      // Cyan: #00E5FF -> BGR &H00FFE500
      assert.strictEqual(hexToAssColor('#00E5FF'), '&H00FFE500');
      assert.strictEqual(assColorToHex('&H00FFE500'), '#00E5FF');
    });

    test('getSharedStyleModel generates both ASS and CSS objects for all 8 presets', () => {
      const presets = ['minimal', 'cinematic', 'hormozi', 'karaoke', 'pop', 'box', 'underline', 'neon'];

      for (const presetId of presets) {
        const model = getSharedStyleModel(presetId);
        assert.ok(model, `Model for '${presetId}' must exist`);
        assert.ok(model.ass, `Model for '${presetId}' must contain ASS parameters`);
        assert.ok(model.css, `Model for '${presetId}' must contain CSS parameters`);
        assert.ok(model.platformSafe, `Model for '${presetId}' must contain platformSafe metadata`);

        // Check font consistency
        assert.ok(model.css.fontFamily.includes(model.ass.fontName),
          `CSS font family must include ASS font name for preset '${presetId}'`);

        // Check color parity
        assert.strictEqual(hexToAssColor(model.css.color), model.ass.primaryColor,
          `ASS primary color must match CSS color for preset '${presetId}'`);
      }
    });

    test('getSharedStyleModel correctly applies user overrides', () => {
      const model = getSharedStyleModel('bold', {
        fontFamily: 'Montserrat',
        fontSize: 64,
        textColor: '#00FF00',
        highlightColor: '#FF00FF',
        marginV: 450,
      });

      assert.strictEqual(model.ass.fontName, 'Montserrat');
      assert.strictEqual(model.ass.fontSize, 64);
      assert.strictEqual(model.ass.marginV, 450);
      assert.strictEqual(model.css.color, '#00FF00');
      assert.strictEqual(model.css.highlightColor, '#FF00FF');
      assert.ok(model.platformSafe.isPlatformSafe);
    });
  });

  // ─── Test Suite 2: Subtitle File Syntax & Standards ──────────────────
  describe('Requirement 2: Subtitle File Syntax Validation', () => {
    test('generateASS produces compliant Advanced SubStation Alpha v4.00+ header and script', () => {
      const ass = generateASS(sampleWordsWithTiming, 'bold');
      
      // Header compliance
      assert.ok(ass.includes('[Script Info]'), 'Must include [Script Info]');
      assert.ok(ass.includes('ScriptType: v4.00+'), 'Must declare ScriptType: v4.00+');
      assert.ok(ass.includes('PlayResX: 1080'), 'Must define PlayResX: 1080');
      assert.ok(ass.includes('PlayResY: 1920'), 'Must define PlayResY: 1920 (9:16 vertical canvas)');
      
      // Style compliance
      assert.ok(ass.includes('[V4+ Styles]'), 'Must include [V4+ Styles]');
      assert.ok(ass.includes('Format: Name, Fontname, Fontsize,'), 'Must specify standard V4+ style fields');
      assert.ok(ass.includes('Style: Default,'), 'Must define Default style line');
      
      // Events compliance
      assert.ok(ass.includes('[Events]'), 'Must include [Events]');
      assert.ok(ass.includes('Format: Layer, Start, End, Style,'), 'Must specify Event format');
      assert.ok(ass.includes('Dialogue: 0,'), 'Must have at least one Dialogue line');
    });

    test('generateSRT produces RFC-compliant numbered SubRip file structure', () => {
      const srt = generateSRT(sampleWordsWithTiming);
      
      // Split into blocks by double newline
      const blocks = srt.split('\n\n').filter(Boolean);
      assert.ok(blocks.length >= 2, 'Should create multiple caption blocks');

      blocks.forEach((block, index) => {
        const lines = block.split('\n');
        assert.strictEqual(lines[0], String(index + 1), `Block ${index + 1} must start with sequential integer index`);
        assert.ok(lines[1].includes(' --> '), `Block ${index + 1} line 2 must be timestamp arrow format`);
        assert.match(lines[1], /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/, 'Must match HH:MM:SS,mmm timestamp format');
        assert.ok(lines[2].trim().length > 0, `Block ${index + 1} must have non-empty subtitle text`);
      });
    });

    test('handles segment-level fallback gracefully when word timestamps are absent', () => {
      assert.strictEqual(hasWordTimestamps(untimedSegments), false, 'Should recognize untimed segment');

      // Test ASS segment fallback
      const ass = generateASS(untimedSegments, 'bold');
      assert.ok(ass.includes('Dialogue: 0,'), 'ASS must generate Dialogue lines for segment fallback');
      assert.ok(ass.includes('ARTIFICIAL INTELLIGENCE'), 'ASS must contain the spoken words');

      // Test SRT segment fallback
      const srt = generateSRT(untimedSegments);
      assert.ok(srt.includes('1'), 'SRT must start with block 1');
      assert.ok(srt.includes('-->'), 'SRT must contain time arrow');
      assert.ok(srt.includes('artificial intelligence'), 'SRT must contain text');
    });
  });

  // ─── Test Suite 3: Character Escaping & Security ────────────────────
  describe('Requirement 3: Character Escaping & Security Injection Guards', () => {
    test('escapeASSText neutralizes ASS command override braces and backslashes', () => {
      const maliciousPayload = 'Check out {\\b1\\c&H0000FF&}HACKED{\\b0} text \\N new line';
      const escaped = escapeASSText(maliciousPayload);

      // Overrides '{' and '}' must be sanitized to full-width characters so ASS parser treats them as text
      assert.ok(!escaped.includes('{'), 'Must not contain raw open brace');
      assert.ok(!escaped.includes('}'), 'Must not contain raw close brace');
      assert.ok(escaped.includes('｛'), 'Must contain neutralized full-width open brace');
      assert.ok(escaped.includes('｝'), 'Must contain neutralized full-width close brace');
    });

    test('preserves multilingual Unicode, symbols, and emojis safely', () => {
      const multilingualWords = [
        { word: '¡Hola!', start: 0.1, end: 0.5 },
        { word: 'नमस्ते', start: 0.5, end: 1.0 },
        { word: 'こんにちは', start: 1.0, end: 1.5 },
        { word: '🔥🚀', start: 1.5, end: 2.0 },
      ];

      const ass = generateASS(multilingualWords, 'bold');
      assert.ok(ass.includes('¡HOLA!'), 'Spanish punctuation preserved');
      assert.ok(ass.includes('नमस्ते'), 'Devanagari script preserved');
      assert.ok(ass.includes('こんにちは'), 'Japanese kana preserved');
      assert.ok(ass.includes('🔥🚀'), 'Emojis preserved');
    });

    test('handles empty, null, and undefined inputs without throwing exceptions', () => {
      assert.doesNotThrow(() => generateASS([], 'bold'));
      assert.doesNotThrow(() => generateASS(null, 'bold'));
      assert.doesNotThrow(() => generateASS(undefined, 'bold'));

      assert.strictEqual(generateSRT([]), '');
      assert.strictEqual(generateSRT(null), '');
      assert.strictEqual(generateSRT(undefined), '');
    });
  });

  // ─── Test Suite 4: Platform Safe Margins (TikTok / Reels / Shorts) ──
  describe('Requirement 4: Platform Safe Margins & Safe Zones', () => {
    test('default vertical margins for 9:16 portrait canvas avoid UI overlay collisions', () => {
      const presets = ['minimal', 'cinematic', 'hormozi', 'karaoke', 'pop', 'box', 'underline', 'neon'];

      for (const id of presets) {
        const model = getSharedStyleModel(id);
        if (id === 'pop') {
          // Pop style is center-screen (alignment 5)
          assert.strictEqual(model.ass.alignment, 5, 'Pop style should be centered');
        } else {
          // Bottom captions must be placed safely above the lower 350px engagement threshold
          assert.ok(model.ass.marginV >= 320,
            `Preset '${id}' marginV (${model.ass.marginV}) must be safely above bottom overlay`);
          assert.ok(model.platformSafe.bottomPx >= 320,
            `Preset '${id}' bottomPx metadata must be >= 320`);
        }
      }
    });

    test('correctly assesses safe vs warning states for user custom margins', () => {
      const safeModel = getSharedStyleModel('bold', { marginV: 420 });
      assert.strictEqual(safeModel.platformSafe.isPlatformSafe, true);
      assert.ok(safeModel.platformSafe.description.includes('Safe area'));

      const unsafeModel = getSharedStyleModel('bold', { marginV: 200 });
      assert.strictEqual(unsafeModel.platformSafe.isPlatformSafe, false);
      assert.ok(unsafeModel.platformSafe.description.includes('Caution'));
    });
  });

  // ─── Test Suite 5: Comparison & Preset Parity ───────────────────────
  describe('Requirement 5: Comparison & Preset State Parity', () => {
    test('all 8 presets produce valid and distinct style configurations', () => {
      const generatedStyles = new Set();
      const presets = ['minimal', 'cinematic', 'hormozi', 'karaoke', 'pop', 'box', 'underline', 'neon'];

      for (const id of presets) {
        const preset = getCaptionPreset(id);
        assert.ok(preset.name, `Preset ${id} must have a display name`);
        assert.ok(preset.category, `Preset ${id} must specify target category`);
        assert.ok(preset.description, `Preset ${id} must describe the use case`);

        const signature = `${preset.fontName}-${preset.fontSize}-${preset.primaryColor}-${preset.outlineWidth}`;
        assert.ok(!generatedStyles.has(signature), `Preset '${id}' must have distinct style signature`);
        generatedStyles.add(signature);
      }
    });

    test('dialogue timing offset shifts events accurately', () => {
      const baseAss = generateASS(sampleWordsWithTiming, 'bold', 0);
      const offsetAss = generateASS(sampleWordsWithTiming, 'bold', 10.0);

      // In baseAss, first word starts at 0:00:00.10
      assert.ok(baseAss.includes('0:00:00.10'));

      // In offsetAss with offset 10.0, word starting at 0.1s is clamped to 0:00:00.00
      assert.ok(offsetAss.includes('0:00:00.00'));
    });
  });
});
