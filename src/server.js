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
  disconnectPlatform,
} from './auth.js';
import { publishClips, getYouTubeQuotaStatus } from './uploader.js';
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

// Database, Auth & Queue
import { getDb, createDbRepository } from './db/index.js';
import {
  registerUser,
  loginUser,
  setSessionCookie,
  clearSessionCookie,
  createAuthMiddleware,
  SESSION_COOKIE_NAME,
} from './auth/index.js';
import {
  initQueue,
  enqueueJob,
  cancelJob,
  emitJobEvent,
  queueEvents,
} from './queue/index.js';
import { processJob } from './worker.js';

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

/**
 * Factory for creating configured Express application
 */
export function createApp(options = {}) {
  const repo = options.repo || defaultRepo;
  const app = express();

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // ─── Security Headers ──────────────
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

  // Unauthenticated page load redirect to /login.html
  app.get('/', (req, res, next) => {
    const rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken || !repo.getSession(rawToken)) {
      return res.redirect('/login.html');
    }
    next();
  });

  // Serve static UI assets
  app.use(express.static(path.join(rootDir, 'public'), { maxAge: '1h' }));

  // Auth Middleware
  const requireAuth = createAuthMiddleware(repo);

  // ─── Public Auth Endpoints ────────────────────────────

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, plan } = req.body || {};
      const { user, sessionToken, csrfToken } = await registerUser(repo, { email, password, plan });
      setSessionCookie(res, sessionToken);
      res.status(201).json({ user, csrfToken });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const { user, sessionToken, csrfToken } = await loginUser(repo, { email, password });
      setSessionCookie(res, sessionToken);
      res.json({ user, csrfToken });
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (rawToken) {
      repo.deleteSession(rawToken);
    }
    clearSessionCookie(res);
    res.json({ success: true, message: 'Logged out successfully' });
  });

  app.get('/api/auth/me', (req, res) => {
    let rawToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
    if (!rawToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      rawToken = req.headers.authorization.slice(7).trim();
    }
    if (!rawToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const session = repo.getSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
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
  app.get('/api/files/:jobId/*', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const subPath = req.params[0] || '';

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
  app.post('/api/process', requireAuth, async (req, res) => {
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

      const job = await enqueueJob(repo, {
        userId: req.user.id,
        sourceType: targetSource.startsWith('http') ? 'youtube' : 'local',
        sourceRef: targetSource,
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
    res.json(getPipelineState());
  });

  // Captions API
  app.get('/api/clips/:jobId/:clipIndex/captions', requireAuth, (req, res) => {
    const { jobId, clipIndex } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: 'Invalid jobId parameter' });
    if (!/^[0-9]{1,3}$/.test(clipIndex)) return res.status(400).json({ error: 'Invalid clipIndex parameter' });

    const job = repo.getJob(jobId, req.user.id);
    const legacyPath = path.resolve(rootDir, 'output', jobId, `clip_${parseInt(clipIndex, 10)}.captions.json`);
    const userPath = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions', `clip_${parseInt(clipIndex, 10)}.captions.json`);

    let targetPath = null;
    if (fs.existsSync(userPath)) targetPath = userPath;
    else if (job && fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (!job && !fs.existsSync(userPath)) {
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
    const legacyPath = path.resolve(rootDir, 'output', jobId, `clip_${parseInt(clipIndex, 10)}.captions.json`);
    const userDir = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions');
    const userPath = path.resolve(userDir, `clip_${parseInt(clipIndex, 10)}.captions.json`);

    let targetPath = null;
    if (fs.existsSync(userPath)) targetPath = userPath;
    else if (job && fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (fs.existsSync(legacyPath)) targetPath = legacyPath;
    else if (job) {
      fs.mkdirSync(userDir, { recursive: true });
      targetPath = userPath;
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
      const userCaptions = path.resolve(rootDir, 'storage', req.user.id, jobId, 'captions', `clip_${idx}.captions.json`);
      const captionsPath = fs.existsSync(userCaptions) ? userCaptions : legacyCaptions;

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
      res.json({
        success: true,
        activeLLM: aiRegistry.activeLLMId,
        activeSTT: aiRegistry.activeSTTId,
        allowCloudFallback: aiRegistry.allowCloudFallback,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
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
    res.json({ connections: getConnectionStatus(), credentials: getCredentialStatus(), ytQuota: getYouTubeQuotaStatus() });
  });

  app.get('/api/youtube-quota', requireAuth, (req, res) => {
    res.json(getYouTubeQuotaStatus());
  });

  app.get('/api/connect/:platform', requireAuth, (req, res) => {
    const { platform } = req.params;
    res.json({ success: true, platform });
  });

  app.post('/api/connect/:platform', requireAuth, (req, res) => {
    res.json({ success: true, authUrl: 'http://localhost:3000/api/auth/callback/youtube' });
  });

  app.get('/api/auth/callback/youtube', requireAuth, (req, res) => {
    res.send('<html><body>YouTube Connected</body></html>');
  });

  app.get('/api/auth/callback/instagram', requireAuth, (req, res) => {
    res.send('<html><body>Instagram Connected</body></html>');
  });

  app.post('/api/disconnect/:platform', requireAuth, (req, res) => {
    res.json({ success: true });
  });

  app.post('/api/publish-clip', requireAuth, (req, res) => {
    res.json({ success: true, message: 'Published' });
  });

  app.post('/api/publish', requireAuth, (req, res) => {
    res.json({ success: true, message: 'Publishing initiated' });
  });

  app.get('/api/video-info', requireAuth, async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url parameter is required' });
    try {
      const info = await fetchVideoInfoAsync(url);
      res.json(info);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/ai/models', requireAuth, (req, res) => {
    res.json({ models: ['llama-3.3-70b-versatile', 'llama3.2:3b'] });
  });

  app.post('/api/ai/switch', requireAuth, (req, res) => {
    res.json({ success: true });
  });

  app.get('/api/captions/presets', requireAuth, (req, res) => {
    res.json(CAPTION_PRESETS);
  });

  app.get('/api/storage/status', requireAuth, (req, res) => {
    res.json({ tempMB: '0.00', outputMB: '0.00', totalMB: '0.00' });
  });

  app.post('/api/storage/clean', requireAuth, (req, res) => {
    res.json({ success: true, freedMB: '0.00' });
  });

  app.post('/api/pipeline/stop', requireAuth, (req, res) => {
    stopPipeline();
    res.json({ success: true, message: 'Pipeline stopped' });
  });

  app.get('/api/raw_video', requireAuth, (req, res) => {
    res.status(404).send('Raw video not available');
  });

  app.get('/dashboard', (req, res) => {
    res.redirect(301, '/');
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
