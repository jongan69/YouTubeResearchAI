// Web-compatible pipeline wrapper.
// Imports existing CLI modules and runs them with progress callbacks and
// per-job temp directories instead of the hardcoded outputs/run-* structure.

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {loadEnv} from './lib.mjs';
import {buildConfig, createProviders} from './ai-config.mjs';
import {runResearch} from './research/index.mjs';
import {CitationManager} from './research/citation-manager.mjs';
import {AuditLog} from './research/provenance.mjs';
import {EvidenceSynthesizer} from './research/evidence-synthesis.mjs';
import {detectDomain, getDomain} from './domains/index.mjs';
import {
  REPORT_SCHEMA, CHUNK_SUMMARY_SCHEMA,
  buildChunkSystemPrompt, buildChunkUserInput,
  buildReportSystemPrompt, buildReportUserInput,
} from './prompts/index.mjs';

loadEnv();

// ---- File helpers (using temp dir instead of outputs/run-*) ----------------

const downloadVideo = (url, downloadDir) => {
  const isYouTube = /youtube\.com|youtu\.be/i.test(url);
  const outputTemplate = path.join(downloadDir, '%(title).180B [%(id)s].%(ext)s');
  const args = ['--no-playlist','--merge-output-format','mp4','--remux-video','mp4',
    '--write-info-json','--output',outputTemplate,'--print','after_move:filepath'];
  if (isYouTube) args.push('--extractor-args','youtube:player_client=android,web');
  args.push(url);

  // Skip browser cookies in Docker/Cloud Run — no Chrome available
  const inContainer = fs.existsSync('/.dockerenv') || process.env.K_SERVICE || process.env.CLOUD_RUN_JOB;

  let stdout = '';
  try { stdout = execFileSync('yt-dlp', args, {encoding:'utf8',stdio:['ignore','pipe','inherit']}); }
  catch {
    if (isYouTube && !inContainer) {
      stdout = execFileSync('yt-dlp', ['--cookies-from-browser','chrome',...args], {encoding:'utf8',stdio:['ignore','pipe','inherit']});
    } else {
      throw new Error(`Download failed for ${url}. ${isYouTube ? 'The video may be age-restricted, geo-blocked, or unavailable.' : 'The site may require authentication.'}`);
    }
  }
  const downloaded = stdout.split(/\r?\n/).map((l)=>l.trim()).filter(Boolean).at(-1);
  if (!downloaded) throw new Error(`yt-dlp did not report a downloaded file for ${url}`);
  return path.resolve(downloaded);
};

const probeDuration = (mp) => Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',mp],{encoding:'utf8'}).trim());

const extractAudio = (vp, ap) => {
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',vp,'-vn','-acodec','libmp3lame','-b:a','48k','-ar','16000','-ac','1',ap],{stdio:'inherit'});
};

const transcribe = async (videoPath, transcriptionProvider, model, tempDir, onProgress) => {
  const audioPath = path.join(tempDir, 'audio.mp3');
  extractAudio(videoPath, audioPath);
  const dur = probeDuration(audioPath);
  onProgress('transcribe', 40, `Transcribing ${Math.round(dur)}s audio...`, {duration: dur});

  if (dur <= 180) {
    const r = await transcriptionProvider.transcribe({audioPath, model});
    onProgress('transcribe', 90, 'Transcription complete');
    return r;
  }

  // Chunked transcription for long videos
  const chunkSec = 180;
  const cc = Math.ceil(dur / chunkSec);
  const parts = [];
  for (let i = 0; i < cc; i++) {
    const off = i * chunkSec;
    const d = Math.min(chunkSec, dur - off);
    const cp = path.join(tempDir, `chunk-${i + 1}.mp3`);
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(off),'-t',String(d),'-i',audioPath,'-acodec','libmp3lame','-b:a','48k','-ar','16000','-ac','1',cp],{stdio:'inherit'});
    parts.push({transcription: await transcriptionProvider.transcribe({audioPath: cp, model}), offsetSeconds: off});
    onProgress('transcribe', 40 + Math.round((i + 1) / cc * 50), `Chunk ${i + 1}/${cc}`);
  }

  const first = parts[0]?.transcription ?? {};
  return {
    ...first, duration: dur,
    text: parts.map(({transcription: t}) => t.text??'').join(' ').replace(/\s+/g,' ').trim(),
    segments: parts.flatMap(({transcription: t, offsetSeconds}) =>
      (t.segments??[]).map(s => ({...s, start: Number(s.start??0)+offsetSeconds, end: Number(s.end??0)+offsetSeconds}))),
  };
};

const buildTimestamped = (t) => {
  const segs = t.segments??[];
  if (!segs.length) return t.text??'';
  return segs.map(s => {
    const fmt = (sec) => { const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60); return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`; };
    return `[${fmt(s.start)}-${fmt(s.end)}] ${String(s.text??'').trim()}`;
  }).join('\n');
};

// ---- Main pipeline ---------------------------------------------------------

/**
 * Run the full research pipeline. Accepts a progress callback for web integration.
 *
 * @param {object} opts
 * @param {string} opts.url           — video URL
 * @param {object} opts.options       — research options (research, verify, etc.)
 * @param {string} [opts.apiKey]      — BYO API key override
 * @param {string} opts.tempDir       — temp directory for this job
 * @param {function} opts.onProgress  — (stage, progress, message, data?) => void
 * @returns {Promise<{report: object, methodology: object, references: object[]}>}
 */
export async function runPipeline({url, options = {}, apiKey, tempDir, onProgress = () => {}}) {
  const config = buildConfig({...options});

  // Override with BYO key if provided
  if (apiKey) {
    if (config.aiProvider === 'openai' || config.aiProvider === 'openai-compat') {
      config.openaiApiKey = apiKey;
    } else if (config.aiProvider === 'anthropic') {
      config.anthropicApiKey = apiKey;
    } else if (config.aiProvider === 'google') {
      config.googleApiKey = apiKey;
    }
  }

  const {ai, transcription: tp} = await createProviders(config);

  // Stage 1: Download
  onProgress('download', 5, 'Downloading video...');
  const videoPath = downloadVideo(url, tempDir);

  // Stage 2: Transcribe
  onProgress('transcribe', 15, 'Extracting audio...');
  const transcription = await transcribe(videoPath, tp, config.transcriptionModel, tempDir, onProgress);
  const timestamped = buildTimestamped(transcription);
  const title = path.basename(videoPath, path.extname(videoPath));

  // Stage 3: Domain detection
  onProgress('analyze', 60, 'Detecting research domain...');
  const domain = config.domain ? getDomain(config.domain) : detectDomain(timestamped);
  if (!domain) domain = {name:'General',reportSystemPrompt:'',evidenceSystemPrompt:'',queryPlannerPrompt:'',evaluationRubric:''};

  // Stage 4: Research (literature search + citations)
  let sourcesBlock = '', citationManager = null, auditLog = null, evidenceReview = null;
  if (config.researchEnabled) {
    onProgress('research', 65, `Searching academic databases (${domain.name})...`);
    try {
      const rr = await runResearch({
        transcriptText: timestamped, title, ai, config, researchDir: tempDir, itemSlug: 'web-job',
      });
      sourcesBlock = rr.sourcesBlock;
      citationManager = rr.citationManager;
      auditLog = rr.auditLog;
      onProgress('research', 75, `${rr.sourcesRetrieved} sources found, ${rr.sourcesCited} selected`);

      // Stage 5: Evidence synthesis
      if (config.verifyEnabled && rr.selectedSources?.length > 0) {
        onProgress('verify', 78, 'Verifying claims against literature...');
        const synthesizer = new EvidenceSynthesizer({ai});
        const claims = rr.topics?.flatMap(t => t.queries?.slice(0,1) ?? [t.topic]) ?? [];
        const ev = await synthesizer.assessClaims({
          claims: claims.slice(0, 15),
          references: rr.selectedSources,
          transcriptContext: timestamped.slice(0, 4000),
          domain,
        });
        evidenceReview = ev?.assessments ?? [];
        if (ev?.sourceQuality) evidenceReview._sourceQuality = ev.sourceQuality;
      }
    } catch (err) {
      onProgress('research', 75, `Research skipped: ${err.message}`);
    }
  }

  // Stage 6: Generate report
  onProgress('report', 85, 'Generating research report...');
  const chunks = splitText(timestamped, config.reportChunkChars);
  const chunkNotes = [];
  if (chunks.length > 1) {
    for (let i = 0; i < chunks.length; i++) {
      const cr = await ai.generateStructured({
        systemPrompt: buildChunkSystemPrompt(),
        userInput: buildChunkUserInput({chunk: chunks[i], index: i + 1, total: chunks.length}),
        jsonSchema: CHUNK_SUMMARY_SCHEMA, schemaName: 'learning_video_chunk_summary',
        maxOutputTokens: config.reportMaxOutputTokens, apiKey,
      });
      chunkNotes.push(cr.outputJson);
    }
  }

  const reportInput = chunks.length === 1 ? timestamped
    : `The full transcript was summarized in chunks:\n\n${JSON.stringify(chunkNotes, null, 2)}`;

  const hasSources = Boolean(sourcesBlock);
  const hasEvidence = evidenceReview?.length > 0;
  let sysExtra = domain?.reportSystemPrompt ? [domain.reportSystemPrompt] : [];
  if (hasEvidence) sysExtra.push('Evidence review has been conducted. Incorporate assessments into the report. Mark claims with confidence levels.');
  const fullSysPrompt = sysExtra.length > 0
    ? `${buildReportSystemPrompt({hasSources: hasSources || hasEvidence})}\n\n${sysExtra.join(' ')}`
    : buildReportSystemPrompt({hasSources: hasSources || hasEvidence});

  let userExtra = '';
  if (hasEvidence) {
    userExtra = '\n\n## Evidence Review\n' + evidenceReview.map((a,i) =>
      `[C${i+1}] ${a.claim}\n  Confidence: ${a.confidence}\n  Supporting: [${(a.supportingRefs??[]).join('], [')}]\n  Contradicting: [${(a.contradictingRefs??[]).join('], [')}]\n  Notes: ${a.notes??''}`
    ).join('\n\n');
  }

  const result = await ai.generateStructured({
    systemPrompt: fullSysPrompt,
    userInput: buildReportUserInput({title, source: url, reportInput, sourcesBlock: sourcesBlock??''}) + userExtra,
    jsonSchema: REPORT_SCHEMA, schemaName: 'learning_video_research_report',
    maxOutputTokens: config.reportMaxOutputTokens, apiKey,
  });

  const report = result.outputJson;
  report.chunkNotes = chunkNotes;

  // Post-process citations
  if (citationManager?.count > 0) {
    const {cited} = finalizeCitations({report, citationManager, citationStyle: config.citationStyle ?? 'apa'});
    if (cited > 0) onProgress('report', 98, `Report complete — ${cited} sources cited`);
  } else {
    report.references = [];
  }

  // Methodology
  report.methodology = auditLog ? auditLog.buildMethodology({
    researchEnabled: config.researchEnabled, domain: domain?.name ?? null,
    researchTopics: [], sourcesQueried: config.researchApis ?? [],
    queries: [], sourcesRetrieved: report.references?.length ?? 0,
    sourcesCited: citationManager?.getCitedReferences().length ?? 0,
    verificationCompleted: config.verifyEnabled && hasEvidence,
    provider: config.aiProvider, model: config.reportModel, reportModel: config.reportModel,
  }) : {researchEnabled: false};

  // Append evidence section to markdown
  if (hasEvidence && evidenceReview._sourceQuality) {
    const eq = ['\n\n## Evidence Quality Assessment\n'];
    eq.push(`Overall confidence: **${evidenceReview._sourceQuality.overallConfidence ?? 'not assessed'}**\n`);
    for (const a of evidenceReview.slice(0,10)) {
      const em = {'well_supported':'✅','plausible':'🟡','contested':'⚠️','speculative':'❓','opinion':'💬'}[a.confidence]??'';
      eq.push(`- ${em} **${a.claim.slice(0,100)}${a.claim.length>100?'...':''}** — *${a.confidence}*`);
    }
    eq.push('\n*Automated evidence assessment. Not a substitute for expert review.*');
    report.reportMarkdown = `${report.reportMarkdown.trim()}${eq.join('\n')}`;
  }

  onProgress('done', 100, 'Complete');

  return {
    report,
    reportMarkdown: report.reportMarkdown,
    reportJson: report,
    references: report.references ?? [],
    methodology: report.methodology,
    title: report.title,
  };
}

// ---- Citation post-processing (extracted from process-links.mjs) -----------

const finalizeCitations = ({report, citationManager, citationStyle}) => {
  if (!citationManager || citationManager.count === 0) return {cited: 0, pruned: 0};
  const md = report.reportMarkdown ?? '';
  const markers = []; const re = /\[S(\d+)\]/g; let m;
  while ((m = re.exec(md)) !== null) markers.push({index: Number(m[1]), pos: m.index, full: m[0]});
  if (!markers.length) { report.references = citationManager.toJSON(); return {cited: 0, pruned: 0}; }

  const refs = citationManager.getReferences();
  const indexToId = {}, idToNewIndex = {}, seen = new Set(), ordered = [];
  for (const mk of markers) { if (!seen.has(mk.index)) { seen.add(mk.index); ordered.push(mk.index); } }

  let newIdx = 0;
  for (const oi of ordered) { const ref = refs[oi - 1]; if (ref) { indexToId[oi] = ref.id; idToNewIndex[ref.id] = newIdx; ref.markerIndex = newIdx; newIdx++; } }

  let umd = md, pruned = 0;
  for (const mk of [...markers].sort((a, b) => b.pos - a.pos)) {
    const rid = indexToId[mk.index];
    if (rid && idToNewIndex[rid] !== undefined) {
      umd = umd.slice(0, mk.pos) + `[${idToNewIndex[rid] + 1}]` + umd.slice(mk.pos + mk.full.length);
    } else { umd = umd.slice(0, mk.pos) + umd.slice(mk.pos + mk.full.length); pruned++; }
  }

  const refList = citationManager.formatReferenceList(citationStyle);
  report.reportMarkdown = refList ? `${umd.trim()}\n\n${refList}` : umd;
  report.references = citationManager.toJSON();
  return {cited: newIdx, pruned};
};

const splitText = (text, maxChars = 18000) => {
  const chunks = []; let remaining = text.trim();
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < maxChars * 0.5) splitAt = remaining.lastIndexOf('. ', maxChars);
    if (splitAt < maxChars * 0.5) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};
