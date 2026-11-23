// =============================================
// L2S — FFmpeg Renderer (Cross-Platform)
// =============================================
// Supports GPU (NVENC) and CPU encoding, bounded parallel rendering,
// multiple aspect ratios, atomic output writes, and FFprobe verification.

import path from "path";
import fs from "fs";
import os from "os";
import { generateSRT, generateASS } from "./subtitles.js";
import { spawnTracked } from "./process_manager.js";
import { getExportProfile } from "./video/quality_profiles.js";
import { verifyMediaFile } from "./video/verifier.js";
import { ensureSufficientDiskSpace } from "./system/disk_guard.js";

const IS_WINDOWS = process.platform === "win32";

// ─── Concurrency Configuration ───────────────
// RTX 2050 has 4GB GDDR6 VRAM. Bounding to 2 concurrent renders
// prevents NVENC session driver out-of-memory errors while keeping speeds high.
const PARALLEL_RENDERS = 2;

// ─── GPU Encoder Detection (cached) ──────────
let _encoderCache = null;

/**
 * Detect whether h264_nvenc (NVIDIA GPU) is available asynchronously.
 * Result is cached for the process lifetime.
 * @returns {Promise<{ codec: string, preset: string, qualityFlag: string, qualityValue: string, label: string }>}
 */
export async function detectEncoderAsync() {
  if (_encoderCache) return _encoderCache;

  try {
    const probeRes = await runFFmpegAsync(["-encoders", "-hide_banner"], 5000);
    if (probeRes.stdout && probeRes.stdout.includes("h264_nvenc")) {
      // Test if NVENC is functional on this hardware
      const testRes = await runFFmpegAsync([
        "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1",
        "-c:v", "h264_nvenc",
        "-f", "null", "-",
      ], 5000);

      if (testRes.status === 0) {
        _encoderCache = {
          codec: "h264_nvenc",
          preset: "p4",       // balanced speed/quality
          qualityFlag: "-cq",
          qualityValue: "18", // Crisp high quality
          label: "NVENC GPU (1080p Crisp)",
        };
        return _encoderCache;
      }
    }
  } catch { /* GPU detection failed, fall through */ }

  _encoderCache = {
    codec: "libx264",
    preset: "veryfast",
    qualityFlag: "-crf",
    qualityValue: "18", // Crisp high quality
    label: "CPU (libx264 Crisp)",
  };
  return _encoderCache;
}

/**
 * Synchronous fallback getter for cached encoder
 */
export function detectEncoder() {
  if (_encoderCache) return _encoderCache;
  return {
    codec: "libx264",
    preset: "veryfast",
    qualityFlag: "-crf",
    qualityValue: "18",
    label: "CPU (libx264 Crisp)",
  };
}

// ─── Concurrency Limiter ─────────────────────
async function parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ─── Main Render Function ────────────────────
/**
 * Render selected clips with subtitles.
 * Uses parallel rendering, atomic writes, and FFprobe verification.
 */
export async function renderClips(sourceFile, selected, subtitleStyle, outputDir, onLog) {
  const clipsDir = path.join(outputDir, "clips");
  const captionsDir = path.join(outputDir, "captions");
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(captionsDir, { recursive: true });

  // Pre-flight disk space check: ensure at least 250 MB free
  ensureSufficientDiskSpace(outputDir, 250 * 1024 * 1024);

  // Clean old clip files from directory to avoid leftover dummy clips from older runs
  try {
    const existingFiles = fs.readdirSync(clipsDir);
    for (const file of existingFiles) {
      if (file.endsWith(".mp4") || file.endsWith(".tmp.mp4")) {
        try { fs.unlinkSync(path.join(clipsDir, file)); } catch (e) {}
      }
    }
  } catch (e) {}

  // Detect encoder asynchronously
  const encoder = await detectEncoderAsync();
  if (onLog) onLog(`🎬 Encoder: ${encoder.label} (${encoder.codec})`);

  // Prepare all clip data upfront (subtitle files, paths)
  const clipJobs = selected.map((chunk, i) => {
    const clipNum = String(i + 1).padStart(2, "0");
    const clipFileName = `clip-${clipNum}.mp4`;
    const clipPath = path.join(clipsDir, clipFileName);
    const srtPath = path.join(captionsDir, `clip-${clipNum}.srt`);
    const assPath = path.join(captionsDir, `clip-${clipNum}.ass`);

    const chunkStart = chunk.chunk?.start ?? chunk.start ?? 0;

    // Generate subtitle files synchronously with clip-specific preset support
    const words = chunk.chunk?.words || chunk.words || [];
    const clipStyle = chunk.custom?.captionPreset || chunk.custom?.subtitleStyle || subtitleStyle || "bold";
    fs.writeFileSync(srtPath, generateSRT(words, clipStyle, chunkStart));
    fs.writeFileSync(assPath, generateASS(words, clipStyle, chunkStart, chunk.custom || {}));

    const actualStart = Number(chunk.custom?.editStart ?? chunk.chunk?.start ?? chunk.start ?? 0);
    const actualEnd = Number(chunk.custom?.editEnd ?? chunk.chunk?.end ?? chunk.end ?? 0);

    return { chunk, clipNum, clipFileName, clipPath, assPath, actualStart, actualEnd };
  });

  // Render clips in parallel (bounded concurrency)
  const concurrency = Math.min(PARALLEL_RENDERS, clipJobs.length);
  if (onLog && concurrency > 1) {
    onLog(`⚡ Parallel rendering: ${concurrency} clips at a time`);
  }

  await parallelMap(clipJobs, concurrency, async (job) => {
    if (onLog) onLog(`Rendering clip ${job.clipNum}/${String(selected.length).padStart(2, "0")}...`);
    await cutClip(sourceFile, job.clipPath, job.actualStart, job.actualEnd, job.assPath, job.chunk.custom, encoder);
  });

  return clipJobs;
}

// ─── Cut a Single Clip ───────────────────────
async function cutClip(sourceFile, outputPath, start, end, assPath, customData = {}, encoder) {
  const duration = Math.max(0.1, end - start);
  const tempRaw = outputPath.replace(".mp4", "-raw.mp4");
  const tempFinal = outputPath.replace(".mp4", `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);

  // Helper to ensure values are valid numbers
  const getNum = (val, def) => {
    const n = Number(val);
    return isNaN(n) ? def : n;
  };

  // Editor parameters
  const zoom = Math.min(3.0, Math.max(0.1, getNum(customData.zoom, 1.0)));
  const normPanX = getNum(customData.normPanX, 0.0);
  const normPanY = getNum(customData.normPanY, 0.0);
  const bright = getNum(customData.brightness, 0.0);
  const contrast = getNum(customData.contrast, 1.0);
  const exposure = getNum(customData.exposure, 0.0);
  const saturation = getNum(customData.saturation, 1.0);
  const sharpen = getNum(customData.sharpen, 0.0);
  const aspectRatio = customData.aspectRatio || '9:16';
  const captionsEnabled = customData.captionsEnabled === true;

  // Determine output dimensions based on aspect ratio
  let outW, outH;
  switch (aspectRatio) {
    case '16:9':
      outW = 1920; outH = 1080;
      break;
    case '4:5':
      outW = 1080; outH = 1350;
      break;
    case '4:3':
      outW = 1440; outH = 1080;
      break;
    case '1:1':
      outW = 1080; outH = 1080;
      break;
    case '9:16':
    default:
      outW = 1080; outH = 1920;
      break;
  }

  // Universal aspect-ratio preserving zoom & pan filter pipeline (supports 0.1x to 3.0x):
  // 1. Scale preserving aspect ratio based on whether video is wider or taller than target container
  // 2. Pad to target canvas if zoomed out (< 1.0x) or if edges are exposed
  // 3. Crop to exact target canvas dimensions with pan offsets clamped within bounds
  // 4. Force 1:1 square pixel aspect ratio (SAR 1:1) to prevent playback stretching
  const scaleFilter = `scale=w='if(gt(a,${outW}/${outH}),-2,trunc(${outW}*${zoom}/2)*2)':h='if(gt(a,${outW}/${outH}),trunc(${outH}*${zoom}/2)*2,-2)'`;
  const padFilter = `pad=w='max(iw,${outW})':h='max(ih,${outH})':x='(ow-iw)/2':y='(oh-ih)/2':color=black`;
  const cropFilter = `crop=${outW}:${outH}:x='min(max(0,(iw-${outW})/2-(${normPanX}*${outH})),iw-${outW})':y='min(max(0,(ih-${outH})/2-(${normPanY}*${outH})),ih-${outH})'`;
  
  // 3. Filters
  const totalBright = bright + exposure;
  const sharpenFilter = sharpen > 0 ? `,unsharp=5:5:${sharpen}` : '';

  const filterParts = [
    scaleFilter,
    padFilter,
    cropFilter,
    "setsar=1",
    `eq=brightness=${totalBright}:contrast=${contrast}:saturation=${saturation}${sharpenFilter}`
  ];

  const filter = filterParts.join(",");

  // Export quality profile integration
  const exportProfile = getExportProfile(customData.exportQuality || customData.exportProfile || 'balanced');
  const isNvenc = encoder.codec.includes('nvenc');
  const preset = isNvenc ? exportProfile.nvencPreset : exportProfile.cpuPreset;
  const qualityVal = isNvenc ? String(exportProfile.nvencCq) : String(exportProfile.cpuCrf);
  const audioBitrate = exportProfile.audioBitrate || '192k';

  // Build encoder args based on detected encoder and export profile
  // -pix_fmt yuv420p ensures universal mobile & browser playback
  // -movflags +faststart places moov atom at beginning of MP4 for instant streaming
  // -vsync 1 & -async 1 prevent audio/video drift during trimming
  const encoderArgs = [
    "-c:v", encoder.codec,
    "-preset", preset,
    encoder.qualityFlag, qualityVal,
    "-b:v", exportProfile.videoBitrate || "8M",
    "-maxrate", exportProfile.maxrate || "14M",
    "-bufsize", exportProfile.bufsize || "18M",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-vsync", "1",
    "-async", "1",
  ];

  // If captions enabled, render to tempRaw first, otherwise render straight to tempFinal
  const initialOutput = captionsEnabled ? tempRaw : tempFinal;

  try {
    await runFFmpegAsync([
      "-ss", String(start),
      "-i", sourceFile,
      "-t", String(duration),
      "-vf", filter,
      ...encoderArgs,
      "-c:a", "aac",
      "-b:a", audioBitrate,
      "-threads", "0",
      "-y",
      initialOutput,
    ]);
  } catch (e) {
    // If GPU encoding fails, retry with CPU fallback
    if (encoder.codec !== "libx264") {
      console.warn(`[renderer] GPU encode failed, retrying with CPU: ${e.message.slice(0, 100)}`);
      await runFFmpegAsync([
        "-ss", String(start),
        "-i", sourceFile,
        "-t", String(duration),
        "-vf", filter,
        "-c:v", "libx264",
        "-preset", exportProfile.cpuPreset || "medium",
        "-crf", String(exportProfile.cpuCrf || 22),
        "-pix_fmt", "yuv420p",
        "-b:v", exportProfile.videoBitrate || "8M",
        "-maxrate", exportProfile.maxrate || "14M",
        "-bufsize", exportProfile.bufsize || "18M",
        "-movflags", "+faststart",
        "-vsync", "1",
        "-async", "1",
        "-c:a", "aac",
        "-b:a", audioBitrate,
        "-threads", "0",
        "-y",
        initialOutput,
      ]);
    } else {
      throw e;
    }
  }

  if (!fs.existsSync(initialOutput)) {
    throw new Error(`Render failed for segment ${start}s-${end}s: Initial video was not created`);
  }

  // Step 2: Burn subtitles if captions enabled
  if (captionsEnabled && assPath && fs.existsSync(assPath) && fs.existsSync(tempRaw)) {
    let subFilter;
    if (IS_WINDOWS) {
      const escapedPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      subFilter = `ass='${escapedPath}'`;
    } else {
      subFilter = `ass=${assPath}`;
    }

    try {
      await runFFmpegAsync([
        "-i", tempRaw,
        "-vf", subFilter,
        "-c:v", encoder.codec,
        "-preset", preset,
        encoder.qualityFlag, qualityVal,
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "copy",
        "-threads", "0",
        "-y",
        tempFinal,
      ]);
      try { fs.unlinkSync(tempRaw); } catch (e) {}
    } catch (e) {
      // If GPU subtitle burning fails, retry with CPU libx264
      if (encoder.codec !== "libx264") {
        try {
          console.warn(`[renderer] GPU subtitle burn failed, retrying with CPU: ${e.message.slice(0, 100)}`);
          await runFFmpegAsync([
            "-i", tempRaw,
            "-vf", subFilter,
            "-c:v", "libx264",
            "-preset", exportProfile.cpuPreset || "medium",
            "-crf", String(exportProfile.cpuCrf || 22),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "copy",
            "-threads", "0",
            "-y",
            tempFinal,
          ]);
          try { fs.unlinkSync(tempRaw); } catch (err) {}
        } catch (cpuErr) {
          fs.renameSync(tempRaw, tempFinal);
        }
      } else {
        fs.renameSync(tempRaw, tempFinal);
      }
    }
  }

  // Step 3: Verify exported video with FFprobe before atomic commitment
  const verification = await verifyMediaFile(tempFinal, { minDuration: 0.1 });
  if (!verification.valid) {
    try { fs.unlinkSync(tempFinal); } catch (e) {}
    try { if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw); } catch (e) {}
    throw new Error(`Render verification failed for clip ${start}s-${end}s: ${verification.error}`);
  }

  // Step 4: Atomic commitment: rename verified temp file to final destination
  fs.renameSync(tempFinal, outputPath);
}

// ─── FFmpeg Async Runner ─────────────────────
function runFFmpegAsync(args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked("ffmpeg", args);
    let stdoutData = "";
    let stderrData = "";

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    if (child.stdout) child.stdout.on("data", (data) => stdoutData += data.toString());
    if (child.stderr) child.stderr.on("data", (data) => stderrData += data.toString());

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`FFmpeg exited with ${code}: ${stderrData.slice(-500)}`));
      }
      resolve({ status: 0, stdout: stdoutData, stderr: stderrData });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
