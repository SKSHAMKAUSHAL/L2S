import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDb, createDbRepository } from '../src/db/index.js';
import { saveStoredYouTubeToken } from '../src/auth.js';
import { uploadToYouTube, publishClipToYouTube, formatYouTubeMetadata } from '../src/uploader.js';
import { createFakeGoogleServer } from './helpers/fake_google_server.js';

describe('YouTube Resumable Chunked Upload & Fault Recovery (tests/youtube.upload.test.js)', () => {
  let fakeGoogle;
  let googleUrls;
  let db;
  let repo;
  let user;
  let tempDir;
  let testVideoPath;
  const FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

  before(async () => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'GOCSPX-secret';
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 5).toString('base64');
    process.env.YT_APP_DAILY_QUOTA = '50000'; // plenty of quota for tests

    fakeGoogle = createFakeGoogleServer();
    googleUrls = await fakeGoogle.start();

    process.env.GOOGLE_AUTH_URL = googleUrls.authUrl;
    process.env.GOOGLE_TOKEN_URL = googleUrls.tokenUrl;
    process.env.GOOGLE_USERINFO_URL = googleUrls.userinfoUrl;
    process.env.GOOGLE_REVOKE_URL = googleUrls.revokeUrl;
    process.env.GOOGLE_UPLOAD_URL = googleUrls.uploadUrl;

    db = initDb(':memory:');
    repo = createDbRepository(db);

    user = repo.createUser({ email: 'uploader@example.com', passwordHash: 'hash-pwd-1234567890', plan: 'paid' });

    // Seed valid token for user
    saveStoredYouTubeToken(user.id, {
      accessToken: 'valid_access_token_upload_test',
      refreshToken: 'valid_refresh_token',
      expiresAt: Date.now() + 3600000,
      username: 'Test Creator',
      needsReconnect: false,
    }, repo);

    // Create 20 MB test file on disk in 1MB increments
    tempDir = path.join(os.tmpdir(), 'l2s_yt_test_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    testVideoPath = path.join(tempDir, 'test_20mb.mp4');

    const fd = fs.openSync(testVideoPath, 'w');
    const chunk1MB = Buffer.alloc(1024 * 1024, 0x59);
    for (let i = 0; i < 20; i++) {
      fs.writeSync(fd, chunk1MB);
    }
    fs.closeSync(fd);
  });

  after(async () => {
    if (fakeGoogle) await fakeGoogle.stop();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. Metadata formatting enforces limits and moves #Shorts to description if title exceeds', () => {
    // 150-char title without #Shorts
    const longTitle = 'A'.repeat(150);
    const meta1 = formatYouTubeMetadata({ title: longTitle, description: 'My video description' });
    assert.strictEqual(meta1.title.length, 100, 'Title must be capped at 100 chars');
    assert.ok(meta1.description.includes('#Shorts'), 'Missing #Shorts must be added to description');

    // Title already has #Shorts
    const titleWithShorts = 'Viral Video Hook #Shorts';
    const meta2 = formatYouTubeMetadata({ title: titleWithShorts, description: 'Short clip' });
    assert.strictEqual(meta2.title, 'Viral Video Hook #Shorts');

    // Overlong description capped at 5000
    const overlongDesc = 'D'.repeat(6000);
    const meta3 = formatYouTubeMetadata({ title: 'Short title', description: overlongDesc });
    assert.strictEqual(meta3.description.length, 5000, 'Description capped at 5000');

    // Tags total length capped under 500
    const manyTags = Array.from({ length: 60 }, (_, i) => `tag_${i}_with_extra_long_padding`);
    const meta4 = formatYouTubeMetadata({ tags: manyTags });
    const totalTagLength = meta4.tags.reduce((acc, t) => acc + t.length + 1, 0);
    assert.ok(totalTagLength <= 500, `Tags length ${totalTagLength} must be <= 500`);
  });

  it('2. 20 MB generated file uploads in 8MB chunks while keeping memory RSS growth flat (< 100MB)', async () => {
    // Collect garbage if available or record baseline RSS
    if (global.gc) global.gc();
    const initialRss = process.memoryUsage().rss;

    const result = await uploadToYouTube({
      filePath: testVideoPath,
      metadata: {
        title: '20MB Resumable Test Video',
        description: 'Testing chunked upload without memory bloat',
        visibility: 'private',
      },
      userId: user.id,
      userPlan: 'paid',
      repo,
    });

    const finalRss = process.memoryUsage().rss;
    const rssGrowthMB = (finalRss - initialRss) / (1024 * 1024);

    assert.strictEqual(result.success, true);
    assert.ok(result.videoId, 'Must return videoId');
    assert.strictEqual(result.privacyStatus, 'private');
    assert.ok(result.url.includes(result.videoId));

    // Assert memory growth was strictly under 100 MB
    assert.ok(rssGrowthMB < 100, `Memory RSS grew by ${rssGrowthMB.toFixed(2)} MB, which is >= 100 MB`);
  });

  it('3. Simulated connection drop after chunk 2 resumes from the right byte offset and succeeds', async () => {
    // Configure fake Google to simulate a socket drop during chunk 2
    fakeGoogle.setSimulateDropOnChunk(2);

    const result = await uploadToYouTube({
      filePath: testVideoPath,
      metadata: {
        title: 'Drop Recovery Test',
        description: 'Simulating drop on chunk 2',
      },
      userId: user.id,
      userPlan: 'paid',
      repo,
    });

    assert.strictEqual(result.success, true, 'Must successfully complete after resume');
    assert.ok(result.videoId, 'Must have received videoId');
  });

  it('4. quotaExceeded error from Google leads to status waiting-for-quota and updates DB', async () => {
    fakeGoogle.setUploadQuotaExceeded(true);

    const job = repo.createJob({ userId: user.id, status: 'completed' });
    const clip = repo.createClip({
      jobId: job.id,
      userId: user.id,
      idx: 0,
      start: 0,
      end: 30,
      title: 'Quota Exceeded Test Clip',
      filePath: testVideoPath,
    });

    const result = await publishClipToYouTube({
      clipId: clip.id,
      userId: user.id,
      jobId: job.id,
      filePath: testVideoPath,
      metadata: { title: 'Quota Exceeded Video' },
      clip,
      clipIndex: 0,
      repo,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'waiting-for-quota');
    assert.strictEqual(result.quotaExceeded, true);

    // Verify publish_jobs record in DB has status 'waiting-for-quota'
    const pubJob = repo.getPublishJob(result.publishJobId);
    assert.ok(pubJob);
    assert.strictEqual(pubJob.status, 'waiting-for-quota');

    // Reset fakeGoogle
    fakeGoogle.setUploadQuotaExceeded(false);
  });
});
