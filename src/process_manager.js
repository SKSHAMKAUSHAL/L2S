// =============================================
// L2S — Process Manager (Subprocess Registry)
// =============================================
// Tracks active child processes (yt-dlp, whisper, ffmpeg)
// and kills them cleanly on cancellation.

import { spawn, spawnSync } from 'child_process';

const IS_WINDOWS = process.platform === 'win32';
const activeProcesses = new Set();

/**
 * Register a child process to be tracked
 * @param {ChildProcess} child 
 * @returns {ChildProcess}
 */
export function registerProcess(child) {
  if (!child || !child.pid) return child;
  activeProcesses.add(child);

  child.on('exit', () => {
    activeProcesses.delete(child);
  });
  child.on('error', () => {
    activeProcesses.delete(child);
  });

  return child;
}

/**
 * Terminate all running child processes immediately
 */
export function killAllProcesses() {
  const procs = Array.from(activeProcesses);
  activeProcesses.clear();

  for (const p of procs) {
    try {
      if (p.pid && !p.killed) {
        if (IS_WINDOWS) {
          spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
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
 * Spawn a child process and register it
 */
export function spawnTracked(command, args, options = {}) {
  const child = spawn(command, args, {
    windowsHide: true,
    ...options,
  });
  return registerProcess(child);
}
