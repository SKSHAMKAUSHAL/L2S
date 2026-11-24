/**
 * src/queue/index.js
 * Hybrid job queue supporting BullMQ + Redis for production,
 * and an in-memory queue for standalone local development.
 */

import { EventEmitter } from 'node:events';
import { killJobProcesses } from '../process_manager.js';

export const queueEvents = new EventEmitter();
const REDIS_URL = process.env.REDIS_URL;
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 1));

export const PLAN_LIMITS = {
  free: {
    maxConcurrentJobs: 1,
    maxDurationMinutes: 30,
    monthlyMinutes: 60
  },
  paid: {
    maxConcurrentJobs: 2,
    maxDurationMinutes: 120,
    monthlyMinutes: 600
  }
};

let bullQueue = null;
let redisPub = null;
let redisSub = null;
const inMemoryQueue = [];
let activeWorkers = 0;
let defaultJobProcessor = null;

// Initialize Queue backend
export async function initQueue(processor = null) {
  if (processor) defaultJobProcessor = processor;

  if (REDIS_URL) {
    try {
      const { Queue, Worker } = await import('bullmq');
      const { default: IORedis } = await import('ioredis');

      const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
      redisPub = new IORedis(REDIS_URL);
      redisSub = new IORedis(REDIS_URL);

      bullQueue = new Queue('l2s_jobs', { connection });

      redisSub.subscribe('l2s_job_events', (err) => {
        if (err) console.error('[queue] Redis subscribe error:', err.message);
      });

      redisSub.on('message', (channel, message) => {
        if (channel === 'l2s_job_events') {
          try {
            const parsed = JSON.parse(message);
            queueEvents.emit('event', parsed);
          } catch (e) {}
        }
      });

      console.log(`[queue] Connected to Redis BullMQ queue: ${REDIS_URL}`);
      return { type: 'bullmq', queue: bullQueue };
    } catch (err) {
      console.warn(`[queue] Redis initialization failed (${err.message}). Falling back to in-memory queue.`);
    }
  }

  console.log(`⚠️  [queue] REDIS_URL not set — running with in-process queue in development mode`);
  return { type: 'memory' };
}

export function setDefaultJobProcessor(processor) {
  defaultJobProcessor = processor;
}

/**
 * Enqueues a job after validating plan quotas and concurrency limits.
 */
export async function enqueueJob(repo, { userId, sourceType, sourceRef, params = {}, processor = null }) {
  const user = repo.getUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const plan = user.plan || 'free';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // 1. Quota Check: Max source duration (402 Payment Required)
  if (params.duration && params.duration > limits.maxDurationMinutes * 60) {
    const err = new Error(`Source video duration (${Math.round(params.duration / 60)} min) exceeds maximum allowed for ${plan} plan (${limits.maxDurationMinutes} min).`);
    err.status = 402;
    throw err;
  }

  // 2. Quota Check: Concurrency limit per user (429 Too Many Requests)
  const activeCount = repo.countActiveUserJobs(userId);
  if (activeCount >= limits.maxConcurrentJobs) {
    const err = new Error(`Concurrent job limit reached for your plan (${limits.maxConcurrentJobs} max). Please wait for active jobs to complete.`);
    err.status = 429;
    throw err;
  }

  // Insert job row into DB
  const job = repo.createJob({
    userId,
    status: 'queued',
    sourceType,
    sourceRef,
    paramsJson: JSON.stringify(params)
  });

  const proc = processor || defaultJobProcessor;

  if (bullQueue) {
    await bullQueue.add('process_job', {
      jobId: job.id,
      userId,
      sourceType,
      sourceRef,
      params
    });
  } else {
    // In-memory queue
    inMemoryQueue.push({
      jobId: job.id,
      userId,
      sourceType,
      sourceRef,
      params,
      repo,
      processor: proc
    });
    processInMemoryQueue();
  }

  return job;
}

/**
 * Cancels a running or queued job and kills its tracked child processes
 */
export async function cancelJob(repo, jobId, userId) {
  const job = repo.getJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  // Terminate any active subprocesses running for this job
  killJobProcesses(jobId);

  // Update DB status
  repo.updateJob(jobId, {
    status: 'cancelled',
    finished_at: new Date().toISOString()
  });

  emitJobEvent({
    type: 'cancelled',
    jobId,
    userId,
    msg: 'Job was cancelled by user'
  });

  return { success: true, jobId, status: 'cancelled' };
}

/**
 * Publishes progress or log events to pub/sub
 */
export function emitJobEvent(eventData) {
  if (redisPub) {
    try {
      redisPub.publish('l2s_job_events', JSON.stringify(eventData));
    } catch (e) {}
  }
  queueEvents.emit('event', eventData);
}

// In-memory worker dispatcher
async function processInMemoryQueue() {
  if (activeWorkers >= WORKER_CONCURRENCY || inMemoryQueue.length === 0) return;

  activeWorkers++;
  const item = inMemoryQueue.shift();

  try {
    const { jobId, userId, sourceType, sourceRef, params, repo, processor } = item;

    // Check if cancelled while in queue
    const currentJob = repo.getJob(jobId, userId);
    if (!currentJob || currentJob.status === 'cancelled') {
      return;
    }

    repo.updateJob(jobId, {
      status: 'processing',
      started_at: new Date().toISOString()
    });

    emitJobEvent({ type: 'started', jobId, userId });

    if (processor) {
      await processor({
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
    }

    // Mark finished if not cancelled
    const finishedJob = repo.getJob(jobId, userId);
    if (finishedJob && finishedJob.status !== 'cancelled' && finishedJob.status !== 'failed') {
      repo.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        finished_at: new Date().toISOString()
      });
      emitJobEvent({ type: 'completed', jobId, userId });
    }
  } catch (err) {
    item.repo.updateJob(item.jobId, {
      status: 'failed',
      error: err.message,
      finished_at: new Date().toISOString()
    });
    emitJobEvent({ type: 'failed', jobId: item.jobId, userId: item.userId, error: err.message });
  } finally {
    activeWorkers--;
    // Process next item in queue
    setImmediate(processInMemoryQueue);
  }
}
