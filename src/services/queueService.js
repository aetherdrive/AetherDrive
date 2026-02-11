/*
 * Offline/async job queue service
 *
 * This module defines a simple abstraction for queuing long‑running or
 * asynchronous jobs (e.g. sending a‑meldinger, uploading payment files).
 * In a production system you might use a library like bull, bullmq or
 * agenda with Redis for durable queues. Here we provide a basic in‑memory
 * queue that retains tasks and drains them when connectivity is restored.
 *
 * If RUN_MODE is set to `starlink`, you can extend this service to persist
 * queued jobs to disk and retry them when network connectivity changes.
 */

const queue = [];

export function enqueue(task) {
  queue.push({ task, createdAt: new Date().toISOString() });
}

export function drain(handler) {
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      handler(item.task);
    } catch (e) {
      // requeue on failure
      queue.unshift(item);
      throw e;
    }
  }
}

export function pending() {
  return queue.length;
}