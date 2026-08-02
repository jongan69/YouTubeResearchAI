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
