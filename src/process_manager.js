// =============================================
// L2S — Process Manager (Subprocess Registry)
// =============================================
// Tracks active child processes (yt-dlp, whisper, ffmpeg)
// and kills them cleanly on cancellation, keyed by jobId.

import { spawn, spawnSync } from 'child_process';

const IS_WINDOWS = process.platform === 'win32';
const activeProcesses = new Set();
const processesByJob = new Map(); // jobId -> Set<ChildProcess>

/**
 * Register a child process to be tracked, optionally keyed by jobId
 * @param {ChildProcess} child 
 * @param {string} [jobId]
 * @returns {ChildProcess}
 */
export function registerProcess(child, jobId = null) {
  if (!child || !child.pid) return child;
  activeProcesses.add(child);

  if (jobId) {
    if (!processesByJob.has(jobId)) {
      processesByJob.set(jobId, new Set());
    }
    processesByJob.get(jobId).add(child);
  }

  const cleanup = () => {
    activeProcesses.delete(child);
    if (jobId && processesByJob.has(jobId)) {
      const set = processesByJob.get(jobId);
      set.delete(child);
      if (set.size === 0) processesByJob.delete(jobId);
    }
  };

  child.on('exit', cleanup);
  child.on('error', cleanup);

  return child;
}

/**
 * Terminate child processes for a specific job immediately
 * @param {string} jobId 
 */
export function killJobProcesses(jobId) {
  if (!jobId || !processesByJob.has(jobId)) return;
  const procs = Array.from(processesByJob.get(jobId));
  processesByJob.delete(jobId);

  for (const p of procs) {
    activeProcesses.delete(p);
    try {
      if (p.pid && !p.killed) {
        if (IS_WINDOWS) {
          spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          try { p.kill('SIGKILL'); } catch {}
        } else {
          p.kill('SIGKILL');
        }
      }
    } catch (e) {
      // Process already terminated
    }
  }
}

/**
 * Terminate all running child processes immediately
 */
export function killAllProcesses() {
  const procs = Array.from(activeProcesses);
  activeProcesses.clear();
  processesByJob.clear();

  for (const p of procs) {
    try {
      if (p.pid && !p.killed) {
        if (IS_WINDOWS) {
          spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          try { p.kill('SIGKILL'); } catch {}
        } else {
          p.kill('SIGKILL');
        }
      }
    } catch (e) {
      // Process already terminated
    }
  }
}

/**
 * Spawn a child process and register it, optionally keyed by jobId
 */
export function spawnTracked(command, args, options = {}, jobId = null) {
  const child = spawn(command, args, {
    windowsHide: true,
    ...options,
  });
  return registerProcess(child, jobId);
}
