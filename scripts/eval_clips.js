#!/usr/bin/env node
// =============================================
// L2S — Clip Intelligence Evaluator CLI
// =============================================
// Evaluates clip quality on a transcript JSON and optional heatmap JSON.
// Usage: node scripts/eval_clips.js <transcript.json> [heatmap.json] [genre] [clipCount]

import fs from 'fs';
import path from 'path';
import { runClipEngine } from '../src/clip_engine/index.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/eval_clips.js <transcript.json> [heatmap.json] [genre] [clipCount]');
    process.exit(1);
  }

  const transcriptPath = path.resolve(args[0]);
  if (!fs.existsSync(transcriptPath)) {
    console.error(`Transcript file not found: ${transcriptPath}`);
    process.exit(1);
  }

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));

  let heatmap = null;
  let genre = 'default';
  let clipCount = 5;

  if (args[1] && fs.existsSync(path.resolve(args[1]))) {
    try {
      heatmap = JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf8'));
    } catch {}
    genre = args[2] || 'default';
    clipCount = parseInt(args[3], 10) || 5;
  } else {
    genre = args[1] || 'default';
    clipCount = parseInt(args[2], 10) || 5;
  }

  console.log(`\n🎬 Evaluating Clip Engine`);
  console.log(`   Transcript: ${path.basename(transcriptPath)} (${transcript.words?.length || 0} words)`);
  console.log(`   Genre: ${genre} | Target Clips: ${clipCount}`);
  console.log(`   Heatmap: ${heatmap ? 'Enabled' : 'None'}\n`);

  const clips = await runClipEngine(transcript, {
    genre,
    clipCount,
    heatmap,
    onLog: (msg) => console.log(`   [Engine] ${msg}`),
  });

  console.log(`\n=================== TOP VIRAL CLIPS ===================\n`);

  const rows = clips.map((c, idx) => {
    const startStr = `${Math.floor(c.start / 60)}:${String(Math.floor(c.start % 60)).padStart(2, '0')}`;
    const endStr = `${Math.floor(c.end / 60)}:${String(Math.floor(c.end % 60)).padStart(2, '0')}`;

    return {
      Rank: `#${idx + 1}`,
      Range: `${startStr} - ${endStr}`,
      Dur: `${c.duration}s`,
      Score: `${c.score}/100`,
      Hook: (c.hook || c.hookCaption || '').slice(0, 32),
      Title: (c.title || '').slice(0, 40),
    };
  });

  console.table(rows);

  console.log('\n--- Full Clip Details ---\n');
  clips.forEach((c, i) => {
    console.log(`Clip #${i + 1} (${c.duration}s) | Score: ${c.score}`);
    console.log(`  Title:       ${c.title}`);
    console.log(`  Hook:        ${c.hook || c.hookCaption}`);
    console.log(`  Description: ${c.description}`);
    console.log(`  Hashtags:    ${c.hashtags}`);
    console.log(`  Reason:      ${c.justification}`);
    console.log(`  Text:        "${(c.text || '').slice(0, 180)}..."\n`);
  });
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
