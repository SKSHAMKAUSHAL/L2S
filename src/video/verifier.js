// =============================================
// L2S — Media Integrity Verifier (FFprobe Guard)
// =============================================
// Validates rendered clips before reporting success to prevent
// false positives, corrupted containers, and 0-byte output files.

import fs from 'fs';
import { spawn } from 'child_process';
import { spawnTracked } from '../process_manager.js';

/**
 * Verify a media file using FFprobe
 *
 * @param {string} filePath - Absolute path to media file
 * @param {Object} [options] - Verification criteria
 * @param {number} [options.minDuration=0.05] - Minimum duration in seconds
 * @param {number} [options.minSizeBytes=1024] - Minimum file size in bytes
 * @param {boolean} [options.requireAudio=false] - Whether an audio stream is mandatory
 * @returns {Promise<Object>} Verification result
 */
export async function verifyMediaFile(filePath, options = {}) {
  const {
    minDuration = 0.05,
    minSizeBytes = 1024,
    requireAudio = false,
  } = options;

  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path must be a non-empty string' };
  }

  // 1. File existence and basic size check
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `Media file does not exist: ${filePath}` };
  }

  const stat = fs.statSync(filePath);
  if (stat.size < minSizeBytes) {
    return {
      valid: false,
      error: `File size too small (${stat.size} bytes < ${minSizeBytes} bytes required). Output is likely corrupted.`,
      size: stat.size,
    };
  }

  // 2. FFprobe deep container analysis
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate',
      '-of', 'json',
      filePath,
    ];

    const child = spawnTracked ? spawnTracked('ffprobe', args) : spawn('ffprobe', args, { windowsHide: true });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve({ valid: false, error: 'FFprobe verification timed out after 10 seconds' });
    }, 10000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({
          valid: false,
          error: `FFprobe failed with exit code ${code}: ${stderr.trim() || 'Corrupted media container'}`,
        });
      }

      try {
        const probeData = JSON.parse(stdout.trim());
        const duration = parseFloat(probeData.format?.duration);

        if (!Number.isFinite(duration) || duration < minDuration) {
          return resolve({
            valid: false,
            error: `Invalid duration: ${duration}s (must be >= ${minDuration}s)`,
            probeData,
          });
        }

        const streams = probeData.streams || [];
        const videoStream = streams.find(s => s.codec_type === 'video');
        const audioStream = streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          return resolve({ valid: false, error: 'No video stream detected in output container' });
        }

        if (requireAudio && !audioStream) {
          return resolve({ valid: false, error: 'No audio stream detected in output container' });
        }

        const width = parseInt(videoStream.width, 10);
        const height = parseInt(videoStream.height, 10);

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
          return resolve({ valid: false, error: `Invalid video dimensions: ${width}x${height}` });
        }

        resolve({
          valid: true,
          duration,
          size: stat.size,
          width,
          height,
          videoCodec: videoStream.codec_name,
          pixelFormat: videoStream.pix_fmt || null,
          fps: videoStream.r_frame_rate || videoStream.avg_frame_rate || null,
          audioCodec: audioStream ? audioStream.codec_name : null,
          bitrate: parseInt(probeData.format?.bit_rate || '0', 10),
        });
      } catch (parseErr) {
        resolve({
          valid: false,
          error: `Failed to parse FFprobe output: ${parseErr.message}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ valid: false, error: `FFprobe execution error: ${err.message}` });
    });
  });
}
