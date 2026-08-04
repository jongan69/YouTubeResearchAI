#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {commandExists, loadEnv, projectRoot} from './lib.mjs';

loadEnv();

const aiProvider = String(process.env.AI_PROVIDER || 'openai').toLowerCase();

const checks = [
  {name: 'node', required: true, ok: commandExists('node')},
  {name: 'npm', required: true, ok: commandExists('npm')},
  {name: 'yt-dlp', required: true, ok: commandExists('yt-dlp')},
  {name: 'ffmpeg', required: true, ok: commandExists('ffmpeg')},
  {name: 'ffprobe', required: true, ok: commandExists('ffprobe')},
  {name: '.env', required: true, ok: fs.existsSync(path.join(projectRoot, '.env'))},
];

// Provider-specific API key checks
const keyChecks = {
  openai: {
    name: 'OPENAI_API_KEY',
    required: true,
    ok: Boolean(process.env.OPENAI_API_KEY),
  },
  anthropic: {
    name: 'ANTHROPIC_API_KEY',
    required: true,
    ok: Boolean(process.env.ANTHROPIC_API_KEY),
  },
  google: {
    name: 'GOOGLE_API_KEY',
    required: true,
    ok: Boolean(process.env.GOOGLE_API_KEY),
  },
  'openai-compat': {
    name: 'OPENAI_API_KEY + OPENAI_BASE_URL',
    required: true,
    ok: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL),
  },
};

const keyCheck = keyChecks[aiProvider];
if (keyCheck) {
  checks.push(keyCheck);
} else {
  checks.push({
    name: 'AI_PROVIDER',
    required: true,
    ok: false,
  });
}

// If the report provider doesn't support transcription, check for a fallback
if (!['openai', 'openai-compat'].includes(aiProvider)) {
  const transcriptionProvider = String(
    process.env.TRANSCRIPTION_PROVIDER || 'openai',
  ).toLowerCase();
  if (transcriptionProvider === 'openai' || transcriptionProvider === 'openai-compat') {
    checks.push({
      name: `OPENAI_API_KEY (for transcription via ${transcriptionProvider})`,
      required: true,
      ok: Boolean(process.env.OPENAI_API_KEY),
    });
  }
}

// Research feature checks (optional)
const researchEnabled = process.env.RESEARCH_ENABLED === 'true' || process.env.RESEARCH_ENABLED === '1';
if (researchEnabled) {
  checks.push({
    name: 'RESEARCH_ENABLED',
    required: false,
    ok: true,
  });

  // Check network reachability for research APIs (non-blocking warnings)
  const researchApis = String(
    process.env.RESEARCH_APIS || 'arxiv,semantic_scholar,crossref,openalex',
  ).split(',').map((s) => s.trim());

  if (researchApis.includes('semantic_scholar')) {
    const hasKey = Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY);
    checks.push({
      name: 'SEMANTIC_SCHOLAR_API_KEY (optional, raises rate limit)',
      required: false,
      ok: hasKey ? 'set' : 'not set',
      value: hasKey,
    });
  }

  if (researchApis.includes('crossref')) {
    const hasMailto = Boolean(process.env.RESEARCH_MAILTO);
    checks.push({
      name: 'RESEARCH_MAILTO (recommended for CrossRef polite pool)',
      required: false,
      ok: hasMailto ? 'set' : 'not set',
      value: hasMailto,
    });
  }
}

console.log('YouTubeResearchAI doctor');
console.log('========================');
console.log(`AI provider: ${aiProvider}`);

for (const check of checks) {
  let mark;
  if (check.ok === true || check.ok === 'set') {
    mark = 'OK  ';
  } else if (!check.required && (check.ok === false || check.ok === 'not set')) {
    mark = 'INFO';
  } else if (check.required && !check.ok) {
    mark = 'MISS';
  } else {
    mark = 'SKIP';
  }
  console.log(`${mark} ${check.name}`);
}

const missing = checks.filter((check) => check.required && !check.ok);
if (missing.length > 0) {
  console.log('');
  console.log('Fix the missing required items above, then run again.');
  process.exit(1);
}

console.log('');
console.log('Ready.');
