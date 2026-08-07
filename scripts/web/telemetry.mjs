// Lightweight PostHog telemetry — zero dependencies, fire-and-forget fetch.
// Captures: startup, job-completed, job-failed, rate-limited, shutdown.
// Disabled when POSTHOG_API_KEY is unset (noop).

const PH_KEY = process.env.POSTHOG_API_KEY;
const PH_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
const ENABLED = Boolean(PH_KEY);

let instanceId = null;
let distinctId = 'ytresearch-server';

const queue = [];
let draining = false;

const drain = async () => {
  if (draining || !queue.length) return;
  draining = true;
  const batch = queue.splice(0, Math.min(queue.length, 20));
  try {
    await fetch(`${PH_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: PH_KEY, batch }),
    });
  } catch { /* fire and forget */ }
  draining = false;
  if (queue.length) drain();
};

/** Enqueue an event. Batched every 5s or 20 events, whichever comes first. */
const capture = (event, properties = {}) => {
  if (!ENABLED) return;
  queue.push({
    event,
    properties: { ...properties, $lib: 'ytresearch-web', instance: instanceId },
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
  });
  if (queue.length >= 20) drain();
};

// Periodic drain
if (ENABLED) setInterval(drain, 5000);

// ---- Public API ------------------------------------------------------------

export const init = (opts = {}) => {
  instanceId = opts.instanceId || `ytresearch-${Math.random().toString(36).slice(2, 8)}`;
  if (opts.distinctId) distinctId = opts.distinctId;
  capture('server-started', {
    nodeVersion: process.version,
    platform: process.platform,
    freeTierLimit: opts.freeTierLimit,
    maxQueueSize: opts.maxQueueSize,
  });
};

export const jobCreated = (jobId, { url, hasApiKey }) => {
  capture('job-created', { jobId, urlDomain: tryDomain(url), hasApiKey: Boolean(hasApiKey) });
};

export const jobCompleted = (jobId, { url, durationMs, sourcesCited, reportLength }) => {
  capture('job-completed', {
    jobId, urlDomain: tryDomain(url), durationMs,
    sourcesCited: sourcesCited ?? 0, reportLength: reportLength ?? 0,
  });
};

export const jobFailed = (jobId, { url, error, stage, durationMs }) => {
  capture('job-failed', {
    jobId, urlDomain: tryDomain(url),
    error: String(error).slice(0, 200), stage: stage ?? 'unknown',
    durationMs: durationMs ?? 0,
  });
};

export const rateLimited = (ip) => {
  capture('rate-limited', { ip: String(ip).slice(0, 15) });
};

export const shutdown = () => {
  capture('server-shutdown', {});
  return drain(); // flush before exit
};

const tryDomain = (url) => {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
};

export default { init, jobCreated, jobCompleted, jobFailed, rateLimited, shutdown };
