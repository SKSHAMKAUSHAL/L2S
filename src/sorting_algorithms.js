// =============================================
// Sorting Algorithms — O(n log n) Performance
// Merge-sort and quick-select for clip ranking
// =============================================

/**
 * Merge-sort: O(n log n) stable sort for clips
 * Preserves relative order of equal-score clips
 * @param {Array} clips - Array of clips to sort
 * @param {Function} compareFn - Comparison function
 * @returns {Array} Sorted clips
 */
export function mergeSort(clips, compareFn = (a, b) => b.score - a.score) {
  if (clips.length <= 1) return clips;

  const mid = Math.floor(clips.length / 2);
  const left = mergeSort(clips.slice(0, mid), compareFn);
  const right = mergeSort(clips.slice(mid), compareFn);

  return merge(left, right, compareFn);
}

/**
 * Merge two sorted arrays
 */
function merge(left, right, compareFn) {
  const result = [];
  let i = 0, j = 0;

  while (i < left.length && j < right.length) {
    if (compareFn(left[i], right[j]) <= 0) {
      result.push(left[i++]);
    } else {
      result.push(right[j++]);
    }
  }

  return result.concat(left.slice(i), right.slice(j));
}

/**
 * Quick-select: O(n) average-case selection
 * Find k-th largest element without full sort
 * @param {Array} clips - Array of clips
 * @param {number} k - Position to find (0-indexed)
 * @param {Function} compareFn - Comparison function
 * @returns {*} Element at position k
 */
export function quickSelect(clips, k, compareFn = (a, b) => b.score - a.score) {
  if (clips.length === 0) return null;
  if (k >= clips.length) return null;

  const partition = (arr, low, high) => {
    const pivot = arr[high];
    let i = low - 1;

    for (let j = low; j < high; j++) {
      if (compareFn(arr[j], pivot) <= 0) {
        i++;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }

    [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];
    return i + 1;
  };

  let low = 0, high = clips.length - 1;

  while (low <= high) {
    const p = partition(clips, low, high);
    
    if (p === k) return clips[p];
    if (p < k) {
      low = p + 1;
    } else {
      high = p - 1;
    }
  }

  return null;
}

/**
 * Get top-k clips efficiently
 * Faster than sorting entire array when k << n
 * @param {Array} clips - Array of clips
 * @param {number} k - Number of top clips to return
 * @param {Function} compareFn - Comparison function
 * @returns {Array} Top k clips sorted
 */
export function getTopK(clips, k, compareFn = (a, b) => b.score - a.score) {
  if (k >= clips.length) {
    return mergeSort([...clips], compareFn);
  }

  // For small k, use partial sort approach
  // Find k-th element position
  const clipsClone = [...clips];
  quickSelect(clipsClone, k - 1, compareFn);
  
  // Get top k and sort them
  const topK = clipsClone.slice(0, k);
  return mergeSort(topK, compareFn);
}

/**
 * Three-way partition for clips with ties
 * Handles multiple clips with same score efficiently
 * @param {Array} clips - Array of clips
 * @param {Function} keyFn - Function to extract sort key
 * @returns {Object} { less, equal, greater }
 */
export function threeWayPartition(clips, keyFn = clip => clip.score) {
  const pivot = clips[Math.floor(Math.random() * clips.length)];
  const pivotKey = keyFn(pivot);

  const less = [];
  const equal = [];
  const greater = [];

  for (const clip of clips) {
    const key = keyFn(clip);
    if (key < pivotKey) {
      less.push(clip);
    } else if (key === pivotKey) {
      equal.push(clip);
    } else {
      greater.push(clip);
    }
  }

  return { less, equal, greater };
}

/**
 * Radix sort for integer scores (very fast for bounded ranges)
 * O(n * k) where k is number of digits
 * @param {Array} clips - Array of clips
 * @param {Function} keyFn - Function to extract numeric key
 * @returns {Array} Sorted clips
 */
export function radixSort(clips, keyFn = clip => Math.floor(clip.score) || 0) {
  if (clips.length === 0) return clips;

  // Find max value to determine digit count
  const maxValue = Math.max(...clips.map(keyFn));
  if (maxValue < 0) {
    // Handle negative numbers: separate and sort
    const positive = clips.filter(c => keyFn(c) >= 0);
    const negative = clips.filter(c => keyFn(c) < 0);
    return radixSort(negative, keyFn).reverse().concat(radixSort(positive, keyFn));
  }

  const digitCount = String(maxValue).length;
  const result = [...clips];

  // Counting sort for each digit (LSD radix sort)
  for (let digit = 0; digit < digitCount; digit++) {
    const buckets = Array.from({ length: 10 }, () => []);
    const divisor = Math.pow(10, digit);

    for (const clip of result) {
      const key = keyFn(clip);
      const digitValue = Math.floor((key / divisor) % 10);
      buckets[digitValue].push(clip);
    }

    result.length = 0;
    result.push(...buckets.flat());
  }

  return result.reverse(); // Descending order
}

/**
 * Bucket sort for clips with bounded score range
 * O(n) average case for well-distributed scores
 * @param {Array} clips - Array of clips
 * @param {number} bucketCount - Number of buckets (default: 10)
 * @param {Function} keyFn - Function to extract score
 * @returns {Array} Sorted clips
 */
export function bucketSort(clips, bucketCount = 10, keyFn = clip => clip.score) {
  if (clips.length === 0) return clips;

  const scores = clips.map(keyFn);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore || 1;

  const buckets = Array.from({ length: bucketCount }, () => []);

  // Distribute clips into buckets
  for (const clip of clips) {
    const score = keyFn(clip);
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor(((score - minScore) / range) * bucketCount)
    );
    buckets[bucketIndex].push(clip);
  }

  // Sort each bucket and concatenate (reverse for descending)
  const result = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    result.push(...buckets[i].sort((a, b) => keyFn(b) - keyFn(a)));
  }

  return result;
}

/**
 * Benchmark sort performance
 * Returns timing for different algorithms
 */
export function benchmarkSort(clips, k) {
  const results = {};
  const iterations = 3;

  // Merge sort
  {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      mergeSort([...clips]);
      times.push(performance.now() - start);
    }
    results.mergeSort = Math.round(times.reduce((a, b) => a + b) / iterations);
  }

  // Bucket sort
  {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      bucketSort([...clips], 20);
      times.push(performance.now() - start);
    }
    results.bucketSort = Math.round(times.reduce((a, b) => a + b) / iterations);
  }

  // Radix sort
  {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      radixSort([...clips]);
      times.push(performance.now() - start);
    }
    results.radixSort = Math.round(times.reduce((a, b) => a + b) / iterations);
  }

  return results;
}
