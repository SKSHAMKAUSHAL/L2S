// =============================================
// SKATE — Downloader (yt-dlp + FFmpeg)
// Hardened for Step 8 Security Standards
// =============================================

import path from "path";
import fs from "fs";
import { spawnTracked } from "./process_manager.js";
import { validateYouTubeUrl } from "./security/url.js";

const MAX_DOWNLOAD_BYTES = process.env.MAX_DOWNLOAD_BYTES || '2G';
const MAX_SECONDS = process.env.MAX_SECONDS || '7200';
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB output buffer cap

/**
 * Execute command asynchronously with process tracking, timeout, and buffer capping
 */
export function runCommandAsync(command, args, timeoutMs = 600000, jobId = null, onProgress = null) {
  return new Promise((resolve, reject) => {
    // shell is strictly false to prevent shell injection
    const child = spawnTracked(command, args, { shell: false }, jobId);
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        if (child.pid && !child.killed) {
          child.kill('SIGTERM');
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
          }, 2000).unref();
        }
      } catch (e) {}
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    let lastProgressTime = 0;
    child.stdout.on("data", (data) => {
      const text = data.toString();
      if (stdout.length + text.length <= MAX_BUFFER_BYTES) {
        stdout += text;
      }
      if (onProgress) {
        const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?%)\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s\r\n]+)/);
        if (match) {
          const now = Date.now();
          if (now - lastProgressTime >= 1200) {
            lastProgressTime = now;
            onProgress(`📥 Download: ${match[1]} of ${match[2]} at ${match[3]} (ETA ${match[4]})`);
          }
        }
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      if (stderr.length + text.length <= MAX_BUFFER_BYTES) {
        stderr += text;
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (!killedByTimeout) {
        resolve({ status: code, stdout, stderr });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!killedByTimeout) {
        reject(err);
      }
    });
  });
}

/**
 * Fetch YouTube video metadata asynchronously without blocking the event loop (30s timeout)
 * @param {string} url - YouTube URL
 * @param {number} [timeoutMs=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Metadata object
 */
export async function fetchVideoInfoAsync(url, timeoutMs = 30000) {
  if (!url || typeof url !== 'string') throw new Error('URL is required');
  
  // Validate and normalize URL to prevent SSRF and argument injection
  const { canonicalUrl } = validateYouTubeUrl(url);

  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-playlist',
    '--socket-timeout', '30',
    '--retries', '3',
    '--extractor-args', 'youtube:player_client=mediaconnect',
    '--',
    canonicalUrl,
  ];

  const res = await runCommandAsync('yt-dlp', args, timeoutMs);

  if (res.status !== 0) {
    throw new Error(`Could not fetch video info: ${res.stderr?.trim() || 'yt-dlp exited with code ' + res.status}`);
  }

  return JSON.parse(res.stdout.trim());
}

/**
 * Download video from YouTube using yt-dlp
 * Hardened: Strict SSL verification, no browser cookies probing.
 * Enforces --no-playlist, --max-filesize, --match-filter, and '--' before URL.
 *
 * @param {string} url - YouTube URL
 * @param {string} outputDir - Output directory
 * @param {Function} onLog - Logging callback
 * @param {string} quality - Video quality: 'high', 'medium', 'fast', '1080p', etc.
 * @param {string} [jobId] - Optional jobId for process cancellation tracking
 */
export async function downloadVideo(url, outputDir, onLog, quality = 'high', jobId = null) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");

  const { canonicalUrl } = validateYouTubeUrl(url);

  // Quality format profiles (1080p max for blazing fast download while preserving full shorts quality)
  const qualityFormats = {
    best: "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    '4k': "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best",
    '1440p': "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best",
    '1080p': "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    '720p': "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    high: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    medium: "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    fast: "bestvideo[height<=720]+bestaudio/best[height<=720]/best[ext=mp4]/best",
  };

  const selectedFormat = qualityFormats[quality] || qualityFormats['1080p'] || qualityFormats.high;
  onLog?.(`📥 Download profile: ${quality || '1080p'} — Target: ${selectedFormat}`);

  const commonArgs = [
    "-f", selectedFormat,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--concurrent-fragments", "4",
    "--buffer-size", "1024k",
    "--no-update",
    "--max-filesize", `${MAX_DOWNLOAD_BYTES}`,
    "--match-filter", `duration<=${MAX_SECONDS}`,
    "--socket-timeout", "30",
    "--retries", "3",
    "-o", outputTemplate,
    "--print", "after_move:filepath",
    "--no-simulate",
    "--no-warnings",
  ];

  const strategies = [
    {
      name: "Standard download",
      args: [...commonArgs, "--", canonicalUrl],
    },
    {
      name: "iOS & Mobile Web client",
      args: [
        "-f", selectedFormat,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--concurrent-fragments", "4",
        "--buffer-size", "1024k",
        "--no-update",
        "--max-filesize", `${MAX_DOWNLOAD_BYTES}`,
        "--match-filter", `duration<=${MAX_SECONDS}`,
        "--socket-timeout", "30",
        "--retries", "3",
        "--extractor-args", "youtube:player_client=ios,mweb",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        "--",
        canonicalUrl,
      ],
    },
    {
      name: "Android client fallback",
      args: [
        "-f", selectedFormat,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--concurrent-fragments", "4",
        "--buffer-size", "1024k",
        "--no-update",
        "--max-filesize", `${MAX_DOWNLOAD_BYTES}`,
        "--match-filter", `duration<=${MAX_SECONDS}`,
        "--socket-timeout", "30",
        "--retries", "3",
        "--extractor-args", "youtube:player_client=android",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        "--",
        canonicalUrl,
      ],
    },
  ];

  let lastError = "";

  for (const strategy of strategies) {
    if (onLog) onLog(`Trying: ${strategy.name}...`);

    try {
      const result = await runCommandAsync("yt-dlp", strategy.args, 600000, jobId, onLog);

      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

      // Catch filter skips immediately so we don't stall looping strategies
      if (combinedOutput.includes('does not pass filter (duration<=')) {
        throw new Error(`Video duration exceeds the maximum allowed limit of ${Math.round(Number(MAX_SECONDS) / 60)} minutes. Please update MAX_SECONDS in .env or choose a shorter video.`);
      }
      if (combinedOutput.includes('File is larger than max-filesize')) {
        throw new Error(`Video file size exceeds the allowed MAX_DOWNLOAD_BYTES (${MAX_DOWNLOAD_BYTES}).`);
      }

      if (result.status !== 0) {
        lastError = (result.stderr || result.stdout || "").trim();
        if (onLog) onLog(`Strategy "${strategy.name}" failed: ${lastError.split("\n")[0]}`);
        continue;
      }

      // Success — find the output file
      const stdout = (result.stdout || "").trim();
      const outputPath = stdout.split("\n").pop() || "";

      if (outputPath) {
        const normalizedPath = path.normalize(outputPath.trim());
        if (fs.existsSync(normalizedPath)) {
          return normalizedPath;
        }
      }

      const found = findLatestVideo(outputDir);
      if (found) return found;
    } catch (err) {
      lastError = err.message;
      if (onLog) onLog(`Strategy "${strategy.name}" error: ${lastError}`);
    }
  }

  throw new Error(`Download failed after trying all strategies.\nLast error: ${lastError}`);
}

/**
 * Extract audio from video using FFmpeg
 */
export async function extractAudio(videoPath, outputDir, jobId = null) {
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const audioFile = path.join(outputDir, `${baseName}.wav`);

  if (fs.existsSync(audioFile)) {
    return audioFile;
  }

  const result = await runCommandAsync("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    audioFile,
  ], 600000, jobId);

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`Audio extraction failed: ${stderr || "ffmpeg exited with code " + result.status}`);
  }

  if (!fs.existsSync(audioFile)) {
    throw new Error(`Audio extraction completed but file not found at: ${audioFile}`);
  }

  return audioFile;
}

/**
 * Find the latest video file in a directory
 */
function findLatestVideo(dir) {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter(f =>
    f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")
  );

  if (files.length === 0) return null;

  files.sort((a, b) => {
    const statA = fs.statSync(path.join(dir, a));
    const statB = fs.statSync(path.join(dir, b));
    return statB.mtimeMs - statA.mtimeMs;
  });

  return path.join(dir, files[0]);
}
