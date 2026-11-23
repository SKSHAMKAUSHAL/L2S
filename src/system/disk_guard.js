// =============================================
// L2S — Disk Space Guard & Resource Limits
// =============================================
// Monitors storage availability, prevents runaway disk exhaustion,
// enforces max media sizes, and safely cleans temporary job files.

import fs from 'fs';
import path from 'path';

export const MIN_FREE_DISK_BYTES = 500 * 1024 * 1024; // 500 MB minimum
export const MAX_INPUT_FILE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB maximum

/**
 * Get available free disk space in bytes for a target directory
 *
 * @param {string} targetPath - Path to directory or file
 * @returns {number} Available free space in bytes
 */
export function getFreeDiskSpace(targetPath = '.') {
  try {
    const checkPath = fs.existsSync(targetPath) ? targetPath : path.dirname(targetPath);
    const stats = fs.statfsSync(checkPath);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch (err) {
    // If statfs fails on rare virtual mount, fallback to 10GB safe assumption
    return 10 * 1024 * 1024 * 1024;
  }
}

/**
 * Ensure sufficient disk space exists before initiating heavy operations
 *
 * @param {string} targetPath - Destination path
 * @param {number} [requiredBytes=MIN_FREE_DISK_BYTES] - Required bytes
 * @throws {Error} If disk space is below required threshold
 */
export function ensureSufficientDiskSpace(targetPath = '.', requiredBytes = MIN_FREE_DISK_BYTES) {
  const freeBytes = getFreeDiskSpace(targetPath);
  if (freeBytes < requiredBytes) {
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    const requiredMB = Math.round(requiredBytes / (1024 * 1024));
    const err = new Error(`Insufficient disk space: Only ${freeMB} MB free on disk, but at least ${requiredMB} MB is required for video processing.`);
    err.code = 'DISK_FULL';
    err.freeBytes = freeBytes;
    err.requiredBytes = requiredBytes;
    throw err;
  }
  return true;
}

/**
 * Validate that a file does not exceed maximum allowable size limit
 *
 * @param {string} filePath - Path to file
 * @param {number} [maxBytes=MAX_INPUT_FILE_BYTES] - Maximum allowed size
 * @throws {Error} If file exceeds limit
 */
export function validateFileSize(filePath, maxBytes = MAX_INPUT_FILE_BYTES) {
  if (!fs.existsSync(filePath)) return true;
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    const sizeMB = Math.round(stat.size / (1024 * 1024));
    const maxMB = Math.round(maxBytes / (1024 * 1024));
    const err = new Error(`File size (${sizeMB} MB) exceeds maximum allowed limit (${maxMB} MB).`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  return true;
}

/**
 * Safely clean temporary files owned by a job without touching user source media
 *
 * @param {string} dirPath - Directory to clean
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - Only delete files with these extensions (e.g. ['.tmp', '.wav'])
 * @param {number} [options.maxAgeMs] - Only delete files older than this duration
 * @param {string} [options.protectedFile] - Explicitly protect this file from deletion
 */
export function safeCleanupDirectory(dirPath, options = {}) {
  const { extensions = null, maxAgeMs = null, protectedFile = null } = options;

  if (!fs.existsSync(dirPath)) return 0;

  let cleanedCount = 0;
  try {
    const files = fs.readdirSync(dirPath);
    const now = Date.now();

    for (const file of files) {
      const fullPath = path.join(dirPath, file);

      // Never delete protected source file(s)
      if (protectedFile) {
        const protectedList = Array.isArray(protectedFile) ? protectedFile : [protectedFile];
        if (protectedList.some(p => path.resolve(fullPath) === path.resolve(p))) {
          continue;
        }
      }

      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        // Extension filter
        if (extensions && !extensions.some(ext => file.endsWith(ext))) {
          continue;
        }

        // Age filter
        if (maxAgeMs !== null && (now - stat.mtimeMs) < maxAgeMs) {
          continue;
        }

        fs.unlinkSync(fullPath);
        cleanedCount++;
      } catch (e) {
        // Ignore single file locked/in-use errors
      }
    }
  } catch (dirErr) {
    console.warn(`[DiskGuard] Directory read failed during cleanup: ${dirErr.message}`);
  }

  return cleanedCount;
}
