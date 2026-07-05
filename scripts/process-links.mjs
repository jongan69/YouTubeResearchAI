#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import OpenAI from 'openai';
import {
  ensureDir,
  formatTimestamp,
  loadEnv,
  parseArgs,
  projectRoot,
  slugify,
  timestampSlug,
  uniqueDir,
} from './lib.mjs';

const usage = `
Usage:
  npm run research -- [options]

Options:
  --links FILE                Links file. Default: ./links.txt
  --out-dir DIR               Output root. Default: ./outputs
  --run-name NAME             Run folder name. Default: run-YYYY-MM-DD-HHMMSS
  --download-dir DIR          Download folder. Default: current run folder/downloads
  --transcription-model ID    Default: OPENAI_TRANSCRIPTION_MODEL or whisper-1
  --report-model ID           Default: OPENAI_REPORT_MODEL or gpt-4.1
  --prompt TEXT               Transcription prompt for names, jargon, acronyms.
  --chunk-seconds N           Audio chunk seconds. Default: 180
  --skip-download             Treat link lines as local video paths.
  --no-report                 Download and transcribe only.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(usage);
  process.exit(0);
}

loadEnv();
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required. Add it to .env.');
}

const linksPath = path.resolve(String(args.links ?? path.join(projectRoot, 'links.txt')));
const outRoot = path.resolve(String(args['out-dir'] ?? path.join(projectRoot, 'outputs')));
const runName = String(args['run-name'] ?? timestampSlug('run'));
const runDir = uniqueDir(outRoot, runName);
const downloadDir = path.resolve(String(args['download-dir'] ?? path.join(runDir, 'downloads')));
const transcriptDir = path.join(runDir, 'transcripts');
const reportDir = path.join(runDir, 'reports');
const manifestPath = path.join(runDir, 'manifest.json');
const transcriptionModel = String(
  args['transcription-model'] ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'whisper-1',
);
const reportModel = String(args['report-model'] ?? process.env.OPENAI_REPORT_MODEL ?? 'gpt-4.1');
const chunkSeconds = Math.max(30, Number(args['chunk-seconds'] ?? 180));
const noReport = Boolean(args['no-report']);
const skipDownload = Boolean(args['skip-download']);

if (!fs.existsSync(linksPath)) {
  throw new Error(`Links file not found: ${linksPath}`);
}

const inputs = fs
  .readFileSync(linksPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

if (inputs.length === 0) {
  throw new Error(`No links or local paths found in ${linksPath}`);
}

ensureDir(outRoot);
ensureDir(runDir);
ensureDir(downloadDir);
ensureDir(transcriptDir);
ensureDir(reportDir);
fs.copyFileSync(linksPath, path.join(runDir, 'links.txt'));

const openai = new OpenAI({maxRetries: 0});
const manifest = {
  createdAt: new Date().toISOString(),
  linksPath,
  runDir,
  downloadDir,
  transcriptDir,
  reportDir,
  transcriptionModel,
  reportModel: noReport ? null : reportModel,
  items: [],
};

const writeManifest = () => {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const isRetryable = (error) => {
  const status = Number(error?.status ?? error?.response?.status ?? 0);
  const code = String(error?.code ?? error?.cause?.code ?? '');

  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)
  );
};

const withRetry = async (label, fn, retries = 5) => {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retries) {
        throw error;
      }
      const delayMs = Math.min(30000, 1500 * 2 ** (attempt - 1));
      console.warn(
        `${label} failed with ${error?.status ?? error?.code ?? 'unknown error'}; retrying in ${Math.round(
          delayMs / 1000,
        )}s...`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
};

const downloadVideo = (url) => {
  const outputTemplate = path.join(downloadDir, '%(title).180B [%(id)s].%(ext)s');
  const baseArgs = [
    '--no-playlist',
    '--extractor-args',
    'youtube:player_client=android,web',
    '--merge-output-format',
    'mp4',
    '--remux-video',
    'mp4',
    '--write-info-json',
    '--output',
    outputTemplate,
    '--print',
    'after_move:filepath',
    url,
  ];

  let stdout = '';
  try {
    stdout = execFileSync('yt-dlp', baseArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch {
    console.warn('Download failed without browser cookies. Retrying with Chrome cookies...');
    stdout = execFileSync('yt-dlp', ['--cookies-from-browser', 'chrome', ...baseArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  }

  const downloaded = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!downloaded) {
    throw new Error(`yt-dlp did not report a downloaded file for ${url}`);
  }

  return path.resolve(downloaded);
};

const probeDurationSeconds = (mediaPath) => {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      mediaPath,
    ],
    {encoding: 'utf8'},
  );

  return Number(output.trim());
};

const makeAudio = (videoPath) => {
  const audioPath = path.join(os.tmpdir(), `yt-research-audio-${Date.now()}.mp3`);
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-b:a',
      '48k',
      '-ar',
      '16000',
      '-ac',
      '1',
      audioPath,
    ],
    {stdio: 'inherit'},
  );
  return audioPath;
};

const makeAudioChunk = ({sourceAudio, offsetSeconds, durationSeconds, index}) => {
  const chunkPath = path.join(os.tmpdir(), `yt-research-audio-${Date.now()}-${index}.mp3`);
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(offsetSeconds),
      '-t',
      String(durationSeconds),
      '-i',
      sourceAudio,
      '-acodec',
      'libmp3lame',
      '-b:a',
      '48k',
      '-ar',
      '16000',
      '-ac',
      '1',
      chunkPath,
    ],
    {stdio: 'inherit'},
  );
  return chunkPath;
};

const offsetTimedItem = (item, offsetSeconds) => ({
  ...item,
  start: Number(item.start ?? 0) + offsetSeconds,
  end: Number(item.end ?? 0) + offsetSeconds,
});

const combineTranscriptions = (parts, durationSeconds) => {
  const first = parts[0]?.transcription ?? {};
  return {
    ...first,
    duration: durationSeconds,
    text: parts
      .map(({transcription}) => transcription.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    words: parts.flatMap(({transcription, offsetSeconds}) =>
      (transcription.words ?? []).map((word) => offsetTimedItem(word, offsetSeconds)),
    ),
    segments: parts.flatMap(({transcription, offsetSeconds}) =>
      (transcription.segments ?? []).map((segment) => offsetTimedItem(segment, offsetSeconds)),
    ),
  };
};

const transcribeAudioFile = async ({audioPath, prompt, label}) =>
  withRetry(`Transcription ${label}`, async (attempt) => {
    console.log(
      `Transcribing ${label} with OpenAI (${transcriptionModel}), attempt ${attempt}/5...`,
    );
    return openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: transcriptionModel,
      response_format: 'verbose_json',
      prompt,
      timestamp_granularities: ['word'],
    });
  });

const transcribeVideo = async ({videoPath, prompt}) => {
  const audioPath = makeAudio(videoPath);
  const chunkPaths = [];

  try {
    const durationSeconds = probeDurationSeconds(audioPath);
    const audioSizeMb = fs.statSync(audioPath).size / 1024 / 1024;
    console.log(
      `Prepared audio: ${audioSizeMb.toFixed(1)} MB, ${durationSeconds.toFixed(1)}s`,
    );

    if (durationSeconds <= chunkSeconds) {
      return transcribeAudioFile({audioPath, prompt, label: 'audio'});
    }

    const parts = [];
    const chunkCount = Math.ceil(durationSeconds / chunkSeconds);
    console.log(
      `Audio is ${durationSeconds.toFixed(1)}s; splitting into ${chunkCount} chunks.`,
    );

    for (let index = 0; index < chunkCount; index += 1) {
      const offsetSeconds = index * chunkSeconds;
      const duration = Math.min(chunkSeconds, durationSeconds - offsetSeconds);
      const chunkPath = makeAudioChunk({
        sourceAudio: audioPath,
        offsetSeconds,
        durationSeconds: duration,
        index: index + 1,
      });
      chunkPaths.push(chunkPath);
      const transcription = await transcribeAudioFile({
        audioPath: chunkPath,
        prompt,
        label: `chunk ${index + 1}/${chunkCount}`,
      });
      parts.push({transcription, offsetSeconds});
    }

    return combineTranscriptions(parts, durationSeconds);
  } finally {
    for (const file of [audioPath, ...chunkPaths]) {
      fs.rmSync(file, {force: true});
    }
  }
};

const timestampedTranscript = (transcription) => {
  const segments = transcription.segments ?? [];
  if (segments.length === 0) {
    return transcription.text ?? '';
  }

  return segments
    .map((segment) => {
      const start = formatTimestamp(segment.start);
      const end = formatTimestamp(segment.end);
      return `[${start}-${end}] ${String(segment.text ?? '').trim()}`;
    })
    .join('\n');
};

const splitText = (text, maxChars = 18000) => {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < maxChars * 0.5) {
      splitAt = remaining.lastIndexOf('. ', maxChars);
    }
    if (splitAt < maxChars * 0.5) {
      splitAt = maxChars;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
};

const chunkSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {type: 'string'},
    keyIdeas: {type: 'array', items: {type: 'string'}},
    importantMoments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timestamp: {type: 'string'},
          point: {type: 'string'},
        },
        required: ['timestamp', 'point'],
      },
    },
    notableQuotes: {type: 'array', items: {type: 'string'}},
    claimsToVerify: {type: 'array', items: {type: 'string'}},
  },
  required: ['summary', 'keyIdeas', 'importantMoments', 'notableQuotes', 'claimsToVerify'],
};

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {type: 'string'},
    executiveSummary: {type: 'string'},
    coreThesis: {type: 'string'},
    detailedSummary: {type: 'string'},
    keyIdeas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          idea: {type: 'string'},
          explanation: {type: 'string'},
          whyItMatters: {type: 'string'},
        },
        required: ['idea', 'explanation', 'whyItMatters'],
      },
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timestamp: {type: 'string'},
          moment: {type: 'string'},
          significance: {type: 'string'},
        },
        required: ['timestamp', 'moment', 'significance'],
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: {type: 'string'},
          definition: {type: 'string'},
        },
        required: ['term', 'definition'],
      },
    },
    memorableQuotes: {type: 'array', items: {type: 'string'}},
    claimsToVerify: {type: 'array', items: {type: 'string'}},
    studyQuestions: {type: 'array', items: {type: 'string'}},
    practicalApplications: {type: 'array', items: {type: 'string'}},
    followUpResearch: {type: 'array', items: {type: 'string'}},
    sevenDayStudyPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          day: {type: 'integer'},
          focus: {type: 'string'},
          task: {type: 'string'},
        },
        required: ['day', 'focus', 'task'],
      },
    },
    reportMarkdown: {type: 'string'},
  },
  required: [
    'title',
    'executiveSummary',
    'coreThesis',
    'detailedSummary',
    'keyIdeas',
    'timeline',
    'glossary',
    'memorableQuotes',
    'claimsToVerify',
    'studyQuestions',
    'practicalApplications',
    'followUpResearch',
    'sevenDayStudyPlan',
    'reportMarkdown',
  ],
};

const summarizeChunk = async ({chunk, index, total}) => {
  const response = await withRetry(`Chunk summary ${index}/${total}`, async () =>
    openai.responses.create({
      model: reportModel,
      text: {
        verbosity: 'medium',
        format: {
          type: 'json_schema',
          name: 'learning_video_chunk_summary',
          strict: true,
          schema: chunkSummarySchema,
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You summarize timestamped video transcripts for a serious learner. Preserve important timestamps, claims, concepts, examples, quotes, and unanswered questions. Do not invent facts beyond the transcript.',
        },
        {
          role: 'user',
          content: `Chunk ${index} of ${total}:\n\n${chunk}`,
        },
      ],
    }),
  );

  return JSON.parse(response.output_text);
};

const generateReport = async ({title, source, transcriptText}) => {
  const chunks = splitText(transcriptText);
  const chunkNotes = [];

  if (chunks.length > 1) {
    for (let index = 0; index < chunks.length; index += 1) {
      console.log(`Summarizing transcript chunk ${index + 1}/${chunks.length}...`);
      chunkNotes.push(
        await summarizeChunk({
          chunk: chunks[index],
          index: index + 1,
          total: chunks.length,
        }),
      );
    }
  }

  const reportInput =
    chunks.length === 1
      ? transcriptText
      : `The full transcript was summarized in chunks. Use these chunk notes to create the final report:\n\n${JSON.stringify(
          chunkNotes,
          null,
          2,
        )}`;

  const response = await withRetry('Research report', async () =>
    openai.responses.create({
      model: reportModel,
      reasoning: {effort: 'medium'},
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'learning_video_research_report',
          strict: true,
          schema: reportSchema,
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You create deep research reports from video transcripts for learners. Be clear, structured, and useful. Base the report on the transcript only. If a claim needs outside verification, list it under claimsToVerify instead of presenting it as verified. Include timestamps when available.',
        },
        {
          role: 'user',
          content: `Source: ${source}\nWorking title: ${title}\n\nCreate a deep learning report from this material:\n\n${reportInput}`,
        },
      ],
    }),
  );

  const report = JSON.parse(response.output_text);
  report.chunkNotes = chunkNotes;
  return report;
};

const writeTranscriptFiles = ({slug, transcription}) => {
  const transcriptJsonPath = path.join(transcriptDir, `${slug}.transcript.json`);
  const transcriptTxtPath = path.join(transcriptDir, `${slug}.transcript.txt`);
  const timestampedPath = path.join(transcriptDir, `${slug}.timestamped.md`);
  const plainText = String(transcription.text ?? '').trim();
  const timestamped = timestampedTranscript(transcription);

  fs.writeFileSync(transcriptJsonPath, `${JSON.stringify(transcription, null, 2)}\n`);
  fs.writeFileSync(transcriptTxtPath, `${plainText}\n`);
  fs.writeFileSync(timestampedPath, `# Timestamped Transcript\n\n${timestamped}\n`);

  return {transcriptJsonPath, transcriptTxtPath, timestampedPath, timestamped};
};

const writeReportFiles = ({slug, report}) => {
  const reportJsonPath = path.join(reportDir, `${slug}.research.json`);
  const reportMarkdownPath = path.join(reportDir, `${slug}.research.md`);
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownPath, `${report.reportMarkdown.trim()}\n`);
  return {reportJsonPath, reportMarkdownPath};
};

for (const [index, input] of inputs.entries()) {
  console.log(`\n[${index + 1}/${inputs.length}] ${skipDownload ? 'Using' : 'Downloading'} ${input}`);
  const sourceVideo = skipDownload ? path.resolve(input) : downloadVideo(input);
  if (!fs.existsSync(sourceVideo)) {
    throw new Error(`Video not found: ${sourceVideo}`);
  }

  const slug = slugify(path.basename(sourceVideo, path.extname(sourceVideo)));
  const item = {
    input,
    sourceVideo,
    slug,
    transcript: null,
    report: null,
  };
  manifest.items.push(item);
  writeManifest();

  console.log(`[${index + 1}/${inputs.length}] Transcribing`);
  const transcription = await transcribeVideo({
    videoPath: sourceVideo,
    prompt: args.prompt ? String(args.prompt) : undefined,
  });
  const transcriptFiles = writeTranscriptFiles({slug, transcription});
  item.transcript = transcriptFiles;
  writeManifest();

  if (!noReport) {
    console.log(`[${index + 1}/${inputs.length}] Generating deep research report`);
    const report = await generateReport({
      title: path.basename(sourceVideo, path.extname(sourceVideo)),
      source: input,
      transcriptText: transcriptFiles.timestamped,
    });
    item.report = writeReportFiles({slug, report});
    writeManifest();
  }
}

writeManifest();

console.log('');
console.log(`Done. Run folder: ${runDir}`);
console.log(`Manifest: ${manifestPath}`);
