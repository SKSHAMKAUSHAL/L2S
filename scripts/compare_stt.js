#!/usr/bin/env node
// =============================================
// L2S — STT Model Comparison Utility
// =============================================
// Runs whisper-large-v3-turbo and whisper-large-v3 on a specified audio file
// and prints word count, language, and the first 30 words side-by-side.

import path from 'path';
import { transcribeGroq } from '../src/stt/groq.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/compare_stt.js <audio_file> [language]');
    process.exit(1);
  }

  const audioPath = path.resolve(args[0]);
  const language = args[1] || 'auto';

  console.log(`\n🎧 Comparing Groq Whisper Models on: ${audioPath}`);
  console.log(`🌐 Requested Language: ${language}\n`);

  try {
    console.log('1️⃣ Transcribing with whisper-large-v3-turbo...');
    const tTurbo = await transcribeGroq(audioPath, { model: 'whisper-large-v3-turbo', language });

    console.log('2️⃣ Transcribing with whisper-large-v3...');
    const tLarge = await transcribeGroq(audioPath, { model: 'whisper-large-v3', language });

    console.log('\n================================================================================');
    console.log('MODEL COMPARISON REPORT');
    console.log('================================================================================');
    console.log(`Turbo Word Count  : ${tTurbo.words.length} (Lang: ${tTurbo.language})`);
    console.log(`Large Word Count  : ${tLarge.words.length} (Lang: ${tLarge.language})`);
    console.log('--------------------------------------------------------------------------------');
    console.log('FIRST 30 WORDS SIDE-BY-SIDE:');
    console.log('--------------------------------------------------------------------------------');

    const maxWords = Math.max(tTurbo.words.length, tLarge.words.length);
    const limit = Math.min(30, maxWords);

    console.log(`${'INDEX'.padEnd(6)} | ${'TURBO'.padEnd(35)} | ${'LARGE V3'.padEnd(35)}`);
    console.log('-'.repeat(80));

    for (let i = 0; i < limit; i++) {
      const w1 = tTurbo.words[i] ? `${tTurbo.words[i].word} (${tTurbo.words[i].start.toFixed(1)}s)` : '';
      const w2 = tLarge.words[i] ? `${tLarge.words[i].word} (${tLarge.words[i].start.toFixed(1)}s)` : '';
      console.log(`${String(i + 1).padEnd(6)} | ${w1.padEnd(35)} | ${w2.padEnd(35)}`);
    }

    console.log('================================================================================\n');
  } catch (err) {
    console.error('Comparison error:', err.message);
    process.exit(1);
  }
}

main();
