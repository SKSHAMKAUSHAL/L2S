/**
 * src/services/youtube_quota.js
 * App-wide and per-user YouTube quota tracker.
 * Resets daily at Midnight Pacific Time (America/Los_Angeles).
 */

export const YOUTUBE_UPLOAD_COST = 1600;
export const DEFAULT_APP_DAILY_QUOTA = 10000;

export const USER_DAILY_LIMITS = {
  free: 2,
  paid: 10,
};

/**
 * Returns 'YYYY-MM-DD' representing the current date in America/Los_Angeles
 * @param {Date} [date]
 * @returns {string}
 */
export function getPacificDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns ISO string of the next Pacific midnight (when quota resets)
 * Handles daylight saving transitions cleanly.
 * @param {Date} [date]
 * @returns {string} ISO string
 */
export function getNextPacificMidnight(date = new Date()) {
  const currentKey = getPacificDateKey(date);
  // Scan forward in 15-minute increments until Pacific date changes, then refine
  let t = date.getTime();
  // Jump forward 12 hours minimum if we are safely in the day, or step by hour
  while (getPacificDateKey(new Date(t)) === currentKey) {
    t += 3600 * 1000;
  }
  // Now t is past midnight. Step backward in 1-minute steps until back to currentKey
  while (getPacificDateKey(new Date(t)) !== currentKey) {
    t -= 60 * 1000;
  }
  // The first minute where date changes is the reset
  t += 60 * 1000;
  // Truncate seconds/ms to clean minute
  const d = new Date(t);
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * Get current YouTube quota status for the app and a user
 * @param {Object} repo
 * @param {string} [userId]
 * @param {string} [userPlan]
 * @param {Date} [now]
 */
export function getQuotaStatus(repo, userId = null, userPlan = 'free', now = new Date()) {
  const dateKey = getPacificDateKey(now);
  const appLimit = Number(process.env.YT_APP_DAILY_QUOTA) || DEFAULT_APP_DAILY_QUOTA;
  const unitsUsed = repo.getAppQuota(dateKey);
  const unitsRemaining = Math.max(0, appLimit - unitsUsed);
  const isAppAtLimit = (unitsUsed + YOUTUBE_UPLOAD_COST) > appLimit;

  let userStatus = null;
  if (userId) {
    const userLimit = USER_DAILY_LIMITS[userPlan] || USER_DAILY_LIMITS.free;
    const userUploads = repo.getUserPublishQuota(userId, dateKey);
    const userRemaining = Math.max(0, userLimit - userUploads);
    userStatus = {
      uploadsToday: userUploads,
      userLimit,
      uploadsRemaining: userRemaining,
      isUserAtLimit: userUploads >= userLimit,
    };
  }

  return {
    dateKey,
    unitsUsed,
    unitsRemaining,
    appLimit,
    isAppAtLimit,
    nextResetTime: getNextPacificMidnight(now),
    user: userStatus,
  };
}

/**
 * Pre-upload quota check
 * @param {Object} params
 * @param {Object} params.repo
 * @param {string} params.userId
 * @param {string} [params.plan]
 * @param {Date} [params.now]
 * @returns {{ allowed: boolean, reason?: string, error?: string, nextResetTime?: string, status?: string }}
 */
export function checkQuotaBeforeUpload({ repo, userId, plan = 'free', now = new Date() }) {
  const status = getQuotaStatus(repo, userId, plan, now);

  if (status.user && status.user.isUserAtLimit) {
    return {
      allowed: false,
      reason: 'USER_LIMIT_EXCEEDED',
      error: `Daily upload limit reached for your ${plan} plan (${status.user.uploadsToday}/${status.user.userLimit} uploads used today). Resets at Pacific midnight.`,
      status: 'failed',
      nextResetTime: status.nextResetTime,
    };
  }

  if (status.isAppAtLimit) {
    return {
      allowed: false,
      reason: 'APP_QUOTA_EXCEEDED',
      error: `YouTube daily app quota exhausted (${status.unitsUsed}/${status.appLimit} units used today). Upload queued for next quota reset.`,
      status: 'waiting-for-quota',
      nextResetTime: status.nextResetTime,
    };
  }

  return {
    allowed: true,
    status: 'allowed',
    nextResetTime: status.nextResetTime,
  };
}

/**
 * Record a successful upload in quota tables
 * @param {Object} repo
 * @param {string} userId
 * @param {Date} [now]
 */
export function consumeQuota(repo, userId, now = new Date()) {
  const dateKey = getPacificDateKey(now);
  const updatedUnits = repo.incrementAppQuota(dateKey, YOUTUBE_UPLOAD_COST);
  const updatedUserUploads = repo.incrementUserPublishQuota(userId, dateKey);
  return {
    dateKey,
    appUnitsUsed: updatedUnits,
    userUploads: updatedUserUploads,
  };
}
