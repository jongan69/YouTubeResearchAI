#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDir, formatTimestamp, loadEnv, parseArgs, projectRoot,
  slugify, timestampSlug, uniqueDir,
} from './lib.mjs';
import {buildConfig, createProviders} from './ai-config.mjs';
import {
  CHUNK_SUMMARY_SCHEMA, REPORT_SCHEMA,
  buildChunkSystemPrompt, buildChunkUserInput,
  buildReportSystemPrompt, buildReportUserInput,
} from './prompts/index.mjs';
import {runResearch} from './research/index.mjs';
import {CitationManager} from './research/citation-manager.mjs';
import {AuditLog} from './research/provenance.mjs';
import {EvidenceSynthesizer} from './research/evidence-synthesis.mjs';
import {runIterativeResearch} from './research/iterative-research.mjs';
import {runSynthesis} from './research/synthesis.mjs';
import {VisionAnalyzer} from './research/vision-analysis.mjs';
import {detectDomain, getDomain} from './domains/index.mjs';

const usage = `
Usage:
  npm run research -- [options]

Core options:
  --links FILE                Video URLs file (any yt-dlp supported site). Default: ./links.txt
  --out-dir DIR               Output root. Default: ./outputs
  --run-name NAME             Run folder name. Default: run-YYYY-MM-DD-HHMMSS
  --ai-provider ID            AI provider. Default: from env or openai
  --transcription-model ID    Default: whisper-1
  --report-model ID           Default: provider-specific
  --reasoning-effort LEVEL    low, medium, high. Default: medium
  --verbosity LEVEL           low, medium, high. Default: medium
  --max-output-tokens N       Report output budget
  --transcript FILE           Generate report from existing transcript
  --title TEXT                Report title (with --transcript)
  --skip-download             Treat link lines as local video paths
  --no-report                 Download and transcribe only

Research options:
  --research                  Enable scholarly literature search + citations
  --research-depth LEVEL      none, light, medium, deep. Default: medium when --research on
  --research-topics "a; b"    Semicolon-separated topics (auto-detected)
  --max-sources N             Max sources to cite. Default: 10
  --max-papers-per-topic N    Max papers per query. Default: 5
  --research-apis LIST        arxiv,semantic_scholar,crossref,openalex. Default: all
  --citation-style STYLE      apa, chicago, ieee. Default: apa
  --verify                    Enable evidence synthesis — compare claims to literature
  --domain ID                 Force domain: computer-science, medicine, social-sciences, etc.
  --synthesis                 Generate cross-source synthesis (2+ videos required)
  --vision                    Enable visual frame analysis (requires vision-capable model)
  --max-frames N              Max frames to extract. Default: 20
  --research-iterations N     Max deep research iterations. Default: 3
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) { console.log(usage); process.exit(0); }

loadEnv();
const resolvedConfig = buildConfig(args);

// Validate API keys
const keyChecks = {
  openai: () => resolvedConfig.openaiApiKey,
  anthropic: () => resolvedConfig.anthropicApiKey,
  google: () => resolvedConfig.googleApiKey,
  'openai-compat': () => resolvedConfig.openaiApiKey && resolvedConfig.openaiBaseUrl,
};
const keyCheck = keyChecks[resolvedConfig.aiProvider];
if (!keyCheck?.()) {
  const messages = {
    openai: 'OPENAI_API_KEY is required.',
    anthropic: 'ANTHROPIC_API_KEY is required.',
    google: 'GOOGLE_API_KEY is required.',
    'openai-compat': 'OPENAI_API_KEY and OPENAI_BASE_URL are required.',
  };
  throw new Error(messages[resolvedConfig.aiProvider] ?? `Unknown AI provider "${resolvedConfig.aiProvider}".`);
}

// Resolve paths
const linksPath = path.resolve(String(args.links ?? path.join(projectRoot, 'links.txt')));
const outRoot = path.resolve(String(args['out-dir'] ?? path.join(projectRoot, 'outputs')));
const runName = String(args['run-name'] ?? timestampSlug('run'));
const runDir = uniqueDir(outRoot, runName);
const downloadDir = path.resolve(String(args['download-dir'] ?? path.join(runDir, 'downloads')));
const transcriptDir = path.join(runDir, 'transcripts');
const reportDir = path.join(runDir, 'reports');
const researchDir = path.join(runDir, 'research');
const synthesisDir = path.join(runDir, 'synthesis');
const framesDir = path.join(runDir, 'frames');
const manifestPath = path.join(runDir, 'manifest.json');

// Config shorthand
const transcriptionModel = resolvedConfig.transcriptionModel;
const reportModel = resolvedConfig.reportModel;
const reportReasoningEffort = resolvedConfig.reasoningEffort;
const requestedVerbosity = resolvedConfig.verbosity;
const chunkSeconds = Math.max(30, Number(args['chunk-seconds'] ?? 180));
const noReport = Boolean(args['no-report']);
const skipDownload = Boolean(args['skip-download']);
const transcriptOnlyPath = args.transcript ? path.resolve(String(args.transcript)) : null;
const reportMaxOutputTokens = resolvedConfig.reportMaxOutputTokens;
const reportChunkChars = resolvedConfig.reportChunkChars;
const researchEnabled = resolvedConfig.researchEnabled && !noReport;
const isDeepResearch = resolvedConfig.researchDepth === 'deep';
const verifyEnabled = resolvedConfig.verifyEnabled && researchEnabled;
const visionEnabled = resolvedConfig.visionEnabled && !noReport;
const synthesisEnabled = resolvedConfig.synthesisEnabled && !noReport;

if (transcriptOnlyPath && noReport) throw new Error('--transcript cannot be combined with --no-report.');
if (!transcriptOnlyPath && !fs.existsSync(linksPath)) throw new Error(`Links file not found: ${linksPath}`);

// Parse links
const inputs = transcriptOnlyPath ? [] : fs.readFileSync(linksPath, 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (!transcriptOnlyPath && inputs.length === 0) throw new Error(`No links found in ${linksPath}`);

// Create directories
ensureDir(outRoot); ensureDir(runDir); ensureDir(downloadDir);
ensureDir(transcriptDir); ensureDir(reportDir);
if (researchEnabled) ensureDir(researchDir);
if (visionEnabled) ensureDir(framesDir);
if (synthesisEnabled && inputs.length >= 2) ensureDir(synthesisDir);
if (fs.existsSync(linksPath)) fs.copyFileSync(linksPath, path.join(runDir, 'links.txt'));

const {ai, transcription: transcriptionProvider} = await createProviders(resolvedConfig);

// Report provider capabilities
const capabilities = ai.capabilities ?? {};
if (visionEnabled && !capabilities.vision) {
  console.warn('⚠ Vision analysis requested but provider does not support image inputs. Disabling vision.');
}

const manifest = {
  createdAt: new Date().toISOString(),
  linksPath, runDir, downloadDir, transcriptDir, reportDir,
  transcriptionModel,
  reportModel: noReport ? null : reportModel,
  reportReasoningEffort: noReport ? null : reportReasoningEffort,
  reportVerbosity: noReport ? null : requestedVerbosity,
  reportMaxOutputTokens: noReport ? null : reportMaxOutputTokens,
  reportChunkChars: noReport ? null : reportChunkChars,
  researchEnabled: researchEnabled || undefined,
  researchDepth: researchEnabled ? resolvedConfig.researchDepth : undefined,
  verifyEnabled: verifyEnabled || undefined,
  visionEnabled: (visionEnabled && capabilities.vision) || undefined,
  synthesisEnabled: (synthesisEnabled && inputs.length >= 2) || undefined,
  items: [],
};
const writeManifest = () => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// =========================================================================
// Pipeline helpers (download, transcribe, chunk, report)
// =========================================================================

const downloadVideo = (url) => {
  const outputTemplate = path.join(downloadDir, '%(title).180B [%(id)s].%(ext)s');
  const isYouTube = /youtube\.com|youtu\.be/i.test(url);

  const baseArgs = [
    '--no-playlist',
    '--merge-output-format','mp4',
    '--remux-video','mp4',
    '--write-info-json',
    '--output',outputTemplate,
    '--print','after_move:filepath',
  ];

  // YouTube-specific: use android/web player clients to avoid SABR streaming blocks
  if (isYouTube) {
    baseArgs.push('--extractor-args','youtube:player_client=android,web');
  }

  baseArgs.push(url);

  let stdout = '';
  try {
    stdout = execFileSync('yt-dlp', baseArgs, {encoding:'utf8',stdio:['ignore','pipe','inherit']});
  } catch {
    // Cookies retry is only useful for YouTube (bypasses age-gating, bot detection)
    if (isYouTube) {
      console.warn('Download failed without browser cookies. Retrying with Chrome cookies...');
      const cookieArgs = ['--cookies-from-browser','chrome',...baseArgs];
      stdout = execFileSync('yt-dlp', cookieArgs, {encoding:'utf8',stdio:['ignore','pipe','inherit']});
    } else {
      throw new Error(`yt-dlp download failed for ${url}. The site may require authentication or cookies.`);
    }
  }
  const downloaded = stdout.split(/\r?\n/).map((l)=>l.trim()).filter(Boolean).at(-1);
  if (!downloaded) throw new Error(`yt-dlp did not report a downloaded file for ${url}`);
  return path.resolve(downloaded);
};

const probeDurationSeconds = (mp) => Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',mp],{encoding:'utf8'}).trim());

const makeAudio = (vp) => {
  const ap = path.join(os.tmpdir(), `yt-research-audio-${Date.now()}.mp3`);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',vp,'-vn','-acodec','libmp3lame','-b:a','48k','-ar','16000','-ac','1',ap],{stdio:'inherit'});
  return ap;
};
const makeAudioChunk = ({sourceAudio,offsetSeconds,durationSeconds,index}) => {
  const cp = path.join(os.tmpdir(),`yt-research-audio-${Date.now()}-${index}.mp3`);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(offsetSeconds),'-t',String(durationSeconds),'-i',sourceAudio,'-acodec','libmp3lame','-b:a','48k','-ar','16000','-ac','1',cp],{stdio:'inherit'});
  return cp;
};

const offsetTimedItem = (item, o) => ({...item, start: Number(item.start??0)+o, end: Number(item.end??0)+o});
const combineTranscriptions = (parts, dur) => {
  const first = parts[0]?.transcription ?? {};
  return {...first, duration: dur,
    text: parts.map(({transcription})=>transcription.text??'').join(' ').replace(/\s+/g,' ').trim(),
    words: parts.flatMap(({transcription,offsetSeconds})=>(transcription.words??[]).map((w)=>offsetTimedItem(w,offsetSeconds))),
    segments: parts.flatMap(({transcription,offsetSeconds})=>(transcription.segments??[]).map((s)=>offsetTimedItem(s,offsetSeconds))),
  };
};

const transcribeAudioFile = async ({audioPath,prompt}) => transcriptionProvider.transcribe({audioPath, model: transcriptionModel, prompt});
const transcribeVideo = async ({videoPath,prompt}) => {
  const audioPath = makeAudio(videoPath); const chunkPaths = [];
  try {
    const dur = probeDurationSeconds(audioPath);
    console.log(`Prepared audio: ${(fs.statSync(audioPath).size/1024/1024).toFixed(1)} MB, ${dur.toFixed(1)}s`);
    if (dur <= chunkSeconds) return transcribeAudioFile({audioPath,prompt});
    const parts = []; const cc = Math.ceil(dur/chunkSeconds);
    console.log(`Audio is ${dur.toFixed(1)}s; splitting into ${cc} chunks.`);
    for (let i=0;i<cc;i++) {
      const off = i*chunkSeconds; const d = Math.min(chunkSeconds,dur-off);
      const cp = makeAudioChunk({sourceAudio:audioPath,offsetSeconds:off,durationSeconds:d,index:i+1});
      chunkPaths.push(cp);
      parts.push({transcription: await transcribeAudioFile({audioPath:cp,prompt}), offsetSeconds: off});
    }
    return combineTranscriptions(parts,dur);
  } finally { for (const f of [audioPath,...chunkPaths]) fs.rmSync(f,{force:true}); }
};

const timestampedTranscript = (t) => {
  const segs = t.segments??[];
  if (!segs.length) return t.text??'';
  return segs.map((s)=>`[${formatTimestamp(s.start)}-${formatTimestamp(s.end)}] ${String(s.text??'').trim()}`).join('\n');
};

const splitText = (text, maxChars=18000) => {
  const chunks = []; let remaining = text.trim();
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n',maxChars);
    if (splitAt < maxChars*0.5) splitAt = remaining.lastIndexOf('. ',maxChars);
    if (splitAt < maxChars*0.5) splitAt = maxChars;
    chunks.push(remaining.slice(0,splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

const summarizeChunk = async ({chunk,index,total}) => {
  const r = await ai.generateStructured({
    systemPrompt: buildChunkSystemPrompt(),
    userInput: buildChunkUserInput({chunk,index,total}),
    jsonSchema: CHUNK_SUMMARY_SCHEMA, schemaName: 'learning_video_chunk_summary', maxOutputTokens: reportMaxOutputTokens,
  });
  return r.outputJson;
};

// Citation post-processing
const finalizeCitations = ({report,citationManager,citationStyle}) => {
  if (!citationManager || citationManager.count===0) { report.references=[]; return {cited:0,pruned:0}; }
  const md = report.reportMarkdown??'';
  const markers=[]; const re=/\[S(\d+)\]/g; let m;
  while ((m=re.exec(md))!==null) markers.push({index:Number(m[1]),pos:m.index,full:m[0]});
  if (!markers.length) { report.references=citationManager.toJSON(); return {cited:0,pruned:0}; }

  const refs = citationManager.getReferences();
  const indexToId={}, idToNewIndex={}, seen=new Set(), ordered=[];
  for (const mk of markers) { if (!seen.has(mk.index)) { seen.add(mk.index); ordered.push(mk.index); } }

  let newIdx=0;
  for (const oi of ordered) { const ref=refs[oi-1]; if (ref) { indexToId[oi]=ref.id; idToNewIndex[ref.id]=newIdx; ref.markerIndex=newIdx; newIdx++; } }

  let umd=md, pruned=0;
  for (const mk of [...markers].sort((a,b)=>b.pos-a.pos)) {
    const rid=indexToId[mk.index];
    if (rid && idToNewIndex[rid]!==undefined) {
      umd = umd.slice(0,mk.pos) + `[${idToNewIndex[rid]+1}]` + umd.slice(mk.pos+mk.full.length);
    } else { umd = umd.slice(0,mk.pos) + umd.slice(mk.pos+mk.full.length); pruned++; }
  }

  const refList = citationManager.formatReferenceList(citationStyle);
  report.reportMarkdown = refList ? `${umd.trim()}\n\n${refList}` : umd;
  report.references = citationManager.toJSON();
  return {cited:newIdx,pruned};
};

// Report generation
const generateReport = async ({title,source,transcriptText,sourcesBlock,citationManager,citationStyle,auditLog,domain,evidenceReview,visualNotes}) => {
  const chunks = splitText(transcriptText, reportChunkChars);
  const chunkNotes = []; const hasSources = Boolean(sourcesBlock);

  if (chunks.length > 1) {
    for (let i=0;i<chunks.length;i++) {
      console.log(`Summarizing transcript chunk ${i+1}/${chunks.length}...`);
      chunkNotes.push(await summarizeChunk({chunk:chunks[i],index:i+1,total:chunks.length}));
    }
  }

  const reportInput = chunks.length===1 ? transcriptText
    : `The full transcript was summarized in chunks. Use these chunk notes to create the final report:\n\n${JSON.stringify(chunkNotes,null,2)}`;

  // Build augmented prompt
  const domainPrompt = domain?.reportSystemPrompt ?? '';
  const hasEvidence = evidenceReview && evidenceReview.length > 0;

  const systemExtra = [];
  if (domainPrompt) systemExtra.push(domainPrompt);
  if (hasEvidence) {
    systemExtra.push(
      'An evidence review has been conducted comparing claims to peer-reviewed literature.',
      'Incorporate the evidence assessments into the report. When sources disagree, present both sides.',
      'Mark claims with their confidence level where appropriate (well-supported, plausible, contested, speculative).',
    );
  }
  if (visualNotes && visualNotes.length > 0) {
    systemExtra.push(
      'Visual content from the source has been analyzed. Incorporate relevant visual findings (equations, diagrams, code, data) into the report where they strengthen the analysis.',
    );
  }

  const systemPrompt = buildReportSystemPrompt({hasSources: hasSources || hasEvidence || (visualNotes?.length > 0)});
  const fullSystemPrompt = systemExtra.length > 0 ? `${systemPrompt}\n\n${systemExtra.join(' ')}` : systemPrompt;

  let userExtra = '';
  if (hasEvidence) {
    userExtra += '\n\n## Evidence Review\n' + evidenceReview.map((a,i)=>
      `[C${i+1}] ${a.claim}\n  Confidence: ${a.confidence}\n  Supporting: [${(a.supportingRefs??[]).join('], [')}]\n  Contradicting: [${(a.contradictingRefs??[]).join('], [')}]\n  Notes: ${a.notes??''}`
    ).join('\n\n');
  }
  if (visualNotes && visualNotes.length > 0) {
    userExtra += '\n\n## Visual Content\n' + visualNotes.map((v)=>
      `[${v.timestamp}] ${v.kind}: ${v.description}\n  Relevance: ${v.relevance}`
    ).join('\n');
  }

  const result = await ai.generateStructured({
    systemPrompt: fullSystemPrompt,
    userInput: buildReportUserInput({title,source,reportInput,sourcesBlock:sourcesBlock??''}) + userExtra,
    jsonSchema: REPORT_SCHEMA, schemaName: 'learning_video_research_report', maxOutputTokens: reportMaxOutputTokens,
  });

  const report = result.outputJson;
  report.chunkNotes = chunkNotes;

  // Post-process citations
  if (citationManager?.count > 0) {
    const {cited,pruned} = finalizeCitations({report,citationManager,citationStyle:citationStyle??'apa'});
    if (cited > 0) console.log(`  Citations: ${cited} sources cited${pruned>0?`, ${pruned} invalid markers pruned`:''}`);
  } else {
    report.references = [];
  }

  // Append methods section
  if (auditLog && sourcesBlock) {
    const mm = auditLog.buildMethodsMarkdown({
      sourcesQueried: resolvedConfig.researchApis??[],
      sourcesRetrieved: report.references?.length??0,
      sourcesCited: citationManager?.getCitedReferences().length??0,
      queries:[], researchTopics:[],
    });
    if (mm) report.reportMarkdown = `${report.reportMarkdown.trim()}\n\n${mm}`;
  }

  // Append evidence review section
  if (hasEvidence) {
    const er = ['## Evidence Quality Assessment',''];
    er.push(`Overall confidence: **${evidenceReview[0]?._sourceQuality?.overallConfidence ?? 'not assessed'}**`);
    er.push('');
    for (const a of evidenceReview.slice(0,10)) {
      const emoji = {'well_supported':'✅','plausible':'🟡','contested':'⚠️','speculative':'❓','opinion':'💬'}[a.confidence]??'';
      er.push(`- ${emoji} **${a.claim.slice(0,100)}${a.claim.length>100?'...':''}** — *${a.confidence}*`);
    }
    er.push('','*Confidence levels based on automated comparison with peer-reviewed literature. Not a substitute for expert review.*');
    report.reportMarkdown = `${report.reportMarkdown.trim()}\n\n${er.join('\n')}`;
  }

  return report;
};

// File writers
const writeTranscriptFiles = ({slug,transcription}) => {
  const tjp = path.join(transcriptDir,`${slug}.transcript.json`);
  const ttp = path.join(transcriptDir,`${slug}.transcript.txt`);
  const tmp = path.join(transcriptDir,`${slug}.timestamped.md`);
  const pt = String(transcription.text??'').trim(); const ts = timestampedTranscript(transcription);
  fs.writeFileSync(tjp,`${JSON.stringify(transcription,null,2)}\n`);
  fs.writeFileSync(ttp,`${pt}\n`);
  fs.writeFileSync(tmp,`# Timestamped Transcript\n\n${ts}\n`);
  return {transcriptJsonPath:tjp,transcriptTxtPath:ttp,timestampedPath:tmp,timestamped:ts};
};
const writeReportFiles = ({slug,report}) => {
  const rjp = path.join(reportDir,`${slug}.research.json`);
  const rmp = path.join(reportDir,`${slug}.research.md`);
  fs.writeFileSync(rjp,`${JSON.stringify(report,null,2)}\n`);
  fs.writeFileSync(rmp,`${report.reportMarkdown.trim()}\n`);
  return {reportJsonPath:rjp,reportMarkdownPath:rmp};
};
const readTranscriptForReport = (tp) => {
  if (!fs.existsSync(tp)) throw new Error(`Transcript not found: ${tp}`);
  if (path.extname(tp).toLowerCase()==='.json') { const t=JSON.parse(fs.readFileSync(tp,'utf8')); return timestampedTranscript(t); }
  return fs.readFileSync(tp,'utf8').trim();
};

// =========================================================================
// Per-item research pipeline
// =========================================================================
const runResearchPipeline = async ({transcriptText, title, source, slug, videoPath}) => {
  let sourcesBlock = ''; let citationManager = null; let auditLog = null;
  let evidenceReview = null; let visualNotes = null;
  let domain = resolvedConfig.domain ? getDomain(resolvedConfig.domain) : detectDomain(transcriptText);
  if (!domain) domain = {name:'General',reportSystemPrompt:'',evidenceSystemPrompt:'',queryPlannerPrompt:'',evaluationRubric:''};

  console.log(`  Domain: ${domain.name}`);

  // ---- Vision analysis -------------------------------------------------
  if (visionEnabled && capabilities.vision && videoPath) {
    console.log('  Running visual frame analysis...');
    const itemFramesDir = path.join(framesDir, slug);
    const vision = new VisionAnalyzer({ai});
    const framePaths = vision.extractKeyframes({
      videoPath, outputDir: itemFramesDir,
      intervalSec: Math.max(30, 60 / (resolvedConfig.framesPerMinute || 1)),
      maxFrames: resolvedConfig.maxFrames ?? 20,
    });

    if (framePaths.length > 0) {
      const va = await vision.analyzeFrames({framePaths, transcriptContext: transcriptText.slice(0, 2000)});
      visualNotes = va?.visualNotes ?? [];
      console.log(`  Vision: ${visualNotes.length} visual elements identified`);
      if (!resolvedConfig.visionEnabled) VisionAnalyzer.cleanupFrames(framePaths);
    }
  }

  // ---- Research stage ---------------------------------------------------
  if (researchEnabled) {
    auditLog = new AuditLog(researchDir);
    try {
      const rr = await runResearch({transcriptText, title, ai, config: resolvedConfig, researchDir, itemSlug: slug});
      sourcesBlock = rr.sourcesBlock; citationManager = rr.citationManager;
      console.log(`  Research: ${rr.sourcesRetrieved} sources retrieved, ${rr.sourcesCited} selected`);

      // ---- Evidence synthesis -------------------------------------------
      if (verifyEnabled && rr.selectedSources?.length > 0) {
        console.log('  Running evidence synthesis...');
        const synthesizer = new EvidenceSynthesizer({ai});
        const claimsFromChunks = rr.topics?.flatMap((t) => t.queries?.slice(0,1) ?? [t.topic]) ?? [];
        const evidence = await synthesizer.assessClaims({
          claims: claimsFromChunks.slice(0, 15),
          references: rr.selectedSources,
          transcriptContext: transcriptText.slice(0, 4000),
          domain,
        });
        evidenceReview = evidence?.assessments ?? [];
        if (evidence?.sourceQuality) {
          evidenceReview._sourceQuality = evidence.sourceQuality;
        }
        console.log(`  Evidence: ${evidenceReview.length} claims assessed (quality: ${evidence.sourceQuality?.overallConfidence ?? 'N/A'})`);
      }

      // ---- Iterative deep research --------------------------------------
      if (isDeepResearch && rr.selectedSources?.length > 0) {
        const deepResult = await runIterativeResearch({
          ai, transcriptText, title, config: resolvedConfig,
          citationManager, auditLog,
          initialClaims: evidenceReview?.map((a) => a.claim) ?? rr.topics?.flatMap((t) => t.queries) ?? [],
          initialSources: rr.selectedSources,
          topics: rr.topics, domain,
          maxIterations: resolvedConfig.maxResearchIterations,
        });
        if (deepResult?.evidence?.assessments?.length > 0) {
          evidenceReview = deepResult.evidence.assessments;
          if (deepResult.evidence.sourceQuality) evidenceReview._sourceQuality = deepResult.evidence.sourceQuality;
        }
        if (deepResult?.expandedSources?.length > rr.selectedSources.length) {
          const newBlock = rr.selectedSources.length;
          // Rebuild sources block with expanded sources
          sourcesBlock = (() => {
            const entries = deepResult.expandedSources.map((s,i) =>
              `[S${i+1}] ${s.title} (${(s.authors??[]).join(', ')}, ${s.year??'n.d.'}) — ${s.venue??'Unknown'}. ${s.abstract??''}`
            );
            return entries.length ? `## Provided Sources\n\n${entries.join('\n')}\n` : '';
          })();
          console.log(`  Deep research: expanded from ${newBlock} to ${deepResult.expandedSources.length} sources in ${deepResult.iterations} iterations`);
        }
      }
    } catch (err) {
      console.warn(`  Research phase failed: ${err.message}. Continuing without external sources...`);
    }
  }

  return {sourcesBlock, citationManager, auditLog, evidenceReview, visualNotes, domain};
};

// =========================================================================
// Main pipeline
// =========================================================================

// All processed items for potential synthesis
const processedItems = [];

if (transcriptOnlyPath) {
  const slug = slugify(path.basename(transcriptOnlyPath, path.extname(transcriptOnlyPath)).replace(/\.timestamped$|\.transcript$/i,''));
  const title = String(args.title ?? slug.replace(/-/g,' '));
  const source = String(args.source ?? transcriptOnlyPath);
  const transcriptText = readTranscriptForReport(transcriptOnlyPath);

  console.log(`Generating research report from: ${transcriptOnlyPath}`);

  const {sourcesBlock, citationManager, auditLog, evidenceReview, visualNotes, domain} =
    await runResearchPipeline({transcriptText, title, source, slug});

  const item = {input: transcriptOnlyPath, sourceVideo: null, slug, transcript: {sourcePath: transcriptOnlyPath}, report: null, research: null};
  manifest.items.push(item); writeManifest();

  const report = await generateReport({title, source, transcriptText, sourcesBlock, citationManager, citationStyle: resolvedConfig.citationStyle, auditLog, domain, evidenceReview: evidenceReview?.length > 0 ? evidenceReview : null, visualNotes});

  report.methodology = auditLog ? auditLog.buildMethodology({
    researchEnabled: true, domain: domain?.name ?? null,
    researchTopics: [], sourcesQueried: resolvedConfig.researchApis ?? [],
    queries: [], sourcesRetrieved: report.references?.length ?? 0,
    sourcesCited: citationManager?.getCitedReferences().length ?? 0,
    verificationCompleted: verifyEnabled && evidenceReview?.length > 0,
    provider: resolvedConfig.aiProvider, model: resolvedConfig.reportModel, reportModel: resolvedConfig.reportModel,
  }) : {researchEnabled: false};

  if (!report.references) report.references = [];
  item.report = writeReportFiles({slug, report});
  processedItems.push({slug, title: report.title, source, keyIdeas: report.keyIdeas, claimsToVerify: report.claimsToVerify, references: report.references, evidenceReview, report});
  writeManifest();
} else {
  for (const [index, input] of inputs.entries()) {
    console.log(`\n[${index+1}/${inputs.length}] ${skipDownload?'Using':'Downloading'} ${input}`);
    const sourceVideo = skipDownload ? path.resolve(input) : downloadVideo(input);
    if (!fs.existsSync(sourceVideo)) throw new Error(`Video not found: ${sourceVideo}`);

    const slug = slugify(path.basename(sourceVideo, path.extname(sourceVideo)));
    const item = {input, sourceVideo, slug, transcript: null, report: null, research: null};
    manifest.items.push(item); writeManifest();

    console.log(`[${index+1}/${inputs.length}] Transcribing`);
    const transcription = await transcribeVideo({videoPath: sourceVideo, prompt: args.prompt ? String(args.prompt) : undefined});
    const transcriptFiles = writeTranscriptFiles({slug, transcription});
    item.transcript = transcriptFiles; writeManifest();

    if (!noReport) {
      const title = path.basename(sourceVideo, path.extname(sourceVideo));
      const {sourcesBlock, citationManager, auditLog, evidenceReview, visualNotes, domain} =
        await runResearchPipeline({transcriptText: transcriptFiles.timestamped, title, source: input, slug, videoPath: sourceVideo});

      console.log(`[${index+1}/${inputs.length}] Generating research report`);
      const report = await generateReport({title, source: input, transcriptText: transcriptFiles.timestamped, sourcesBlock, citationManager, citationStyle: resolvedConfig.citationStyle, auditLog, domain, evidenceReview: evidenceReview?.length > 0 ? evidenceReview : null, visualNotes});

      report.methodology = auditLog ? auditLog.buildMethodology({
        researchEnabled: true, domain: domain?.name ?? null,
        researchTopics: [], sourcesQueried: resolvedConfig.researchApis ?? [],
        queries: [], sourcesRetrieved: report.references?.length ?? 0,
        sourcesCited: citationManager?.getCitedReferences().length ?? 0,
        verificationCompleted: verifyEnabled && evidenceReview?.length > 0,
        provider: resolvedConfig.aiProvider, model: resolvedConfig.reportModel, reportModel: resolvedConfig.reportModel,
      }) : {researchEnabled: false};

      if (!report.references) report.references = [];
      item.report = writeReportFiles({slug, report});
      processedItems.push({slug, title: report.title, source: input, keyIdeas: report.keyIdeas, claimsToVerify: report.claimsToVerify, references: report.references, evidenceReview});
      writeManifest();
    }
  }
}

// =========================================================================
// Multi-source synthesis
// =========================================================================
if (synthesisEnabled && processedItems.length >= 2) {
  console.log(`\nGenerating cross-source synthesis across ${processedItems.length} sources...`);
  const sharedRefs = [];
  const seenDois = new Set();
  for (const item of processedItems) {
    for (const ref of (item.references ?? [])) {
      const key = ref.doi?.toLowerCase() || ref.title?.toLowerCase();
      if (!seenDois.has(key)) { seenDois.add(key); sharedRefs.push(ref); }
    }
  }

  try {
    const synthesis = await runSynthesis({ai, items: processedItems, sharedRefs, config: resolvedConfig});
    if (synthesis) {
      ensureDir(synthesisDir);
      const synJsonPath = path.join(synthesisDir, 'synthesis.json');
      const synMdPath = path.join(synthesisDir, 'synthesis.md');
      fs.writeFileSync(synJsonPath, `${JSON.stringify(synthesis, null, 2)}\n`);
      fs.writeFileSync(synMdPath, `${(synthesis.synthesisMarkdown ?? '').trim()}\n`);
      manifest.synthesis = {path: synthesisDir, title: synthesis.title};
      console.log(`  Synthesis report: ${synMdPath}`);
    }
  } catch (err) {
    console.warn(`  Synthesis generation failed: ${err.message}`);
  }
}

writeManifest();
console.log(`\nDone. Run folder: ${runDir}`);
console.log(`Manifest: ${manifestPath}`);
