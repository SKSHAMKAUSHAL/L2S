// =============================================
// Parallel Processor — Optimized Task Queue
// Implements smart concurrency control
// =============================================

import os from 'os';

class ParallelProcessor {
  constructor(maxConcurrency = null) {
    // Use reasonable defaults based on CPU count
    const cpuCount = os.cpus().length;
    
    // If GPU available: more conservative (2-3 parallel)
    // If CPU only: use more concurrency (cpuCount - 1)
    this.maxConcurrency = maxConcurrency || Math.max(2, cpuCount - 1);
    
    this.queue = [];
    this.running = 0;
    this.results = [];
    this.errors = [];
  }

  /**
   * Add task to queue
   * @param {Function} fn - Async function to execute
   * @param {number} priority - Task priority (higher = sooner)
   * @returns {Promise} Resolves when task completes
   */
  addTask(fn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, priority, resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processNext();
    });
  }

  /**
   * Execute next task in queue
   */
  async processNext() {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      this.results.push(result);
      resolve(result);
    } catch (error) {
      this.errors.push(error);
      reject(error);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  /**
   * Wait for all tasks to complete
   */
  async waitAll() {
    while (this.queue.length > 0 || this.running > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      maxConcurrency: this.maxConcurrency,
      running: this.running,
      queued: this.queue.length,
      completed: this.results.length,
      failed: this.errors.length,
      totalCpus: os.cpus().length,
    };
  }
}

export default ParallelProcessor;
