import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { initDb, createDbRepository } from '../src/db/index.js';
import { enqueueJob, cancelJob, initQueue, setDefaultJobProcessor } from '../src/queue/index.js';
import { spawnTracked } from '../src/process_manager.js';

describe('Step 7: Background Job Queue & Concurrency (tests/queue.test.js)', () => {
  let testDb;
  let repo;
  let user1, user2;

  before(async () => {
    testDb = initDb(':memory:');
    repo = createDbRepository(testDb);
    await initQueue();

    user1 = repo.createUser({ email: 'queue_u1@example.com', passwordHash: 'hash_1234567890', plan: 'free' });
    user2 = repo.createUser({ email: 'queue_u2@example.com', passwordHash: 'hash_1234567890', plan: 'free' });
  });

  after(() => {
    if (testDb) testDb.close();
  });

  it('1. two users run jobs at the same time and both complete successfully', async () => {
    let job1Finished = false;
    let job2Finished = false;

    const dummyProcessor = async ({ jobId, onProgress, onLog }) => {
      onLog('Starting test job');
      onProgress(50, 'Processing...');
      await new Promise(r => setTimeout(r, 50));
      onProgress(100, 'Done');
      if (jobId.includes('u1')) job1Finished = true;
      if (jobId.includes('u2')) job2Finished = true;
    };

    const j1 = await enqueueJob(repo, {
      userId: user1.id,
      sourceType: 'local',
      sourceRef: 'vid1.mp4',
      params: { duration: 60 },
      processor: dummyProcessor
    });

    const j2 = await enqueueJob(repo, {
      userId: user2.id,
      sourceType: 'local',
      sourceRef: 'vid2.mp4',
      params: { duration: 60 },
      processor: dummyProcessor
    });

    assert.ok(j1.id);
    assert.ok(j2.id);

    // Wait for in-memory queue to process both
    const maxWait = Date.now() + 3000;
    while ((!job1Finished || !job2Finished) && Date.now() < maxWait) {
      await new Promise(r => setTimeout(r, 50));
    }

    const finalJ1 = repo.getJob(j1.id, user1.id);
    const finalJ2 = repo.getJob(j2.id, user2.id);

    assert.strictEqual(finalJ1.status, 'completed');
    assert.strictEqual(finalJ2.status, 'completed');
  });

  it('2. cancelling a job kills child processes and marks status cancelled', async () => {
    const cancelJobId = 'job_cancel_test_' + Date.now();
    let processKilled = false;

    // Spawn a sleep process tracked by this jobId
    const child = spawnTracked('node', ['-e', 'setTimeout(()=>{}, 60000)'], {}, cancelJobId);
    child.on('exit', () => {
      processKilled = true;
    });

    const job = repo.createJob({
      id: cancelJobId,
      userId: user1.id
    });

    assert.strictEqual(job.status, 'queued'); // created with queued
    repo.updateJob(cancelJobId, { status: 'processing' });

    await cancelJob(repo, cancelJobId, user1.id);

    const updated = repo.getJob(cancelJobId, user1.id);
    assert.strictEqual(updated.status, 'cancelled');

    // Wait a brief moment for SIGKILL/taskkill to complete
    await new Promise(r => setTimeout(r, 200));
    assert.ok(processKilled || child.killed, 'Child process must be killed when job is cancelled');
  });

  it('3. enforces concurrency limit per user (free plan: 1 concurrent job max)', async () => {
    // Create job and set to processing
    const activeJob = repo.createJob({
      id: 'active_j_' + Date.now(),
      userId: user1.id,
      status: 'processing'
    });
    repo.updateJob(activeJob.id, { status: 'processing' });

    // Attempting to enqueue second concurrent job for user1 on free plan must throw 429
    await assert.rejects(
      async () => {
        await enqueueJob(repo, {
          userId: user1.id,
          sourceType: 'local',
          sourceRef: 'vid_limit.mp4',
          params: {}
        });
      },
      (err) => {
        assert.strictEqual(err.status, 429);
        assert.ok(err.message.includes('Concurrent job limit reached'));
        return true;
      }
    );

    // Clean up active job
    repo.updateJob(activeJob.id, { status: 'completed' });
  });

  it('4. enforces maximum video duration quota (free plan: max 30 minutes)', async () => {
    // 35 minutes = 2100 seconds (> 1800s limit)
    await assert.rejects(
      async () => {
        await enqueueJob(repo, {
          userId: user1.id,
          sourceType: 'local',
          sourceRef: 'long_vid.mp4',
          params: { duration: 35 * 60 }
        });
      },
      (err) => {
        assert.strictEqual(err.status, 402);
        assert.ok(err.message.includes('Source video duration'));
        return true;
      }
    );
  });

  it('5. failed job saves error message in DB row', async () => {
    const failProcessor = async () => {
      throw new Error('FFmpeg failed with exit code 1');
    };

    const failJob = await enqueueJob(repo, {
      userId: user2.id,
      sourceType: 'local',
      sourceRef: 'bad_vid.mp4',
      params: { duration: 10 },
      processor: failProcessor
    });

    // Wait for in-memory queue to execute
    await new Promise(r => setTimeout(r, 200));

    const updated = repo.getJob(failJob.id, user2.id);
    assert.strictEqual(updated.status, 'failed');
    assert.strictEqual(updated.error, 'FFmpeg failed with exit code 1');
  });
});
