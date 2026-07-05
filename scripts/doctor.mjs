#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {commandExists, loadEnv, projectRoot} from './lib.mjs';

loadEnv();

const checks = [
  {name: 'node', required: true, ok: commandExists('node')},
  {name: 'npm', required: true, ok: commandExists('npm')},
  {name: 'yt-dlp', required: true, ok: commandExists('yt-dlp')},
  {name: 'ffmpeg', required: true, ok: commandExists('ffmpeg')},
  {name: 'ffprobe', required: true, ok: commandExists('ffprobe')},
  {
    name: '.env',
    required: true,
    ok: fs.existsSync(path.join(projectRoot, '.env')),
  },
  {
    name: 'OPENAI_API_KEY',
    required: true,
    ok: Boolean(process.env.OPENAI_API_KEY),
  },
];

console.log('YouTubeResearchAI doctor');
console.log('========================');
for (const check of checks) {
  const mark = check.ok ? 'OK  ' : check.required ? 'MISS' : 'SKIP';
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
