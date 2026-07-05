import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

export const loadEnv = () => {
  dotenv.config({path: path.join(projectRoot, '.env')});
};

export const parseArgs = (argv) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
};

export const ensureDir = (dir) => {
  fs.mkdirSync(dir, {recursive: true});
};

export const requireArg = (args, key, message) => {
  if (!args[key]) {
    throw new Error(message ?? `Missing required option --${key}`);
  }

  return String(args[key]);
};

export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
};

export const commandExists = (command) => {
  const result = spawnSync('zsh', ['-lc', `command -v ${command}`], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  return result.status === 0;
};

export const slugify = (value, fallback = 'video') => {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);

  return slug || fallback;
};

export const timestampSlug = (prefix = 'run') => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    prefix,
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-');
};

export const uniqueDir = (parent, preferredName) => {
  let candidate = path.join(parent, preferredName);
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${preferredName}-${suffix}`);
    suffix += 1;
  }

  return candidate;
};

export const formatTimestamp = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
};
