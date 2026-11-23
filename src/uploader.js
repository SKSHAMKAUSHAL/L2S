// =============================================
// SKATE — Social Media Uploader
// =============================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getYouTubeToken, getInstagramToken } from './auth.js';

// ─── Template Variable Substitution ──────────

/**
 * Replace template variables in user-configured text
 * Supports: {title}, {description}, {hashtags}, {caption}, {clipNum}
 */
function applyTemplate(template, clip, clipIndex) {
  if (!template) return '';
  return template
    .replace(/\{title\}/gi, clip.title || '')
    .replace(/\{description\}/gi, clip.description || '')
    .replace(/\{hashtags\}/gi, clip.hashtags || '')
    .replace(/\{caption\}/gi, clip.caption || '')
    .replace(/\{clipNum\}/gi, String(clipIndex + 1));
}

// ─── YouTube Daily Upload Quota Tracker ──────
// YouTube Data API v3 costs 1,600 units per upload.
// The daily quota is 10,000 units, so max ~6 uploads per day.

const YOUTUBE_DAILY_QUOTA = 10000;
const YOUTUBE_UPLOAD_COST = 1600;
const MAX_UPLOADS_PER_DAY = Math.floor(YOUTUBE_DAILY_QUOTA / YOUTUBE_UPLOAD_COST); // = 6

const QUOTA_FILE = path.join(os.homedir(), '.skate', 'yt_quota.json');

function getTodayKey() {
  // YouTube quota resets at midnight Pacific Time (UTC-8 / UTC-7 DST)
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return `${pacific.getFullYear()}-${String(pacific.getMonth() + 1).padStart(2, '0')}-${String(pacific.getDate()).padStart(2, '0')}`;
}

function loadQuotaData() {
  try {
    if (fs.existsSync(QUOTA_FILE)) {
      return JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveQuotaData(data) {
  try {
    fs.mkdirSync(path.dirname(QUOTA_FILE), { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

/**
 * Get today's YouTube upload stats (pacific time reset)
 * @returns {{ uploadsToday: number, unitsUsed: number, unitsRemaining: number, maxUploads: number, resetKey: string }}
 */
export function getYouTubeQuotaStatus() {
  const data = loadQuotaData();
  const today = getTodayKey();
  const uploadsToday = data[today] || 0;
  const unitsUsed = uploadsToday * YOUTUBE_UPLOAD_COST;
  return {
    uploadsToday,
    unitsUsed,
    unitsRemaining: Math.max(0, YOUTUBE_DAILY_QUOTA - unitsUsed),
    maxUploads: MAX_UPLOADS_PER_DAY,
    resetKey: today,
    isAtLimit: uploadsToday >= MAX_UPLOADS_PER_DAY,
  };
}

function incrementYouTubeUploadCount() {
  const data = loadQuotaData();
  const today = getTodayKey();
  data[today] = (data[today] || 0) + 1;
  // Clean old keys (keep only last 7 days)
  const keys = Object.keys(data).sort().reverse();
  if (keys.length > 7) {
    keys.slice(7).forEach(k => delete data[k]);
  }
  saveQuotaData(data);
  return data[today];
}

// ─── YouTube Shorts Upload ───────────────────

/**
 * Upload a video to YouTube as a Short
 * Uses YouTube Data API v3 resumable upload
 *
 * @param {string} filePath - Absolute path to the .mp4 file
 * @param {Object} metadata - { title, description, tags, audience, visibility }
 * @param {Object} clip - Clip data with AI-generated social content
 * @param {number} clipIndex - Clip index for template substitution
 * @param {Function} onProgress - Progress callback
 * @returns {Object} { success, videoId, url, error }
 */
export async function uploadToYouTube(filePath, metadata, clip, clipIndex, onProgress) {
  const accessToken = await getYouTubeToken();
  if (!accessToken) {
    return { success: false, error: 'YouTube not connected or token expired. Please reconnect.' };
  }

  // ─── Daily Quota Pre-Check ─────────────────
  const quotaStatus = getYouTubeQuotaStatus();
  if (quotaStatus.isAtLimit) {
    const msg = `YouTube daily upload limit reached (${quotaStatus.uploadsToday}/${quotaStatus.maxUploads} uploads used today). Quota resets at midnight Pacific Time.`;
    onProgress?.(`⛔ ${msg}`);
    return { success: false, error: msg, quotaExceeded: true };
  }

  onProgress?.(`📊 YouTube quota: ${quotaStatus.uploadsToday}/${quotaStatus.maxUploads} uploads used today (${quotaStatus.unitsRemaining} units remaining)`);

  try {
    // Resolve file path (support both absolute and relative paths)
    let resolvedPath = filePath;
    if (!path.isAbsolute(filePath)) {
      resolvedPath = path.resolve(filePath);
    }

    // Verify file exists before attempting upload
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Video file not found at: ${resolvedPath}`);
    }

    // Apply templates with safe defaults
    const meta = metadata || {};
    let title = (meta.title ? applyTemplate(meta.title, clip, clipIndex) : null) || clip.title || `Clip ${clipIndex + 1}`;
    let description = (meta.description ? applyTemplate(meta.description, clip, clipIndex) : null) || clip.description || (clip.caption ? `${clip.caption}\n\n${clip.hashtags || ''}` : '');
    const tagsStr = (meta.tags ? applyTemplate(meta.tags, clip, clipIndex) : null) || clip.hashtags || '';
    const tags = tagsStr.replace(/#/g, '').split(/[,\s]+/).map(t => t.trim()).filter(Boolean);

    // Ensure #Shorts is in the title for YouTube Shorts
    if (!title.toLowerCase().includes('#shorts')) {
      title = `${title} #Shorts`;
    }

    // Ensure title is within limits (trim BEFORE adding #Shorts to avoid exceeding 100)
    const baseTitle = title.replace(/ #Shorts$/i, '').slice(0, 85);
    title = baseTitle.toLowerCase().includes('#shorts') ? baseTitle : `${baseTitle} #Shorts`;
    description = description.slice(0, 5000);

    const madeForKids = meta.audience === 'kids';
    const privacyStatus = meta.visibility || 'public';

    const fileBuffer = fs.readFileSync(resolvedPath);
    const fileSize = fileBuffer.length;

    // Step 1: Initialize resumable upload
    onProgress?.(`📤 Initializing YouTube upload for clip ${clipIndex + 1}...`);

    const videoMetadata = {
      snippet: {
        title,
        description,
        tags: tags.length > 0 ? tags : ['shorts', 'viral'],
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: madeForKids,
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': fileSize.toString(),
        },
        body: JSON.stringify(videoMetadata),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      // Check for quota exceeded specifically
      if (initRes.status === 403 && (errText.includes('quotaExceeded') || errText.includes('forbidden'))) {
        const msg = `YouTube API daily quota exceeded. You have used all 10,000 units for today. Quota resets at midnight Pacific Time.`;
        onProgress?.(`⛔ ${msg}`);
        return { success: false, error: msg, quotaExceeded: true };
      }
      throw new Error(`YouTube upload init failed: ${errText}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('No upload URL returned from YouTube');

    // Step 2: Upload the video file (using Buffer for 100% reliable PUT transfer)
    onProgress?.(`⬆️  Uploading video to YouTube (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize.toString(),
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      if (uploadRes.status === 403 && errText.includes('quotaExceeded')) {
        return {
          success: false,
          error: 'YouTube API daily quota exceeded. Resets at midnight Pacific Time.',
          quotaExceeded: true,
        };
      }
      throw new Error(`YouTube upload failed: ${errText}`);
    }

    const uploadData = await uploadRes.json();
    const videoId = uploadData.id;

    // ─── Track successful upload ───────────
    const totalToday = incrementYouTubeUploadCount();
    const remaining = MAX_UPLOADS_PER_DAY - totalToday;
    onProgress?.(`✅ YouTube upload complete! Video ID: ${videoId}`);
    onProgress?.(`📊 Daily uploads: ${totalToday}/${MAX_UPLOADS_PER_DAY} used. ${remaining} upload${remaining !== 1 ? 's' : ''} remaining today.`);

    return {
      success: true,
      videoId,
      url: `https://youtube.com/shorts/${videoId}`,
      quotaStatus: getYouTubeQuotaStatus(),
    };
  } catch (err) {
    onProgress?.(`❌ YouTube upload failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Instagram Reels Upload ──────────────────

/**
 * Upload a video to Instagram as a Reel
 * Uses Instagram Graph API media container workflow
 *
 * @param {string} fileUrl - Public URL of the video (must be accessible from Meta servers)
 * @param {Object} metadata - { caption, hashtags }
 * @param {Object} clip - Clip data with AI-generated social content
 * @param {number} clipIndex - Clip index for template substitution
 * @param {Function} onProgress - Progress callback
 * @returns {Object} { success, mediaId, url, error }
 */
export async function uploadToInstagram(fileUrl, metadata, clip, clipIndex, onProgress) {
  const igAuth = getInstagramToken();
  if (!igAuth) {
    return { success: false, error: 'Instagram not connected or token expired. Please reconnect.' };
  }

  // ─── Localhost Detection ──────────────────
  // Instagram Graph API requires a publicly accessible URL.
  // localhost/127.0.0.1 will always fail.
  if (fileUrl.includes('localhost') || fileUrl.includes('127.0.0.1')) {
    const msg = 'Instagram requires a public URL for video uploads. localhost is not accessible from Meta servers. Use a tunnel (ngrok, Cloudflare Tunnel) to expose your local server to the internet.';
    onProgress?.(`⚠️  ${msg}`);
    return { success: false, error: msg, localUrlError: true };
  }

  // ─── Business Account Check ───────────────
  if (!igAuth.igUserId) {
    const msg = 'Instagram Business/Creator Account not found. Your Instagram account must be a Business or Creator account linked to a Facebook Page. Personal accounts cannot publish via API.';
    onProgress?.(`⛔ ${msg}`);
    return { success: false, error: msg, noBusinessAccount: true };
  }

  const { accessToken, igUserId } = igAuth;

  try {
    // Build caption from template
    let caption = applyTemplate(metadata.caption, clip, clipIndex) || clip.caption || '';
    const extraHashtags = applyTemplate(metadata.hashtags, clip, clipIndex) || '';

    if (extraHashtags) {
      caption = `${caption}\n\n${extraHashtags}`;
    }

    // Add clip hashtags if not already present
    if (clip.hashtags && !caption.includes(clip.hashtags)) {
      caption = `${caption}\n${clip.hashtags}`;
    }

    caption = caption.slice(0, 2200); // Instagram caption limit

    // Step 1: Create media container
    onProgress?.(`📤 Creating Instagram Reel container for clip ${clipIndex + 1}...`);

    const containerUrl = `https://graph.facebook.com/v21.0/${igUserId}/media`;
    const containerRes = await fetch(containerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: fileUrl,
        caption,
        access_token: accessToken,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`IG container creation failed: ${err}`);
    }

    const containerData = await containerRes.json();
    const containerId = containerData.id;

    // Step 2: Poll for container to be ready
    onProgress?.(`⏳ Waiting for Instagram to process video...`);

    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 60; // ~5 minutes with 5s intervals

    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      const statusRes = await fetch(
        `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        status = statusData.status_code;

        if (status === 'ERROR') {
          throw new Error('Instagram media processing failed');
        }
      }

      if (attempts % 6 === 0) {
        onProgress?.(`   Still processing... (${attempts * 5}s elapsed)`);
      }
    }

    if (status !== 'FINISHED') {
      throw new Error(`Instagram processing timeout after ${maxAttempts * 5}s`);
    }

    // Step 3: Publish the container
    onProgress?.(`📱 Publishing Reel to Instagram...`);

    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`IG publish failed: ${err}`);
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;

    onProgress?.(`✅ Instagram Reel published! Media ID: ${mediaId}`);

    return {
      success: true,
      mediaId,
      url: `https://www.instagram.com/reel/${mediaId}/`,
    };
  } catch (err) {
    onProgress?.(`❌ Instagram upload failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Publish Clips to All Platforms ──────────

/**
 * Publish multiple clips to connected platforms
 *
 * @param {Array} clips - Array of clip data with social content
 * @param {Array} files - Array of file paths/URLs for rendered clips
 * @param {Object} workflow - { instagram: { caption, hashtags }, youtube: { title, description, tags, audience, visibility } }
 * @param {string} rootDir - Project root directory
 * @param {Function} broadcast - WebSocket broadcast function
 * @returns {Object} { results: [...], summary }
 */
export async function publishClips(clips, files, workflow, rootDir, broadcast) {
  const results = [];
  const totalClips = clips.length;
  let successCount = 0;

  broadcast({ type: 'log', level: 'info', msg: `📤 Starting publish: ${totalClips} clips` });

  for (let i = 0; i < totalClips; i++) {
    const clip = clips[i];
    const fileRelativePath = files[i];

    broadcast({
      type: 'publish_progress',
      clipIndex: i,
      total: totalClips,
      status: 'uploading',
    });

    const clipResult = { clipIndex: i, youtube: null, instagram: null };

    // ─── YouTube Upload ─────────────────────
    if (workflow.youtube) {
      let filePath = path.isAbsolute(fileRelativePath)
        ? fileRelativePath
        : path.join(rootDir, fileRelativePath.replace(/^\//, ''));

      if (!fs.existsSync(filePath)) {
        // Fallback: check output dir
        const cleanRel = fileRelativePath.replace(/^\/?(output\/)?/, '');
        const fallback = path.join(rootDir, 'output', cleanRel);
        if (fs.existsSync(fallback)) filePath = fallback;
      }

      if (fs.existsSync(filePath)) {
        broadcast({ type: 'log', level: 'info', msg: `📺 Uploading clip ${i + 1}/${totalClips} to YouTube...` });

        // Gather fallback metadata from clip if workflow is incomplete
        const finalMetadata = {
          title: workflow.youtube.title || clip.title || `Clip ${i + 1}`,
          description: workflow.youtube.description || clip.description || clip.caption || '',
          tags: workflow.youtube.tags || clip.hashtags || '',
          visibility: workflow.youtube.visibility || 'public',
          audience: workflow.youtube.audience || 'general',
        };

        clipResult.youtube = await uploadToYouTube(
          filePath,
          finalMetadata,
          clip,
          i,
          (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` })
        );

        if (clipResult.youtube.success) successCount++;
      } else {
        clipResult.youtube = { success: false, error: `File not found: ${filePath}` };
        broadcast({ type: 'log', level: 'error', msg: `   ❌ File not found: ${filePath}` });
      }
    }

    // ─── Instagram Upload ───────────────────
    if (workflow.instagram) {
      // Instagram requires a publicly accessible URL
      // For local files, we'll need the server URL
      const serverUrl = `http://localhost:${process.env.PORT || 3000}`;
      const publicUrl = `${serverUrl}${fileRelativePath}`;

      broadcast({ type: 'log', level: 'info', msg: `📱 Uploading clip ${i + 1}/${totalClips} to Instagram...` });

      // Note: Instagram Graph API requires the video to be at a publicly accessible URL
      // For local development, this won't work unless using a tunnel (ngrok, etc.)
      clipResult.instagram = await uploadToInstagram(
        publicUrl,
        workflow.instagram,
        clip,
        i,
        (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` })
      );

      if (clipResult.instagram.success) successCount++;
    }

    results.push(clipResult);

    broadcast({
      type: 'publish_progress',
      clipIndex: i,
      total: totalClips,
      status: (clipResult.youtube?.success || clipResult.instagram?.success) ? 'done' : 'error',
      result: clipResult,
    });
  }

  const summary = {
    total: totalClips,
    success: successCount,
    failed: (workflow.youtube ? totalClips : 0) + (workflow.instagram ? totalClips : 0) - successCount,
  };

  broadcast({ type: 'log', level: 'success', msg: `✅ Publishing complete: ${successCount} successful uploads` });

  return { results, summary };
}
