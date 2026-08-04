// In-memory job queue with configurable concurrency.
// Jobs are processed FIFO. Progress events are emitted via EventEmitter.
// Results are cached for 24 hours.

import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class JobQueue extends EventEmitter {
  constructor({concurrency = 2, pipeline, tempDir} = {}) {
    super();
    this._concurrency = concurrency;
    this._pipeline = pipeline;
    this._tempDir = tempDir || os.tmpdir();
    this._jobs = new Map();
    this._queue = [];
    this._running = 0;
    this._cleanupInterval = setInterval(() => this._cleanup(), 60 * 60 * 1000); // hourly
  }

  /** Submit a job. Returns the job object immediately. */
  submit({url, options = {}, apiKey}) {
    const id = randomUUID();
    const job = {
      id,
      url,
      options,
      apiKey,
      status: 'queued',
      stage: null,
      progress: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      result: null,
      _events: [],
    };
    this._jobs.set(id, job);
    this._queue.push(id);
    this.emit('job-created', {id});
    this._processNext();
    return job;
  }

  /** Get a job by ID. Returns null if not found. */
  get(id) {
    return this._jobs.get(id) ?? null;
  }

  /** Stream progress events for a job via async iterator. */
  async *stream(id) {
    const job = this._jobs.get(id);
    if (!job) return;

    // Replay any already-emitted events
    for (const event of job._events) {
      yield event;
    }

    // Listen for new events
    if (job.status === 'complete' || job.status === 'failed') return;

    yield await new Promise((resolve) => {
      const handler = (event) => {
        if (event.id === id) {
          if (event.type === 'final') {
            this.off('job-event', handler);
            resolve(event);
          } else {
            resolve(event);
          }
        }
      };
      this.on('job-event', handler);
    });
  }

  /** Get all jobs (for recent jobs list). */
  getAll() {
    return [...this._jobs.values()].map(({_events, ...rest}) => rest);
  }

  /** Stop the queue and clean up. */
  shutdown() {
    clearInterval(this._cleanupInterval);
  }

  // ---- internal ---------------------------------------------------------

  async _processNext() {
    while (this._running < this._concurrency && this._queue.length > 0) {
      const id = this._queue.shift();
      const job = this._jobs.get(id);
      if (!job) continue;
      this._running++;
      this._processJob(job).finally(() => {
        this._running--;
        this._processNext();
      });
    }
  }

  async _processJob(job) {
    try {
      job.status = 'running';
      this._emitJobEvent(job, {type: 'progress', stage: 'starting', progress: 0, message: 'Starting pipeline...'});

      // Create temp dir for this job
      const jobDir = path.join(this._tempDir, `ytresearch-${job.id}`);
      fs.mkdirSync(jobDir, {recursive: true});

      const onProgress = (stage, progress, message, data) => {
        job.stage = stage;
        job.progress = progress;
        this._emitJobEvent(job, {type: 'progress', stage, progress, message, ...data});
      };

      // Run the pipeline
      const result = await this._pipeline({
        url: job.url,
        options: job.options,
        apiKey: job.apiKey,
        tempDir: jobDir,
        onProgress,
      });

      job.status = 'complete';
      job.completedAt = new Date().toISOString();
      job.result = result;
      this._emitJobEvent(job, {type: 'complete', result});
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = err.message ?? String(err);
      this._emitJobEvent(job, {type: 'error', message: job.error});
    } finally {
      // Clean up temp dir
      try { fs.rmSync(path.join(this._tempDir, `ytresearch-${job.id}`), {recursive: true, force: true}); } catch {}
    }
  }

  _emitJobEvent(job, event) {
    const ev = {id: job.id, ...event, ts: Date.now()};
    job._events.push(ev);
    // Keep only last 100 events in memory
    if (job._events.length > 100) job._events = job._events.slice(-100);
    this.emit('job-event', ev);
  }

  _cleanup() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this._jobs) {
      const createdAt = new Date(job.createdAt).getTime();
      if (createdAt < cutoff) {
        this._jobs.delete(id);
      }
    }
  }
}
