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

// ---- Job queue -------------------------------------------------------------

const queue = new JobQueue({concurrency: 2, pipeline: runPipeline});

// ---- Simple HTTP router (zero dependencies) --------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

const json = (res, data, status = 200) => {
  res.writeHead(status, {...corsHeaders, 'Content-Type': 'application/json'});
  res.end(JSON.stringify(data));
};

const parseBody = async (req) => {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const raw = Buffer.concat(buffers).toString();
  try { return JSON.parse(raw); } catch { return {}; }
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
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  try {
    // GET /api/health
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, {status: 'ok', uptime: process.uptime(), queueSize: queue.getAll().length});
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
      const {_events, ...jobData} = job;
      return json(res, jobData);
    }

    // GET /api/jobs/:id/stream (SSE)
    if (req.method === 'GET' && url.pathname.endsWith('/stream')) {
      const id = url.pathname.split('/api/jobs/')[1].replace('/stream', '');
      const job = queue.get(id);
      if (!job) {
        res.writeHead(404, corsHeaders);
        res.end();
        return;
      }

      res.writeHead(200, {
        ...corsHeaders,
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
      const body = await parseBody(req);
      const apiKey = resolveApiKey(body, req.headers, ip);

      if (!apiKey) {
        return json(res, {
          error: 'API key required. Provide your OpenAI/Anthropic key in the X-API-Key header or apiKey field. Free tier limit reached for today.',
          freeTierRemaining: OPERATOR_KEY ? Math.max(0, FREE_TIER_LIMIT - (freeTierCounts.get(`${ip}:${new Date().toISOString().slice(0,10)}`) ?? 0)) : 0,
        }, 402);
      }

      const url = body.url;
      if (!url) return json(res, {error: 'url is required'}, 400);

      const job = queue.submit({
        url,
        options: body.options ?? {research: true},
        apiKey: apiKey === OPERATOR_KEY ? undefined : apiKey, // Don't pass operator key as override
      });

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
    console.error('Server error:', err);
    json(res, {error: 'Internal server error'}, 500);
  }
});

server.listen(PORT, () => {
  console.log(`YTResearchAI web server running on http://localhost:${PORT}`);
  console.log(`Free tier: ${FREE_TIER_LIMIT} reports/day${OPERATOR_KEY ? ' (enabled)' : ' (disabled — set OPERATOR_OPENAI_KEY to enable)'}`);
  console.log(`Endpoints: POST /api/jobs, GET /api/jobs/:id, GET /api/jobs/:id/stream`);
});
