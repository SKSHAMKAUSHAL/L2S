// =============================================
// L2S — Clip Engine: Greedy Diversity Selector
// =============================================
// Sorts by score, applies Non-Maximum Suppression (drops overlap > 30%),
// caps at 2 clips per topic segment, and enforces a 20s minimum gap between clips.

/**
 * Determine which topic segment a candidate falls into
 */
function findTopicSegment(candidate, topicSegments = []) {
  if (!topicSegments.length) return 'T0';

  let bestTopic = topicSegments[0].id;
  let maxOverlap = -1;

  for (const topic of topicSegments) {
    const overlap = Math.max(0, Math.min(candidate.end, topic.end) - Math.max(candidate.start, topic.start));
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestTopic = topic.id;
    }
  }

  return bestTopic;
}

/**
 * Select the best diverse set of clips
 *
 * @param {Array<Object>} candidates - Scored and refined candidates
 * @param {Array<Object>} [topicSegments=[]] - Topic segments from topics.js
 * @param {number} [totalDuration=600] - Total video duration in seconds
 * @param {Object} [options]
 * @param {number|string} [options.clipCount]
 * @returns {{clips: Array<Object>, meta: Object}}
 */
export function selectDiverseClips(candidates = [], topicSegments = [], totalDuration = 600, options = {}) {
  const durationMinutes = totalDuration / 60;
  let targetCount;

  if (typeof options.clipCount === 'number' && options.clipCount > 0) {
    targetCount = options.clipCount;
  } else if (typeof options.clipCount === 'string' && !isNaN(parseInt(options.clipCount, 10))) {
    targetCount = parseInt(options.clipCount, 10);
  } else {
    // Auto mode formula: clamp(round(durationMinutes / 4), 3, 12)
    targetCount = Math.max(3, Math.min(12, Math.round(durationMinutes / 4)));
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      clips: [],
      meta: { targetCount, selectedCount: 0, fewerThanRequested: false },
    };
  }

  // 1. Sort descending by score
  const sorted = [...candidates].sort((a, b) => {
    const scoreA = a.finalScore ?? a.score ?? 0;
    const scoreB = b.finalScore ?? b.score ?? 0;
    return scoreB - scoreA;
  });

  const selected = [];
  const topicCounts = new Map();

  for (const c of sorted) {
    const topicId = findTopicSegment(c, topicSegments);
    const countInTopic = topicCounts.get(topicId) || 0;

    // Rule: At most 2 clips per topic segment
    if (countInTopic >= 2) {
      continue;
    }

    let conflicts = false;
    for (const s of selected) {
      const overlap = Math.max(0, Math.min(c.end, s.end) - Math.max(c.start, s.start));
      const minLen = Math.min(c.end - c.start, s.end - s.start);

      // Rule: Drop candidate when time overlap > 30% of shorter clip
      if (minLen > 0 && (overlap / minLen) > 0.30) {
        conflicts = true;
        break;
      }

      // Rule: Keep at least 20s between selected clips
      const gap = Math.max(0, Math.max(c.start, s.start) - Math.min(c.end, s.end));
      if (overlap > 0 || gap < 20) {
        conflicts = true;
        break;
      }
    }

    if (!conflicts) {
      selected.push({
        ...c,
        topicId,
      });
      topicCounts.set(topicId, countInTopic + 1);

      if (selected.length >= targetCount) {
        break;
      }
    }
  }

  return {
    clips: selected,
    meta: {
      targetCount,
      selectedCount: selected.length,
      fewerThanRequested: selected.length < targetCount,
      reason: selected.length < targetCount ? 'Not enough high-quality non-overlapping segments found' : null,
    },
  };
}
