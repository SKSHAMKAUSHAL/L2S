/**
 * src/security/url.js
 * Strict validation and normalization for YouTube URLs.
 * Mitigates SSRF, parameter injection, command injection, and unwanted formats.
 */

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Validates and normalizes a user-provided YouTube URL.
 * @param {string} input 
 * @returns {{ valid: boolean, videoId: string, canonicalUrl: string }}
 * @throws {Error} if invalid
 */
export function validateYouTubeUrl(input) {
  if (typeof input !== 'string') {
    throw new Error('URL must be a string');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('URL cannot be empty');
  }

  if (trimmed.length > 2048) {
    throw new Error('URL exceeds maximum length of 2048 characters');
  }

  // Reject strings starting with '-' to prevent CLI option injection
  if (trimmed.startsWith('-')) {
    throw new Error('URL cannot begin with a dash');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Malformed URL');
  }

  // Enforce HTTPS
  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol '${parsed.protocol}'. Only HTTPS is permitted.`);
  }

  // Disallow userinfo (e.g. https://user@youtube.com)
  if (parsed.username || parsed.password) {
    throw new Error('URLs with userinfo credentials are not permitted');
  }

  // Disallow custom ports
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Custom ports are not permitted');
  }

  // Host must strictly match allowed list
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`Host '${hostname}' is not an authorized YouTube domain`);
  }

  // Reject playlist parameters or URLs
  if (parsed.pathname.startsWith('/playlist') || parsed.searchParams.has('list')) {
    throw new Error('Playlists are not supported. Please supply an individual video URL.');
  }

  let videoId = null;

  if (hostname === 'youtu.be') {
    // Format: https://youtu.be/<videoId>
    const segment = parsed.pathname.slice(1).split('/')[0];
    if (segment && VIDEO_ID_REGEX.test(segment)) {
      videoId = segment;
    }
  } else {
    // Format: https://www.youtube.com/watch?v=<videoId>
    if (parsed.searchParams.has('v')) {
      const v = parsed.searchParams.get('v');
      if (VIDEO_ID_REGEX.test(v)) {
        videoId = v;
      }
    } else if (parsed.pathname.startsWith('/shorts/')) {
      const segment = parsed.pathname.replace('/shorts/', '').split('/')[0];
      if (VIDEO_ID_REGEX.test(segment)) {
        videoId = segment;
      }
    } else if (parsed.pathname.startsWith('/embed/')) {
      const segment = parsed.pathname.replace('/embed/', '').split('/')[0];
      if (VIDEO_ID_REGEX.test(segment)) {
        videoId = segment;
      }
    } else if (parsed.pathname.startsWith('/v/')) {
      const segment = parsed.pathname.replace('/v/', '').split('/')[0];
      if (VIDEO_ID_REGEX.test(segment)) {
        videoId = segment;
      }
    }
  }

  if (!videoId) {
    throw new Error('Could not extract a valid 11-character YouTube video ID');
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return {
    valid: true,
    platform: 'youtube',
    videoId,
    canonicalUrl,
  };
}

const ALLOWED_INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

const IG_SHORTCODE_REGEX = /^[a-zA-Z0-9_-]{5,50}$/;

/**
 * Validates and normalizes an Instagram Reel or post URL.
 * @param {string} input 
 * @returns {{ valid: boolean, platform: string, shortcode: string, canonicalUrl: string }}
 */
export function validateInstagramUrl(input) {
  if (typeof input !== 'string') {
    throw new Error('URL must be a string');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('URL cannot be empty');
  }

  if (trimmed.length > 2048) {
    throw new Error('URL exceeds maximum length of 2048 characters');
  }

  if (trimmed.startsWith('-')) {
    throw new Error('URL cannot begin with a dash');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Malformed URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol '${parsed.protocol}'. Only HTTPS is permitted.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with userinfo credentials are not permitted');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error('Custom ports are not permitted');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_INSTAGRAM_HOSTS.has(hostname)) {
    throw new Error(`Host '${hostname}' is not an authorized Instagram domain`);
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Invalid Instagram URL path. Expected reel, post, or video URL.');
  }

  const type = parts[0].toLowerCase();
  const shortcode = parts[1];

  if (!['reel', 'reels', 'p', 'tv'].includes(type) || !IG_SHORTCODE_REGEX.test(shortcode)) {
    throw new Error('Invalid Instagram reel or post shortcode');
  }

  const normalizedType = type === 'reels' ? 'reel' : type;
  const canonicalUrl = `https://www.instagram.com/${normalizedType}/${shortcode}/`;

  return {
    valid: true,
    platform: 'instagram',
    shortcode,
    canonicalUrl,
  };
}

/**
 * Validates any supported media URL (YouTube or Instagram).
 * @param {string} input 
 * @returns {{ valid: boolean, platform: 'youtube'|'instagram', id: string, canonicalUrl: string }}
 */
export function validateMediaUrl(input) {
  if (typeof input !== 'string') {
    throw new Error('URL must be a string');
  }
  const trimmed = input.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Malformed URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(hostname)) {
    const res = validateYouTubeUrl(input);
    return {
      valid: true,
      platform: 'youtube',
      id: res.videoId,
      canonicalUrl: res.canonicalUrl,
    };
  }

  if (ALLOWED_INSTAGRAM_HOSTS.has(hostname)) {
    const res = validateInstagramUrl(input);
    return {
      valid: true,
      platform: 'instagram',
      id: res.shortcode,
      canonicalUrl: res.canonicalUrl,
    };
  }

  throw new Error(`Host '${hostname}' is not supported. Please supply a valid YouTube or Instagram link.`);
}
