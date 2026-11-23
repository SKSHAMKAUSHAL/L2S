// =============================================
// SKATE — Express + WebSocket Server
// =============================================

import './env.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { runPipeline, stopPipeline, getPipelineState } from './pipeline.js';
import { checkDependencies } from './doctor.js';
import { renderClips } from './renderer.js';
import { generateSocialContent } from './social.js';
import { initializeFirebase, uploadClipToCloud, cleanupExpiredClips } from './firebase_storage.js';
import { CacheManager } from './cache_manager.js';
import ParallelProcessor from './parallel_processor.js';
import { mergeSort, getTopK } from './sorting_algorithms.js';
import {
  getYouTubeAuthUrl, exchangeYouTubeCode,
  getInstagramAuthUrl, exchangeInstagramCode,
  getConnectionStatus, getCredentialStatus,
  disconnectPlatform,
} from './auth.js';
import { publishClips, getYouTubeQuotaStatus } from './uploader.js';
import { aiRegistry } from './ai/registry.js';
import { CAPTION_PRESETS } from './captions/presets.js';
import { fetchVideoInfoAsync } from './downloader.js';
import { jobCoordinator, sanitizeClientError } from './pipeline_job.js';
import {
  SOURCE_QUALITY_PROFILES,
  EXPORT_PROFILES,
  analyzeSourceFormats,
  validateSourceResolution,
} from './video/quality_profiles.js';
import { detectEncoder } from './renderer.js';

// ─── Load .env manually (no extra dependency) ────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

try {
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val && !process.env[key]) process.env[key] = val;
        }
      }
    }
  }
} catch (e) { /* ignore */ }

// ─── App Setup ───────────────────────────────────────
const app = express();
app.use(express.json());

// ─── Security Headers (OWASP Hardening) ──────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; media-src 'self' blob: data:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; child-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' ws: wss: http: https:;"
  );
  next();
});

// Serve static files
app.use(express.static(path.join(rootDir, 'public'), { maxAge: '1h' }));
app.use('/output', express.static(path.join(rootDir, 'output')));
app.use('/temp', express.static(path.join(rootDir, 'temp')));

// ✅ NEW: Initialize Firebase Storage
const firebaseInitialized = initializeFirebase();
if (firebaseInitialized) {
  console.log('[Server] ✅ Cloud storage enabled');
  // Start cleanup task (every 30 minutes)
  setInterval(() => {
    cleanupExpiredClips(60).catch(err => console.warn('[Firebase] Cleanup error:', err.message));
  }, 30 * 60 * 1000);
} else {
  console.log('[Server] ⚠️  Cloud storage disabled - using local storage');
}

// ✅ NEW: Initialize Cache Manager
const cacheDir = path.join(rootDir, '.cache');
const cacheManager = new CacheManager(cacheDir);
console.log('[Server] ✅ Cache manager initialized');

// Periodic cache cleanup (every hour)
setInterval(() => {
  cacheManager.clearExpired();
}, 60 * 60 * 1000);

// ✅ NEW: Initialize Parallel Processor
const parallelProcessor = new ParallelProcessor();
console.log(`[Server] ✅ Parallel processor initialized (max concurrency: ${parallelProcessor.maxConcurrency})`);

// Serve raw video for the Live Editor
app.get('/api/raw_video', (req, res) => {
  const state = getPipelineState();
  let videoPath = state?.videoPath;

  // Fallback: If server restarted and state is lost, find latest .mp4 in temp dir
  if (!videoPath || !fs.existsSync(videoPath)) {
    const tempDir = path.join(rootDir, 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.mp4'));
      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(path.join(tempDir, b)).mtimeMs - fs.statSync(path.join(tempDir, a)).mtimeMs);
        videoPath = path.join(tempDir, files[0]);
      }
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).send('Raw video not available');
  }
  
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Ensure directories exist
fs.mkdirSync(path.join(rootDir, 'output'), { recursive: true });
fs.mkdirSync(path.join(rootDir, 'temp'), { recursive: true });

// ─── WebSocket ───────────────────────────────────────
const clients = new Set();
let isProcessing = false;

const broadcast = (message) => {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
};

/**
 * Session manager for tracking active pipelines per user/session
 * Prevents duplicate operations and tracks state across reloads
 */
class PipelineSessionManager {
  constructor() {
    this.sessions = new Map(); // session ID → {state, startTime, processId}
  }
  
  createSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      return { error: 'Pipeline already running in this session' };
    }
    
    const session = {
      sessionId,
      state: 'idle',
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      processId: null,
    };
    
    this.sessions.set(sessionId, session);
    return session;
  }
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  updateState(sessionId, state) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = state;
      session.lastHeartbeat = Date.now();
    }
  }
  
  stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'stopped';
      this.sessions.delete(sessionId);
    }
  }
  
  cleanupStaleSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const age = Date.now() - session.lastHeartbeat;
    if (age > 30 * 60 * 1000) { // 30 minutes
      console.log(`[Session] Cleaning up stale session: ${sessionId}`);
      this.sessions.delete(sessionId);
    }
  }
}

const sessionManager = new PipelineSessionManager();

// ─── API Routes ──────────────────────────────────────

/**
 * GET /api/status — Check installed dependencies
 */
app.get('/api/status', async (req, res) => {
  const status = await checkDependencies();
  res.json(status);
});

/**
 * GET /api/providers — List AI providers and connectivity status
 */
app.get('/api/providers', async (req, res) => {
  try {
    const summary = await aiRegistry.getStatusSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI provider status' });
  }
});

/**
 * POST /api/providers/switch — Switch active LLM or STT provider
 */
app.post('/api/providers/switch', (req, res) => {
  const { llmId, sttId, allowCloudFallback } = req.body;
  try {
    if (llmId) aiRegistry.setActiveLLM(llmId);
    if (sttId) aiRegistry.setActiveSTT(sttId);
    if (typeof allowCloudFallback === 'boolean') {
      aiRegistry.allowCloudFallback = allowCloudFallback;
    }
    const currentLLM = aiRegistry.getLLMProvider();
    res.json({
      success: true,
      activeLLM: aiRegistry.activeLLMId,
      activeSTT: aiRegistry.activeSTTId,
      allowCloudFallback: aiRegistry.allowCloudFallback,
      isConfigured: currentLLM.isConfigured(),
      needsKey: currentLLM.type === 'cloud' && !currentLLM.isConfigured(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/providers/key — Update API key for cloud provider
 */
app.post('/api/providers/key', (req, res) => {
  const { providerId, apiKey } = req.body;
  if (!providerId) {
    return res.status(400).json({ error: 'providerId is required' });
  }
  const updated = aiRegistry.updateProviderKey(providerId, apiKey);
  if (updated) {
    res.json({ success: true, message: `Key updated for ${providerId}` });
  } else {
    res.status(400).json({ error: `Provider ${providerId} not found or is not a cloud provider` });
  }
});

/**
 * GET /api/providers/models — Return available models for selected provider
 */
app.get('/api/providers/models', async (req, res) => {
  const providerId = req.query.provider || aiRegistry.activeLLMId;
  try {
    const models = await aiRegistry.getAvailableModels(providerId);
    const activeModel = aiRegistry.getLLMProvider(providerId)?.model || '';
    res.json({ success: true, provider: providerId, models, activeModel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/providers/model — Set active model for a provider
 */
app.post('/api/providers/model', (req, res) => {
  const { provider, model } = req.body;
  if (!provider || !model) {
    return res.status(400).json({ error: 'provider and model are required' });
  }
  const ok = aiRegistry.setModel(provider, model);
  if (ok) {
    res.json({ success: true, provider, model });
  } else {
    res.status(400).json({ error: `Could not set model for provider ${provider}` });
  }
});

/**
 * GET /api/hardware — Host device hardware and optimal model recommendation
 */
app.get('/api/hardware', (req, res) => {
  try {
    const summary = aiRegistry.getStatusSummary();
    res.json(summary.hardware || {});
  } catch (e) {
    res.status(500).json({ error: 'Failed to detect hardware' });
  }
});

/**
 * GET /api/caption-presets — Return available professional caption presets
 */
app.get('/api/caption-presets', (req, res) => {
  res.json(CAPTION_PRESETS);
});

/**
 * GET /api/export-profiles — Return export encoding profiles and hardware encoder status
 */
app.get('/api/export-profiles', (req, res) => {
  res.json({
    exportProfiles: EXPORT_PROFILES,
    sourceProfiles: SOURCE_QUALITY_PROFILES,
    detectedEncoder: detectEncoder(),
  });
});

/**
 * POST /api/video-info — Fetch YouTube video metadata asynchronously with resolution detection
 */
app.post('/api/video-info', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  const cleanUrl = url.trim();
  if (cleanUrl.startsWith('-') || cleanUrl.startsWith('/dev/')) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    const info = await fetchVideoInfoAsync(cleanUrl);
    const sourceMeta = analyzeSourceFormats(info.formats || []);
    res.json({
      title: info.title || 'Unknown',
      thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
      duration: info.duration || 0,
      channel: info.uploader || info.channel || 'Unknown',
      viewCount: info.view_count || 0,
      description: (info.description || '').slice(0, 200),
      sourceResolution: sourceMeta,
    });
  } catch (e) {
    const sanitized = sanitizeClientError(e);
    res.status(400).json({ error: sanitized.msg || 'Could not fetch video info. Check the URL.' });
  }
});

/**
 * POST /api/process — Start the clip generation pipeline
 */
app.post('/api/process', async (req, res) => {
  if (isProcessing) {
    return res.status(409).json({ error: 'Pipeline already running. Stop it first.' });
  }

  const { source, genre, language = 'auto', description, timestamps, clipMode, clipCount, defaultRatio, defaultZoom, videoQuality, exportQuality, captionStyle, sessionId } = req.body;
  if (!source || typeof source !== 'string') return res.status(400).json({ error: 'Source URL is required' });

  const cleanSource = source.trim();
  if (cleanSource.startsWith('-')) {
    return res.status(400).json({ error: 'Invalid source URL format' });
  }

  // ✅ NEW: Check for existing pipeline in this session
  const existing = sessionManager.getSession(sessionId);
  if (existing && existing.state === 'running') {
    return res.status(409).json({ 
      error: 'Pipeline already running',
      suggestion: 'Click Stop first or wait for completion'
    });
  }
  
  // Clean up old stale sessions
  if (sessionId) {
    sessionManager.cleanupStaleSession(sessionId);
  }
  
  // Create new session
  let session = null;
  if (sessionId) {
    session = sessionManager.createSession(sessionId);
    if (session.error) {
      return res.status(409).json(session);
    }
  }

  // Strict Cloud Model Validation: Never run or fall back if key is missing
  const activeLLM = aiRegistry.getLLMProvider();
  if (activeLLM.type === 'cloud' && !activeLLM.isConfigured()) {
    return res.status(400).json({
      error: 'MISSING_API_KEY',
      provider: activeLLM.id,
      message: `${activeLLM.name} is selected as your active AI model, but no API key was provided. Please enter your ${activeLLM.id.toUpperCase()}_API_KEY in Settings or your .env file before running.`,
    });
  }

  isProcessing = true;
  res.json({ success: true, message: 'Pipeline started', sessionId });

  try {

  // Update session state
  if (sessionId) {
    sessionManager.updateState(sessionId, 'running');
  }

  // Check dependencies
  const deps = await checkDependencies();
  const hasFFmpeg = deps.ffmpeg.installed;
  const hasYtdlp = deps.ytdlp.installed;
  const hasOllama = deps.ollama.installed;

  broadcast({ type: 'log', level: 'info', msg: `🛹 Starting L2S pipeline for: ${source}` });
  broadcast({ type: 'log', level: 'info', msg: `🎯 Genre: ${genre || 'auto-detect'}` });
  if (clipCount) {
    broadcast({ type: 'log', level: 'info', msg: `✂️  Target Clips: ${clipCount === 'auto' ? 'Auto (dynamic based on video length)' : clipCount}` });
  }
  if (defaultRatio) {
    broadcast({ type: 'log', level: 'info', msg: `📐 Ratio: ${defaultRatio} (Zoom: ${defaultZoom || 1.0}x)` });
  }

  if (description) {
    broadcast({ type: 'log', level: 'info', msg: `📝 Description filter: "${description}"` });
  }
  if (timestamps && timestamps.length > 0) {
    broadcast({ type: 'log', level: 'info', msg: `⏱️  Manual timestamps: ${timestamps.length} ranges provided` });
  }
  if (clipMode === 'only' && (timestamps && timestamps.length > 0)) {
    broadcast({ type: 'log', level: 'info', msg: `🎯 Mode: Only timestamp clips (skipping AI ranking)` });
  }

  // Check critical dependencies
  if (!hasFFmpeg || !hasYtdlp) {
    const missing = [];
    if (!hasFFmpeg) missing.push('FFmpeg');
    if (!hasYtdlp) missing.push('yt-dlp');
    broadcast({
      type: 'error',
      errorCode: 'MISSING_DEPS',
      msg: `Missing required tools: ${missing.join(', ')}. Install them and add to your system PATH.`,
    });
    isProcessing = false;
    if (sessionId) sessionManager.updateState(sessionId, 'error');
    return;
  }

  const activeLLM = aiRegistry.getLLMProvider();
  const activeSTT = aiRegistry.getSTTProvider();

  broadcast({ type: 'log', level: 'info', msg: `🤖 Active LLM: ${activeLLM.name} (${activeLLM.model})` });
  broadcast({ type: 'log', level: 'info', msg: `🎙️ Active STT: ${activeSTT.name}` });

  if (activeLLM.id === 'ollama') {
    const conn = await activeLLM.testConnection();
    if (!conn.ok) {
      broadcast({ type: 'log', level: 'warning', msg: '⚠️ Ollama daemon not running — AI ranking will run in heuristic-only mode. (To enable AI: ollama serve)' });
    } else {
      broadcast({ type: 'log', level: 'success', msg: `✅ Ollama local AI connected (${activeLLM.model})` });
    }
  } else if (activeLLM.id === 'groq') {
    if (!activeLLM.isConfigured()) {
      broadcast({
        type: 'error',
        errorCode: 'MISSING_API_KEY',
        msg: 'Groq Cloud is active, but GROQ_API_KEY is not configured. Set it in Settings or your .env file.',
      });
      isProcessing = false;
      if (sessionId) sessionManager.updateState(sessionId, 'error');
      return;
    }
    broadcast({ type: 'log', level: 'success', msg: `✅ Groq Cloud ready (${activeLLM.model})` });
  }

    await runPipeline(source, genre, broadcast, rootDir, {
      language,
      description,
      timestamps,
      clipMode,
      clipCount,
      defaultRatio,
      defaultZoom,
      videoQuality,
      exportQuality,
      captionStyle,
    });
    broadcast({ type: 'done' });
    if (sessionId) sessionManager.updateState(sessionId, 'completed');
    jobCoordinator.completeJob(sessionId);
  } catch (err) {
    jobCoordinator.failJob(sessionId, err);
    if (err.message === 'PIPELINE_CANCELLED') {
      broadcast({ type: 'stopped' });
      if (sessionId) sessionManager.updateState(sessionId, 'stopped');
    } else {
      const sanitized = sanitizeClientError(err, rootDir);
      let errorCode = sanitized.code;
      const msg = err.message || '';
      if (msg.includes('GROQ_API_KEY') || msg.includes('missing') && msg.includes('key')) errorCode = 'MISSING_API_KEY';
      else if (msg.includes('429') || msg.includes('rate limit')) errorCode = 'RATE_LIMIT_EXCEEDED';
      else if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) errorCode = 'AI_CONNECTION';
      else if (msg.includes('timed out')) errorCode = 'AI_TIMEOUT';
      else if (msg.includes('yt-dlp') || msg.includes('403')) errorCode = 'YTDLP_FAILED';
      else if (msg.includes('ffmpeg') || msg.includes('FFmpeg')) errorCode = 'FFMPEG_FAILED';
      else if (msg.includes('whisper') || msg.includes('transcri')) errorCode = 'TRANSCRIPTION_FAILED';
      else if (msg.includes('DISK_FULL') || msg.includes('disk space')) errorCode = 'DISK_FULL';
      broadcast({ type: 'error', errorCode, msg: sanitized.msg, step: 'error' });
      if (sessionId) sessionManager.updateState(sessionId, 'error');
    }
  } finally {
    isProcessing = false;
  }
});

/**
 * POST /api/stop — Cancel a running pipeline
 */
app.post('/api/stop', (req, res) => {
  const { sessionId } = req.body;
  
  // ✅ NEW: Handle session-based stop
  if (sessionId) {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    sessionManager.stopSession(sessionId);
  }
  
  if (!isProcessing) {
    return res.json({ success: true, message: 'Nothing to stop' });
  }
  jobCoordinator.cancelActiveJob('Stopped by user');
  stopPipeline();
  isProcessing = false;
  broadcast({ type: 'log', level: 'warning', msg: '🛑 Pipeline cancelled by user' });
  broadcast({ type: 'stopped' });
  res.json({ success: true, message: 'Pipeline stopping...' });
});

/**
 * GET /api/session-status/:sessionId — Check if session is active
 */
app.get('/api/session-status/:sessionId', (req, res) => {
  const session = sessionManager.getSession(req.params.sessionId);
  
  res.json({
    active: session ? true : false,
    state: session?.state || 'idle',
    age: session ? Date.now() - session.startTime : null,
  });
});

/**
 * Validate that selectedIndices match expected clips
 * Returns true if all indices are valid and point to correct clips
 * @param {Array} selectedIndices - User's selected clip indices
 * @param {Array} selectedClipsData - Actual clip objects from frontend
 * @param {Object} currentState - state.selected from pipeline
 * @returns {Object} {valid: boolean, error: string}
 */
function validateSelectedIndices(selectedIndices, selectedClipsData, currentState) {
  if (!selectedIndices || selectedIndices.length === 0) {
    return { valid: false, error: 'No clips selected' };
  }
  
  if (!selectedClipsData || selectedClipsData.length !== selectedIndices.length) {
    return { valid: false, error: 'Clip data count mismatch' };
  }
  
  if (!currentState || !currentState.selected || !Array.isArray(currentState.selected)) {
    return { valid: false, error: 'Pipeline state corrupted or missing' };
  }
  
  // Verify each index maps to correct clip
  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const dataClip = selectedClipsData[i];
    
    // Index out of bounds
    if (idx < 0 || idx >= currentState.selected.length) {
      return { 
        valid: false, 
        error: `Index ${idx} out of bounds (state has ${currentState.selected.length} clips)` 
      };
    }
    
    const stateClip = currentState.selected[idx];
    
    // Validate clip identity using start/end times (deterministic)
    if (Math.abs(stateClip.start - dataClip.start) > 0.1 || 
        Math.abs(stateClip.end - dataClip.end) > 0.1) {
      return { 
        valid: false, 
        error: `Clip data mismatch at index ${idx}: expected ${stateClip.start}-${stateClip.end}s, got ${dataClip.start}-${dataClip.end}s` 
      };
    }
  }
  
  return { valid: true };
}

/**
 * POST /api/render — Render selected clips with FFmpeg
 */
app.post('/api/render', async (req, res) => {
  const { selectedIndices, selectedClipsData, customOutputDir, captionStyle, exportQuality } = req.body;
  const state = getPipelineState();

  if (!state || !state.videoPath || !state.selected) {
    return res.status(400).json({ error: 'No pipeline data. Run the pipeline first.' });
  }

  // Validate indices before rendering
  const validation = validateSelectedIndices(selectedIndices, selectedClipsData, state);
  if (!validation.valid) {
    broadcast({ 
      type: 'error', 
      msg: `Validation failed: ${validation.error}`,
      recoverable: true 
    });
    return res.status(400).json({ 
      error: validation.error,
      suggestion: 'Review page state may be stale. Please regenerate clips.' 
    });
  }

  res.json({ success: true, message: 'Rendering started' });

  broadcast({ type: 'step', step: 'render', status: 'active' });
  broadcast({ type: 'log', level: 'info', msg: '🎬 Starting clip rendering with FFmpeg...' });

  try {
    // Use validated indices
    const indices = selectedIndices;
    const toRender = indices
      .map((clipIndex, arrayIndex) => {
        const baseClip = state.selected[clipIndex];
        if (!baseClip) return null;
        const customData = selectedClipsData && selectedClipsData[arrayIndex] ? { ...selectedClipsData[arrayIndex] } : {};
        if (captionStyle && !customData.captionPreset) customData.captionPreset = captionStyle;
        if (exportQuality && !customData.exportQuality) customData.exportQuality = exportQuality;
        return { ...baseClip, custom: customData };
      })
      .filter(Boolean);

    if (toRender.length === 0) {
      throw new Error('No valid clips to render after validation');
    }

    broadcast({ type: 'log', level: 'info', msg: `🎞️  Rendering exactly ${toRender.length} clips (as selected)...` });

    // Create output directory named after the video
    const videoName = path.basename(state.videoPath, path.extname(state.videoPath));
    const baseDir = customOutputDir && fs.existsSync(customOutputDir) ? customOutputDir : path.join(rootDir, 'output');
    const outputDir = path.join(baseDir, videoName);

    // Render selected clips and get exact job details
    const renderedJobs = await renderClips(state.videoPath, toRender, 'tiktok', outputDir, (msg) => {
      broadcast({ type: 'log', level: 'info', msg: `  ${msg}` });
    });

    // Collect ONLY the clips rendered in this job run
    let renderedFiles = [];
    let cloudUploadSucceeded = 0;
    let cloudUploadFailed = 0;

    for (const job of renderedJobs) {
      const clipFile = job.clipFileName;
      const localPath = job.clipPath;

      if (firebaseInitialized && fs.existsSync(localPath)) {
        try {
          const uploadResult = await uploadClipToCloud(localPath, clipFile, 30);
          renderedFiles.push({
            name: clipFile,
            url: uploadResult.url,
            cloudPath: uploadResult.cloudPath,
            expiresAt: uploadResult.expiresAt,
            type: 'cloud',
          });
          cloudUploadSucceeded++;
          broadcast({ type: 'log', level: 'info', msg: `  ✅ ${clipFile} → cloud` });
        } catch (uploadErr) {
          renderedFiles.push({
            name: clipFile,
            url: `/output/${videoName}/clips/${clipFile}`,
            type: 'local',
          });
          cloudUploadFailed++;
          broadcast({ type: 'log', level: 'warn', msg: `  ⚠️  ${clipFile} → local storage` });
        }
      } else {
        renderedFiles.push({
          name: clipFile,
          url: `/output/${videoName}/clips/${clipFile}`,
          type: 'local',
        });
      }
    }

    broadcast({ type: 'log', level: 'success', msg: `✅ Rendered exactly ${renderedFiles.length} clips successfully!` });
    if (cloudUploadSucceeded > 0) {
      broadcast({ type: 'log', level: 'info', msg: `☁️  Cloud: ${cloudUploadSucceeded}/${renderedFiles.length} clips` });
    }
    broadcast({ type: 'step', step: 'render', status: 'done' });

    // Send rendered file URLs to frontend
    broadcast({
      type: 'render_done',
      files: renderedFiles,
      outputDir: `/output/${videoName}`,
      cloudEnabled: !!firebaseInitialized,
    });

    // ─── Smart Auto-Cleanup of bulky raw download & audio ───
    try {
      const tempVideo = path.join(rootDir, 'temp', 'video');
      const tempAudio = path.join(rootDir, 'temp', 'audio');
      if (fs.existsSync(tempVideo)) {
        const vFiles = fs.readdirSync(tempVideo);
        for (const f of vFiles) { try { fs.unlinkSync(path.join(tempVideo, f)); } catch (e) {} }
      }
      if (fs.existsSync(tempAudio)) {
        const aFiles = fs.readdirSync(tempAudio);
        for (const f of aFiles) { try { fs.unlinkSync(path.join(tempAudio, f)); } catch (e) {} }
      }
      broadcast({ type: 'log', level: 'info', msg: '🧹 Cleaned temporary raw source media' });
    } catch (cleanErr) {}

    // ─── Lazy social content generation ──────────────
    const genre = state.genre || 'default';
    const language = state.transcript?.language || 'unknown';

    broadcast({ type: 'log', level: 'info', msg: '✍️  Generating social content for rendered clips...' });

    for (let ai = 0; ai < toRender.length; ai++) {
      const clip = toRender[ai];
      const clipText = clip.chunk?.text || clip.text || '';
      if (!clipText) continue;

      try {
        const social = await generateSocialContent(clipText, genre, language);
        broadcast({
          type: 'social_content',
          clipIndex: indices[ai],
          title: social.title,
          description: social.description,
          hashtags: social.hashtags,
          caption: social.caption,
        });
      } catch (e) {
        console.warn(`[server] Social content generation failed for clip ${ai + 1}:`, e.message);
      }
    }
    broadcast({ type: 'log', level: 'success', msg: '✅ Social content ready!' });

  } catch (err) {
    broadcast({ type: 'step', step: 'render', status: 'error' });
    broadcast({ type: 'error', msg: `Render failed: ${err.message}` });
  }
});

/**
 * POST /api/re-render — Re-render a single clip after editing
 */
app.post('/api/re-render', async (req, res) => {
  const { clipIndex, clipData } = req.body;
  const state = getPipelineState();

  if (!state || !state.videoPath) {
    return res.status(400).json({ error: 'No pipeline data. Run the pipeline first.' });
  }

  res.json({ success: true, message: 'Re-rendering clip...' });

  try {
    const videoName = path.basename(state.videoPath, path.extname(state.videoPath));
    const outputDir = path.join(rootDir, 'output', videoName);
    const clipsDir = path.join(outputDir, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    const clipNum = String(clipIndex + 1).padStart(2, '0');

    // Build the clip object for rendering
    const chunk = {
      start: clipData.start || 0,
      end: clipData.end || 0,
      text: clipData.text || '',
      words: clipData.words || [],
    };

    const toRender = [{
      chunk,
      custom: clipData,
    }];

    broadcast({ type: 'log', level: 'info', msg: `🔄 Re-rendering clip ${clipNum}...` });

    await renderClips(state.videoPath, toRender, 'tiktok', outputDir, (msg) => {
      broadcast({ type: 'log', level: 'info', msg: `  ${msg}` });
    });

    const fileUrl = `/output/${videoName}/clips/clip-01.mp4`;

    // Rename the re-rendered file to the correct clip number
    const renderedPath = path.join(clipsDir, 'clip-01.mp4');
    const targetPath = path.join(clipsDir, `clip-${clipNum}.mp4`);
    if (clipNum !== '01' && fs.existsSync(renderedPath)) {
      fs.renameSync(renderedPath, targetPath);
    }

    const finalUrl = `/output/${videoName}/clips/clip-${clipNum}.mp4`;

    broadcast({ type: 'log', level: 'success', msg: `✅ Clip ${clipNum} re-rendered!` });
    broadcast({
      type: 're_render_done',
      clipIndex,
      fileUrl: finalUrl,
    });

  } catch (err) {
    broadcast({ type: 'error', msg: `Re-render failed: ${err.message}` });
  }
});

/**
 * Helper: Calculate total directory size in bytes recursively
 */
function getDirSizeBytes(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSizeBytes(fullPath);
      } else if (entry.isFile()) {
        try { total += fs.statSync(fullPath).size; } catch (e) {}
      }
    }
  } catch (e) {}
  return total;
}

/**
 * Helper: Clean files from a directory
 */
function cleanDirectory(dirPath, keepDir = true) {
  if (!fs.existsSync(dirPath)) return 0;
  let freed = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        freed += cleanDirectory(fullPath, false);
      } else if (entry.isFile()) {
        try {
          const sz = fs.statSync(fullPath).size;
          fs.unlinkSync(fullPath);
          freed += sz;
        } catch (e) {}
      }
    }
    if (!keepDir) {
      try { fs.rmdirSync(dirPath); } catch (e) {}
    }
  } catch (e) {}
  return freed;
}

/**
 * GET /api/storage/status — Check storage usage
 */
app.get('/api/storage/status', (req, res) => {
  const tempDir = path.join(rootDir, 'temp');
  const outputDir = path.join(rootDir, 'output');
  const tempBytes = getDirSizeBytes(tempDir);
  const outputBytes = getDirSizeBytes(outputDir);
  const totalBytes = tempBytes + outputBytes;

  res.json({
    tempMB: (tempBytes / (1024 * 1024)).toFixed(2),
    outputMB: (outputBytes / (1024 * 1024)).toFixed(2),
    totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
    totalGB: (totalBytes / (1024 * 1024 * 1024)).toFixed(2),
  });
});

/**
 * POST /api/storage/clean — Purge temporary and cache files
 */
app.post('/api/storage/clean', (req, res) => {
  const { cleanOutput = false } = req.body;
  const tempDir = path.join(rootDir, 'temp');
  let freedBytes = 0;

  if (fs.existsSync(tempDir)) {
    freedBytes += cleanDirectory(path.join(tempDir, 'video'), true);
    freedBytes += cleanDirectory(path.join(tempDir, 'audio'), true);
  }

  if (cleanOutput) {
    const outputDir = path.join(rootDir, 'output');
    if (fs.existsSync(outputDir)) {
      freedBytes += cleanDirectory(outputDir, true);
    }
  }

  const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
  broadcast({ type: 'log', level: 'info', msg: `🧹 Cleaned storage: freed ${freedMB} MB` });
  res.json({ success: true, freedMB, message: `Freed ${freedMB} MB of storage space` });
});

/**
 * POST /api/pipeline/stop — Immediately abort current pipeline and child processes
 */
app.post('/api/pipeline/stop', (req, res) => {
  stopPipeline();
  isProcessing = false;
  broadcast({ type: 'log', level: 'warning', msg: '🛑 Pipeline immediately stopped by user' });
  broadcast({ type: 'stopped' });
  res.json({ success: true, message: 'Pipeline stopped successfully' });
});

/**
 * POST /api/set-output-dir — Validate and set custom output directory
 */
app.post('/api/set-output-dir', (req, res) => {
  const { dirPath } = req.body;
  if (!dirPath || typeof dirPath !== 'string') return res.status(400).json({ error: 'Path is required' });

  if (dirPath.includes('\0') || dirPath.startsWith('-')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const resolved = path.resolve(dirPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    if (fs.existsSync(resolved)) {
      return res.json({ success: true, path: resolved });
    }
    return res.status(400).json({ error: 'Could not create directory' });
  } catch (e) {
    return res.status(400).json({ error: `Invalid path: ${e.message}` });
  }
});

/**
 * Handler for virality recommendations, peak posting windows, and genre tips
 */
function getSocialRecommendationsHandler(req, res) {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = day === 0 || day === 6;

  const recommendations = {
    bestPostingTimes: isWeekend 
      ? [
          { time: '9:00 AM - 11:00 AM', platform: 'YouTube Shorts', reason: 'High weekend morning browsing' },
          { time: '6:00 PM - 9:00 PM', platform: 'Instagram Reels', reason: 'Peak evening relaxation window' },
        ]
      : [
          { time: '12:00 PM - 2:00 PM', platform: 'YouTube Shorts', reason: 'Lunch hour mobile view spike' },
          { time: '7:00 PM - 9:30 PM', platform: 'Instagram Reels', reason: 'Prime commute & evening downtime' },
        ],
    optimalClipLength: '30 to 45 seconds (Highest completion & replay rate)',
    hookTip: 'Place the biggest visual shock or provocative statement within the first 2.5 seconds',
    genrePrompts: {
      motivational: "Focus on powerful turning points, discipline mindsets, and energetic climaxes",
      comedy: "Clip the setup right before the punchline and leave the funniest reaction at the end",
      educational: "Highlight the 'aha!' moment and counter-intuitive facts that spark comment debates",
      tech: "Focus on jaw-dropping specs, surprising price points, or unique feature demos",
    }
  };

  res.json(recommendations);
}

/**
 * GET /api/social/recommendations & /api/publishing/recommendations
 * Consolidated virality recommendations for the unified workspace
 */
app.get('/api/social/recommendations', getSocialRecommendationsHandler);
app.get('/api/publishing/recommendations', getSocialRecommendationsHandler);

/**
 * GET /api/dashboard/ai-helper — Backward compatibility alias
 */
app.get('/api/dashboard/ai-helper', (req, res) => {
  res.set('X-Deprecated', 'Use /api/social/recommendations');
  getSocialRecommendationsHandler(req, res);
});

/**
 * POST /api/publish-clip — Publish a single clip to a platform
 */
app.post('/api/publish-clip', async (req, res) => {
  const { clip, fileUrl, platform, workflow } = req.body;
  if (!clip || !fileUrl || !platform) {
    return res.status(400).json({ error: 'clip, fileUrl, and platform are required' });
  }

  const connections = getConnectionStatus();
  if (!connections[platform]?.connected) {
    return res.json({ success: false, message: `${platform} not connected` });
  }

  res.json({ success: true, message: `Publishing to ${platform}...` });

  const activeWorkflow = { youtube: null, instagram: null };
  activeWorkflow[platform] = workflow || {};

  try {
    const result = await publishClips([clip], [fileUrl], activeWorkflow, rootDir, broadcast);
    broadcast({ type: 'publish_done', results: result.results, summary: result.summary });
  } catch (err) {
    broadcast({ type: 'log', level: 'error', msg: `❌ Publish error: ${err.message}` });
    broadcast({ type: 'publish_done', results: [], summary: { total: 0, success: 0, failed: 1 } });
  }
});

/**
 * GET /api/connection-status — Check social media connection status
 */
app.get('/api/connection-status', (req, res) => {
  const connections = getConnectionStatus();
  const credentials = getCredentialStatus();
  const ytQuota = getYouTubeQuotaStatus();
  res.json({ connections, credentials, ytQuota });
});

/**
 * GET /api/youtube-quota — Get YouTube daily upload quota status
 */
app.get('/api/youtube-quota', (req, res) => {
  res.json(getYouTubeQuotaStatus());
});

/**
 * Compute OAuth redirect URI dynamically based on request, proxy headers (ngrok/Cloudflare), or PUBLIC_URL
 */
function getOAuthRedirectUri(req, platform) {
  if (process.env.PUBLIC_URL) {
    const base = process.env.PUBLIC_URL.replace(/\/+$/, '');
    return `${base}/api/auth/callback/${platform}`;
  }
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedProto = req.get('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}/api/auth/callback/${platform}`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api/auth/callback/${platform}`;
}

/**
 * GET /api/connect/:platform — Direct browser redirect for OAuth login
 */
app.get('/api/connect/:platform', (req, res) => {
  const { platform } = req.params;

  if (platform === 'youtube') {
    const redirectUri = getOAuthRedirectUri(req, 'youtube');
    const authUrl = getYouTubeAuthUrl(redirectUri);
    if (authUrl) return res.redirect(authUrl);
    return res.status(400).send('YouTube OAuth credentials not configured. Please add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env.');
  }

  if (platform === 'instagram') {
    const redirectUri = getOAuthRedirectUri(req, 'instagram');
    const authUrl = getInstagramAuthUrl(redirectUri);
    if (authUrl) return res.redirect(authUrl);
    return res.status(400).send('Instagram OAuth credentials not configured. Please add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to .env.');
  }

  res.status(400).send(`Unknown platform: ${platform}`);
});

/**
 * POST /api/connect/:platform — Start OAuth flow for a platform
 */
app.post('/api/connect/:platform', (req, res) => {
  const { platform } = req.params;

  if (platform === 'youtube') {
    const redirectUri = getOAuthRedirectUri(req, 'youtube');
    const authUrl = getYouTubeAuthUrl(redirectUri);
    if (!authUrl) {
      return res.json({
        success: false,
        needsSetup: true,
        message: 'YouTube OAuth not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to your .env file.',
      });
    }
    return res.json({ success: true, authUrl, message: 'Redirecting to Google login...' });
  }

  if (platform === 'instagram') {
    const redirectUri = getOAuthRedirectUri(req, 'instagram');
    const authUrl = getInstagramAuthUrl(redirectUri);
    if (!authUrl) {
      return res.json({
        success: false,
        needsSetup: true,
        message: 'Instagram OAuth not configured. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to your .env file.',
      });
    }
    return res.json({ success: true, authUrl, message: 'Redirecting to Facebook login...' });
  }

  res.status(400).json({ error: `Unknown platform: ${platform}` });
});

/**
 * GET /api/auth/callback/youtube — YouTube OAuth callback
 */
app.get('/api/auth/callback/youtube', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.send(authResultPage('YouTube', false, error || 'No authorization code received'));
  }
  try {
    const redirectUri = getOAuthRedirectUri(req, 'youtube');
    const tokenData = await exchangeYouTubeCode(code, redirectUri);
    broadcast({ type: 'log', level: 'success', msg: `✅ YouTube connected as: ${tokenData.username}` });
    broadcast({ type: 'connection_update', platform: 'youtube', connected: true, username: tokenData.username });
    res.send(authResultPage('YouTube', true, null, tokenData.username));
  } catch (e) {
    broadcast({ type: 'log', level: 'error', msg: `❌ YouTube auth failed: ${e.message}` });
    res.send(authResultPage('YouTube', false, e.message));
  }
});

/**
 * GET /api/auth/callback/instagram — Instagram OAuth callback
 */
app.get('/api/auth/callback/instagram', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.send(authResultPage('Instagram', false, error || 'No authorization code received'));
  }
  try {
    const redirectUri = getOAuthRedirectUri(req, 'instagram');
    const tokenData = await exchangeInstagramCode(code, redirectUri);
    broadcast({ type: 'log', level: 'success', msg: `✅ Instagram connected as: ${tokenData.username}` });
    broadcast({ type: 'connection_update', platform: 'instagram', connected: true, username: tokenData.username });
    res.send(authResultPage('Instagram', true, null, tokenData.username));
  } catch (e) {
    broadcast({ type: 'log', level: 'error', msg: `❌ Instagram auth failed: ${e.message}` });
    res.send(authResultPage('Instagram', false, e.message));
  }
});

/**
 * POST /api/disconnect/:platform — Disconnect a platform
 */
app.post('/api/disconnect/:platform', (req, res) => {
  const { platform } = req.params;
  disconnectPlatform(platform);
  broadcast({ type: 'connection_update', platform, connected: false });
  broadcast({ type: 'log', level: 'info', msg: `🔌 ${platform} disconnected` });
  res.json({ success: true });
});

/**
 * POST /api/publish — Publish clips to connected platforms
 */
app.post('/api/publish', async (req, res) => {
  const { clips, files, workflow } = req.body;
  if (!clips || clips.length === 0) {
    return res.status(400).json({ error: 'No clips to publish' });
  }

  const connections = getConnectionStatus();
  const platforms = [];
  if (workflow?.youtube && connections.youtube.connected) platforms.push('YouTube');
  if (workflow?.instagram && connections.instagram.connected) platforms.push('Instagram');

  if (platforms.length === 0) {
    return res.json({
      success: false,
      message: 'No connected platforms. Connect YouTube or Instagram first.',
      published: 0,
    });
  }

  res.json({ success: true, message: `Publishing to ${platforms.join(' & ')}...` });

  const activeWorkflow = {
    youtube: (workflow?.youtube && connections.youtube.connected) ? workflow.youtube : null,
    instagram: (workflow?.instagram && connections.instagram.connected) ? workflow.instagram : null,
  };

  try {
    const result = await publishClips(clips, files, activeWorkflow, rootDir, broadcast);
    broadcast({ type: 'publish_done', results: result.results, summary: result.summary });
  } catch (err) {
    broadcast({ type: 'log', level: 'error', msg: `❌ Publish error: ${err.message}` });
    broadcast({ type: 'publish_done', results: [], summary: { total: 0, success: 0, failed: clips.length } });
  }
});

/** Generate HTML page for OAuth callback result */
function authResultPage(platform, success, error, username) {
  const emoji = success ? '✅' : '❌';
  const msg = success
    ? `Connected to ${platform} as ${username || 'User'}!`
    : `Failed to connect ${platform}: ${error || 'Unknown error'}`;
  const bg = success ? '#0a2e1a' : '#2e0a0a';
  const border = success ? '#10b981' : '#ef4444';
  const glow = success ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
  const usernameJs = username ? `'${username.replace(/'/g, "\\'")}'` : 'null';
  const errorJs = error ? `'${error.replace(/'/g, "\\'")}'` : 'null';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${platform} — ${success ? 'Connected' : 'Error'}</title>
<style>body{background:#06060a;color:#f0f0f5;font-family:'Inter',-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:${bg};border:1px solid ${border};border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 0 30px ${glow}}
.emoji{font-size:3rem;margin-bottom:16px}h2{margin:0 0 8px;font-size:1.3rem}p{color:#8a8a9e;font-size:0.9rem;margin:0}</style></head>
<body><div class="card"><div class="emoji">${emoji}</div><h2>${msg}</h2><p>This window will close automatically...</p></div>
<script>if(window.opener){window.opener.postMessage({type:'oauth_callback',platform:'${platform.toLowerCase()}',success:${success},username:${usernameJs},error:${errorJs}},'*')}
setTimeout(()=>window.close(),2000)</script></body></html>`;
}

// Redirect legacy /dashboard to unified workspace (301 Permanent)
app.get('/dashboard', (req, res) => {
  res.redirect(301, '/');
});

// ─── Start Server ────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n  🛹 L2S is running on http://localhost:${PORT}\n`);
  console.log(`  Turn long-form videos into viral shorts — 100% local, 100% free\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Startup Error: Port ${PORT} is already in use by another process.`);
    console.error(`   To resolve without killing other processes, set PORT=<port> in .env or run:`);
    console.error(`   $env:PORT=3001; npm run dev (PowerShell) or PORT=3001 npm run dev\n`);
    process.exit(1);
  }
  console.error('Server startup error:', err);
  process.exit(1);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// ─── Graceful Shutdown ───────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server (SIGINT)...');
  stopPipeline();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server (SIGTERM)...');
  stopPipeline();
  server.close(() => process.exit(0));
});
