import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { generateASS } from '../src/subtitles.js';
import { FONTS_DIR } from '../src/captions/fonts.js';
import { loadFixture } from './helpers/fixtures.js';

const OUTPUT_DIR = path.resolve('tests/output');
const PRESETS = ['hormozi', 'neon', 'karaoke', 'minimal', 'box', 'cinematic', 'pop', 'underline'];
const LANGUAGES = ['en', 'hi', 'hinglish'];

function checkFFmpegAvailable() {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

describe('Caption Render Integration (Step 2)', () => {
  const hasFFmpeg = checkFFmpegAvailable();

  if (!hasFFmpeg) {
    it.skip('Skipping caption render tests: ffmpeg is not available on system PATH', () => {});
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const generatedPngs = [];

  for (const lang of LANGUAGES) {
    describe(`Language: ${lang}`, () => {
      const fixture = loadFixture(lang);
      const words = fixture.segments.flatMap(s => s.words).slice(0, 15);

      for (const preset of PRESETS) {
        it(`renders 1080x1920 frame for preset [${preset}] in [${lang}]`, () => {
          const assContent = generateASS(words, preset, 0);
          const assPath = path.join(OUTPUT_DIR, `temp_${lang}_${preset}.ass`);
          const pngPath = path.join(OUTPUT_DIR, `frame_${lang}_${preset}.png`);

          fs.writeFileSync(assPath, assContent, 'utf8');

          const escapeFFmpegPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
          const escapedAss = escapeFFmpegPath(assPath);
          const escapedFonts = escapeFFmpegPath(FONTS_DIR);
          const subFilter = `subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'`;

          // Generate frame from black canvas with burned captions
          const ffmpegArgs = [
            '-f', 'lavfi',
            '-i', 'color=black:s=1080x1920:d=3',
            '-vf', subFilter,
            '-ss', '0.6',
            '-vframes', '1',
            '-y',
            pngPath,
          ];

          const res = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
          assert.strictEqual(res.status, 0, `FFmpeg failed to render frame: ${res.stderr?.slice(-300)}`);

          // Assert PNG exists and is not empty
          assert.ok(fs.existsSync(pngPath), `PNG output must exist: ${pngPath}`);
          const stats = fs.statSync(pngPath);
          // A pure black 1080x1920 PNG is ~2-3 KB. Rendered text with outlines is >15 KB.
          assert.ok(stats.size > 5000, `Frame PNG should be larger than 5KB with rendered captions (got ${stats.size} bytes)`);

          generatedPngs.push(pngPath);

          // Clean up temp ASS file
          try { fs.unlinkSync(assPath); } catch {}
        });
      }
    });
  }

  it('asserts libass debug log does not report font fallback for Devanagari text', () => {
    const hiFixture = loadFixture('hi');
    const hiWords = hiFixture.segments[0].words;
    const assContent = generateASS(hiWords, 'hormozi', 0);
    const assPath = path.join(OUTPUT_DIR, 'temp_devanagari_debug.ass');
    const pngPath = path.join(OUTPUT_DIR, 'temp_devanagari_debug.png');

    fs.writeFileSync(assPath, assContent, 'utf8');

    const escapeFFmpegPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
    const escapedAss = escapeFFmpegPath(assPath);
    const escapedFonts = escapeFFmpegPath(FONTS_DIR);
    const subFilter = `subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'`;

    const res = spawnSync('ffmpeg', [
      '-loglevel', 'debug',
      '-f', 'lavfi',
      '-i', 'color=black:s=1080x1920:d=2',
      '-vf', subFilter,
      '-ss', '0.5',
      '-vframes', '1',
      '-y',
      pngPath,
    ], { encoding: 'utf8' });

    assert.strictEqual(res.status, 0);

    const stderr = res.stderr || '';
    // Assert no fallback failure message
    assert.ok(
      !stderr.includes('falling back to a different font') &&
      !stderr.includes('No fonts found') &&
      !stderr.includes('font fallback failed'),
      'Libass should load Noto Sans Devanagari without falling back'
    );

    // Clean up
    try { fs.unlinkSync(assPath); } catch {}
    try { fs.unlinkSync(pngPath); } catch {}
  });

  it('confirms all 24 sample frames were generated in tests/output/', () => {
    assert.strictEqual(generatedPngs.length, 24, 'All 24 (3 x 8) PNG frames must be generated');
    for (const p of generatedPngs) {
      assert.ok(fs.existsSync(p));
    }
  });
});
