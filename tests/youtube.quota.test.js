import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { initDb, createDbRepository } from '../src/db/index.js';
import {
  getPacificDateKey,
  getNextPacificMidnight,
  getQuotaStatus,
  checkQuotaBeforeUpload,
  consumeQuota,
  YOUTUBE_UPLOAD_COST,
  USER_DAILY_LIMITS,
} from '../src/services/youtube_quota.js';

describe('YouTube App-Wide Quota Guard & LA Midnight Reset (tests/youtube.quota.test.js)', () => {
  let db;
  let repo;
  let freeUser;
  let paidUser;

  before(() => {
    delete process.env.YT_APP_DAILY_QUOTA;
    db = initDb(':memory:');
    repo = createDbRepository(db);

    freeUser = repo.createUser({ email: 'free-user@example.com', passwordHash: 'pwd-1234567890', plan: 'free' });
    paidUser = repo.createUser({ email: 'paid-user@example.com', passwordHash: 'pwd-1234567890', plan: 'paid' });
  });

  it('1. App quota counter is shared across all users in SQLite database', () => {
    delete process.env.YT_APP_DAILY_QUOTA;
    const fixedNow = new Date('2026-06-15T19:00:00Z'); // 12:00 PM Pacific Time
    const dateKey = getPacificDateKey(fixedNow);

    // Initial state: 0 units used
    assert.strictEqual(repo.getAppQuota(dateKey), 0);

    // Free user uploads 1 video
    consumeQuota(repo, freeUser.id, fixedNow);
    assert.strictEqual(repo.getAppQuota(dateKey), YOUTUBE_UPLOAD_COST); // 1,600
    assert.strictEqual(repo.getUserPublishQuota(freeUser.id, dateKey), 1);

    // Paid user uploads 1 video
    consumeQuota(repo, paidUser.id, fixedNow);
    assert.strictEqual(repo.getAppQuota(dateKey), YOUTUBE_UPLOAD_COST * 2); // 3,200
    assert.strictEqual(repo.getUserPublishQuota(paidUser.id, dateKey), 1);

    // Verify both users increased the same shared counter
    const statusA = getQuotaStatus(repo, freeUser.id, 'free', fixedNow);
    const statusB = getQuotaStatus(repo, paidUser.id, 'paid', fixedNow);

    assert.strictEqual(statusA.unitsUsed, 3200);
    assert.strictEqual(statusB.unitsUsed, 3200);
  });

  it('2. Per-user daily upload caps: free plan gets 2, paid plan gets 10', () => {
    process.env.YT_APP_DAILY_QUOTA = '50000'; // generous app quota to isolate user limits
    const testDate = new Date('2026-07-20T20:00:00Z');
    const dateKey = getPacificDateKey(testDate);

    // Free plan: 2 uploads allowed
    assert.strictEqual(USER_DAILY_LIMITS.free, 2);

    // Upload 1
    let check = checkQuotaBeforeUpload({ repo, userId: freeUser.id, plan: 'free', now: testDate });
    assert.strictEqual(check.allowed, true);
    consumeQuota(repo, freeUser.id, testDate);

    // Upload 2
    check = checkQuotaBeforeUpload({ repo, userId: freeUser.id, plan: 'free', now: testDate });
    assert.strictEqual(check.allowed, true);
    consumeQuota(repo, freeUser.id, testDate);

    // Upload 3 (exceeds limit 2)
    check = checkQuotaBeforeUpload({ repo, userId: freeUser.id, plan: 'free', now: testDate });
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.reason, 'USER_LIMIT_EXCEEDED');
    assert.strictEqual(check.status, 'failed');
    assert.ok(check.error.includes('Daily upload limit reached'));

    // Paid plan: up to 10 uploads allowed
    assert.strictEqual(USER_DAILY_LIMITS.paid, 10);
    for (let i = 0; i < 10; i++) {
      const paidCheck = checkQuotaBeforeUpload({ repo, userId: paidUser.id, plan: 'paid', now: testDate });
      assert.strictEqual(paidCheck.allowed, true, `Upload ${i + 1} for paid user should be allowed`);
      consumeQuota(repo, paidUser.id, testDate);
    }

    // 11th upload for paid user rejected
    const paidCheck11 = checkQuotaBeforeUpload({ repo, userId: paidUser.id, plan: 'paid', now: testDate });
    assert.strictEqual(paidCheck11.allowed, false);
    assert.strictEqual(paidCheck11.reason, 'USER_LIMIT_EXCEEDED');
  });

  it('3. App-wide quota exhaustion queues upload for after reset (waiting-for-quota)', () => {
    delete process.env.YT_APP_DAILY_QUOTA;
    const testDate = new Date('2026-08-10T18:00:00Z');
    const dateKey = getPacificDateKey(testDate);

    // Default app limit is 10,000 units. Set app units used to 9,000 (only 1,000 left, but upload needs 1,600)
    repo.setAppQuota(dateKey, 9000);

    const check = checkQuotaBeforeUpload({ repo, userId: paidUser.id, plan: 'paid', now: testDate });
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.reason, 'APP_QUOTA_EXCEEDED');
    assert.strictEqual(check.status, 'waiting-for-quota');
    assert.ok(check.nextResetTime, 'Must provide nextResetTime ISO string');
  });

  it('4. Quota resets at America/Los_Angeles midnight across daylight saving changes', () => {
    delete process.env.YT_APP_DAILY_QUOTA;
    // Test case: DST transition in March (Standard -> Daylight)
    // March 8, 2026: 23:58 Pacific Time (-07:00 PDT because clocks sprang forward at 2am)
    // 23:58 PDT on March 8 is March 9 06:58:00 UTC
    const beforeMidnightDST = new Date('2026-03-09T06:58:00.000Z');
    assert.strictEqual(getPacificDateKey(beforeMidnightDST), '2026-03-08');

    // Seed max quota used on 2026-03-08
    repo.setAppQuota('2026-03-08', 10000);
    const checkBefore = checkQuotaBeforeUpload({ repo, userId: paidUser.id, plan: 'paid', now: beforeMidnightDST });
    assert.strictEqual(checkBefore.allowed, false);
    assert.strictEqual(checkBefore.status, 'waiting-for-quota');

    // Advance 5 minutes past Pacific Midnight (00:03 PDT on March 9 is March 9 07:03:00 UTC)
    const afterMidnightDST = new Date('2026-03-09T07:03:00.000Z');
    assert.strictEqual(getPacificDateKey(afterMidnightDST), '2026-03-09');

    // On March 9, quota is fresh (0 units used)
    const checkAfter = checkQuotaBeforeUpload({ repo, userId: paidUser.id, plan: 'paid', now: afterMidnightDST });
    assert.strictEqual(checkAfter.allowed, true);
    assert.strictEqual(checkAfter.status, 'allowed');

    // Verify next Pacific midnight computation
    const nextMidnight = getNextPacificMidnight(beforeMidnightDST);
    // Midnight PDT for March 8/9 is 07:00:00 UTC on March 9
    assert.strictEqual(nextMidnight, '2026-03-09T07:00:00.000Z');
  });

  it('5. Winter Standard Time (PST UTC-8) midnight transition resets properly', () => {
    // December 20, 2026: 23:55 PST (-08:00) is December 21 07:55:00 UTC
    const beforePST = new Date('2026-12-21T07:55:00.000Z');
    assert.strictEqual(getPacificDateKey(beforePST), '2026-12-20');

    // Next reset time must be 08:00:00 UTC
    const nextReset = getNextPacificMidnight(beforePST);
    assert.strictEqual(nextReset, '2026-12-21T08:00:00.000Z');

    // 10 minutes later (00:05 PST) is December 21 08:05:00 UTC
    const afterPST = new Date('2026-12-21T08:05:00.000Z');
    assert.strictEqual(getPacificDateKey(afterPST), '2026-12-21');
  });
});
