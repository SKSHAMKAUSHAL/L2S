// =============================================
// SKATE — Social Media Uploader
// Multi-user, Resumable Chunked YouTube Uploader
// =============================================

import fs from 'fs';
import path from 'path';
import { getValidYouTubeToken, refreshYouTubeToken, getStoredYouTubeToken, isInstagramEnabled, getInstagramAuthUrl, exchangeInstagramCode } from './auth.js';
import { checkQuotaBeforeUpload, consumeQuota, getQuotaStatus } from './services/youtube_quota.js';
import { decryptToken } from './security/crypto.js';

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB (32 * 256 KB)
const MAX_CHUNK_RETRIES = 3;

/**
 * Replace template variables in user-configured text
 * Supports: {title}, {description}, {hashtags}, {caption}, {clipNum}
 */
export function applyTemplate(template, clip = {}, clipIndex = 0) {
  if (typeof template !== 'string' || !template) return '';
  return template
    .replace(/\{title\}/gi, clip.title || '')
    .replace(/\{description\}/gi, clip.description || '')
    .replace(/\{hashtags\}/gi, clip.hashtags || '')
    .replace(/\{caption\}/gi, clip.caption || '')
    .replace(/\{clipNum\}/gi, String(clipIndex + 1));
}

/**
 * Format title, description, and tags adhering strictly to YouTube limits
 * Does NOT force #Shorts to title limit; appends to description if missing.
 */
export function formatYouTubeMetadata(metadata = {}, clip = {}, clipIndex = 0) {
  let title = (typeof metadata.title === 'string' ? applyTemplate(metadata.title, clip, clipIndex) : null) || clip.title || `Clip ${clipIndex + 1}`;
  let description = (typeof metadata.description === 'string' ? applyTemplate(metadata.description, clip, clipIndex) : null) || clip.description || (clip.caption ? `${clip.caption}\n\n${clip.hashtags || ''}` : '');
  let rawTags = metadata.tags;
  if (typeof rawTags === 'string') {
    rawTags = applyTemplate(rawTags, clip, clipIndex);
  } else if (!rawTags) {
    rawTags = clip.hashtags || '';
  }

  // Title: max 100 characters
  title = title.trim();
  if (title.length > 100) {
    title = title.slice(0, 100);
  }

  // Ensure #Shorts is present in description if missing
  const hasShortsInTitle = /#shorts\b/i.test(title);
  const hasShortsInDesc = /#shorts\b/i.test(description);
  if (!hasShortsInTitle && !hasShortsInDesc) {
    description = description ? `${description}\n\n#Shorts` : '#Shorts';
  }

  // Description: max 5000 characters
  if (description.length > 5000) {
    description = description.slice(0, 5000);
  }

  // Tags: total combined length under 500 chars
  let tags = [];
  if (Array.isArray(rawTags)) {
    tags = rawTags.map(t => String(t).trim()).filter(Boolean);
  } else if (typeof rawTags === 'string') {
    tags = rawTags.replace(/#/g, '').split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  }
  if (tags.length === 0) {
    tags = ['shorts', 'viral'];
  }

  // Filter tags to stay under 500 chars total
  const validTags = [];
  let currentTagsLength = 0;
  for (const tag of tags) {
    if (currentTagsLength + tag.length + 1 <= 500) {
      validTags.push(tag);
      currentTagsLength += tag.length + 1;
    }
  }

  const categoryId = metadata.categoryId || '22'; // People & Blogs
  const privacyStatus = metadata.visibility || process.env.YT_DEFAULT_PRIVACY || 'private';
  const selfDeclaredMadeForKids = Boolean(metadata.audience === 'kids' || metadata.selfDeclaredMadeForKids);

  return {
    title,
    description,
    tags: validTags,
    categoryId,
    privacyStatus,
    selfDeclaredMadeForKids,
  };
}

/**
 * Resumable Chunked Upload to YouTube
 * Streams from disk in 8MB chunks without loading whole file into memory.
 * 
 * @param {Object} options
 * @param {string} options.filePath - Path to mp4 file
 * @param {Object} options.metadata - { title, description, tags, categoryId, visibility, audience }
 * @param {Object} [options.clip] - Clip metadata
 * @param {number} [options.clipIndex] - Index
 * @param {string} options.userId - User ID
 * @param {string} [options.userPlan] - 'free' or 'paid'
 * @param {Object} options.repo - Database repository
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>}
 */
export async function uploadToYouTube({
  filePath,
  metadata = {},
  clip = {},
  clipIndex = 0,
  userId,
  userPlan = 'free',
  repo,
  onProgress,
}) {
  if (!userId || !repo) {
    return { success: false, error: 'User ID and repository required for YouTube upload' };
  }

  // 1. Quota Pre-Check
  const quotaCheck = checkQuotaBeforeUpload({ repo, userId, plan: userPlan });
  if (!quotaCheck.allowed) {
    onProgress?.(`⛔ ${quotaCheck.error}`);
    return {
      success: false,
      error: quotaCheck.error,
      reason: quotaCheck.reason,
      status: quotaCheck.status,
      nextResetTime: quotaCheck.nextResetTime,
      quotaExceeded: quotaCheck.reason === 'APP_QUOTA_EXCEEDED',
      userLimitExceeded: quotaCheck.reason === 'USER_LIMIT_EXCEEDED',
    };
  }

  // 2. Token Check & Refresh
  let accessToken = await getValidYouTubeToken(userId, repo);
  if (!accessToken) {
    return {
      success: false,
      error: 'YouTube not connected or token expired. Please reconnect.',
      needsReconnect: true,
    };
  }

  // 3. File existence & size check
  let resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `Video file not found at: ${resolvedPath}` };
  }
  const stat = fs.statSync(resolvedPath);
  const fileSize = stat.size;
  if (fileSize === 0) {
    return { success: false, error: 'Video file is empty (0 bytes)' };
  }

  // 4. Format metadata
  const formatted = formatYouTubeMetadata(metadata, clip, clipIndex);

  const videoResource = {
    snippet: {
      title: formatted.title,
      description: formatted.description,
      tags: formatted.tags,
      categoryId: formatted.categoryId,
    },
    status: {
      privacyStatus: formatted.privacyStatus,
      selfDeclaredMadeForKids: formatted.selfDeclaredMadeForKids,
    },
  };

  const uploadEndpoint = process.env.GOOGLE_UPLOAD_URL || 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

  // 5. Initiate Resumable Session with Retry for 401
  onProgress?.(`📤 Initializing resumable YouTube upload for "${formatted.title}"...`);

  async function initiateSession(token) {
    return await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(videoResource),
    });
  }

  let initRes = await initiateSession(accessToken);

  if (initRes.status === 401) {
    onProgress?.('🔄 Access token expired during init, refreshing...');
    try {
      accessToken = await refreshYouTubeToken(userId, repo);
      initRes = await initiateSession(accessToken);
    } catch (e) {
      return { success: false, error: `Failed to refresh token: ${e.message}`, needsReconnect: true };
    }
  }

  if (!initRes.ok) {
    const errText = await initRes.text();
    if (initRes.status === 403) {
      if (errText.includes('quotaExceeded')) {
        return {
          success: false,
          error: 'YouTube API daily quota exceeded. Resets at midnight Pacific Time.',
          quotaExceeded: true,
          status: 'waiting-for-quota',
        };
      }
      if (errText.includes('uploadLimitExceeded')) {
        return {
          success: false,
          error: 'YouTube upload limit exceeded for this channel today.',
          uploadLimitExceeded: true,
          status: 'failed',
        };
      }
      if (errText.includes('forbidden')) {
        return { success: false, error: `YouTube API forbidden: ${errText}`, status: 'failed' };
      }
    }
    return { success: false, error: `YouTube upload initialization failed (${initRes.status}): ${errText}` };
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    return { success: false, error: 'No resumable upload Location header received from YouTube' };
  }

  // 6. Resumable Chunk Upload Loop
  let startByte = 0;
  let uploadResult = null;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  onProgress?.(`⬆️  Uploading ${Math.round(fileSize / 1024 / 1024 * 10) / 10} MB in ${totalChunks} chunks...`);

  const fd = fs.openSync(resolvedPath, 'r');

  try {
    while (startByte < fileSize) {
      const endByte = Math.min(startByte + CHUNK_SIZE - 1, fileSize - 1);
      const chunkLength = endByte - startByte + 1;
      const currentChunkIdx = Math.floor(startByte / CHUNK_SIZE) + 1;

      // Allocate only the 8MB slice buffer for this chunk
      const chunkBuffer = Buffer.alloc(chunkLength);
      fs.readSync(fd, chunkBuffer, 0, chunkLength, startByte);

      let chunkSuccess = false;
      let chunkAttempt = 0;

      while (!chunkSuccess && chunkAttempt < MAX_CHUNK_RETRIES) {
        chunkAttempt++;
        try {
          const chunkRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': String(chunkLength),
              'Content-Range': `bytes ${startByte}-${endByte}/${fileSize}`,
            },
            body: chunkBuffer,
          });

          if (chunkRes.status === 308) {
            // Chunk accepted, upload incomplete
            chunkSuccess = true;
            const rangeHeader = chunkRes.headers.get('range');
            if (rangeHeader) {
              const match = rangeHeader.match(/bytes=0-(\d+)/);
              if (match) {
                startByte = parseInt(match[1], 10) + 1;
              } else {
                startByte = endByte + 1;
              }
            } else {
              startByte = endByte + 1;
            }
            const pct = Math.round((startByte / fileSize) * 100);
            onProgress?.(`   Chunk ${currentChunkIdx}/${totalChunks} uploaded (${pct}%)`);
          } else if (chunkRes.status === 200 || chunkRes.status === 201) {
            // Upload complete!
            chunkSuccess = true;
            uploadResult = await chunkRes.json();
            startByte = fileSize;
          } else if (chunkRes.status === 401 && chunkAttempt === 1) {
            // Try refresh once
            try {
              accessToken = await refreshYouTubeToken(userId, repo);
            } catch (e) {
              throw new Error(`Token refresh failed mid-upload: ${e.message}`);
            }
          } else if (chunkRes.status === 403) {
            const errText = await chunkRes.text();
            if (errText.includes('quotaExceeded')) {
              return { success: false, error: 'YouTube API quota exceeded mid-upload', quotaExceeded: true, status: 'waiting-for-quota' };
            }
            if (errText.includes('uploadLimitExceeded')) {
              return { success: false, error: 'YouTube upload limit exceeded', uploadLimitExceeded: true, status: 'failed' };
            }
            throw new Error(`YouTube chunk upload forbidden: ${errText}`);
          } else {
            const errText = await chunkRes.text();
            throw new Error(`Unexpected status ${chunkRes.status}: ${errText}`);
          }
        } catch (netErr) {
          onProgress?.(`⚠️  Chunk ${currentChunkIdx} attempt ${chunkAttempt} failed: ${netErr.message}. Querying resume status...`);

          // Attempt recovery: Query Google for upload status (308 Range check)
          try {
            const statusCheckRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Range': `bytes */${fileSize}`,
                'Content-Length': '0',
              },
            });

            if (statusCheckRes.status === 308) {
              const rangeHeader = statusCheckRes.headers.get('range');
              if (rangeHeader) {
                const match = rangeHeader.match(/bytes=0-(\d+)/);
                if (match) {
                  startByte = parseInt(match[1], 10) + 1;
                  chunkSuccess = true; // Resumed from recovered byte offset
                  break;
                }
              }
            } else if (statusCheckRes.status === 200 || statusCheckRes.status === 201) {
              uploadResult = await statusCheckRes.json();
              startByte = fileSize;
              chunkSuccess = true;
              break;
            }
          } catch (statusErr) {
            // Wait briefly before next attempt
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, chunkAttempt)));
          }

          if (chunkAttempt >= MAX_CHUNK_RETRIES) {
            throw new Error(`Upload failed after ${MAX_CHUNK_RETRIES} attempts on chunk ${currentChunkIdx}: ${netErr.message}`);
          }
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!uploadResult || !uploadResult.id) {
    return { success: false, error: 'Upload completed but no video ID received from YouTube' };
  }

  // 7. Consume Quota & Update Database
  consumeQuota(repo, userId);

  const videoId = uploadResult.id;
  const returnedPrivacyStatus = uploadResult.status?.privacyStatus || formatted.privacyStatus;
  const videoUrl = `https://youtube.com/shorts/${videoId}`;

  onProgress?.(`✅ YouTube Short published! Video ID: ${videoId} (Privacy: ${returnedPrivacyStatus})`);

  return {
    success: true,
    videoId,
    url: videoUrl,
    privacyStatus: returnedPrivacyStatus,
    quotaStatus: getQuotaStatus(repo, userId, userPlan),
  };
}

/**
 * Publish a single clip to YouTube and update the clip row in SQLite
 * @param {Object} params
 * @param {string} params.clipId
 * @param {string} params.userId
 * @param {string} params.jobId
 * @param {string} params.filePath
 * @param {Object} params.metadata
 * @param {Object} params.clip
 * @param {number} [params.clipIndex]
 * @param {Object} params.repo
 * @param {Function} [params.broadcast]
 * @returns {Promise<Object>}
 */
export async function publishClipToYouTube({
  clipId,
  userId,
  jobId,
  filePath,
  metadata = {},
  clip = {},
  clipIndex = 0,
  repo,
  broadcast,
}) {
  const user = repo.getUserById(userId);
  const userPlan = user?.plan || 'free';

  // Create or record publish job in DB
  const pubJob = repo.createPublishJob({
    userId,
    clipId,
    jobId,
    platform: 'youtube',
    status: 'publishing',
    metadataJson: JSON.stringify(metadata),
  });

  const onProgress = (msg) => {
    broadcast?.({ type: 'publish_log', clipId, msg });
  };

  const result = await uploadToYouTube({
    filePath,
    metadata,
    clip,
    clipIndex,
    userId,
    userPlan,
    repo,
    onProgress,
  });

  if (result.success) {
    repo.updatePublishJob(pubJob.id, {
      status: 'published',
      result_url: result.url,
      error: null,
    });
    repo.updateClip(clipId, {
      youtube_url: result.url,
      publish_status: 'published',
      published_at: new Date().toISOString(),
    });
  } else {
    const newStatus = result.status || (result.quotaExceeded ? 'waiting-for-quota' : 'failed');
    repo.updatePublishJob(pubJob.id, {
      status: newStatus,
      error: result.error,
      scheduled_for: result.nextResetTime || null,
    });
    repo.updateClip(clipId, {
      publish_status: newStatus,
    });
  }

  return {
    publishJobId: pubJob.id,
    ...result,
  };
}

/**
 * Upload video to Instagram as a Reel
 * Uses user's encrypted Instagram token stored in SQLite
 */
export async function uploadToInstagram({
  fileUrl,
  filePath,
  metadata = {},
  clip = {},
  clipIndex = 0,
  userId,
  repo,
  onProgress,
}) {
  if (!userId || !repo) {
    return { success: false, error: 'User ID and repository required for Instagram upload' };
  }

  const row = repo.getOAuthToken(userId, 'instagram');
  if (!row || !row.enc_blob) {
    return { success: false, error: 'Instagram not connected. Please connect your Instagram account in Settings.' };
  }

  let igAuth = null;
  try {
    igAuth = JSON.parse(decryptToken(row.enc_blob));
  } catch (err) {
    return { success: false, error: 'Failed to decrypt Instagram credentials' };
  }

  if (!igAuth.accessToken || !igAuth.igUserId) {
    return { success: false, error: 'Instagram Business account ID or access token missing. Please reconnect.' };
  }

  const { accessToken, igUserId } = igAuth;

  let caption = (typeof metadata.caption === 'string' ? applyTemplate(metadata.caption, clip, clipIndex) : null) || clip.caption || clip.title || '';
  const hashtags = (typeof metadata.hashtags === 'string' ? applyTemplate(metadata.hashtags, clip, clipIndex) : null) || clip.hashtags || '';
  if (hashtags && !caption.includes(hashtags)) {
    caption = caption ? `${caption}\n\n${hashtags}` : hashtags;
  }
  caption = caption.slice(0, 2200);

  const publicVideoUrl = fileUrl || metadata.videoUrl;
  if (!publicVideoUrl || publicVideoUrl.includes('localhost') || publicVideoUrl.includes('127.0.0.1')) {
    onProgress?.('⚠️ Note: Instagram Graph API requires a publicly reachable video URL (e.g. your production domain or tunnel).');
  }

  try {
    onProgress?.(`📤 Initializing Instagram Reel container for clip ${clipIndex + 1}...`);
    const containerUrl = `https://graph.facebook.com/v21.0/${igUserId}/media`;
    const containerRes = await fetch(containerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: publicVideoUrl,
        caption,
        access_token: accessToken,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`Instagram container creation failed: ${err}`);
    }

    const containerData = await containerRes.json();
    const containerId = containerData.id;

    onProgress?.('⏳ Waiting for Instagram media processing...');
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      const statusRes = await fetch(`https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`);
      if (statusRes.ok) {
        const sData = await statusRes.json();
        status = sData.status_code;
        if (status === 'ERROR') throw new Error('Instagram media processing failed');
      }
    }

    onProgress?.('📱 Publishing Reel to Instagram...');
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });

    if (!publishRes.ok) {
      const pErr = await publishRes.text();
      throw new Error(`Instagram publish failed: ${pErr}`);
    }

    const pubData = await publishRes.json();
    const mediaId = pubData.id;

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

/**
 * Publish a single clip to Instagram and update the clip row in SQLite
 */
export async function publishClipToInstagram({
  clipId,
  userId,
  jobId,
  filePath,
  fileUrl,
  metadata = {},
  clip = {},
  clipIndex = 0,
  repo,
  broadcast,
}) {
  const pubJob = repo.createPublishJob({
    userId,
    clipId,
    jobId,
    platform: 'instagram',
    status: 'publishing',
    metadataJson: JSON.stringify(metadata),
  });

  const onProgress = (msg) => {
    broadcast?.({ type: 'publish_log', clipId, msg });
  };

  const result = await uploadToInstagram({
    fileUrl,
    filePath,
    metadata,
    clip,
    clipIndex,
    userId,
    repo,
    onProgress,
  });

  if (result.success) {
    repo.updatePublishJob(pubJob.id, {
      status: 'published',
      result_url: result.url,
      error: null,
    });
    repo.updateClip(clipId, {
      publish_status: 'published',
      published_at: new Date().toISOString(),
    });
  } else {
    repo.updatePublishJob(pubJob.id, {
      status: 'failed',
      error: result.error,
    });
    repo.updateClip(clipId, {
      publish_status: 'failed',
    });
  }

  return {
    publishJobId: pubJob.id,
    ...result,
  };
}
