// =============================================
// L2S — Video Quality & Export Profiles
// =============================================
// Manages distinct Source Download Quality and Final Export Encoding Profiles.
// Enforces technical accuracy: no artificial upscaling claimed as native,
// platform-compatible rate-control (CRF/CQ), yuv420p pixel format, and faststart.

export const SOURCE_QUALITY_PROFILES = {
  best: {
    id: 'best',
    name: 'Best Available',
    label: 'Best Available (Source / Original)',
    format: 'bestvideo+bestaudio/best',
    description: 'Original highest resolution and audio stream without downsampling.',
    maxHeight: 4320,
  },
  '4k': {
    id: '4k',
    name: '4K Ultra HD',
    label: '4K Ultra HD (2160p)',
    format: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best',
    description: 'Native 4K if available (falls back to native source if 4K unavailable).',
    maxHeight: 2160,
  },
  '1440p': {
    id: '1440p',
    name: '1440p QHD',
    label: 'Quad HD (1440p / 2K)',
    format: 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best',
    description: 'High-res 1440p crisp resolution.',
    maxHeight: 1440,
  },
  '1080p': {
    id: '1080p',
    name: '1080p Full HD',
    label: 'Full HD (1080p) — Recommended',
    format: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    description: 'Perfect balance of visual sharpness and download speed for Shorts.',
    maxHeight: 1080,
  },
  '720p': {
    id: '720p',
    name: '720p HD',
    label: 'HD (720p) — Fast Download',
    format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
    description: 'Fast download and processing for quick turnaround.',
    maxHeight: 720,
  },
  '480p': {
    id: '480p',
    name: '480p SD',
    label: 'SD (480p) — Data Saver',
    format: 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
    description: 'Efficient low-bandwidth download for testing.',
    maxHeight: 480,
  },
  '360p': {
    id: '360p',
    name: '360p SD',
    label: 'SD (360p) — Minimal Bandwidth',
    format: 'bestvideo[height<=360]+bestaudio/best[height<=360]/best',
    description: 'Minimum bandwidth download for rough cuts.',
    maxHeight: 360,
  },
  audio: {
    id: 'audio',
    name: 'Audio Only',
    label: 'Audio Only (Voice / Podcast)',
    format: 'bestaudio/best',
    description: 'Extracts speech only without video streams.',
    maxHeight: 0,
  },
};

export const EXPORT_PROFILES = {
  fast: {
    id: 'fast',
    name: 'Fast',
    label: '⚡ Fast (Rapid Draft)',
    description: 'High-speed encoding optimized for rapid previewing and drafting.',
    nvencPreset: 'p1',
    nvencCq: 28,
    cpuPreset: 'veryfast',
    cpuCrf: 26,
    videoBitrate: '6M',
    maxrate: '8M',
    bufsize: '12M',
    audioCodec: 'aac',
    audioBitrate: '128k',
    audioSampleRate: 44100,
    fpsStrategy: 'cfr_30',
    pixelFormat: 'yuv420p',
    summary: 'Fast draft render (H.264 CQ 28 / CRF 26, 128k audio, 30fps CFR)',
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    label: '⚖️ Balanced (Recommended)',
    description: 'Optimal balance of fast rendering, compact file size, and crisp visual clarity.',
    nvencPreset: 'p4',
    nvencCq: 22,
    cpuPreset: 'medium',
    cpuCrf: 22,
    videoBitrate: '8M',
    maxrate: '14M',
    bufsize: '18M',
    audioCodec: 'aac',
    audioBitrate: '192k',
    audioSampleRate: 48000,
    fpsStrategy: 'cfr_preserve_or_30',
    pixelFormat: 'yuv420p',
    summary: 'Optimal clarity & speed (H.264 CQ 22 / CRF 22, 192k audio, fast-start)',
  },
  high: {
    id: 'high',
    name: 'High Quality',
    label: '💎 High Quality (Pristine)',
    description: 'Pristine high-bitrate visual output recommended for YouTube Shorts & Reels.',
    nvencPreset: 'p6',
    nvencCq: 18,
    cpuPreset: 'slow',
    cpuCrf: 18,
    videoBitrate: '12M',
    maxrate: '20M',
    bufsize: '28M',
    audioCodec: 'aac',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    fpsStrategy: 'cfr_preserve_or_60',
    pixelFormat: 'yuv420p',
    summary: 'Pristine Shorts & Reels (H.264 CQ 18 / CRF 18, 256k audio, max 60fps)',
  },
  max: {
    id: 'max',
    name: 'Maximum Quality',
    label: '👑 Maximum (Master Export)',
    description: 'Master studio quality with near-lossless visual fidelity and studio audio.',
    nvencPreset: 'p7',
    nvencCq: 15,
    cpuPreset: 'slower',
    cpuCrf: 15,
    videoBitrate: '18M',
    maxrate: '30M',
    bufsize: '40M',
    audioCodec: 'aac',
    audioBitrate: '320k',
    audioSampleRate: 48000,
    fpsStrategy: 'cfr_preserve',
    pixelFormat: 'yuv420p',
    summary: 'Studio master fidelity (H.264 CQ 15 / CRF 15, 320k audio, near lossless)',
  },
};

/**
 * Get yt-dlp format string for a requested source quality
 */
export function getSourceQualityFormat(id = '1080p') {
  return (SOURCE_QUALITY_PROFILES[id] || SOURCE_QUALITY_PROFILES['1080p']).format;
}

/**
 * Get export profile object by ID with safe fallback to balanced
 */
export function getExportProfile(id = 'balanced') {
  return EXPORT_PROFILES[id] || EXPORT_PROFILES.balanced;
}

/**
 * Analyze yt-dlp formats list to accurately detect available resolutions
 * Prevents false claims of 4K when the source max resolution is lower.
 *
 * @param {Array<Object>} formats - yt-dlp formats array from metadata
 * @returns {Object} Resolution analysis
 */
export function analyzeSourceFormats(formats = []) {
  if (!Array.isArray(formats) || formats.length === 0) {
    return {
      maxHeight: 1080,
      maxResolution: '1080p',
      is4kAvailable: false,
      availableResolutions: ['1080p', '720p', '480p'],
      nativeFps: 30,
      hasAudio: true,
      hasVideo: true,
    };
  }

  const heights = new Set();
  let maxFps = 30;
  let hasAudioStream = false;
  let hasVideoStream = false;

  for (const f of formats) {
    if (f.vcodec && f.vcodec !== 'none') {
      hasVideoStream = true;
      if (typeof f.height === 'number' && f.height > 0) {
        heights.add(f.height);
      }
      if (typeof f.fps === 'number' && f.fps > maxFps) {
        maxFps = f.fps;
      }
    }
    if (f.acodec && f.acodec !== 'none') {
      hasAudioStream = true;
    }
  }

  const sortedHeights = Array.from(heights).sort((a, b) => b - a);
  const maxHeight = sortedHeights[0] || 1080;
  const is4kAvailable = maxHeight >= 2160;

  const availableResolutions = [];
  if (sortedHeights.some(h => h >= 2160)) availableResolutions.push('4k');
  if (sortedHeights.some(h => h >= 1440)) availableResolutions.push('1440p');
  if (sortedHeights.some(h => h >= 1080)) availableResolutions.push('1080p');
  if (sortedHeights.some(h => h >= 720)) availableResolutions.push('720p');
  if (sortedHeights.some(h => h >= 480)) availableResolutions.push('480p');
  if (sortedHeights.some(h => h >= 360)) availableResolutions.push('360p');

  let maxResolution = '1080p';
  if (maxHeight >= 2160) maxResolution = '4K (2160p)';
  else if (maxHeight >= 1440) maxResolution = '2K (1440p)';
  else if (maxHeight >= 1080) maxResolution = '1080p Full HD';
  else if (maxHeight >= 720) maxResolution = '720p HD';
  else maxResolution = `${maxHeight}p SD`;

  return {
    maxHeight,
    maxResolution,
    is4kAvailable,
    availableResolutions: availableResolutions.length > 0 ? availableResolutions : ['1080p', '720p', '480p'],
    nativeFps: Math.round(maxFps),
    hasAudio: hasAudioStream,
    hasVideo: hasVideoStream,
  };
}

/**
 * Validate a requested source quality against detected metadata
 * Prevents promising 4K when the source video does not support it.
 *
 * @param {string} requested - Quality ID requested by user ('4k', '1080p', '720p', etc.)
 * @param {Object} metadata - Analysis from analyzeSourceFormats
 * @returns {Object} Validation and adjustment verdict
 */
export function validateSourceResolution(requested = '1080p', metadata = {}) {
  const maxHeight = metadata.maxHeight || 1080;
  const requestedProfile = SOURCE_QUALITY_PROFILES[requested] || SOURCE_QUALITY_PROFILES['1080p'];

  if (requested === 'best' || requested === 'audio') {
    return {
      effectiveQuality: requested,
      wasAdjusted: false,
      reason: requested === 'audio' ? 'Audio-only stream extraction' : `Native source maximum resolution (${maxHeight}p)`,
    };
  }

  const targetHeight = requestedProfile.maxHeight;
  if (targetHeight > maxHeight) {
    // Requested resolution exceeds source native quality
    let adjusted = '1080p';
    if (maxHeight >= 1080) adjusted = '1080p';
    else if (maxHeight >= 720) adjusted = '720p';
    else adjusted = '480p';

    return {
      effectiveQuality: adjusted,
      wasAdjusted: true,
      reason: `Source video max resolution is ${maxHeight}p. Downloading in native ${adjusted} without artificial upscaling.`,
    };
  }

  return {
    effectiveQuality: requested,
    wasAdjusted: false,
    reason: `Source video supports requested ${requestedProfile.name} natively.`,
  };
}

