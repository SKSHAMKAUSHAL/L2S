// =============================================
// SKATE — Express + WebSocket Server
// =============================================

import './env.js';
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cookieParser from 'cookie-parser';

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
  disconnectYouTube, isInstagramEnabled,
} from './auth.js';
import { publishClipToYouTube, uploadToYouTube, formatYouTubeMetadata, publishClipToInstagram, uploadToInstagram } from './uploader.js';
import { getQuotaStatus, checkQuotaBeforeUpload } from './services/youtube_quota.js';
import { aiRegistry } from './ai/registry.js';
import { CAPTION_PRESETS } from './captions/presets.js';
import { fetchVideoInfoAsync } from './downloader.js';
import { generateASS } from './subtitles.js';
import { FONTS_DIR } from './captions/fonts.js';
import { spawnTracked, killJobProcesses } from './process_manager.js';
import { jobCoordinator, sanitizeClientError } from './pipeline_job.js';
import {
  SOURCE_QUALITY_PROFILES,
  EXPORT_PROFILES,
  analyzeSourceFormats,
  validateSourceResolution,
} from './video/quality_profiles.js';
import { detectEncoder } from './renderer.js';
import { detectHardwareAndRecommendedModel } from './ai/hardware_detector.js';

// Database, Auth & Queue
import { getDb, createDbRepository } from './db/index.js';
import {
  registerUser,
  loginUser,
  setSessionCookie,
  clearSessionCookie,
  setCsrfCookie,
  clearCsrfCookie,
  createAuthMiddleware,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
} from './auth/index.js';
import {
  initQueue,
  enqueueJob,
  cancelJob,
  emitJobEvent,
  queueEvents,
} from './queue/index.js';
import { processJob } from './worker.js';

// Security Hardening (Step 8)
import helmet from 'helmet';
import { generalLimiter, loginLimiter, registerLimiter, jobCreationLimiter } from './security/rate_limit.js';
import { logger, requestLogger } from './security/logger.js';
import { validateYouTubeUrl, validateMediaUrl, validateInstagramUrl } from './security/url.js';
import { generatePKCE, createSessionOAuthState, consumeOAuthState } from './security/pkce.js';
import { encryptToken, decryptToken } from './security/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Ensure base directories exist
fs.mkdirSync(path.join(rootDir, 'storage'), { recursive: true });
fs.mkdirSync(path.join(rootDir, 'output'), { recursive: true });
fs.mkdirSync(path.join(rootDir, 'temp'), { recursive: true });

// Global active WebSocket clients
const clients = new Set();

export function broadcast(message, targetUserId = null) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      if (!targetUserId || client.userId === targetUserId) {
        client.send(data);
      }
    }
  }
}

// Forward queue progress events to owners over WebSocket
queueEvents.on('event', (evt) => {
  broadcast(evt, evt.userId);
});

// Default shared DB repository
const defaultDb = getDb();
const defaultRepo = createDbRepository(defaultDb);

// Initialize Queue in background
initQueue(processJob).catch(console.error);

// Helper for MIME types
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.json': 'application/json',
    '.ass': 'text/plain',
    '.srt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}

function getDirSizeBytes(dirPath) {
  let total = 0;
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSizeBytes(fullPath);
      } else if (entry.isFile()) {
        try { total += fs.statSync(fullPath).size; } catch {}
      }
    }
  } catch {}
  return total;
}

function cleanDirectory(dirPath, keepDir = true) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
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
        } catch {}
      }
    }
    if (!keepDir) {
      try { fs.rmdirSync(dirPath); } catch {}
    }
  } catch {}
  return freed;
}

function validateSelectedIndices(selectedIndices, selectedClipsData, currentState) {
  if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
    return { valid: false, error: 'No clips selected' };
  }
  if (!Array.isArray(selectedClipsData) || selectedClipsData.length !== selectedIndices.length) {
    return { valid: false, error: 'Clip data count mismatch' };
  }
  if (!currentState || !Array.isArray(currentState.selected)) {
    return { valid: false, error: 'Pipeline state missing' };
  }
  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const dataClip = selectedClipsData[i];
    if (idx < 0 || idx >= currentState.selected.length) {
      return { valid: false, error: `Index ${idx} out of bounds` };
    }
    const stateClip = currentState.selected[idx];
    const sStart = stateClip.chunk?.start ?? stateClip.start ?? 0;
    const sEnd = stateClip.chunk?.end ?? stateClip.end ?? 0;
    if (dataClip && (Math.abs(sStart - dataClip.start) > 0.5 || Math.abs(sEnd - dataClip.end) > 0.5)) {
      return { valid: false, error: `Clip data mismatch at index ${idx}` };
    }
  }
  return { valid: true };
}

/**
 * Factory for creating configured Express application
 */
export function createApp(options = {}) {
  const repo = options.repo || defaultRepo;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 1);

  // Structured Logging with Redaction & Request ID
  app.use(requestLogger);

  // Helmet Security Headers & Content Security Policy (No unsafe-inline for scripts)
  app.use(
    helmet({
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          mediaSrc: ["'self'", 'blob:', 'data:'],
          frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS closed by default (allow only env APP_ORIGIN)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigin = process.env.APP_ORIGIN;

    if (origin) {
      if (allowedOrigin && (allowedOrigin === '*' || origin === allowedOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-XSRF-Token, X-Request-Id, Authorization');
      } else {
        if (req.method === 'OPTIONS') {
          return res.status(403).json({ error: 'CORS forbidden' });
        }
      }
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // General API rate limiter for all /api endpoints
  app.use('/api', generalLimiter);

  // Unauthenticated page load redirect to /login.html
  app.get('/', (req, res, next) => {
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers && req.headers.cookie) {
      const match = req.headers.cookie.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE_NAME + '=([^;]*)'));
      if (match && match[1]) rawToken = decodeURIComponent(match[1]).trim();
    }
    if (!rawToken) {
      return res.redirect('/login.html');
    }
    const session = repo.getSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      clearCsrfCookie(res);
      return res.redirect('/login.html');
    }
    // Synchronously set XSRF-TOKEN cookie so client-side JavaScript can read it immediately on first load
    setCsrfCookie(res, session.csrf_token);
    next();
  });

  // Serve static UI assets
  app.use(express.static(path.join(rootDir, 'public'), { maxAge: '1h' }));

  // Public Legal Pages
  app.get('/privacy', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'privacy.html'));
  });
  app.get('/terms', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'terms.html'));
  });

  // Auth Middleware
  const requireAuth = createAuthMiddleware(repo);

  // ─── Public Auth Endpoints ────────────────────────────

  app.post('/api/auth/register', registerLimiter, async (req, res) => {
    try {
      const { email, password, plan } = req.body || {};
      const { user, sessionToken, csrfToken } = await registerUser(repo, { email, password, plan });
      setSessionCookie(res, sessionToken);
      setCsrfCookie(res, csrfToken);
      res.status(201).json({ user, csrfToken });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const { user, sessionToken, csrfToken } = await loginUser(repo, { email, password });
      setSessionCookie(res, sessionToken);
      setCsrfCookie(res, csrfToken);
      res.json({ user, csrfToken });
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers && req.headers.cookie) {
      const match = req.headers.cookie.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE_NAME + '=([^;]*)'));
      if (match && match[1]) rawToken = decodeURIComponent(match[1]).trim();
    }
    if (rawToken) {
      repo.deleteSession(rawToken);
    }
    clearSessionCookie(res);
    clearCsrfCookie(res);
    res.json({ success: true, message: 'Logged out successfully' });
  });

  app.get('/api/auth/me', (req, res) => {
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }
    if (!rawToken && req.headers && req.headers.cookie) {
      const match = req.headers.cookie.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE_NAME + '=([^;]*)'));
      if (match && match[1]) rawToken = decodeURIComponent(match[1]).trim();
    }
    if (!rawToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const session = repo.getSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    setCsrfCookie(res, session.csrf_token);
    res.json({
      user: {
        id: session.user_id,
        email: session.email,
        plan: session.plan,
        credits_seconds: session.credits_seconds,
      },
      csrfToken: session.csrf_token,
    });
  });

  app.get('/api/auth/csrf', (req, res) => {
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }
    if (!rawToken && req.headers && req.headers.cookie) {
      const match = req.headers.cookie.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE_NAME + '=([^;]*)'));
      if (match && match[1]) rawToken = decodeURIComponent(match[1]).trim();
    }
    if (!rawToken) {
      return res.json({ csrfToken: null });
    }
    const session = repo.getSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      clearCsrfCookie(res);
      return res.json({ csrfToken: null });
    }
    setCsrfCookie(res, session.csrf_token);
    res.json({ csrfToken: session.csrf_token });
  });

  // Public Health Endpoints
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
  });

  app.get('/api/status/hardware', (req, res) => {
    res.json({ cpu: 'ok', memory: 'ok', gpu: detectEncoder() });
  });

  // ─── Protected Routes (requireAuth) ───────────────────

  // Host Hardware & Diagnostics
  app.get('/api/hardware', requireAuth, (req, res) => {
    const hw = detectHardwareAndRecommendedModel();
    const encoder = detectEncoder();
    res.json({
      ...hw,
      encoder,
      cpu: {
        cores: hw.cpuCores,
        model: hw.cpuModel,
      },
      ram: {
        totalGB: hw.totalRamGB,
      },
      gpu: {
        ...hw.gpu,
        vramGB: hw.gpu.vramGB,
        name: hw.gpu.hasNvidia && hw.gpu.name ? hw.gpu.name : (encoder && encoder !== 'libx264' ? encoder : 'Integrated / CPU'),
        encoder,
      },
      recommendedModel: hw.recommendedModel,
      tier: hw.tier,
    });
  });

  // Account Deletion
  app.delete('/api/account', requireAuth, (req, res) => {
    const userId = req.user.id;
    const userStorageDir = path.join(rootDir, 'storage', userId);
    if (fs.existsSync(userStorageDir)) {
      try { fs.rmSync(userStorageDir, { recursive: true, force: true }); } catch (e) {}
    }
    repo.deleteUser(userId);
    clearSessionCookie(res);
    res.json({ success: true, message: 'Account and all data deleted' });
  });

  // Jobs
  app.get('/api/jobs', requireAuth, (req, res) => {
    const jobs = repo.listJobs(req.user.id);
    res.json({ jobs });
  });

  app.get('/api/jobs/:id', requireAuth, (req, res) => {
    const job = repo.getJob(req.params.id, req.user.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const clips = repo.listClips(job.id, req.user.id);
    res.json({ job, clips });
  });

  app.post('/api/jobs/:id/cancel', requireAuth, async (req, res) => {
    try {
      const result = await cancelJob(repo, req.params.id, req.user.id);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.delete('/api/jobs/:id', requireAuth, (req, res) => {
    const job = repo.getJob(req.params.id, req.user.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const jobStorageDir = path.join(rootDir, 'storage', req.user.id, job.id);
    if (fs.existsSync(jobStorageDir)) {
      try { fs.rmSync(jobStorageDir, { recursive: true, force: true }); } catch (e) {}
    }
    repo.deleteJob(job.id, req.user.id);
    res.json({ success: true, message: 'Job and files deleted' });
  });

  // Authenticated File Streaming with Range Support
  app.get('/api/files/:jobId/*filePath', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const raw = req.params.filePath || req.params[0] || '';
    const subPath = Array.isArray(raw) ? raw.join('/') : String(raw);

    if (subPath.includes('..') || path.isAbsolute(subPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const job = repo.getJob(jobId, req.user.id);
    if (!job) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(rootDir, 'storage', req.user.id, jobId, subPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = getMimeType(filePath);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Pipeline Enqueue
  app.post('/api/process', requireAuth, jobCreationLimiter, async (req, res) => {
    try {
      const {
        source,
        url,
        genre,
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
        duration,
      } = req.body || {};

      const targetSource = source || url;
      if (!targetSource) {
        return res.status(400).json({ error: 'Source video URL or path is required' });
      }

      let sourceRef = targetSource;
      let sourceType = 'local';
      if (typeof targetSource === 'string' && (targetSource.startsWith('http://') || targetSource.startsWith('https://'))) {
        try {
          const validated = validateMediaUrl(targetSource);
          sourceRef = validated.canonicalUrl;
          sourceType = validated.platform;
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      const job = await enqueueJob(repo, {
        userId: req.user.id,
        sourceType,
        sourceRef,
        params: {
          genre,
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
          duration,
        },
      });

      res.status(202).json({
        success: true,
        jobId: job.id,
        status: job.status,
        message: 'Job enqueued successfully',
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/process/stop', requireAuth, async (req, res) => {
    const { jobId } = req.body || {};
    if (jobId) {
      try {
        const result = await cancelJob(repo, jobId, req.user.id);
        return res.json(result);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }
    stopPipeline();
    res.json({ success: true, message: 'Pipeline stopped' });
  });

  app.post('/api/stop', requireAuth, async (req, res) => {
    const { jobId } = req.body || {};
    if (jobId) {
      try {
        const result = await cancelJob(repo, jobId, req.user.id);
        return res.json(result);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }
    stopPipeline();
    res.json({ success: true, message: 'Pipeline stopped' });
  });

  app.get('/api/process/status', requireAuth, (req, res) => {
    res.json(getPipelineState(req.user.id, req.query.jobId || null));
  });

  app.post('/api/render', requireAuth, async (req, res) => {
    const {
      jobId: bodyJobId,
      selectedIndices,
      selectedClipsData,
      customOutputDir,
      captionStyle,
      exportQuality,
    } = req.body || {};

    const state = getPipelineState(req.user.id, bodyJobId || null);
    let resolvedVideoPath = state?.videoPath;
    let resolvedSelected = state?.selected;
    let activeJobId = bodyJobId || state?.jobId;

    // Fallback to DB records if server state was cleared or restarted
    if ((!resolvedVideoPath || !resolvedSelected) && activeJobId) {
      const dbJob = repo.getJob(activeJobId, req.user.id);
      const dbClips = dbJob ? repo.listClips(activeJobId, req.user.id) : [];
      if (dbJob && dbClips.length > 0) {
        if (!resolvedSelected) {
          resolvedSelected = dbClips.map((c, idx) => {
            let parsedMeta = {};
            try { parsedMeta = JSON.parse(c.meta_json || '{}'); } catch {}
            return {
              index: idx,
              chunk: {
                start: c.start,
                end: c.end,
                text: parsedMeta.text || c.title || '',
                words: parsedMeta.words || [],
              },
              combinedScore: c.score || 80,
              aiTitle: c.title || '',
              source: parsedMeta.source || 'ai',
            };
          });
        }
        if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
          const tempVideoDir = path.join(rootDir, 'temp', 'video');
          if (fs.existsSync(tempVideoDir)) {
            const mp4s = fs.readdirSync(tempVideoDir)
              .filter(f => f.endsWith('.mp4') && !f.endsWith('.part'))
              .map(f => ({ name: f, mtime: fs.statSync(path.join(tempVideoDir, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime);
            if (mp4s.length > 0) {
              resolvedVideoPath = path.join(tempVideoDir, mp4s[0].name);
            }
          }
        }
      }
    }

    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath) || !resolvedSelected) {
      return res.status(400).json({ error: 'No active pipeline video or clips found. Please run Generate first.' });
    }

    const validation = validateSelectedIndices(selectedIndices, selectedClipsData, { selected: resolvedSelected });
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error,
        suggestion: 'Review page state may be stale. Please regenerate clips.',
      });
    }

    if (!activeJobId) {
      const userJobs = repo.listJobs(req.user.id);
      activeJobId = userJobs[0]?.id || `job_${Date.now()}`;
    }

    res.json({ success: true, message: 'Rendering started', jobId: activeJobId });

    const userId = req.user.id;
    const emitUser = (payload) => broadcast({ ...payload, jobId: activeJobId }, userId);

    emitUser({ type: 'step', step: 'render', status: 'active' });
    emitUser({ type: 'log', level: 'info', msg: '🎬 Starting clip rendering with FFmpeg...' });

    try {
      const indices = selectedIndices;
      const toRender = indices
        .map((clipIndex, arrayIndex) => {
          const baseClip = resolvedSelected[clipIndex];
          if (!baseClip) return null;
          const customData = selectedClipsData && selectedClipsData[arrayIndex]
            ? { ...selectedClipsData[arrayIndex] }
            : {};
          if (captionStyle && !customData.captionPreset) customData.captionPreset = captionStyle;
          if (exportQuality && !customData.exportQuality) customData.exportQuality = exportQuality;
          return { ...baseClip, custom: customData };
        })
        .filter(Boolean);

      if (toRender.length === 0) {
        throw new Error('No valid clips to render after validation');
      }

      emitUser({ type: 'log', level: 'info', msg: `🎞️ Rendering ${toRender.length} selected clip(s)...` });

      const userJobDir = path.join(rootDir, 'storage', userId, activeJobId);
      fs.mkdirSync(path.join(userJobDir, 'clips'), { recursive: true });

      const renderedJobs = await renderClips(
        resolvedVideoPath,
        toRender,
        captionStyle || 'hormozi',
        userJobDir,
        (msg) => emitUser({ type: 'log', level: 'info', msg: `  ${msg}` })
      );

      // Optional mirror export to customOutputDir if specified and safe
      let validCustomDir = null;
      if (customOutputDir && typeof customOutputDir === 'string' && !customOutputDir.includes('\0') && !customOutputDir.startsWith('-')) {
        try {
          const resolvedCustom = path.resolve(customOutputDir);
          fs.mkdirSync(resolvedCustom, { recursive: true });
          validCustomDir = resolvedCustom;
        } catch {}
      }

      const renderedFiles = [];
      for (let i = 0; i < renderedJobs.length; i++) {
        const job = renderedJobs[i];
        const origClipIdx = indices[i];
        const clipFile = job.clipFileName;
        const localPath = job.clipPath;

        if (validCustomDir && fs.existsSync(localPath)) {
          try {
            fs.copyFileSync(localPath, path.join(validCustomDir, clipFile));
          } catch {}
        }

        // Sync clip file_path in SQLite DB for direct YouTube/Instagram publish
        const existingDbClip =
          repo.getClip(activeJobId, origClipIdx + 1, userId) ||
          repo.getClip(activeJobId, origClipIdx, userId);
        if (existingDbClip) {
          repo.updateClip(existingDbClip.id, { file_path: localPath });
        } else {
          try {
            repo.createClip({
              jobId: activeJobId,
              userId,
              idx: origClipIdx + 1,
              start: toRender[i].chunk?.start || 0,
              end: toRender[i].chunk?.end || 0,
              score: toRender[i].combinedScore || toRender[i].score || 80,
              title: toRender[i].custom?.title || toRender[i].aiTitle || `Clip ${origClipIdx + 1}`,
              filePath: localPath,
              metaJson: JSON.stringify(toRender[i].custom || {}),
            });
          } catch {}
        }

        renderedFiles.push({
          name: clipFile,
          url: `/api/files/${activeJobId}/clips/${clipFile}`,
          type: 'local',
          clipIndex: origClipIdx,
        });
      }

      emitUser({ type: 'log', level: 'success', msg: `✅ Rendered ${renderedFiles.length} clip(s) successfully!` });
      emitUser({ type: 'step', step: 'render', status: 'done' });
      emitUser({
        type: 'render_done',
        files: renderedFiles,
        jobId: activeJobId,
        outputDir: `/api/files/${activeJobId}`,
        cloudEnabled: false,
      });

      // Lazy social content generation
      const genre = state?.genre || 'default';
      const language = state?.transcript?.language || 'unknown';
      emitUser({ type: 'log', level: 'info', msg: '✍️ Generating social copy (titles, descriptions, hashtags)...' });

      for (let ai = 0; ai < toRender.length; ai++) {
        const clip = toRender[ai];
        const clipText = clip.chunk?.text || clip.custom?.text || '';
        if (!clipText) continue;
        try {
          const social = await generateSocialContent(clipText, genre, language);
          emitUser({
            type: 'social_content',
            clipIndex: indices[ai],
            title: social.title,
            description: social.description,
            hashtags: social.hashtags,
            caption: social.caption,
          });
        } catch (socialErr) {
          logger.warn({ err: socialErr.message }, 'Social content generation warning');
        }
      }
      emitUser({ type: 'log', level: 'success', msg: '✅ Social content ready!' });
    } catch (err) {
      emitUser({ type: 'step', step: 'render', status: 'error' });
      emitUser({ type: 'error', msg: `Render failed: ${err.message}` });
    }
  });

  app.post('/api/re-render', requireAuth, async (req, res) => {
    const { clipIndex = 0, clipData = {}, jobId: bodyJobId } = req.body || {};
    const state = getPipelineState(req.user.id, bodyJobId || null);

    if (!state || !state.videoPath || !fs.existsSync(state.videoPath)) {
      return res.status(400).json({ error: 'No active pipeline video found for re-render.' });
    }

    const activeJobId = bodyJobId || state.jobId || `job_${Date.now()}`;
    const userId = req.user.id;
    const emitUser = (payload) => broadcast({ ...payload, jobId: activeJobId }, userId);

    res.json({ success: true, message: 'Re-rendering clip...', jobId: activeJobId });

    try {
      const userJobDir = path.join(rootDir, 'storage', userId, activeJobId);
      const clipsDir = path.join(userJobDir, 'clips');
      fs.mkdirSync(clipsDir, { recursive: true });

      const clipNum = String(Number(clipIndex) + 1).padStart(2, '0');
      const toRender = [{
        chunk: {
          start: clipData.start || 0,
          end: clipData.end || 0,
          text: clipData.text || '',
          words: clipData.words || [],
        },
        custom: clipData,
      }];

      emitUser({ type: 'log', level: 'info', msg: `🔄 Re-rendering clip ${clipNum}...` });

      const rendered = await renderClips(
        state.videoPath,
        toRender,
        clipData.captionPreset || 'hormozi',
        userJobDir,
        (msg) => emitUser({ type: 'log', level: 'info', msg: `  ${msg}` })
      );

      const producedPath = rendered[0]?.clipPath || path.join(clipsDir, 'clip-01.mp4');
      const targetPath = path.join(clipsDir, `clip-${clipNum}.mp4`);
      if (clipNum !== '01' && fs.existsSync(producedPath) && producedPath !== targetPath) {
        fs.renameSync(producedPath, targetPath);
      }

      const finalUrl = `/api/files/${activeJobId}/clips/clip-${clipNum}.mp4`;
      const existingDbClip = repo.getClip(activeJobId, Number(clipIndex) + 1, userId);
      if (existingDbClip) {
        repo.updateClip(existingDbClip.id, { file_path: targetPath });
      }

      emitUser({ type: 'log', level: 'success', msg: `✅ Clip ${clipNum} re-rendered!` });
      emitUser({
        type: 're_render_done',
        clipIndex,
        fileUrl: finalUrl,
      });
    } catch (err) {
      emitUser({ type: 'error', msg: `Re-render failed: ${err.message}` });
    }
  });

  // Captions API
  app.get('/api/clips/:jobId/:clipIndex/captions', requireAuth, (req, res) => {
    const { jobId, clipIndex } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: 'Invalid jobId parameter' });
    if (!/^[0-9]{1,3}$/.test(clipIndex)) return res.status(400).json({ error: 'Invalid clipIndex parameter' });

    const job = repo.getJob(jobId, req.user.id);
    const idxNum = parseInt(clipIndex, 10);
    const legacyPath = path.resolve(rootDir, 'output', jobId, `clip_${idxNum}.captions.json`);
    const userPathSub = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions', `clip_${idxNum}.captions.json`);
    const userPathRoot = path.resolve(rootDir, 'storage', req.user.id, jobId, `clip_${idxNum}.captions.json`);

    let targetPath = null;
    if (fs.existsSync(userPathSub)) targetPath = userPathSub;
    else if (fs.existsSync(userPathRoot)) targetPath = userPathRoot;
    else if (job && fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (!job) {
      return res.status(404).json({ error: 'Captions not found for this clip' });
    } else if (fs.existsSync(legacyPath)) {
      targetPath = legacyPath;
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Captions not found for this clip' });
    }

    try {
      res.json(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
    } catch (e) {
      res.status(500).json({ error: 'Failed to read caption file' });
    }
  });

  app.put('/api/clips/:jobId/:clipIndex/captions', requireAuth, (req, res) => {
    const { jobId, clipIndex } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: 'Invalid jobId parameter' });
    if (!/^[0-9]{1,3}$/.test(clipIndex)) return res.status(400).json({ error: 'Invalid clipIndex parameter' });

    const job = repo.getJob(jobId, req.user.id);
    const idxNum = parseInt(clipIndex, 10);
    const legacyPath = path.resolve(rootDir, 'output', jobId, `clip_${idxNum}.captions.json`);
    const userDir = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions');
    const userPathSub = path.resolve(userDir, `clip_${idxNum}.captions.json`);
    const userPathRoot = path.resolve(rootDir, 'storage', req.user.id, jobId, `clip_${idxNum}.captions.json`);

    let targetPath = null;
    if (fs.existsSync(userPathSub)) targetPath = userPathSub;
    else if (fs.existsSync(userPathRoot)) targetPath = userPathRoot;
    else if (job && fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (job) {
      fs.mkdirSync(userDir, { recursive: true });
      targetPath = userPathSub;
    } else {
      return res.status(404).json({ error: 'Clip captions not found' });
    }

    const { words, preset, overrides } = req.body || {};
    if (!Array.isArray(words)) return res.status(400).json({ error: 'words must be an array' });
    if (words.length > 5000) return res.status(400).json({ error: 'Too many words (max 5000)' });

    let prevStart = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w || typeof w.word !== 'string') {
        return res.status(400).json({ error: `Invalid word at index ${i}` });
      }
      if (w.word.length > 40) {
        return res.status(400).json({ error: `Word exceeds 40 characters limit` });
      }
      if (typeof w.start !== 'number' || typeof w.end !== 'number' || w.start > w.end) {
        return res.status(400).json({ error: 'Invalid word timestamps (start > end or non-numeric)' });
      }
      if (w.start < prevStart) {
        return res.status(400).json({ error: 'Word timestamps must be non-decreasing' });
      }
      prevStart = w.start;
    }

    const payload = {
      words,
      preset: preset || 'hormozi',
      overrides: overrides || {},
      version: 2,
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, captions: payload, saved: payload });
  });

  const activeRerenders = new Set();

  app.post('/api/clips/:jobId/:clipIndex/rerender', requireAuth, async (req, res) => {
    const { jobId, clipIndex } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: 'Invalid jobId parameter' });
    if (!/^[0-9]{1,3}$/.test(clipIndex)) return res.status(400).json({ error: 'Invalid clipIndex parameter' });

    const idx = parseInt(clipIndex, 10);
    const lockKey = `${jobId}:${idx}`;

    if (activeRerenders.has(lockKey)) {
      return res.status(409).json({ error: 'Re-render already in progress for this clip' });
    }

    activeRerenders.add(lockKey);
    try {
      const padNum = String(idx).padStart(2, '0');
      const legacyCaptions = path.resolve(rootDir, 'output', jobId, `clip_${idx}.captions.json`);
      const userCaptionsSub = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions', `clip_${idx}.captions.json`);
      const userCaptionsRoot = path.resolve(rootDir, 'storage', req.user.id, jobId, `clip_${idx}.captions.json`);
      const captionsPath = fs.existsSync(userCaptionsSub)
        ? userCaptionsSub
        : (fs.existsSync(userCaptionsRoot) ? userCaptionsRoot : legacyCaptions);

      if (!fs.existsSync(captionsPath)) {
        return res.status(404).json({ error: 'Captions not found for this clip' });
      }

      // Check clip video path
      const userClip = path.resolve(rootDir, 'storage', req.user.id, jobId, 'clips', `clip-${padNum}.mp4`);
      const legacyClipsDir = path.resolve(rootDir, 'output', jobId, 'clips');
      const legacyClip1 = path.resolve(legacyClipsDir, `clip-${padNum}.mp4`);
      const legacyClip2 = path.resolve(legacyClipsDir, `clip_${idx}.mp4`);

      let clipVideoPath = null;
      if (fs.existsSync(userClip)) clipVideoPath = userClip;
      else if (fs.existsSync(legacyClip1)) clipVideoPath = legacyClip1;
      else if (fs.existsSync(legacyClip2)) clipVideoPath = legacyClip2;
      else {
        return res.status(404).json({ error: `Source clip video not found for clip ${idx}` });
      }

      const captionsData = JSON.parse(fs.readFileSync(captionsPath, 'utf8'));
      const assContent = generateASS(captionsData.words || [], captionsData.preset || 'hormozi', 0, captionsData.overrides);
      const assDir = path.dirname(captionsPath);
      const assPath = path.join(assDir, `clip-${padNum}.ass`);
      fs.writeFileSync(assPath, assContent, 'utf8');

      const escapeFFmpegPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
      const escapedAss = escapeFFmpegPath(assPath);
      const escapedFonts = escapeFFmpegPath(FONTS_DIR);
      const subFilter = `subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'`;

      const clipsDir = path.dirname(clipVideoPath);
      const tempOut = path.join(clipsDir, `rerender_tmp_${Date.now()}_clip-${padNum}.mp4`);

      await new Promise((resolve, reject) => {
        const child = spawnTracked('ffmpeg', [
          '-i', clipVideoPath,
          '-vf', subFilter,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-c:a', 'copy',
          '-y',
          tempOut,
        ], {}, jobId);

        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
        child.on('error', reject);
      });

      fs.renameSync(tempOut, clipVideoPath);

      const fileUrl = clipVideoPath.includes('storage')
        ? `/api/files/${jobId}/clips/${path.basename(clipVideoPath)}?v=${Date.now()}`
        : `/output/${jobId}/clips/${path.basename(clipVideoPath)}?v=${Date.now()}`;

      res.json({
        success: true,
        message: 'Re-render completed',
        fileUrl,
        assPath,
      });
    } catch (e) {
      res.status(500).json({ error: `Re-render failed: ${e.message}` });
    } finally {
      activeRerenders.delete(lockKey);
    }
  });

  app.post('/api/clips/:jobId/captions/replace', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const { find, replace, caseSensitive = false } = req.body || {};
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: 'Invalid jobId parameter' });
    if (!find || typeof find !== 'string' || typeof replace !== 'string') {
      return res.status(400).json({ error: 'find and replace strings required' });
    }

    const job = repo.getJob(jobId, req.user.id);
    const searchDirs = [
      path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions'),
      path.resolve(rootDir, 'storage', req.user.id, jobId),
      path.resolve(rootDir, 'output', jobId, 'captions'),
      path.resolve(rootDir, 'output', jobId),
    ];

    let totalChanged = 0;
    const seenFiles = new Set();

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.startsWith('clip_') && f.endsWith('.captions.json'));
        for (const f of files) {
          const filePath = path.join(dir, f);
          if (seenFiles.has(filePath)) continue;
          seenFiles.add(filePath);

          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(data.words)) {
              let fileChanged = 0;
              for (const w of data.words) {
                if (!w || !w.word) continue;
                if (caseSensitive) {
                  if (w.word.includes(find)) {
                    w.word = w.word.replaceAll(find, replace);
                    fileChanged++;
                    totalChanged++;
                  }
                } else {
                  const regex = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                  if (regex.test(w.word)) {
                    w.word = w.word.replace(regex, replace);
                    fileChanged++;
                    totalChanged++;
                  }
                }
              }

              if (fileChanged > 0) {
                data.version = (data.version || 1) + 1;
                data.updatedAt = new Date().toISOString();
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
              }
            }
          } catch {}
        }
      }
    }

    res.json({ success: true, changedWords: totalChanged, updatedCount: totalChanged, count: totalChanged });
  });

  // Providers & System Status
  app.get('/api/status', requireAuth, async (req, res) => {
    const status = await checkDependencies();
    res.json(status);
  });

  app.get('/api/providers', requireAuth, async (req, res) => {
    try {
      const summary = await aiRegistry.getStatusSummary();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve AI provider status' });
    }
  });

  app.post('/api/providers/switch', requireAuth, (req, res) => {
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

  app.post('/api/providers/key', requireAuth, (req, res) => {
    const { providerId, apiKey } = req.body || {};
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

  app.get('/api/providers/models', requireAuth, async (req, res) => {
    const providerId = req.query.provider || aiRegistry.activeLLMId;
    try {
      const models = await aiRegistry.getAvailableModels(providerId);
      const activeModel = aiRegistry.getLLMProvider(providerId)?.model || '';
      res.json({ success: true, provider: providerId, models, activeModel });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/providers/model', requireAuth, (req, res) => {
    const { provider, model } = req.body || {};
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

  // Recommendations
  function getSocialRecommendationsHandler(req, res) {
    const recommendations = {
      bestPostingTimes: [
        { time: '12:00 PM - 2:00 PM', platform: 'YouTube Shorts', reason: 'Lunch mobile spike' },
        { time: '7:00 PM - 9:30 PM', platform: 'Instagram Reels', reason: 'Evening downtime' },
      ],
      optimalClipLength: '30 to 45 seconds',
      hookTip: 'Place provocative statement within first 2.5 seconds',
      genrePrompts: { motivational: 'Focus on discipline', comedy: 'Punchline delivery' },
    };
    res.json(recommendations);
  }

  app.get('/api/social/recommendations', requireAuth, getSocialRecommendationsHandler);
  app.get('/api/publishing/recommendations', requireAuth, getSocialRecommendationsHandler);
  app.get('/api/dashboard/ai-helper', requireAuth, (req, res) => {
    res.set('X-Deprecated', 'Use /api/social/recommendations');
    getSocialRecommendationsHandler(req, res);
  });

  // Social & OAuth
  app.get('/api/connection-status', requireAuth, (req, res) => {
    const connections = getConnectionStatus(req.user.id, repo);
    const credentials = getCredentialStatus();
    const ytQuota = getQuotaStatus(repo, req.user.id, req.user.plan);
    res.json({ connections, credentials, ytQuota });
  });

  app.get('/api/youtube-quota', requireAuth, (req, res) => {
    res.json(getQuotaStatus(repo, req.user.id, req.user.plan));
  });

  const handleConnect = (req, res) => {
    const { platform } = req.params;
    const wantsHtml = req.method === 'GET' && !req.xhr && (req.headers.accept || '').includes('text/html');

    if (platform === 'youtube') {
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const redirectUri = `${baseUrl}/api/auth/callback/youtube`;
      try {
        const result = getYouTubeAuthUrl({ userId: req.user.id, repo, redirectUri });
        if (wantsHtml) {
          return res.redirect(result.authUrl);
        }
        return res.json({ success: true, platform, authUrl: result.authUrl, state: result.state, codeChallenge: result.codeChallenge });
      } catch (err) {
        if (wantsHtml) {
          return res.status(400).send(`<html><body style="font-family:sans-serif;background:#0b0c12;color:#fff;padding:24px"><h3>YouTube OAuth Error</h3><p>${err.message}</p></body></html>`);
        }
        return res.status(400).json({ error: err.message });
      }
    }
    if (platform === 'instagram') {
      if (!isInstagramEnabled()) {
        const msg = 'Instagram OAuth is not configured. Set FEATURE_INSTAGRAM=true and Meta App credentials in .env.';
        if (wantsHtml) {
          return res.status(404).send(`<html><body style="font-family:sans-serif;background:#0b0c12;color:#fff;padding:24px"><h3>Instagram Not Configured</h3><p>${msg}</p></body></html>`);
        }
        return res.status(404).json({ error: msg, needsSetup: true });
      }
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const redirectUri = `${baseUrl}/api/auth/callback/instagram`;
      const authUrl = getInstagramAuthUrl(redirectUri);
      if (wantsHtml) {
        return res.redirect(authUrl);
      }
      return res.json({ success: true, platform, authUrl });
    }
    res.status(400).json({ error: 'Unsupported platform' });
  };

  app.get('/api/connect/:platform', requireAuth, handleConnect);
  app.post('/api/connect/:platform', requireAuth, handleConnect);

  app.get('/api/auth/callback/youtube', async (req, res) => {
    const { state, code, error } = req.query;
    if (error) {
      return res.status(400).send(`OAuth error: ${error}`);
    }

    if (!state) {
      return res.status(400).json({ error: 'Missing OAuth state parameter' });
    }

    const stateResult = consumeOAuthState(String(state));
    if (!stateResult.valid) {
      return res.status(400).json({ error: stateResult.error });
    }

    const userId = stateResult.userId;
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const redirectUri = `${baseUrl}/api/auth/callback/youtube`;

    try {
      await exchangeYouTubeCode({
        code: String(code),
        codeVerifier: stateResult.codeVerifier,
        redirectUri,
        userId,
        repo,
      });

      res.send('<!DOCTYPE html><html><body><h2>YouTube Connected</h2><p>You can close this window now.</p><script>if(window.opener){window.opener.postMessage({type:"oauth_callback",platform:"youtube",success:true},"*");window.close();}</script></body></html>');
    } catch (err) {
      logger.error({ err, userId }, 'YouTube OAuth exchange failed');
      res.status(400).send(`YouTube connection failed: ${err.message}`);
    }
  });

  app.get('/api/auth/callback/instagram', (req, res) => {
    if (!isInstagramEnabled()) {
      return res.status(404).send('Instagram feature is disabled');
    }
    res.send('<html><body>Instagram Connected</body></html>');
  });

  app.post('/api/disconnect/:platform', requireAuth, async (req, res) => {
    const { platform } = req.params;
    if (platform === 'youtube') {
      await disconnectYouTube(req.user.id, repo);
      return res.json({ success: true, message: 'YouTube disconnected' });
    }
    if (platform === 'instagram') {
      repo.deleteOAuthToken(req.user.id, 'instagram');
      return res.json({ success: true, message: 'Instagram disconnected' });
    }
    res.status(400).json({ error: 'Unsupported platform' });
  });

  app.post('/api/publish-clip', requireAuth, async (req, res) => {
    try {
      let { clipId, jobId, clipIndex, platform = 'youtube', metadata = {}, clip: bodyClip, workflow, fileUrl } = req.body || {};

      if (bodyClip) {
        if (!clipId) clipId = bodyClip.id;
        if (!jobId) jobId = bodyClip.job_id;
        if (clipIndex === undefined) clipIndex = bodyClip.idx;
      }
      if (!metadata || Object.keys(metadata).length === 0) {
        if (workflow && workflow[platform]) {
          metadata = workflow[platform];
        }
      }

      let clip = null;
      if (clipId) {
        clip =
          repo.getClip(jobId, clipIndex !== undefined ? clipIndex : 0, req.user.id) ||
          repo.getClip(jobId, Number(clipIndex || 0) + 1, req.user.id);
        if (!clip && jobId) {
          const allClips = repo.listClips(jobId, req.user.id);
          clip = allClips.find(c => c.id === clipId);
        }
      } else if (jobId !== undefined && clipIndex !== undefined) {
        clip =
          repo.getClip(jobId, clipIndex, req.user.id) ||
          repo.getClip(jobId, Number(clipIndex) + 1, req.user.id);
      }

      if (!clip) {
        const idx1Based = Number(clipIndex || 0) + 1;
        const padNum1 = String(idx1Based).padStart(2, '0');
        const padNum0 = String(clipIndex || 0).padStart(2, '0');
        let fallbackPath = null;

        if (jobId) {
          const candidates = [
            path.resolve(rootDir, 'storage', req.user.id, jobId, 'clips', `clip-${padNum1}.mp4`),
            path.resolve(rootDir, 'storage', req.user.id, jobId, 'clips', `clip-${padNum0}.mp4`),
            path.resolve(rootDir, 'output', jobId, 'clips', `clip-${padNum1}.mp4`),
            path.resolve(rootDir, 'output', jobId, 'clips', `clip-${padNum0}.mp4`),
          ];
          fallbackPath = candidates.find(p => fs.existsSync(p)) || null;
        }
        if ((!fallbackPath || !fs.existsSync(fallbackPath)) && fileUrl) {
          const cleanUrl = String(fileUrl).split('?')[0];
          const filesMatch = cleanUrl.match(/^\/api\/files\/([^/]+)\/(.+)$/);
          if (filesMatch) {
            const cand = path.resolve(rootDir, 'storage', req.user.id, filesMatch[1], filesMatch[2]);
            if (cand.startsWith(path.resolve(rootDir, 'storage', req.user.id)) && fs.existsSync(cand)) {
              fallbackPath = cand;
            }
          } else {
            const rel = cleanUrl.replace(/^\/output\//, '');
            const cand = path.resolve(rootDir, 'output', rel);
            if (cand.startsWith(path.resolve(rootDir, 'output')) && fs.existsSync(cand)) {
              fallbackPath = cand;
            }
          }
        }
        if (fallbackPath && fs.existsSync(fallbackPath)) {
          clip = {
            id: clipId || 'clp_' + Date.now(),
            job_id: jobId || 'job_' + Date.now(),
            user_id: req.user.id,
            idx: idx1Based,
            title: metadata.title || `Clip ${idx1Based}`,
            file_path: fallbackPath,
          };
        } else {
          return res.status(404).json({ error: 'Clip not found or unauthorized' });
        }
      }

      let filePath = clip.file_path;
      if (!filePath || !fs.existsSync(filePath)) {
        const padNum = String(clip.idx).padStart(2, '0');
        const c1 = path.resolve(rootDir, 'storage', req.user.id, clip.job_id, 'clips', `clip-${padNum}.mp4`);
        const c2 = path.resolve(rootDir, 'output', clip.job_id, 'clips', `clip-${padNum}.mp4`);
        if (fs.existsSync(c1)) filePath = c1;
        else if (fs.existsSync(c2)) filePath = c2;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Rendered video file for this clip does not exist on disk' });
      }

      let result;
      if (platform === 'instagram') {
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        const fileUrl = `${baseUrl}/api/files/${clip.job_id}/clips/${path.basename(filePath)}`;
        result = await publishClipToInstagram({
          clipId: clip.id,
          userId: req.user.id,
          jobId: clip.job_id,
          filePath,
          fileUrl,
          metadata,
          clip,
          clipIndex: clip.idx,
          repo,
          broadcast,
        });
      } else {
        result = await publishClipToYouTube({
          clipId: clip.id,
          userId: req.user.id,
          jobId: clip.job_id,
          filePath,
          metadata,
          clip,
          clipIndex: clip.idx,
          repo,
          broadcast,
        });
      }

      res.json(result);
    } catch (err) {
      logger.error({ err, userId: req.user.id }, 'Publish clip error');
      res.status(500).json({ error: `Publishing failed: ${err.message}` });
    }
  });

  app.post('/api/publish', requireAuth, async (req, res) => {
    try {
      let { jobId, clips = [], files = [], workflow = {} } = req.body || {};
      const state = getPipelineState(req.user.id, jobId || null);
      if (!jobId) {
        jobId = state?.jobId || repo.listJobs(req.user.id)[0]?.id;
      }
      if (!jobId) {
        return res.status(400).json({ error: 'jobId is required' });
      }

      const connections = getConnectionStatus(req.user.id, repo);
      const platforms = [];
      if (workflow?.youtube && connections.youtube?.connected) platforms.push('youtube');
      if (workflow?.instagram && connections.instagram?.connected) platforms.push('instagram');

      if (platforms.length === 0) {
        return res.json({
          success: false,
          message: 'No connected platforms selected. Connect YouTube or Instagram first.',
          published: 0,
        });
      }

      res.json({ success: true, message: `Publishing ${clips.length} clip(s) to ${platforms.join(' & ')}...`, jobId });

      const userId = req.user.id;
      const emitUser = (payload) => broadcast({ ...payload, jobId }, userId);
      let successCount = 0;
      let failedCount = 0;
      const results = [];

      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const fileEntry = files[i];
        const rawUrl = typeof fileEntry === 'string' ? fileEntry : fileEntry?.url;
        let filePath = null;

        if (rawUrl) {
          const cleanUrl = rawUrl.split('?')[0];
          const match = cleanUrl.match(/^\/api\/files\/([^/]+)\/(.+)$/);
          if (match) {
            const cand = path.resolve(rootDir, 'storage', userId, match[1], match[2]);
            if (cand.startsWith(path.resolve(rootDir, 'storage', userId)) && fs.existsSync(cand)) {
              filePath = cand;
            }
          }
        }
        if (!filePath) {
          const dbClip = repo.getClip(jobId, (c.index ?? i) + 1, userId) || repo.getClip(jobId, c.index ?? i, userId);
          if (dbClip?.file_path && fs.existsSync(dbClip.file_path)) filePath = dbClip.file_path;
        }
        if (!filePath) {
          const pad = String(i + 1).padStart(2, '0');
          const cand = path.resolve(rootDir, 'storage', userId, jobId, 'clips', `clip-${pad}.mp4`);
          if (fs.existsSync(cand)) filePath = cand;
        }

        for (const plat of platforms) {
          if (!filePath || !fs.existsSync(filePath)) {
            failedCount++;
            results.push({ clipIndex: i, platform: plat, success: false, error: 'File not found' });
            continue;
          }
          try {
            let pubRes;
            if (plat === 'instagram') {
              const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
              const pubUrl = `${baseUrl}/api/files/${jobId}/clips/${path.basename(filePath)}`;
              pubRes = await publishClipToInstagram({
                clipId: c.id || `clp_${jobId}_${i}`,
                userId,
                jobId,
                filePath,
                fileUrl: pubUrl,
                metadata: workflow.instagram,
                clip: c,
                clipIndex: i,
                repo,
                broadcast: emitUser,
              });
            } else {
              pubRes = await publishClipToYouTube({
                clipId: c.id || `clp_${jobId}_${i}`,
                userId,
                jobId,
                filePath,
                metadata: workflow.youtube,
                clip: c,
                clipIndex: i,
                repo,
                broadcast: emitUser,
              });
            }
            if (pubRes?.success) successCount++;
            else failedCount++;
            results.push({ clipIndex: i, platform: plat, ...pubRes });
            emitUser({ type: 'publish_progress', clipIndex: i, total: clips.length, status: pubRes?.success ? 'done' : 'failed', result: pubRes });
          } catch (pubErr) {
            failedCount++;
            results.push({ clipIndex: i, platform: plat, success: false, error: pubErr.message });
          }
        }
      }

      emitUser({
        type: 'publish_done',
        results,
        summary: { total: clips.length * platforms.length, success: successCount, failed: failedCount },
      });
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  const handleVideoInfo = async (req, res) => {
    const url = req.query.url || (req.body && req.body.url);
    if (!url) return res.status(400).json({ error: 'url parameter is required' });
    try {
      const media = validateMediaUrl(url);
      const info = await fetchVideoInfoAsync(media.canonicalUrl, 30000);
      const sourceResolution = Array.isArray(info.formats) ? analyzeSourceFormats(info.formats) : null;
      res.json({
        id: info.id || media.id,
        platform: media.platform,
        title: info.title || 'Unknown Title',
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
        duration: info.duration || 0,
        channel: info.uploader || info.channel || 'Unknown Channel',
        viewCount: info.view_count || 0,
        description: (info.description || '').slice(0, 300),
        sourceResolution,
      });
    } catch (e) {
      const isClientErr = e.message.includes('protocol') || e.message.includes('authorized') || e.message.includes('Malformed') || e.message.includes('Playlists') || e.message.includes('dash') || e.message.includes('video ID') || e.message.includes('userinfo') || e.message.includes('Custom ports') || e.message.includes('Instagram');
      res.status(isClientErr ? 400 : 500).json({ error: e.message });
    }
  };
  app.get('/api/video-info', requireAuth, handleVideoInfo);
  app.post('/api/video-info', requireAuth, handleVideoInfo);

  app.get('/api/ai/models', requireAuth, (req, res) => {
    res.json({ models: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'llama3.2:3b'] });
  });

  app.post('/api/ai/switch', requireAuth, (req, res) => {
    res.json({ success: true });
  });

  app.get(['/api/captions/presets', '/api/caption-presets'], requireAuth, (req, res) => {
    res.json({ ...CAPTION_PRESETS, presets: Object.values(CAPTION_PRESETS) });
  });

  app.get('/api/export-profiles', requireAuth, (req, res) => {
    res.json({
      exportProfiles: EXPORT_PROFILES,
      sourceProfiles: SOURCE_QUALITY_PROFILES,
      detectedEncoder: detectEncoder(),
    });
  });

  app.post('/api/set-output-dir', requireAuth, (req, res) => {
    const { dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (dirPath.includes('\0') || dirPath.startsWith('-')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    try {
      const resolved = path.resolve(dirPath);
      fs.mkdirSync(resolved, { recursive: true });
      if (fs.existsSync(resolved)) {
        return res.json({ success: true, path: resolved });
      }
      return res.status(400).json({ error: 'Could not create directory' });
    } catch (e) {
      return res.status(400).json({ error: `Invalid path: ${e.message}` });
    }
  });

  app.get('/api/storage/status', requireAuth, (req, res) => {
    const tempDir = path.join(rootDir, 'temp');
    const userStorageDir = path.join(rootDir, 'storage', req.user.id);
    const tempBytes = getDirSizeBytes(tempDir);
    const userBytes = getDirSizeBytes(userStorageDir);
    const totalBytes = tempBytes + userBytes;

    res.json({
      tempMB: (tempBytes / (1024 * 1024)).toFixed(2),
      outputMB: (userBytes / (1024 * 1024)).toFixed(2),
      totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
      totalGB: (totalBytes / (1024 * 1024 * 1024)).toFixed(2),
    });
  });

  app.post('/api/storage/clean', requireAuth, (req, res) => {
    const { cleanOutput = false } = req.body || {};
    const tempDir = path.join(rootDir, 'temp');
    let freedBytes = 0;

    if (fs.existsSync(tempDir)) {
      freedBytes += cleanDirectory(path.join(tempDir, 'video'), true);
      freedBytes += cleanDirectory(path.join(tempDir, 'audio'), true);
    }

    if (cleanOutput) {
      const userStorageDir = path.join(rootDir, 'storage', req.user.id);
      if (fs.existsSync(userStorageDir)) {
        freedBytes += cleanDirectory(userStorageDir, true);
      }
    }

    const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
    broadcast({ type: 'log', level: 'info', msg: `🧹 Cleaned storage: freed ${freedMB} MB` }, req.user.id);
    res.json({ success: true, freedMB, message: `Freed ${freedMB} MB of storage space` });
  });

  app.post('/api/pipeline/stop', requireAuth, async (req, res) => {
    const { jobId } = req.body || {};
    if (jobId) {
      try {
        const result = await cancelJob(repo, jobId, req.user.id);
        return res.json(result);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }
    stopPipeline();
    res.json({ success: true, message: 'Pipeline stopped' });
  });

  app.get('/api/raw_video', requireAuth, (req, res) => {
    const state = getPipelineState(req.user.id, req.query.jobId || null);
    let videoPath = state?.videoPath;

    if (!videoPath || !fs.existsSync(videoPath)) {
      const tempVideoDir = path.join(rootDir, 'temp', 'video');
      if (fs.existsSync(tempVideoDir)) {
        const files = fs.readdirSync(tempVideoDir)
          .filter(f => f.endsWith('.mp4') && !f.endsWith('.part'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(tempVideoDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          videoPath = path.join(tempVideoDir, files[0].name);
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
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) || start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  });

  app.get('/dashboard', (req, res) => {
    res.redirect(301, '/');
  });

  // ─── Global Error Handler ───────────────────────────────────────────────
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const reqId = req.id || 'unknown';
    logger.error({ err, reqId, url: req.originalUrl, method: req.method }, `Server error: ${err.message}`);

    res.status(status).json({
      error: status === 500 ? 'An unexpected server error occurred' : err.message,
      requestId: reqId,
    });
  });

  return app;
}

// Instantiate default app for direct imports
const app = createApp({ repo: defaultRepo });
export { app };

// ─── Direct Server Execution ────────────────────────────────────────────────

const isDirectRun = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
   process.argv[1].endsWith('server.js'))
);

if (isDirectRun) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`\n  🛹 L2S running on http://localhost:${PORT}\n`);
  });

  // Authenticated WebSocket upgrade
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;
    const allowedOrigin = process.env.APP_ORIGIN;
    const isLocalhostDev = (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) &&
                           (process.env.NODE_ENV !== 'production' || !allowedOrigin);
    if (origin && allowedOrigin && allowedOrigin !== '*' && origin !== allowedOrigin && !isLocalhostDev) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach((c) => {
      const [k, v] = c.trim().split('=');
      if (k && v) cookies[k] = decodeURIComponent(v);
    });

    const token = cookies[SESSION_COOKIE_NAME];
    const session = token ? defaultRepo.getSession(token) : null;

    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.user_id;
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
    });
  });

  process.on('SIGINT', () => {
    stopPipeline();
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    stopPipeline();
    server.close(() => process.exit(0));
  });
}
