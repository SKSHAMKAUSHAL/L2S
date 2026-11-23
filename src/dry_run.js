#!/usr/bin/env node
// =============================================
// L2S — Dry-Run CLI Mode
// =============================================
// Test clip selection on a transcript file without rendering video.
// Usage: node src/dry_run.js path/to/transcript.json --genre motivational --clips 5

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectClips } from './clip_selector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Load .env ───────────────────────────────
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
} catch { /* ignore */ }

// ─── Parse CLI args ──────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    transcriptPath: null,
    genre: 'default',
    clips: 5,
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.MODEL || 'llama3.2:3b',
    heuristicOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--genre' && args[i + 1]) {
      options.genre = args[++i];
    } else if (args[i] === '--clips' && args[i + 1]) {
      options.clips = parseInt(args[++i], 10);
    } else if (args[i] === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (args[i] === '--ollama-url' && args[i + 1]) {
      options.ollamaUrl = args[++i];
    } else if (args[i] === '--heuristic-only') {
      options.heuristicOnly = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    } else if (!args[i].startsWith('--')) {
      options.transcriptPath = args[i];
    }
  }

  return options;
}

function printUsage() {
  console.log(`
L2S Dry-Run — Test clip selection without rendering

Usage:
  node src/dry_run.js <transcript.json> [options]

Options:
  --genre <genre>       Genre for scoring (default: auto-detect)
                        Options: motivational, funny, educational, storytime,
                                 tech, gaming, news, music, sports, vlog, cooking
  --clips <number>      Number of clips to select (default: 5)
  --model <model>       Ollama model (default: llama3.2:3b)
  --ollama-url <url>    Ollama URL (default: http://localhost:11434)
  --heuristic-only      Skip LLM scoring, use heuristics only
  -h, --help            Show this help

Examples:
  node src/dry_run.js temp/cache/video.transcript.json --genre motivational
  node src/dry_run.js temp/cache/video.transcript.json --genre comedy --clips 3 --heuristic-only
  `);
}

// ─── Find transcript files ──────────────────
function findTranscriptFiles() {
  const searchDirs = [
    path.join(__dirname, '..', 'temp'),
    path.join(__dirname, '..', 'temp', 'cache'),
    path.join(require('os').homedir(), '.skate', 'cache'),
  ];

  const files = [];
  for (const dir of searchDirs) {
    try {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (entry.endsWith('.transcript.json') || entry.endsWith('.json')) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);
            files.push({ path: fullPath, name: entry, size: stat.size, mtime: stat.mtimeMs });
          }
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  return files.sort((a, b) => b.mtime - a.mtime);
}

// ─── Format table row ───────────────────────
function pad(str, len) {
  return String(str).slice(0, len).padEnd(len);
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Main ───────────────────────────────────
async function main() {
  const options = parseArgs();

  if (!options.transcriptPath) {
    // Try to find a transcript file automatically
    console.log('No transcript file specified. Searching for cached transcripts...\n');
    const files = findTranscriptFiles();

    if (files.length === 0) {
      console.error('No transcript files found. Run the full pipeline first to generate a transcript,');
      console.error('or specify a transcript file path:\n');
      console.error('  node src/dry_run.js path/to/transcript.json --genre motivational\n');
      process.exit(1);
    }

    console.log('Found transcript files:');
    files.slice(0, 10).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);
    });

    options.transcriptPath = files[0].path;
    console.log(`\nUsing: ${files[0].name}\n`);
  }

  // Load transcript
  const transcriptPath = path.resolve(options.transcriptPath);
  if (!fs.existsSync(transcriptPath)) {
    console.error(`File not found: ${transcriptPath}`);
    process.exit(1);
  }

  let transcript;
  try {
    transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse transcript JSON: ${e.message}`);
    process.exit(1);
  }

  // Validate transcript structure
  if (!transcript.segments || !Array.isArray(transcript.segments)) {
    console.error('Invalid transcript format: expected { segments: [...] }');
    process.exit(1);
  }

  const totalWords = transcript.segments.reduce(
    (sum, s) => sum + (s.words ? s.words.length : s.text?.split(/\s+/).length || 0), 0
  );
  const totalDuration = transcript.duration || (transcript.segments.length > 0
    ? transcript.segments[transcript.segments.length - 1].end
    : 0);

  console.log('═══════════════════════════════════════════');
  console.log('  L2S Dry-Run — Clip Selection Test');
  console.log('═══════════════════════════════════════════');
  console.log(`  Transcript: ${path.basename(transcriptPath)}`);
  console.log(`  Duration:   ${formatDuration(totalDuration)} (${totalWords} words)`);
  console.log(`  Genre:      ${options.genre}`);
  console.log(`  Clips:      ${options.clips}`);
  console.log(`  Model:      ${options.heuristicOnly ? 'heuristic-only' : options.model}`);
  console.log('═══════════════════════════════════════════\n');

  const startTime = Date.now();

  try {
    if (options.heuristicOnly) {
      // Heuristic-only mode: skip LLM, useful for tuning weights fast
      const { generateCandidateSegments } = await import('./segmenter.js');
      const { scoreSegments } = await import('./scorer.js');

      const candidates = generateCandidateSegments(transcript);
      console.log(`Generated ${candidates.length} candidate segments\n`);

      const scored = scoreSegments(candidates, options.genre);
      const sorted = [...scored].sort((a, b) => b.heuristic.total - a.heuristic.total);
      const top = sorted.slice(0, options.clips * 2); // show more for tuning

      printResultsTable(top, true);
    } else {
      const clips = await selectClips(transcript, options.genre, options.clips, {
        ollamaUrl: options.ollamaUrl,
        model: options.model,
        onLog: (msg) => console.log(`  ${msg}`),
      });

      console.log('');
      printResultsTable(clips, false);
    }
  } catch (e) {
    console.error(`\nError: ${e.message}`);
    if (e.message.includes('Ollama') || e.message.includes('ECONNREFUSED')) {
      console.error('\nMake sure Ollama is running: ollama serve');
      console.error('Or use --heuristic-only to skip LLM scoring');
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Completed in ${elapsed}s`);
}

function printResultsTable(results, isHeuristicOnly) {
  if (results.length === 0) {
    console.log('  No clips selected.');
    return;
  }

  console.log('┌──────┬──────────┬──────────┬───────┬──────┬──────┬──────┬──────┬──────┬──────────┬─────────────────────────────────────────┐');

  if (isHeuristicOnly) {
    console.log('│ Rank │ Start    │ End      │ Dur   │ Hook │ Stan │ Pay  │ Emot │ TopD │ Total    │ First words                             │');
  } else {
    console.log('│ Rank │ Start    │ End      │ Dur   │ Heur │ LLM  │ Comb │ Hook │ Stan │ Pay      │ Justification                           │');
  }
  console.log('├──────┼──────────┼──────────┼───────┼──────┼──────┼──────┼──────┼──────┼──────────┼─────────────────────────────────────────┤');

  results.forEach((r, i) => {
    const start = formatDuration(r.start);
    const end = formatDuration(r.end);
    const dur = `${Math.round(r.end - r.start)}s`;

    if (isHeuristicOnly) {
      const h = r.heuristic;
      const firstWords = (r.text || '').slice(0, 37);
      console.log(
        `│ ${pad(i + 1, 4)} │ ${pad(start, 8)} │ ${pad(end, 8)} │ ${pad(dur, 5)} │ ${pad(h.hook, 4)} │ ${pad(h.standalone, 4)} │ ${pad(h.payoff, 4)} │ ${pad(h.emotion, 4)} │ ${pad(h.topicDensity, 4)} │ ${pad(h.total, 8)} │ ${pad(firstWords, 39)} │`
      );
    } else {
      const heur = r.heuristicScore || r.heuristic?.total || 0;
      const llm = r.llmScore != null ? r.llmScore : '-';
      const comb = r.combinedScore || 0;
      const hook = r.scoreBreakdown?.heuristic?.hook || r.heuristic?.hook || '-';
      const stan = r.scoreBreakdown?.heuristic?.standalone || r.heuristic?.standalone || '-';
      const pay = r.scoreBreakdown?.heuristic?.payoff || r.heuristic?.payoff || '-';
      const just = (r.justification || '').slice(0, 37);
      console.log(
        `│ ${pad(i + 1, 4)} │ ${pad(start, 8)} │ ${pad(end, 8)} │ ${pad(dur, 5)} │ ${pad(heur, 4)} │ ${pad(llm, 4)} │ ${pad(comb, 4)} │ ${pad(hook, 4)} │ ${pad(stan, 4)} │ ${pad(pay, 8)} │ ${pad(just, 39)} │`
      );
    }
  });

  console.log('└──────┴──────────┴──────────┴───────┴──────┴──────┴──────┴──────┴──────┴──────────┴─────────────────────────────────────────┘');
}

main();
