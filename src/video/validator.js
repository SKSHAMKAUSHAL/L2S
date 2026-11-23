// =============================================
// L2S — Boundary & Timestamp Validator
// =============================================
// Enforces mathematical and physical sanity on all clip
// boundaries, duration ranges, and manual timestamps.

/**
 * Validate a single start/end time range
 *
 * @param {Object} params
 * @param {number} params.start - Start time in seconds
 * @param {number} params.end - End time in seconds
 * @param {number} [params.maxDuration] - Total duration of source video in seconds
 * @param {number} [params.minDuration=0.5] - Minimum allowable clip duration
 * @returns {{ valid: boolean, start: number, end: number, duration: number, error?: string }}
 */
export function validateTimeRange({ start, end, maxDuration = null, minDuration = 0.5 }) {
  const numStart = Number(start);
  const numEnd = Number(end);

  if (start === null || start === undefined || typeof start === 'boolean' || !Number.isFinite(numStart) || isNaN(numStart)) {
    return { valid: false, error: `Invalid start time: "${start}" is not a finite number.` };
  }

  if (end === null || end === undefined || typeof end === 'boolean' || !Number.isFinite(numEnd) || isNaN(numEnd)) {
    return { valid: false, error: `Invalid end time: "${end}" is not a finite number.` };
  }

  if (numStart < 0) {
    return { valid: false, error: `Start time cannot be negative (${numStart}s).` };
  }

  if (numEnd <= numStart) {
    return { valid: false, error: `End time (${numEnd}s) must be strictly greater than start time (${numStart}s).` };
  }

  const duration = numEnd - numStart;
  if (duration < minDuration) {
    return { valid: false, error: `Clip duration (${duration.toFixed(2)}s) is shorter than minimum allowed (${minDuration}s).` };
  }

  if (maxDuration !== null && Number.isFinite(maxDuration) && maxDuration > 0) {
    // Allow small epsilon (0.5s) for audio lead-out rounding
    if (numStart >= maxDuration) {
      return { valid: false, error: `Start time (${numStart}s) exceeds total media duration (${maxDuration}s).` };
    }
    if (numEnd > maxDuration + 1.0) {
      return { valid: false, error: `End time (${numEnd}s) exceeds total media duration (${maxDuration}s).` };
    }
  }

  return {
    valid: true,
    start: Math.round(numStart * 100) / 100,
    end: Math.round(numEnd * 100) / 100,
    duration: Math.round(duration * 100) / 100,
  };
}

/**
 * Validate and sanitize an array of clip candidates or manual timestamps
 *
 * @param {Array<Object>} clips - Array of clip objects
 * @param {number} [mediaDuration] - Total duration of source media
 * @returns {{ validClips: Array<Object>, rejected: Array<Object> }}
 */
export function sanitizeAndValidateClips(clips, mediaDuration = null) {
  if (!Array.isArray(clips)) {
    return { validClips: [], rejected: [{ error: 'Clips must be an array' }] };
  }

  const validClips = [];
  const rejected = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const rawStart = c.custom?.editStart ?? c.chunk?.start ?? c.start;
    const rawEnd = c.custom?.editEnd ?? c.chunk?.end ?? c.end;

    const validation = validateTimeRange({
      start: rawStart,
      end: rawEnd,
      maxDuration: mediaDuration,
      minDuration: 1.0,
    });

    if (validation.valid) {
      validClips.push({
        ...c,
        start: validation.start,
        end: validation.end,
        duration: validation.duration,
      });
    } else {
      rejected.push({
        index: i,
        clip: c,
        error: validation.error,
      });
    }
  }

  return { validClips, rejected };
}
