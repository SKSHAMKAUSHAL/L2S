// =============================================
// SKATE — Downloader (yt-dlp + FFmpeg)
// Fixed: 403 errors, cookies, retry logic
// =============================================

import path from "path";
import fs from "fs";
import os from "os";
import { spawnTracked } from "./process_manager.js";

// Find local cookies.txt if provided by user in standard project locations
function findCookiesFile() {
  const possiblePaths = [
    path.join(process.cwd(), "cookies.txt"),
    path.join(process.cwd(), "youtube_cookies.txt"),
    path.join(process.cwd(), "temp", "cookies.txt"),
    path.join(os.homedir(), "cookies.txt"),
    path.join(os.homedir(), "Downloads", "cookies.txt"),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

// Order candidate browsers prioritizing those without DPAPI issues on Windows (Firefox first)
function getCandidateBrowsers() {
  return ["firefox", "chrome", "edge", "brave", "opera", "chromium", "safari", "vivaldi"];
}

// Export detectBrowser for backwards compatibility
export function detectBrowser() {
  return "firefox";
}

export function runCommandAsync(command, args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args);
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fetch YouTube video metadata asynchronously without blocking the event loop
 *
 * @param {string} url - YouTube URL
 * @param {number} [timeoutMs=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} Metadata object
 */
export async function fetchVideoInfoAsync(url, timeoutMs = 30000) {
  if (!url || typeof url !== 'string') throw new Error('URL is required');
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith('-') || cleanUrl.startsWith('/dev/')) {
    throw new Error('Invalid URL format');
  }

  // Strategy 1: modern default client (fast, non-blocking)
  let res = await runCommandAsync('yt-dlp', [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=mediaconnect',
    '--no-check-certificates',
    '--',
    cleanUrl,
  ], timeoutMs);

  // Strategy 2: browser cookies fallback
  if (res.status !== 0) {
    res = await runCommandAsync('yt-dlp', [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--cookies-from-browser', 'chrome',
      '--no-check-certificates',
      '--',
      cleanUrl,
    ], timeoutMs);
  }

  if (res.status !== 0) {
    throw new Error(`Could not fetch video info: ${res.stderr?.trim() || 'yt-dlp exited with code ' + res.status}`);
  }

  return JSON.parse(res.stdout.trim());
}

/**
 * Download video from YouTube using yt-dlp
 * Handles 403 errors, DPAPI decryption errors, and bot restrictions
 * @param {string} url - YouTube URL
 * @param {string} outputDir - Output directory
 * @param {Function} onLog - Logging callback
 * @param {string} quality - Video quality: 'high' (best available), 'medium' (1080p), or 'fast' (720p)
 */
export async function downloadVideo(url, outputDir, onLog, quality = 'high') {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");

  // Quality format strings from quality_profiles
  const qualityFormats = {
    best: "bestvideo+bestaudio/best",
    '4k': "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best",
    '1440p': "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best",
    '1080p': "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    '720p': "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    high: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
    medium: "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    fast: "bestvideo[height<=720]+bestaudio/best[height<=720]/best[ext=mp4]/best",
  };

  const selectedFormat = qualityFormats[quality] || qualityFormats['1080p'] || qualityFormats.high;
  onLog?.(`📥 Download profile: ${quality || '1080p'} — Target: ${selectedFormat}`);

  const commonArgs = [
    "-f", selectedFormat,
    "--merge-output-format", "mp4",
    "--no-check-certificates",
    "-o", outputTemplate,
    "--print", "after_move:filepath",
    "--no-simulate",
    "--no-warnings",
  ];

  const strategies = [
    {
      name: "Standard download",
      args: [...commonArgs, url],
    },
    {
      name: "iOS & Mobile Web client",
      args: [
        "-f", selectedFormat,
        "--merge-output-format", "mp4",
        "--extractor-args", "youtube:player_client=ios,mweb",
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    },
  ];

  // Check if local cookies file exists
  const cookiesFile = findCookiesFile();
  if (cookiesFile) {
    strategies.push({
      name: `Local cookies file (${path.basename(cookiesFile)})`,
      args: [
        "-f", selectedFormat,
        "--merge-output-format", "mp4",
        "--cookies", cookiesFile,
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    });
  }

  // Add browser cookie strategies (Firefox first to avoid Windows DPAPI restriction)
  for (const browser of getCandidateBrowsers()) {
    strategies.push({
      name: `With ${browser} cookies`,
      browser,
      args: [
        "-f", selectedFormat,
        "--merge-output-format", "mp4",
        "--cookies-from-browser", browser,
        "--no-check-certificates",
        "-o", outputTemplate,
        "--print", "after_move:filepath",
        "--no-simulate",
        "--no-warnings",
        url,
      ],
    });
  }

  // Android client fallback
  strategies.push({
    name: "Android client fallback",
    args: [
      "-f", selectedFormat,
      "--merge-output-format", "mp4",
      "--extractor-args", "youtube:player_client=android",
      "--no-check-certificates",
      "-o", outputTemplate,
      "--print", "after_move:filepath",
      "--no-simulate",
      "--no-warnings",
      url,
    ],
  });

  // Audio-only fallback
  strategies.push({
    name: "Audio-only fallback",
    args: [
      "-f", "bestaudio/best",
      "-x", "--audio-format", "mp3",
      "--no-check-certificates",
      "-o", outputTemplate,
      url,
    ],
  });

  let lastError = "";

  for (const strategy of strategies) {
    if (onLog) onLog(`Trying: ${strategy.name}...`);

    try {
      const result = await runCommandAsync("yt-dlp", strategy.args, 600000);

      if (result.status !== 0) {
        lastError = (result.stderr || "").trim();

        // Catch DPAPI decryption errors specific to Windows Chrome 127+
        if (lastError.includes("Failed to decrypt with DPAPI")) {
          if (onLog) {
            onLog(`Strategy "${strategy.name}" skipped due to DPAPI restriction. Trying next strategy...`);
          }
          continue;
        }

        // Browser not installed / cookies unreadable
        if (
          lastError.includes("Could not copy Chrome cookie database") ||
          lastError.includes("No browser found") ||
          lastError.includes("could not find browser") ||
          lastError.includes("KeyError")
        ) {
          if (onLog) onLog(`Strategy "${strategy.name}" skipped (${strategy.browser || "browser"} cookies not available). Trying next...`);
          continue;
        }

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

      // Try to find file in output directory
      const found = findLatestVideo(outputDir);
      if (found) return found;
    } catch (err) {
      lastError = err.message;
      if (onLog) onLog(`Strategy "${strategy.name}" error: ${lastError}`);
    }
  }

  // All strategies failed
  throw new Error(
    `Download failed after trying all strategies.\n` +
    `Last error: ${lastError}\n\n` +
    `💡 Tips to resolve YouTube download issues:\n` +
    `   1. Open YouTube in Firefox and log in (Firefox cookies work without DPAPI restrictions).\n` +
    `   2. Or export YouTube cookies and save as cookies.txt in the project folder.\n` +
    `   3. Update yt-dlp: pip install --upgrade yt-dlp`
  );
}

/**
 * Extract audio from video using FFmpeg
 */
export async function extractAudio(videoPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const audioFile = path.join(outputDir, `${baseName}.wav`);

  // Skip if already extracted
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
  ], 600000);

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
