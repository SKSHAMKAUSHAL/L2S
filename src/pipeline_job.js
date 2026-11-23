// =============================================
// L2S — Pipeline Job State Machine & Lifecycle
// =============================================
// Enforces explicit state transitions, duplicate submission guards,
// bounded execution, and safe error sanitization.

export const JOB_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  CANCELLING: 'cancelling',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
});

// Allowed deterministic transitions
const ALLOWED_TRANSITIONS = new Map([
  [JOB_STATES.QUEUED, new Set([JOB_STATES.RUNNING, JOB_STATES.FAILED, JOB_STATES.STOPPED])],
  [JOB_STATES.RUNNING, new Set([JOB_STATES.CANCELLING, JOB_STATES.COMPLETED, JOB_STATES.FAILED])],
  [JOB_STATES.CANCELLING, new Set([JOB_STATES.STOPPED, JOB_STATES.FAILED])],
  [JOB_STATES.COMPLETED, new Set()], // Terminal
  [JOB_STATES.FAILED, new Set()],    // Terminal
  [JOB_STATES.STOPPED, new Set()],   // Terminal
]);

/**
 * Sanitize an error object or message so that internal absolute paths,
 * secrets, and raw stack traces are never leaked to the browser.
 *
 * @param {Error|string} err - Error object or string
 * @param {string} [rootDir] - Optional root directory to redact
 * @returns {{ msg: string, code: string }}
 */
export function sanitizeClientError(err, rootDir = process.cwd()) {
  const rawMsg = typeof err === 'string' ? err : (err?.message || 'An unexpected error occurred');
  const code = err?.code || err?.errorCode || 'UNKNOWN_ERROR';

  // Redact potential absolute paths
  let cleanMsg = rawMsg;
  if (rootDir) {
    const escapedRoot = rootDir.replace(/\\/g, '[\\\\/]');
    cleanMsg = cleanMsg.replace(new RegExp(escapedRoot, 'gi'), '.');
  }
  // Windows user profile redaction
  cleanMsg = cleanMsg.replace(/[A-Z]:\\[^\s:;,]+/gi, (match) => {
    const base = match.split(/[\\/]/).pop();
    return base ? `./${base}` : match;
  });

  // Redact API keys and authorization headers
  cleanMsg = cleanMsg.replace(/(gsk_[a-zA-Z0-9_-]{8,})/gi, 'gsk_***REDACTED***');
  cleanMsg = cleanMsg.replace(/(Bearer\s+[a-zA-Z0-9_.-]{10,})/gi, 'Bearer ***REDACTED***');

  return {
    msg: cleanMsg,
    code,
  };
}

/**
 * Pipeline Job Representation
 */
export class PipelineJob {
  constructor({ id, source, options = {}, broadcast = () => {} }) {
    this.id = id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.source = source;
    this.options = options;
    this.broadcast = broadcast;

    this.state = JOB_STATES.QUEUED;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.error = null;
    this.result = null;
  }

  transitionTo(newState, reason = null) {
    const allowed = ALLOWED_TRANSITIONS.get(this.state);
    if (!allowed || !allowed.has(newState)) {
      throw new Error(`Invalid job state transition: Cannot change from '${this.state}' to '${newState}'.`);
    }

    this.state = newState;
    if (newState === JOB_STATES.RUNNING && !this.startedAt) {
      this.startedAt = Date.now();
    }
    if (newState === JOB_STATES.COMPLETED || newState === JOB_STATES.FAILED || newState === JOB_STATES.STOPPED) {
      this.completedAt = Date.now();
    }
    if (reason && (newState === JOB_STATES.FAILED || newState === JOB_STATES.STOPPED)) {
      this.error = reason;
    }

    return this.state;
  }

  isTerminal() {
    return this.state === JOB_STATES.COMPLETED ||
           this.state === JOB_STATES.FAILED ||
           this.state === JOB_STATES.STOPPED;
  }
}

/**
 * Singleton Pipeline Job Coordinator
 */
export class JobCoordinator {
  constructor() {
    this.jobs = new Map(); // jobId -> PipelineJob
    this.activeJobId = null;
  }

  createJob({ id, source, options, broadcast }) {
    // Prevent duplicate submission if an active job is already processing
    if (this.activeJobId) {
      const activeJob = this.jobs.get(this.activeJobId);
      if (activeJob && !activeJob.isTerminal()) {
        const err = new Error(`A video processing job (${this.activeJobId}) is already running. Please wait or cancel it first.`);
        err.code = 'JOB_CONCURRENCY_LIMIT';
        throw err;
      }
    }

    const job = new PipelineJob({ id, source, options, broadcast });
    this.jobs.set(job.id, job);
    this.activeJobId = job.id;
    return job;
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  getActiveJob() {
    return this.activeJobId ? this.jobs.get(this.activeJobId) : null;
  }

  cancelActiveJob(reason = 'Cancelled by user') {
    const active = this.getActiveJob();
    if (active && !active.isTerminal()) {
      active.transitionTo(JOB_STATES.CANCELLING, reason);
      active.transitionTo(JOB_STATES.STOPPED, reason);
      this.activeJobId = null;
      return true;
    }
    return false;
  }

  completeJob(id, result = null) {
    const job = this.jobs.get(id);
    if (job && !job.isTerminal()) {
      job.result = result;
      job.transitionTo(JOB_STATES.COMPLETED);
      if (this.activeJobId === id) this.activeJobId = null;
    }
  }

  failJob(id, error) {
    const job = this.jobs.get(id);
    if (job && !job.isTerminal()) {
      job.transitionTo(JOB_STATES.FAILED, error?.message || error);
      if (this.activeJobId === id) this.activeJobId = null;
    }
  }
}

export const jobCoordinator = new JobCoordinator();
