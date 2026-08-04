import {createReportProvider, createTranscriptionProvider} from './providers/interface.mjs';

/**
 * Build the full AI configuration from environment variables and CLI args.
 *
 * Call this ONCE at startup after loadEnv().
 *
 * @param {object} args — parsed CLI args (from parseArgs)
 * @returns {object} config object passed to provider factories
 */
export const buildConfig = (args = {}) => {
  const aiProvider = String(
    args['ai-provider'] ?? process.env.AI_PROVIDER ?? 'openai',
  ).toLowerCase();

  const config = {
    // Provider selection
    aiProvider,

    // OpenAI / OpenAI-compatible
    openaiApiKey: process.env.OPENAI_API_KEY ?? undefined,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? undefined,
    openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 20 * 60 * 1000),

    // Transcription
    transcriptionProvider: String(
      args['transcription-provider'] ?? process.env.TRANSCRIPTION_PROVIDER ?? '',
    ).toLowerCase() || undefined,
    transcriptionModel: String(
      args['transcription-model'] ??
        process.env.OPENAI_TRANSCRIPTION_MODEL ??
        'whisper-1',
    ),

    // Report generation — model
    reportModel: String(
      args['report-model'] ??
        process.env.OPENAI_REPORT_MODEL ??
        process.env.ANTHROPIC_REPORT_MODEL ??
        process.env.GOOGLE_REPORT_MODEL ??
        resolveDefaultModel(aiProvider),
    ),

    // Report generation — behavior
    reasoningEffort: String(
      args['reasoning-effort'] ??
        process.env.OPENAI_REASONING_EFFORT ??
        'medium',
    ),
    verbosity: String(
      args.verbosity ?? process.env.OPENAI_TEXT_VERBOSITY ?? 'medium',
    ),
    reportMaxOutputTokens: Number(
      args['max-output-tokens'] ??
        process.env.OPENAI_MAX_OUTPUT_TOKENS ??
        process.env.ANTHROPIC_MAX_OUTPUT_TOKENS ??
        process.env.GOOGLE_MAX_OUTPUT_TOKENS ??
        resolveDefaultMaxTokens(aiProvider),
    ),

    // Report chunking
    reportChunkChars: Number(
      args['report-chunk-chars'] ??
        process.env.OPENAI_REPORT_CHUNK_CHARS ??
        resolveDefaultChunkChars(aiProvider, args),
    ),

    // Anthropic-specific
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? undefined,
    anthropicReportModel: process.env.ANTHROPIC_REPORT_MODEL ?? undefined,
    anthropicMaxOutputTokens: process.env.ANTHROPIC_MAX_OUTPUT_TOKENS
      ? Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS)
      : undefined,
    anthropicThinkingBudget: process.env.ANTHROPIC_THINKING_BUDGET
      ? Number(process.env.ANTHROPIC_THINKING_BUDGET)
      : undefined,

    // Google-specific
    googleApiKey: process.env.GOOGLE_API_KEY ?? undefined,
    googleReportModel: process.env.GOOGLE_REPORT_MODEL ?? undefined,
    googleMaxOutputTokens: process.env.GOOGLE_MAX_OUTPUT_TOKENS
      ? Number(process.env.GOOGLE_MAX_OUTPUT_TOKENS)
      : undefined,

    // ---- Research (Phase 1) -----------------------------------------------
    researchEnabled: resolveBool(
      args.research ?? process.env.RESEARCH_ENABLED ?? false,
    ),
    researchTopics: resolveList(args['research-topics'] ?? process.env.RESEARCH_TOPICS),
    maxSources: Number(
      args['max-sources'] ?? process.env.RESEARCH_MAX_SOURCES ?? 10,
    ),
    maxPapersPerTopic: Number(
      args['max-papers-per-topic'] ?? process.env.RESEARCH_MAX_PAPERS_PER_TOPIC ?? 5,
    ),
    researchApis: resolveList(
      args['research-apis'] ?? process.env.RESEARCH_APIS ?? 'arxiv,semantic_scholar,crossref,openalex',
    ),
    researchMailto: process.env.RESEARCH_MAILTO ?? undefined,
    researchCacheDir: process.env.RESEARCH_CACHE_DIR ?? undefined,
    researchTimeoutMs: Number(process.env.RESEARCH_TIMEOUT_MS ?? 15000),
    semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY ?? undefined,
    citationStyle: String(
      args['citation-style'] ?? process.env.CITATION_STYLE ?? 'apa',
    ).toLowerCase(),

    // ---- Phase 2: Evidence Synthesis ----------------------------------------
    verifyEnabled: resolveBool(
      args.verify ?? process.env.VERIFY_ENABLED ?? false,
    ),

    // ---- Phase 3: Domain Scaffolding ----------------------------------------
    domain: String(
      args.domain ?? process.env.DOMAIN ?? '',
    ).toLowerCase() || null,  // null = auto-detect

    // ---- Phase 4: Multi-Source Synthesis ------------------------------------
    synthesisEnabled: resolveBool(
      args.synthesis ?? process.env.SYNTHESIS ?? false,
    ),

    // ---- Phase 5: Vision Analysis -------------------------------------------
    visionEnabled: resolveBool(
      args.vision ?? process.env.VISION_ENABLED ?? false,
    ),
    maxFrames: Number(
      args['max-frames'] ?? process.env.MAX_FRAMES ?? 20,
    ),
    framesPerMinute: Number(
      args['frames-per-minute'] ?? process.env.FRAMES_PER_MINUTE ?? 1,
    ),

    // ---- Phase 6: Iterative Research ----------------------------------------
    researchDepth: String(
      args['research-depth'] ?? process.env.RESEARCH_DEPTH ?? (
        resolveBool(args.research ?? process.env.RESEARCH_ENABLED ?? false)
          ? 'medium'
          : 'none'
      ),
    ).toLowerCase(),
    maxResearchIterations: Number(
      args['research-iterations'] ?? process.env.RESEARCH_ITERATIONS ?? 3,
    ),
  };

  return config;
};

/**
 * Resolve provider-specific defaults when no model is explicitly set.
 */
const resolveDefaultModel = (provider) => {
  switch (provider) {
    case 'openai':
      return 'gpt-5.5';
    case 'anthropic':
      return 'claude-sonnet-5-20251001';
    case 'google':
      return 'gemini-2.5-pro';
    case 'openai-compat':
      return 'llama-3.3-70b-versatile'; // common Groq default
    default:
      return 'gpt-5.5';
  }
};

const resolveDefaultMaxTokens = (provider) => {
  switch (provider) {
    case 'openai':
      return 24000;
    case 'anthropic':
      return 16000;
    case 'google':
      return 16000;
    case 'openai-compat':
      return 12000;
    default:
      return 12000;
  }
};

/** Coerce a value to boolean. Accepts "true", "1", true, 1. */
const resolveBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
};

/** Split a comma-separated string into a trimmed array, filtering empties. */
const resolveList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const resolveDefaultChunkChars = (provider, args) => {
  const model = String(
    args['report-model'] ??
      process.env.OPENAI_REPORT_MODEL ??
      process.env.ANTHROPIC_REPORT_MODEL ??
      process.env.GOOGLE_REPORT_MODEL ??
      resolveDefaultModel(provider),
  );

  // Large context models get bigger chunks
  if (/^(gpt-5|claude-sonnet-5|gemini-2\.5)/i.test(model)) {
    return 100000;
  }
  return 18000;
};

/**
 * Create the AI providers. Returns {ai, transcription}.
 *
 * `ai` is the report-generation provider.
 * `transcription` may be the same or a different provider depending on fallback.
 */
export const createProviders = async (config) => {
  const ai = await createReportProvider(config);
  const transcription = await createTranscriptionProvider(config);

  console.log(`AI provider: ${ai.name} (reports), ${transcription.name} (transcription)`);

  return {ai, transcription};
};
