/**
 * src/reframe.js
 * Automatic face-following 9:16 reframing engine for vertical video exports.
 * Uses OpenCV YuNet detections, scene-cut boundary resets, dead-zone filtering,
 * and exponential path smoothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const CACHE_DIR = path.join(ROOT_DIR, 'cache', 'reframe');

// Bounded concurrency semaphore for analysis (max 2 parallel on 4-core machine)
let activeAnalyses = 0;
const MAX_CONCURRENT_ANALYSES = Number(process.env.REFRAME_CONCURRENCY || 2);
const analysisWaiters = [];

function acquireSemaphore() {
  if (activeAnalyses < MAX_CONCURRENT_ANALYSES) {
    activeAnalyses++;
    return Promise.resolve();
  }
  return new Promise((resolve) => analysisWaiters.push(resolve));
}

function releaseSemaphore() {
  if (analysisWaiters.length > 0) {
    const next = analysisWaiters.shift();
    next();
  } else {
    activeAnalyses = Math.max(0, activeAnalyses - 1);
  }
}

/**
 * Generate deterministic cache key for a video clip reframing analysis
 */
export function getReframeCacheKey(videoPath, start, end, targetAspect = '9:16') {
  let stat = '';
  try {
    const s = fs.statSync(videoPath);
    stat = `${s.size}-${s.mtimeMs}`;
  } catch (e) {
    stat = videoPath;
  }
  const raw = `${videoPath}:${stat}:${Number(start).toFixed(2)}:${Number(end).toFixed(2)}:${targetAspect}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Converts raw YuNet face detections and scene cuts into a smoothed crop trajectory.
 * 
 * @param {Object} analysisData - Raw analysis from reframe_analyze.py
 * @param {Object} options - Configuration overrides
 * @returns {Array} Array of { t, cropX, cropY, cropW, cropH, cx, cy }
 */
export function computeSmoothCropPath(analysisData, options = {}) {
  const {
    width = 1920,
    height = 1080,
    scene_cuts = [],
    path: rawSamples = []
  } = analysisData;

  const targetAspect = options.targetAspect || '9:16';
  const deadZonePercent = options.deadZonePercent ?? 0.04; // 4% frame width
  const maxPanSpeedPercent = options.maxPanSpeedPercent ?? 0.20; // 20% width per second
  const alpha = options.alpha ?? 0.25; // Exponential smoothing rate
  const missingHoldSeconds = options.missingHoldSeconds ?? 1.5;

  // Determine crop dimensions
  let targetCropW, targetCropH;
  if (targetAspect === '9:16') {
    targetCropH = height;
    targetCropW = Math.round(targetCropH * 9 / 16);
  } else if (targetAspect === '1:1') {
    targetCropH = Math.min(width, height);
    targetCropW = targetCropH;
  } else if (targetAspect === '4:5') {
    targetCropH = height;
    targetCropW = Math.round(targetCropH * 4 / 5);
  } else {
    targetCropH = height;
    targetCropW = Math.round(targetCropH * 9 / 16);
  }

  // Ensure even dimensions for video codecs
  if (targetCropW % 2 !== 0) targetCropW -= 1;
  if (targetCropH % 2 !== 0) targetCropH -= 1;

  const centerCropX = Math.round((width - targetCropW) / 2);
  const centerCropY = Math.round((height - targetCropH) / 2);
  const deadZone = deadZonePercent * width;
  const maxPanSpeed = maxPanSpeedPercent * width;

  if (!rawSamples || rawSamples.length === 0) {
    return [{
      t: 0,
      cropX: centerCropX,
      cropY: centerCropY,
      cropW: targetCropW,
      cropH: targetCropH,
      cx: width / 2,
      cy: height / 2
    }];
  }

  // Scene cut lookup set
  const sceneCutTimes = new Set(scene_cuts.map((c) => Number(c).toFixed(2)));

  let smoothedCx = width / 2;
  let smoothedCy = height / 2;
  let lastValidFaceCx = width / 2;
  let lastValidFaceCy = height / 2;
  let lastFaceSeenTime = -1;

  const smoothPath = [];

  for (let i = 0; i < rawSamples.length; i++) {
    const sample = rawSamples[i];
    const t = sample.t;
    const dt = i === 0 ? 0.2 : Math.max(0.001, t - rawSamples[i - 1].t);
    const hasFace = sample.w > 0 && sample.confidence > 0.3;

    // Check if a scene cut occurred between previous sample and current
    const isCut = scene_cuts.some((c) => i > 0 && c > rawSamples[i - 1].t && c <= t);

    if (isCut) {
      // Scene cut: reset smoothing immediately without camera pan
      if (hasFace) {
        smoothedCx = sample.cx;
        smoothedCy = sample.cy;
        lastValidFaceCx = sample.cx;
        lastValidFaceCy = sample.cy;
        lastFaceSeenTime = t;
      } else {
        smoothedCx = width / 2;
        smoothedCy = height / 2;
        lastFaceSeenTime = -1;
      }
    } else if (hasFace) {
      lastFaceSeenTime = t;
      lastValidFaceCx = sample.cx;
      lastValidFaceCy = sample.cy;

      // Dead zone: ignore subtle motion below threshold
      const offsetFromCurrent = Math.abs(sample.cx - smoothedCx);
      let targetCx = smoothedCx;
      if (offsetFromCurrent > deadZone) {
        targetCx = sample.cx;
      }

      // Exponential smoothing
      const stepAlpha = 1 - Math.pow(1 - alpha, dt / 0.2);
      let nextCx = smoothedCx + stepAlpha * (targetCx - smoothedCx);

      // Max pan speed clamp
      const maxStep = maxPanSpeed * dt;
      const panDelta = nextCx - smoothedCx;
      if (Math.abs(panDelta) > maxStep) {
        nextCx = smoothedCx + Math.sign(panDelta) * maxStep;
      }
      smoothedCx = nextCx;

      // Vertical position follows face gently
      const nextCy = smoothedCy + stepAlpha * (sample.cy - smoothedCy);
      smoothedCy = nextCy;
    } else {
      // Missing face: hold position if under missingHoldSeconds, else ease to center
      const timeSinceFace = lastFaceSeenTime >= 0 ? t - lastFaceSeenTime : 999;
      let targetCx = smoothedCx;
      let targetCy = smoothedCy;

      if (timeSinceFace < missingHoldSeconds) {
        targetCx = lastValidFaceCx;
        targetCy = lastValidFaceCy;
      } else {
        targetCx = width / 2;
        targetCy = height / 2;
      }

      // Ease toward target
      const stepAlpha = 1 - Math.pow(1 - alpha, dt / 0.2);
      let nextCx = smoothedCx + stepAlpha * (targetCx - smoothedCx);
      const maxStep = maxPanSpeed * dt;
      const panDelta = nextCx - smoothedCx;
      if (Math.abs(panDelta) > maxStep) {
        nextCx = smoothedCx + Math.sign(panDelta) * maxStep;
      }
      smoothedCx = nextCx;
      smoothedCy = smoothedCy + stepAlpha * (targetCy - smoothedCy);
    }

    // Keep face roughly at the upper third (target Y ~ cy - 0.35 * targetCropH)
    const idealCropX = Math.round(smoothedCx - targetCropW / 2);
    const idealCropY = Math.round(smoothedCy - targetCropH * 0.35);

    // Hard boundary clamping: crop window NEVER leaves the source frame
    const clampedCropX = Math.max(0, Math.min(width - targetCropW, idealCropX));
    const clampedCropY = Math.max(0, Math.min(height - targetCropH, idealCropY));

    smoothPath.push({
      t: round(t, 3),
      cropX: clampedCropX,
      cropY: clampedCropY,
      cropW: targetCropW,
      cropH: targetCropH,
      cx: round(smoothedCx, 1),
      cy: round(smoothedCy, 1)
    });
  }

  return smoothPath;
}

/**
 * Samples smooth crop coordinates at a specific timestamp using linear interpolation
 */
export function sampleCropAt(smoothPath, t) {
  if (!smoothPath || smoothPath.length === 0) return null;
  if (smoothPath.length === 1 || t <= smoothPath[0].t) return smoothPath[0];
  if (t >= smoothPath[smoothPath.length - 1].t) return smoothPath[smoothPath.length - 1];

  for (let i = 0; i < smoothPath.length - 1; i++) {
    const p0 = smoothPath[i];
    const p1 = smoothPath[i + 1];
    if (p0.t <= t && t <= p1.t) {
      const dt = p1.t - p0.t;
      const alpha = dt > 0.0001 ? (t - p0.t) / dt : 0;
      return {
        t,
        cropX: Math.round(p0.cropX + alpha * (p1.cropX - p0.cropX)),
        cropY: Math.round(p0.cropY + alpha * (p1.cropY - p0.cropY)),
        cropW: Math.round(p0.cropW + alpha * (p1.cropW - p0.cropW)),
        cropH: Math.round(p0.cropH + alpha * (p1.cropH - p0.cropH))
      };
    }
  }
  return smoothPath[smoothPath.length - 1];
}

/**
 * Analyzes video clip with Python YuNet detector and returns smoothed crop path.
 * Cached by video hash + timestamps.
 */
export async function analyzeClipReframe(videoPath, start, end, options = {}) {
  const targetAspect = options.targetAspect || '9:16';
  const cacheKey = getReframeCacheKey(videoPath, start, end, targetAspect);
  const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (!options.noCache && fs.existsSync(cacheFilePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      if (cached && cached.smooth_path) {
        return cached;
      }
    } catch (e) {}
  }

  // If deployed on Vercel with bound Python scripts service, call via internal URL binding
  if (process.env.SCRIPTS_SERVICE_URL) {
    try {
      const endpoint = new URL('/reframe', process.env.SCRIPTS_SERVICE_URL);
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath, start, end, targetAspect })
      });
      if (resp.ok) {
        const rawData = await resp.json();
        if (rawData && rawData.path) {
          const smoothPath = computeSmoothCropPath(rawData, { targetAspect });
          const result = {
            ...rawData,
            smooth_path: smoothPath,
            cached_at: Date.now()
          };
          try {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(cacheFilePath, JSON.stringify(result), 'utf8');
          } catch (e) {}
          return result;
        }
      }
    } catch (serviceErr) {
      // Fall through to local spawn if internal service call fails
    }
  }

  await acquireSemaphore();

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tempJsonPath = path.join(CACHE_DIR, `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
    const scriptPath = path.join(SCRIPTS_DIR, 'reframe_analyze.py');

    const args = [
      scriptPath,
      videoPath,
      String(start),
      String(end),
      tempJsonPath,
      targetAspect
    ];

    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python', args, {
        timeout: options.timeoutMs || 60000,
        windowsHide: true
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`reframe_analyze exited with code ${code}: ${stderr}`));
        }
        try {
          if (!fs.existsSync(tempJsonPath)) {
            return reject(new Error(`reframe_analyze produced no output file: ${stderr}`));
          }
          const rawData = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));
          try { fs.unlinkSync(tempJsonPath); } catch (e) {}
          resolve(rawData);
        } catch (err) {
          reject(err);
        }
      });

      proc.on('error', reject);
    });

    // Compute smooth crop path
    const smoothPath = computeSmoothCropPath(result, options);
    const enriched = {
      ...result,
      smooth_path: smoothPath
    };

    // Cache result
    try {
      fs.writeFileSync(cacheFilePath, JSON.stringify(enriched, null, 2), 'utf8');
    } catch (e) {}

    return enriched;
  } catch (err) {
    if (options.onLog) {
      options.onLog(`⚠️  Reframe analysis fallback triggered (${err.message}). Using center crop.`);
    }
    // Fallback response with center crop
    return {
      width: 1920,
      height: 1080,
      fps: 30,
      scene_cuts: [],
      has_split_candidate: false,
      smooth_path: [{
        t: 0,
        cropX: 656,
        cropY: 0,
        cropW: 608,
        cropH: 1080,
        cx: 960,
        cy: 540
      }]
    };
  } finally {
    releaseSemaphore();
  }
}

/**
 * Renders a reframed 9:16 clip using the Python piped frame processor.
 */
export async function renderReframedClip(videoPath, start, end, outputPath, options = {}) {
  const mode = options.reframeMode || 'auto';
  const scriptPath = path.join(SCRIPTS_DIR, 'reframe_render.py');

  let cropDataPath = null;
  if (mode !== 'center') {
    const analysis = await analyzeClipReframe(videoPath, start, end, options);
    const tempCropData = path.join(CACHE_DIR, `render_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(tempCropData, JSON.stringify(analysis), 'utf8');
    cropDataPath = tempCropData;
  }

  const args = [
    scriptPath,
    '--input', videoPath,
    '--start', String(start),
    '--end', String(end),
    '--output', outputPath,
    '--mode', mode,
    '--encoder', options.encoder || 'libx264',
    '--preset', options.preset || 'veryfast',
    '--crf', String(options.crf || 18),
    '--audio-bitrate', options.audioBitrate || '192k',
    '--video-bitrate', options.videoBitrate || '8M',
    '--maxrate', options.maxrate || '14M',
    '--bufsize', options.bufsize || '18M'
  ];

  if (cropDataPath) {
    args.push('--crop-data', cropDataPath);
  }

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('python', args, {
        timeout: options.timeoutMs || 120000,
        windowsHide: true
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (cropDataPath && fs.existsSync(cropDataPath)) {
          try { fs.unlinkSync(cropDataPath); } catch (e) {}
        }
        if (code !== 0) {
          return reject(new Error(`reframe_render exited with code ${code}: ${stderr}`));
        }
        resolve();
      });

      proc.on('error', (err) => {
        if (cropDataPath && fs.existsSync(cropDataPath)) {
          try { fs.unlinkSync(cropDataPath); } catch (e) {}
        }
        reject(err);
      });
    });
  } catch (err) {
    throw new Error(`Reframing render failed: ${err.message}`);
  }
}

function round(n, d = 2) {
  return Number(Number(n).toFixed(d));
}
