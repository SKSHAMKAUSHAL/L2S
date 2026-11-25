/**
 * src/worker.js
 * Standalone background worker process for executing video processing jobs via BullMQ / Redis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb, createDbRepository } from './db/index.js';
import { runPipeline } from './pipeline.js';
import { emitJobEvent } from './queue/index.js';

const REDIS_URL = process.env.REDIS_URL;
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1));

export async function processJob({ jobId, userId, sourceType, sourceRef, params = {}, repo, onProgress, onLog }) {
  repo.updateJob(jobId, { status: 'processing', started_at: new Date().toISOString() });

  const rootDir = process.cwd();
  const storageDir = path.join(rootDir, 'storage', userId, jobId);

  // Ensure storage directories exist
  try {
    fs.mkdirSync(path.join(storageDir, 'clips'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'temp'), { recursive: true });
  } catch (e) {}

  const broadcast = (data) => {
    emitJobEvent({ ...data, jobId, userId });
    if (data.type === 'progress') {
      repo.updateJob(jobId, { progress: data.progress });
    }
  };

  const customOptions = {
    ...params,
    jobId,
    userId,
    customOutputDir: storageDir,
    broadcast,
    rootDir,
    onProgress: (pct, msg) => {
      onProgress?.(pct, msg);
    },
    onLog: (msg, level = 'info') => {
      onLog?.(msg, level);
    }
  };

  const results = await runPipeline(
    sourceRef,
    params.genre || 'auto',
    broadcast,
    rootDir,
    customOptions
  );

  // Save generated clips to DB
  if (results && results.clips) {
    for (let i = 0; i < results.clips.length; i++) {
      const clip = results.clips[i];
      repo.createClip({
        jobId,
        userId,
        idx: i + 1,
        start: clip.start || 0,
        end: clip.end || 0,
        score: clip.score || 0,
        title: clip.title || `Clip ${i + 1}`,
        filePath: clip.filePath || `${storageDir}/clips/clip-${String(i + 1).padStart(2, '0')}.mp4`,
        metaJson: JSON.stringify(clip)
      });
    }
  }

  // Record usage
  if (results && results.totalDuration) {
    repo.recordUsage({
      userId,
      jobId,
      seconds: results.totalDuration
    });
  }

  return results;
}

async function startWorker() {
  if (!REDIS_URL) {
    console.log('[worker] REDIS_URL not set — worker runs in-process with main server.');
    return;
  }

  const { Worker } = await import('bullmq');
  const { default: IORedis } = await import('ioredis');

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const db = getDb();
  const repo = createDbRepository(db);

  const worker = new Worker('l2s_jobs', async (job) => {
    const { jobId, userId, sourceType, sourceRef, params } = job.data;
    console.log(`[worker] Processing job ${jobId} for user ${userId}...`);

    await processJob({
      jobId,
      userId,
      sourceType,
      sourceRef,
      params,
      repo,
      onProgress: (p, msg) => {
        repo.updateJob(jobId, { progress: p });
        emitJobEvent({ type: 'progress', jobId, userId, progress: p, msg });
      },
      onLog: (msg, level = 'info') => {
        emitJobEvent({ type: 'log', jobId, userId, msg, level });
      }
    });

    repo.updateJob(jobId, { status: 'completed', progress: 100, finished_at: new Date().toISOString() });
    emitJobEvent({ type: 'completed', jobId, userId });
  }, {
    connection,
    concurrency: WORKER_CONCURRENCY
  });

  worker.on('failed', (job, err) => {
    if (job) {
      console.error(`[worker] Job ${job.data?.jobId} failed:`, err.message);
      repo.updateJob(job.data?.jobId, {
        status: 'failed',
        error: err.message,
        finished_at: new Date().toISOString()
      });
      emitJobEvent({ type: 'failed', jobId: job.data?.jobId, userId: job.data?.userId, error: err.message });
    }
  });

  console.log(`[worker] BullMQ worker listening for jobs (concurrency: ${WORKER_CONCURRENCY})...`);
}

if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  startWorker().catch(console.error);
}
