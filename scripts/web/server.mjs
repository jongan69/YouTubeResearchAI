#!/usr/bin/env node
// Express web server for the YTResearchAI web app.
// Start: node scripts/web/server.mjs
// Env:  PORT=3000, OPERATOR_OPENAI_KEY=sk-..., FREE_TIER_DAILY_LIMIT=10

import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {loadEnv} from '../lib.mjs';
import {runPipeline} from '../pipeline.mjs';
import {JobQueue} from './job-queue.mjs';

loadEnv();

const PORT = process.env.PORT || 3000;
const FREE_TIER_LIMIT = Number(process.env.FREE_TIER_DAILY_LIMIT ?? 10);
const OPERATOR_KEY = process.env.OPERATOR_OPENAI_KEY;
const MAX_BODY_SIZE = 1_048_576; // 1 MB
const MAX_QUEUE_SIZE = 100;
const MAX_URL_LENGTH = 2048;

// ---- Rate limiting (token bucket per IP) -----------------------------------

const rateBuckets = new Map();
const RATE_LIMITS = { perSecond: 1, perMinute: 60, perHour: 300 };

const checkRateLimit = (ip) => {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || (now - bucket.resetAt) > 3600_000) {
    bucket = { tokens: RATE_LIMITS.perHour, resetAt: now + 3600_000, lastRefill: now };
    rateBuckets.set(ip, bucket);
  }
  // Refill tokens (1 token per second, up to perHour cap)
  const elapsed = Math.floor((now - bucket.lastRefill) / 1000);
  if (elapsed > 0) {
    bucket.tokens = Math.min(RATE_LIMITS.perHour, bucket.tokens + elapsed * RATE_LIMITS.perSecond);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  bucket.tokens--;
  return { allowed: true, remaining: bucket.tokens };
};
// Hourly cleanup of stale buckets
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [ip, b] of rateBuckets) { if (b.resetAt < cutoff) rateBuckets.delete(ip); }
}, 60 * 60_000);

// ---- Free tier tracking ----------------------------------------------------

const freeTierCounts = new Map();
const isWithinFreeLimit = (ip) => {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${ip}:${today}`;
  return (freeTierCounts.get(key) ?? 0) < FREE_TIER_LIMIT;
};
const incrementFreeTier = (ip) => {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${ip}:${today}`;
  freeTierCounts.set(key, (freeTierCounts.get(key) ?? 0) + 1);
};
// Daily cleanup
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const key of freeTierCounts.keys()) {
    if (!key.endsWith(`:${today}`)) freeTierCounts.delete(key);
  }
}, 60 * 60 * 1000);

// ---- Helpers ---------------------------------------------------------------

/** Extract real client IP — on Cloud Run the real IP is the LAST in x-forwarded-for */
const getClientIP = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const parts = fwd.split(',').map(s => s.trim()).filter(Boolean);
    // Cloud Run prepends proxies; real client IP is the last one
    // If only one value, it's the direct client
    return parts.length > 1 ? parts[parts.length - 1] : parts[0];
  }
  return req.socket.remoteAddress || 'unknown';
};

/** Validate a video URL — must be http/https with a host */
const isValidUrl = (s) => {
  if (typeof s !== 'string' || s.length > MAX_URL_LENGTH) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch { return false; }
};

// ---- Job queue -------------------------------------------------------------

const queue = new JobQueue({concurrency: 2, pipeline: runPipeline});

// ---- Simple HTTP router (zero dependencies) --------------------------------

const securityHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0', // deprecated but signals intent
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const json = (res, data, status = 200) => {
  res.writeHead(status, {...securityHeaders, 'Content-Type': 'application/json'});
  res.end(JSON.stringify(data));
};

const parseBody = async (req) => {
  const buffers = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) throw Object.assign(new Error('Request body too large'), {statusCode: 413});
    buffers.push(chunk);
  }
  const raw = Buffer.concat(buffers).toString();
  try { return JSON.parse(raw); } catch { if (raw.length > 0) throw Object.assign(new Error('Invalid JSON'), {statusCode: 400}); return {}; }
};

const resolveApiKey = (body, headers, ip) => {
  // 1. User-provided key
  if (headers['x-api-key']) return headers['x-api-key'];
  if (body?.apiKey) return body.apiKey;

  // 2. Operator free tier
  if (OPERATOR_KEY && isWithinFreeLimit(ip)) {
    incrementFreeTier(ip);
    return OPERATOR_KEY;
  }

  return null;
};

// ---- Routes -----------------------------------------------------------------

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, securityHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = getClientIP(req);
  const requestId = randomUUID().slice(0, 8);
  const startMs = Date.now();

  // Apply rate limiting
  const rate = checkRateLimit(ip);
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return json(res, {error: 'Too many requests', retryAfter: rate.retryAfter}, 429);
  }

  try {
    // GET /api/health
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const jobs = queue.getAll();
      const active = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
      const mem = process.memoryUsage();
      return json(res, {
        status: 'ok', uptime: Math.round(process.uptime()),
        activeJobs: active, totalJobs: jobs.length, queueLimit: MAX_QUEUE_SIZE,
        memory: { heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024), heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024) },
      });
    }

    // GET /api/jobs
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      return json(res, queue.getAll().slice(0, 50));
    }

    // GET /api/jobs/:id
    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/') && !url.pathname.endsWith('/stream') && !url.pathname.endsWith('/report')) {
      const id = url.pathname.split('/api/jobs/')[1];
      const job = queue.get(id);
      if (!job) return json(res, {error: 'Job not found'}, 404);
      const {_events, apiKey, errorStack, ...jobData} = job;
      return json(res, jobData);
    }

    // GET /api/jobs/:id/stream (SSE)
    if (req.method === 'GET' && url.pathname.endsWith('/stream')) {
      const id = url.pathname.split('/api/jobs/')[1].replace('/stream', '');
      const job = queue.get(id);
      if (!job) {
        res.writeHead(404, securityHeaders);
        res.end();
        return;
      }

      res.writeHead(200, {
        ...securityHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send current state
      if (job.status === 'complete') {
        res.write(`event: complete\ndata: ${JSON.stringify({jobId: job.id, result: job.result})}\n\n`);
        res.end();
        return;
      }
      if (job.status === 'failed') {
        res.write(`event: error\ndata: ${JSON.stringify({jobId: job.id, message: job.error})}\n\n`);
        res.end();
        return;
      }

      res.write(`event: progress\ndata: ${JSON.stringify({jobId: job.id, status: job.status, stage: job.stage, progress: job.progress})}\n\n`);

      // Listen for updates
      const onEvent = (ev) => {
        if (ev.id !== id) return;
        if (ev.type === 'progress') {
          res.write(`event: progress\ndata: ${JSON.stringify({jobId: id, stage: ev.stage, progress: ev.progress, message: ev.message})}\n\n`);
        } else if (ev.type === 'complete') {
          res.write(`event: complete\ndata: ${JSON.stringify({jobId: id, result: ev.result})}\n\n`);
          queue.off('job-event', onEvent);
          res.end();
        } else if (ev.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({jobId: id, message: ev.message})}\n\n`);
          queue.off('job-event', onEvent);
          res.end();
        }
      };
      queue.on('job-event', onEvent);

      req.on('close', () => queue.off('job-event', onEvent));
      return;
    }

    // GET /api/jobs/:id/report
    if (req.method === 'GET' && url.pathname.endsWith('/report')) {
      const id = url.pathname.split('/api/jobs/')[1].replace('/report', '');
      const job = queue.get(id);
      if (!job || !job.result) return json(res, {error: 'Report not found'}, 404);
      return json(res, {
        reportMarkdown: job.result.reportMarkdown,
        title: job.result.title,
        references: job.result.references,
        methodology: job.result.methodology,
      });
    }

    // POST /api/jobs
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      // Enforce body size limit
      const contentLength = Number(req.headers['content-length'] ?? 0);
      if (contentLength > MAX_BODY_SIZE) {
        return json(res, {error: `Request body too large (max ${MAX_BODY_SIZE / 1024 / 1024} MB)`}, 413);
      }

      const body = await parseBody(req);
      const apiKey = resolveApiKey(body, req.headers, ip);

      if (!apiKey) {
        const today = new Date().toISOString().slice(0,10);
        const used = freeTierCounts.get(`${ip}:${today}`) ?? 0;
        const remaining = OPERATOR_KEY ? Math.max(0, FREE_TIER_LIMIT - used) : 0;
        return json(res, {
          error: 'API key required. Provide your OpenAI/Anthropic key in the X-API-Key header or apiKey field.',
          freeTier: {used, limit: FREE_TIER_LIMIT, remaining, resetsAt: `${today}T23:59:59Z`},
        }, 402);
      }

      if (!body.url || !isValidUrl(body.url)) {
        return json(res, {error: 'A valid http/https video URL is required'}, 400);
      }

      // Queue size limit
      const pending = queue.getAll().filter(j => j.status === 'queued' || j.status === 'running').length;
      if (pending >= MAX_QUEUE_SIZE) {
        return json(res, {error: 'Server busy — too many jobs queued. Try again later.'}, 503);
      }

      const job = queue.submit({
        url: body.url,
        options: body.options ?? {research: true},
        apiKey: apiKey === OPERATOR_KEY ? undefined : apiKey, // Don't pass operator key as override
      });

      res.setHeader('X-Job-Id', job.id);
      return json(res, {jobId: job.id, status: job.status}, 202);
    }

    // POST /api/validate-key
    if (req.method === 'POST' && url.pathname === '/api/validate-key') {
      const body = await parseBody(req);
      const key = body.apiKey || req.headers['x-api-key'];
      if (!key) return json(res, {valid: false, error: 'No key provided'}, 400);

      try {
        // Quick validation: make a minimal API call
        const isOpenAI = key.startsWith('sk-');
        if (isOpenAI) {
          const r = await fetch('https://api.openai.com/v1/models', {
            headers: {'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json'},
            signal: AbortSignal.timeout(10000),
          });
          return json(res, {valid: r.ok, provider: 'openai'});
        }
        const isAnthropic = key.startsWith('sk-ant-');
        if (isAnthropic) {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
            body: JSON.stringify({model: 'claude-sonnet-5-20251001', max_tokens: 1, messages: [{role: 'user', content: '.'}]}),
            signal: AbortSignal.timeout(10000),
          });
          return json(res, {valid: r.status !== 401, provider: 'anthropic'});
        }
        return json(res, {valid: false, error: 'Unknown key format'});
      } catch (e) {
        return json(res, {valid: false, error: e.message});
      }
    }

    // 404
    json(res, {error: 'Not found'}, 404);
  } catch (err) {
    const code = err.statusCode ?? 500;
    const level = code >= 500 ? 'error' : 'warn';
    const log = {ts: new Date().toISOString(), rid: requestId, level, method: req.method, path: url.pathname, ip, status: code, error: err.message};
    if (code >= 500) log.stack = err.stack?.split('\n').slice(0, 4).join(' | ');
    console[code >= 500 ? 'error' : 'warn'](JSON.stringify(log));
    json(res, {error: code >= 500 ? 'Internal server error' : err.message, requestId}, code);
  } finally {
    const durationMs = Date.now() - startMs;
    // Structured access log
    console.log(JSON.stringify({
      ts: new Date().toISOString(), rid: requestId, level: 'info',
      method: req.method, path: url.pathname, ip, status: res.statusCode, durationMs,
    }));
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level: 'info', event: 'startup',
    port: PORT, freeTierLimit: FREE_TIER_LIMIT,
    freeTierEnabled: Boolean(OPERATOR_KEY),
    maxQueueSize: MAX_QUEUE_SIZE,
    ratePerSec: RATE_LIMITS.perSecond, ratePerMin: RATE_LIMITS.perMinute,
    nodeVersion: process.version, platform: process.platform,
  }));
});

// ---- Graceful shutdown ---------------------------------------------------

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal}));

  // Stop accepting new jobs
  queue._queue.length = 0; // Clear pending queue

  // Wait for running jobs to finish (up to 8s of Cloud Run's 10s grace period)
  const deadline = Date.now() + 8000;
  const waitForRunning = () => {
    const running = queue.getAll().filter(j => j.status === 'running').length;
    if (running === 0 || Date.now() >= deadline) {
      queue.shutdown();
      server.close(() => process.exit(0));
    } else {
      setTimeout(waitForRunning, 200);
    }
  };
  waitForRunning();

  // Force exit after deadline
  setTimeout(() => { queue.shutdown(); process.exit(0); }, 9000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---- Crash handlers ------------------------------------------------------

process.on('unhandledRejection', (reason, promise) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(), level: 'error', event: 'unhandledRejection',
    error: reason?.message ?? String(reason),
    stack: reason?.stack?.split('\n').slice(0, 6).join(' | '),
  }));
});

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(), level: 'error', event: 'uncaughtException',
    error: err.message, stack: err.stack?.split('\n').slice(0, 6).join(' | '),
  }));
  // Don't exit — let the process limp along. If it's truly fatal, it'll crash anyway.
});
