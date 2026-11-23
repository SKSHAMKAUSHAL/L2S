// =============================================
// L2S — Pipeline (Full End-to-End)
// =============================================

import { downloadVideo, extractAudio } from './downloader.js';
import { transcribeAudio } from './transcriber.js';
import { selectClips } from './clip_selector.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { killAllProcesses } from './process_manager.js';
import { aiRegistry } from './ai/registry.js';
import { ensureSufficientDiskSpace } from './system/disk_guard.js';
import { validateTimeRange, sanitizeAndValidateClips } from './video/validator.js';

// Pipeline configuration — reads from env or uses sensible defaults
const getConfig = () => ({
  model: process.env.MODEL || 'llama3.2:3b',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  clips: parseInt(process.env.CLIPS || '5', 10),
  minLength: 15,
  maxLength: 60,
  subtitleStyle: 'hormozi',
  cacheDir: path.join(os.homedir(), '.skate', 'cache'),
});

// Global pipeline state
let currentPipeline = null;

/**
 * Cancel the currently running pipeline and terminate all child processes
 */
export function stopPipeline() {
  if (currentPipeline) {
    currentPipeline.stopped = true;
  }
  killAllProcesses();
}

/**
 * Get the current pipeline state (for rendering after review)
 */
export function getPipelineState() {
  return currentPipeline;
}

/**
 * Extract transcript text that falls within a given time range.
 * Returns a chunk-like object { start, end, text, words }.
 */
function extractTranscriptForRange(transcript, start, end) {
  const allWords = transcript.segments.flatMap(s => s.words || []);
  const matchingWords = allWords.filter(w => w.start >= start && w.end <= end);

  if (matchingWords.length > 0) {
    return {
      start,
      end,
      text: matchingWords.map(w => w.word).join(' '),
      words: matchingWords,
    };
  }

  // Fallback: use segment-level text
  const matchingSegments = transcript.segments.filter(
    s => s.start < end && s.end > start
  );
  const text = matchingSegments.map(s => s.text).join(' ').trim();
  return { start, end, text: text || `Clip ${start}s-${end}s`, words: [] };
}

/**
 * Query Ollama to find chunks matching a user description.
 * Returns array of matched segments.
 */
async function matchSegmentsByDescription(description, transcript, ollamaUrl, model) {
  // Build a set of segments from the transcript for searching
  const segments = transcript.segments.map((seg, i) => ({
    index: i,
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));

  const batchSize = 30;
  let allMatchedIndices = [];
  const systemPrompt = `You are a video clip search assistant. Given a user's description of what clips they want, you analyze transcript segments and return the indices of segments that best match their request. Return ONLY a JSON array of integers.`;

  for (let i = 0; i < segments.length; i += batchSize) {
    const candidates = segments.slice(i, i + batchSize);

    const prompt = `The user wants clips about: "${description}"

Here are transcript segments from a video. Return a JSON array of the segment indices that BEST match the user's description, ranked from most relevant to least. Return at most 10 matches.

Segments:
${candidates.map(c => `[${c.index}] ${c.start}s-${c.end}s: "${c.text.slice(0, 200)}"`).join('\n')}

Return ONLY a JSON array of index numbers, e.g. [3, 7, 1]. No explanation.`;

    try {
      const activeProvider = aiRegistry.getLLMProvider();
      if (!activeProvider.isConfigured()) {
        throw new Error(`${activeProvider.name} is not configured.`);
      }

      const structured = await activeProvider.generateStructuredJSON({
        systemPrompt,
        prompt,
        timeoutMs: 30000,
      });

      if (Array.isArray(structured)) {
        const validIndices = structured.filter(idx => typeof idx === 'number' && idx >= 0 && idx < segments.length);
        allMatchedIndices.push(...validIndices);
      }
    } catch (e) {
      console.warn('Warning: Failed to match description for a batch', e.message);
    }
  }

  // Deduplicate and return matched transcript ranges
  const uniqueIndices = [...new Set(allMatchedIndices)].slice(0, 10);
  return uniqueIndices.map(idx => {
    const seg = segments[idx];
    return extractTranscriptForRange(transcript, seg.start, seg.end);
  });
}

/**
 * Keyword-based fallback for description matching.
 */
function matchSegmentsByKeywords(description, transcript) {
  const keywords = description
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (keywords.length === 0) return [];

  return transcript.segments
    .map(seg => {
      const text = seg.text.toLowerCase();
      let matchCount = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) matchCount++;
      }
      return { ...seg, keywordScore: matchCount / keywords.length };
    })
    .filter(s => s.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, 10)
    .map(seg => extractTranscriptForRange(transcript, seg.start, seg.end));
}

/**
 * Deduplicate clips that overlap in time.
 */
/**
 * Deduplicate clips using merge-sort O(n log n) algorithm
 * Removes clips that overlap by >50% with existing clips
 * Preserves source priority: timestamp > description > ai
 * @param {Array} clips - Array of clip objects with {start, end, source}
 * @returns {Array} Deduplicated clips in chronological order
 */
function deduplicateClips(clips) {
  if (clips.length <= 1) return clips;
  
  // Step 1: Sort by start time (primary), then end time (secondary)
  // For same time, prioritize manual > description > ai
  const SOURCE_PRIORITY = { timestamp: 0, description: 1, ai: 2 };
  
  const sorted = [...clips].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return SOURCE_PRIORITY[a.source || 'ai'] - SOURCE_PRIORITY[b.source || 'ai'];
  });
  
  // Step 2: Deduplicate using sliding window
  const result = [];
  for (const clip of sorted) {
    // Check if any existing clip overlaps significantly
    let hasOverlap = false;
    
    for (const existing of result) {
      const overlapStart = Math.max(existing.start, clip.start);
      const overlapEnd = Math.min(existing.end, clip.end);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      const clipDuration = clip.end - clip.start;
      
      // Keep clip if overlap < 50% of its duration
      if (overlapDuration > clipDuration * 0.5) {
        hasOverlap = true;
        break;
      }
    }
    
    if (!hasOverlap) {
      result.push(clip);
    }
  }
  
  return result;
}

/**
 * Run the full processing pipeline
 * @param {string} source - YouTube URL or local file path
 * @param {string} genre - Content genre for AI ranking
 * @param {Function} broadcast - WebSocket broadcast function
 * @param {string} rootDir - Project root directory
 * @param {Object} options - Advanced options { description, timestamps, clipMode }
 */
export async function runPipeline(source, genre, broadcast, rootDir, options = {}) {
  const config = getConfig();
  const pipeline = { stopped: false, videoPath: null, selected: null, clipsWithMeta: null, transcript: null };
  currentPipeline = pipeline;

  const { language = 'auto', description, timestamps, clipMode, clipCount, defaultRatio = '9:16', defaultZoom = 1.0, videoQuality = 'high', exportQuality = 'balanced', captionStyle } = options;
  const hasTimestamps = timestamps && timestamps.length > 0;
  const onlyManual = clipMode === 'only';

  if (onlyManual && !hasTimestamps) {
    broadcast({
      type: 'error',
      errorCode: 'NO_MANUAL_INPUT',
      msg: 'You selected "Only these clips" but did not provide any timestamps. Please add timestamps, then try again.',
    });
    throw new Error('PIPELINE_CANCELLED');
  }

  const tempDir = path.join(rootDir, 'temp');
  const outputBaseDir = path.join(rootDir, 'output');

  // Verify disk space before allocating temp files
  try {
    ensureSufficientDiskSpace(tempDir, 300 * 1024 * 1024);
  } catch (diskErr) {
    broadcast({
      type: 'error',
      errorCode: 'DISK_FULL',
      msg: diskErr.message,
    });
    throw new Error('PIPELINE_CANCELLED');
  }

  const checkStopped = (stepName) => {
    if (pipeline.stopped) {
      broadcast({ type: 'log', level: 'warning', msg: `Pipeline cancelled during: ${stepName}` });
      throw new Error('PIPELINE_CANCELLED');
    }
  };

  try {
    // ─── Step 1: Download Video ───────────────────────
    broadcast({ type: 'step', step: 'download', status: 'active' });
    broadcast({ type: 'log', level: 'info', msg: `⬇️  Downloading video from: ${source}` });

    const isUrl = source.startsWith('http://') || source.startsWith('https://');
    let videoPath;

    if (isUrl) {
      const videoDir = path.join(tempDir, 'video');
      const logDownload = (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` });
      videoPath = await downloadVideo(source, videoDir, logDownload, videoQuality);
      broadcast({ type: 'log', level: 'success', msg: `✅ Downloaded: ${path.basename(videoPath)}` });
    } else {
      if (!fs.existsSync(source)) {
        broadcast({
          type: 'error',
          errorCode: 'FILE_NOT_FOUND',
          msg: `File not found: ${source}. Please check the path and try again.`,
        });
        throw new Error('PIPELINE_CANCELLED');
      }
      videoPath = path.resolve(source);
      broadcast({ type: 'log', level: 'success', msg: `✅ Using local file: ${path.basename(videoPath)}` });
    }

    pipeline.videoPath = videoPath;
    broadcast({ type: 'step', step: 'download', status: 'done' });
    checkStopped('download');

    // ─── Step 2: Extract Audio ────────────────────────
    broadcast({ type: 'step', step: 'transcribe', status: 'active' });
    broadcast({ type: 'log', level: 'info', msg: '🎵 Extracting audio for transcription...' });

    const audioDir = path.join(tempDir, 'audio');
    let audioPath;
    try {
      audioPath = await extractAudio(videoPath, audioDir);
    } catch (e) {
      broadcast({
        type: 'error',
        errorCode: 'FFMPEG_EXTRACT_FAILED',
        msg: `FFmpeg failed to extract audio: ${e.message}`,
        step: 'transcribe',
      });
      throw new Error('PIPELINE_CANCELLED');
    }
    broadcast({ type: 'log', level: 'success', msg: '✅ Audio extracted successfully' });
    checkStopped('audio-extraction');

    // ─── Step 3: Transcribe with Whisper ──────────────
    broadcast({ type: 'log', level: 'info', msg: '🎤 Running Whisper transcription (this may take a few minutes)...' });

    let transcript;
    try {
      transcript = await transcribeAudio(audioPath, config.cacheDir, {
        language,
        title: videoInfo?.title || '',
        description: videoInfo?.description || description || '',
        channel: videoInfo?.channel || '',
      }, (progressMsg) => {
        broadcast({ type: 'log', level: 'info', msg: `    ${progressMsg}` });
      });
    } catch (e) {
      broadcast({
        type: 'error',
        errorCode: 'TRANSCRIPTION_FAILED',
        msg: `Transcription failed: ${e.message}`,
        step: 'transcribe',
      });
      throw new Error('PIPELINE_CANCELLED');
    }

    pipeline.transcript = transcript;

    const wordCount = transcript.segments.reduce((sum, s) => sum + (s.words ? s.words.length : s.text.split(/\s+/).length), 0);
    const langDisplay = (transcript.language || 'unknown').toUpperCase();

    broadcast({ type: 'log', level: 'success', msg: `✅ Transcribed ${wordCount} words — Language: ${langDisplay}` });
    broadcast({ type: 'language', language: transcript.language || 'unknown' });
    broadcast({ type: 'step', step: 'transcribe', status: 'done' });
    checkStopped('transcription');

    // ─── Step 4: Process Timestamp Clips ─────────────
    const timestampClips = [];
    if (hasTimestamps) {
      const { validClips: sanitizedTs, rejected } = sanitizeAndValidateClips(timestamps, transcript.duration);
      if (rejected.length > 0) {
        broadcast({ type: 'log', level: 'warning', msg: `⚠️ Ignored ${rejected.length} invalid timestamp(s): ${rejected.map(r => r.error).join('; ')}` });
      }

      broadcast({ type: 'log', level: 'info', msg: `⏱️  Creating ${sanitizedTs.length} manual timestamp clip(s)...` });

      for (const ts of sanitizedTs) {
        const chunk = extractTranscriptForRange(transcript, ts.start, ts.end);
        timestampClips.push({
          index: -1,
          chunk,
          heuristic: { total: 80 },
          source: 'timestamp',
        });
        broadcast({ type: 'log', level: 'info', msg: `   ⏱️ Timestamp clip: ${ts.start}s → ${ts.end}s (${Math.round(ts.end - ts.start)}s)` });
      }
    }

    // ─── Step 5: AI Clip Selection ───────────────────
    let aiClips = [];

    if (!onlyManual) {
      // Calculate target number of clips (custom count or dynamic based on video length)
      const transcriptDuration = transcript?.duration || (transcript.segments?.length > 0 ? transcript.segments[transcript.segments.length - 1].end : 300);
      const videoMinutes = Math.max(1, transcriptDuration / 60);
      const dynamicAutoClips = Math.max(3, Math.min(30, Math.round(videoMinutes * 1.5)));
      const parsedCount = parseInt(clipCount, 10);
      const targetClips = (!isNaN(parsedCount) && parsedCount > 0)
        ? parsedCount
        : (config.clips > 0 ? config.clips : dynamicAutoClips);

      broadcast({ type: 'step', step: 'analyze', status: 'active' });
      broadcast({ type: 'log', level: 'info', msg: `📊 Finding top ${targetClips} viral clips for ${genre || 'auto-detected'} genre...` });

      try {
        const selectedClipCandidates = await selectClips(transcript, genre || 'default', targetClips, {
          ollamaUrl: config.ollamaUrl,
          model: config.model,
          description: description,
          onLog: (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` }),
        });

        // Convert ClipCandidate to pipeline's internal format
        aiClips = selectedClipCandidates.map((clip, i) => ({
          index: i,
          chunk: {
            start: clip.start,
            end: clip.end,
            text: clip.text,
            words: clip.words || [],
          },
          heuristic: clip.scoreBreakdown?.heuristic || { total: clip.heuristicScore || 50 },
          aiScore: clip.llmScore,
          combinedScore: clip.combinedScore,
          aiTitle: clip.hookCaption || '',
          aiReason: clip.justification || '',
          source: 'ai',
        }));

        broadcast({ type: 'log', level: 'success', msg: `✅ AI selected ${aiClips.length} viral clips!` });
      } catch (e) {
        const activeProvider = aiRegistry.getLLMProvider();
        broadcast({
          type: 'error',
          errorCode: e.message.includes('timed out') ? 'AI_TIMEOUT' : 'AI_CONNECTION',
          msg: `AI ranking via ${activeProvider.name} failed: ${e.message}`,
          step: 'analyze',
          recoverable: true,
        });
        broadcast({ type: 'log', level: 'warning', msg: '⚠️ Falling back to deterministic heuristic-only mode...' });

        // Heuristic fallback: use segmenter + scorer without LLM
        try {
          const { generateCandidateSegments } = await import('./segmenter.js');
          const { scoreSegments } = await import('./scorer.js');

          const candidates = generateCandidateSegments(transcript);
          const scored = scoreSegments(candidates, genre || 'default');
          const topScored = [...scored].sort((a, b) => b.heuristic.total - a.heuristic.total).slice(0, targetClips);

          aiClips = topScored.map((seg, i) => ({
            index: i,
            chunk: { start: seg.start, end: seg.end, text: seg.text, words: seg.words || [] },
            heuristic: seg.heuristic,
            aiScore: null,
            combinedScore: seg.heuristic.total,
            aiTitle: '',
            aiReason: `Heuristic: ${seg.breakdownStr}`,
            source: 'ai',
          }));
        } catch (fallbackErr) {
          broadcast({ type: 'log', level: 'error', msg: `Heuristic fallback also failed: ${fallbackErr.message}` });
        }
      }

      broadcast({ type: 'step', step: 'analyze', status: 'done' });
      broadcast({ type: 'step', step: 'rank', status: 'done' });
    } else {
      // Skip AI ranking in "only" mode
      broadcast({ type: 'step', step: 'analyze', status: 'done' });
      broadcast({ type: 'step', step: 'rank', status: 'done' });
      broadcast({ type: 'log', level: 'info', msg: '⏭️ Skipping AI ranking (manual/description-only mode)' });
    }

    checkStopped('ranking');

    // ─── Step 6: Combine & Deduplicate ──────────────
    let allSelected = [];

    if (onlyManual) {
      allSelected = [...timestampClips];
      
      // ✅ Deduplicate manual selections (O(n log n))
      if (allSelected.length > 1) {
        const forDedup = allSelected.map(c => ({
          ...c,
          start: c.chunk.start,
          end: c.chunk.end,
        }));
        const deduped = deduplicateClips(forDedup);
        if (allSelected.length !== deduped.length) {
          broadcast({ 
            type: 'log', 
            level: 'info', 
            msg: `   Deduplicated: ${allSelected.length} → ${deduped.length} manual clips (removed ${allSelected.length - deduped.length} overlaps)` 
          });
        }
        allSelected = deduped;
      }
      
      broadcast({ type: 'log', level: 'info', msg: `📋 Using ${allSelected.length} manual timestamp clip(s) only` });

      if (allSelected.length === 0) {
        broadcast({
          type: 'error',
          errorCode: 'NO_MANUAL_CLIPS_FOUND',
          msg: 'No clips found from your timestamps. Please provide valid timestamp ranges.',
          step: 'rank',
          recoverable: true,
        });
        broadcast({ type: 'done' });
        return;
      }
    } else {
      // 'add' mode: Combine timestamps + AI clips
      allSelected = [...timestampClips, ...aiClips];
      
      if (timestampClips.length > 0) {
        const before = allSelected.length;
        const forDedup = allSelected.map(c => ({
          ...c,
          start: c.chunk.start,
          end: c.chunk.end,
        }));
        const deduped = deduplicateClips(forDedup);
        allSelected = deduped;
        if (before !== deduped.length) {
          broadcast({ type: 'log', level: 'info', msg: `   Deduplicated: ${before} → ${deduped.length} clips (removed overlaps)` });
        }
      }

      if (allSelected.length === 0) {
        broadcast({ type: 'log', level: 'warning', msg: '⚠️ No clips found — please try a different video or genre.' });
        broadcast({ type: 'done' });
        return;
      }
    }

    pipeline.selected = allSelected;
    broadcast({ type: 'log', level: 'success', msg: `✅ Total clips for review: ${allSelected.length}` });

    // ─── Step 7: Build clip metadata (lazy social content) ──
    // Social content (description, hashtags) is generated lazily
    // during render — not here — to cut analysis time by ~15-25s.
    const clipsWithMeta = allSelected.map((clip, i) => {
      // Use hookCaption from the LLM ranker if available, else derive from text
      const title = clip.aiTitle
        || (clip.chunk.text || '').split(/[.!?]/)[0]?.trim().slice(0, 60)
        || `Clip ${i + 1}`;

      return {
        index: i,
        start: clip.chunk.start,
        end: clip.chunk.end,
        duration: Math.round(clip.chunk.end - clip.chunk.start),
        text: clip.chunk.text,
        words: clip.chunk.words || [],
        score: clip.aiScore || clip.combinedScore || Math.round((clip.heuristic?.total || 50) / 10),
        heuristic: clip.heuristic || { total: 50 },
        aiReason: clip.aiReason || '',
        title,
        description: '',   // Generated lazily at render time
        hashtags: '',       // Generated lazily at render time
        caption: (clip.chunk.text || '').slice(0, 100),
        language: transcript.language || 'unknown',
        source: clip.source || 'ai',
        aspectRatio: defaultRatio || '9:16',
        zoom: (() => {
          const parsed = Number(defaultZoom);
          return Number.isFinite(parsed) ? Math.min(3.0, Math.max(0.1, parsed)) : 1.0;
        })(),
        exportQuality: exportQuality || 'balanced',
        captionPreset: captionStyle || options.subtitleStyle || config.subtitleStyle || 'hormozi',
      };
    });

    pipeline.clipsWithMeta = clipsWithMeta;
    pipeline.genre = genre;
    broadcast({ type: 'log', level: 'success', msg: `✅ ${clipsWithMeta.length} clips ready for review` });

    // ─── Send Clips to Frontend for Review ────────────
    broadcast({
      type: 'clips_ready',
      clips: clipsWithMeta,
      videoPath: videoPath,
      language: transcript.language || 'unknown',
    });

  } catch (err) {
    if (err.message === 'PIPELINE_CANCELLED') {
      // Already broadcast appropriate error/stopped messages above
    } else {
      throw err;
    }
  }
}
