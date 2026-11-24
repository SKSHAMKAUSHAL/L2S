#!/usr/bin/env node
/**
 * scripts/reframe_demo.js
 * Generates a side-by-side (Before: Static Center vs After: Face Tracked) comparison video.
 *
 * Usage:
 *   node scripts/reframe_demo.js [input_video.mp4] [output_comparison.mp4]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeClipReframe, renderReframedClip } from '../src/reframe.js';
import { ensureModel } from './fetch_models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'tests', 'output');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await ensureModel();

  let inputVideo = process.argv[2];
  const finalOutput = process.argv[3] || path.join(OUT_DIR, 'reframe_demo_comparison.mp4');

  let isSynthetic = false;
  if (!inputVideo || !fs.existsSync(inputVideo)) {
    // Generate a 5-second test video with moving white circle on dark background simulating an off-center speaker
    inputVideo = path.join(OUT_DIR, 'synthetic_demo_source.mp4');
    console.log(`[reframe_demo] Generating synthetic 1080p sample video: ${inputVideo}...`);
    
    // Circle moves from left (x=400) to right (x=1500)
    const genArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x1e1e2e:s=1920x1080:d=5:r=30',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=5',
      '-vf', 'drawbox=x=\'400+1000*t/5\':y=300:w=240:h=280:color=white@0.9:t=fill',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      inputVideo
    ];
    const genRes = spawnSync('ffmpeg', genArgs, { encoding: 'utf8' });
    if (genRes.status !== 0) {
      throw new Error(`Failed to generate synthetic source: ${genRes.stderr}`);
    }
    isSynthetic = true;
  }

  console.log(`[reframe_demo] Input video: ${inputVideo}`);
  const tempCenter = path.join(OUT_DIR, 'temp_center.mp4');
  const tempFollow = path.join(OUT_DIR, 'temp_follow.mp4');

  console.log(`[reframe_demo] Rendering Before (Static Center Crop)...`);
  await renderReframedClip(inputVideo, 0, 5, tempCenter, { reframeMode: 'center' });

  console.log(`[reframe_demo] Rendering After (YuNet Face-Tracked)...`);
  await renderReframedClip(inputVideo, 0, 5, tempFollow, { reframeMode: 'auto' });

  console.log(`[reframe_demo] Creating side-by-side comparison...`);
  const fontFile = path.join(ROOT_DIR, 'assets', 'fonts', 'Montserrat-ExtraBold.ttf');
  const escapedFont = fontFile.replace(/\\/g, '/').replace(/:/g, '\\:');

  let filterComplex;
  if (fs.existsSync(fontFile)) {
    filterComplex = `[0:v]scale=540:960,drawtext=fontfile='${escapedFont}':text='BEFORE (Center Crop)':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=40[left];` +
      `[1:v]scale=540:960,drawtext=fontfile='${escapedFont}':text='AFTER (Face Track)':fontcolor=0x40c4ff:fontsize=28:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=40[right];` +
      `[left][right]hstack=inputs=2[v]`;
  } else {
    filterComplex = `[0:v]scale=540:960[left];[1:v]scale=540:960[right];[left][right]hstack=inputs=2[v]`;
  }

  const stackArgs = [
    '-y',
    '-i', tempCenter,
    '-i', tempFollow,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    finalOutput
  ];

  const stackRes = spawnSync('ffmpeg', stackArgs, { encoding: 'utf8' });

  // Clean intermediate temp files
  try { if (fs.existsSync(tempCenter)) fs.unlinkSync(tempCenter); } catch (e) {}
  try { if (fs.existsSync(tempFollow)) fs.unlinkSync(tempFollow); } catch (e) {}
  if (isSynthetic) {
    try { if (fs.existsSync(inputVideo)) fs.unlinkSync(inputVideo); } catch (e) {}
  }

  if (stackRes.status !== 0) {
    throw new Error(`Failed to create comparison video: ${stackRes.stderr}`);
  }

  console.log(`✅ [reframe_demo] Side-by-side comparison written to: ${finalOutput}`);
}

main().catch((err) => {
  console.error('[reframe_demo] Error:', err.message);
  process.exit(1);
});
