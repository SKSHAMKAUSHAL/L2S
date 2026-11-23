// =============================================
// Cache Manager — Multi-Factor Intelligent Caching
// =============================================
// Prevents redundant downloads & transcriptions while ensuring
// cache keys incorporate models, engine versions, and options to
// avoid serving stale results when user settings change.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export class CacheManager {
  constructor(cacheDir = process.env.CACHE_DIR || path.join(process.cwd(), 'temp', 'cache')) {
    this.cacheDir = cacheDir;
    this.transcriptCache = path.join(cacheDir, 'transcripts');
    this.downloadCache = path.join(cacheDir, 'downloads');
    this.metadataCache = path.join(cacheDir, 'metadata');
    this.maxCacheBytes = 5 * 1024 * 1024 * 1024; // 5 GB max cache size

    [this.transcriptCache, this.downloadCache, this.metadataCache].forEach(dir => {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        // Silently handle if permission restricted
      }
    });
  }

  /**
   * Generate multi-factor composite cache key
   * Incorporates source identity, parameters, engine version, and model
   *
   * @param {string} source - Source identifier (URL, path, or audio identifier)
   * @param {Object} [params={}] - Options (model, engine, genre, quality, etc.)
   * @returns {string} 24-character hexadecimal cache hash
   */
  generateKey(source, params = {}) {
    // Sort keys for deterministic hashing
    const sorted = Object.keys(params).sort().reduce((acc, k) => {
      if (params[k] !== undefined && params[k] !== null) {
        acc[k] = params[k];
      }
      return acc;
    }, {});

    const payload = `${String(source || '')}::${JSON.stringify(sorted)}`;
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  /**
   * Write data atomically to disk (write to .tmp then rename)
   */
  atomicWrite(filePath, data) {
    const tempPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tempPath, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Retrieve transcript if cached and still fresh
   */
  getTranscript(source, params = {}) {
    try {
      const key = this.generateKey(source, params);
      const cacheFile = path.join(this.transcriptCache, `${key}.json`);

      if (fs.existsSync(cacheFile)) {
        const stats = fs.statSync(cacheFile);
        const age = Date.now() - stats.mtimeMs;
        const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

        if (age < MAX_AGE) {
          const raw = fs.readFileSync(cacheFile, 'utf-8');
          return JSON.parse(raw);
        } else {
          try { fs.unlinkSync(cacheFile); } catch (e) {}
        }
      }
    } catch (err) {
      console.warn(`[Cache] Error reading transcript cache:`, err.message);
    }
    return null;
  }

  /**
   * Atomically save transcript to cache
   */
  saveTranscript(source, params = {}, transcript) {
    try {
      const key = this.generateKey(source, params);
      const cacheFile = path.join(this.transcriptCache, `${key}.json`);
      this.atomicWrite(cacheFile, transcript);
    } catch (err) {
      console.warn(`[Cache] Error saving transcript cache:`, err.message);
    }
  }

  /**
   * Retrieve cached video download path
   */
  getDownload(url, quality = 'high') {
    try {
      const key = this.generateKey(url, { quality });
      const cacheFile = path.join(this.downloadCache, `${key}.json`);

      if (fs.existsSync(cacheFile)) {
        const metadata = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (metadata?.path && fs.existsSync(metadata.path)) {
          const age = Date.now() - (metadata.timestamp || 0);
          const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

          if (age < MAX_AGE) {
            return metadata.path;
          }
        }
        try { fs.unlinkSync(cacheFile); } catch (e) {}
      }
    } catch (err) {
      console.warn(`[Cache] Error reading download cache:`, err.message);
    }
    return null;
  }

  /**
   * Save download reference to cache
   */
  saveDownload(url, quality = 'high', filePath) {
    try {
      if (!fs.existsSync(filePath)) return;
      const key = this.generateKey(url, { quality });
      const cacheFile = path.join(this.downloadCache, `${key}.json`);
      const metadata = {
        url,
        quality,
        path: filePath,
        filename: path.basename(filePath),
        timestamp: Date.now(),
        size: fs.statSync(filePath).size,
      };
      this.atomicWrite(cacheFile, metadata);
    } catch (err) {
      console.warn(`[Cache] Error saving download cache:`, err.message);
    }
  }

  /**
   * Enforce storage quota on cache directory
   */
  enforceCacheQuota() {
    try {
      let totalBytes = 0;
      const entries = [];

      [this.transcriptCache, this.downloadCache, this.metadataCache].forEach(dir => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fullPath = path.join(dir, f);
          try {
            const st = fs.statSync(fullPath);
            if (st.isFile()) {
              totalBytes += st.size;
              entries.push({ path: fullPath, size: st.size, mtime: st.mtimeMs });
            }
          } catch (e) {}
        }
      });

      if (totalBytes > this.maxCacheBytes) {
        // Sort oldest first
        entries.sort((a, b) => a.mtime - b.mtime);
        while (totalBytes > this.maxCacheBytes && entries.length > 0) {
          const oldest = entries.shift();
          try {
            fs.unlinkSync(oldest.path);
            totalBytes -= oldest.size;
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('[Cache] Quota enforcement failed:', e.message);
    }
  }
}

export const defaultCacheManager = new CacheManager();
