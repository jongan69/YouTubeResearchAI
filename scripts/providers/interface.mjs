import {setTimeout as sleep} from 'node:timers/promises';

// ---------------------------------------------------------------------------
// Shared helpers (extracted from process-links.mjs)
// ---------------------------------------------------------------------------

export const isRetryable = (error) => {
  const status = Number(error?.status ?? error?.response?.status ?? 0);
  const code = String(error?.code ?? error?.cause?.code ?? '');
  const errorName = String(error?.name ?? '');

  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    errorName === 'APIConnectionTimeoutError' ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)
  );
};

export const withRetry = async (label, fn, retries = 5) => {
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

export const assertCompleteResponse = (response, label) => {
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown';
    throw new Error(
      `${label} was incomplete (${reason}). Try increasing max output tokens or adjusting effort.`,
    );
  }

  if (!response.output_text && !response.outputJson) {
    throw new Error(`${label} returned no output.`);
  }
};

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create a report-generation provider based on AI_PROVIDER env var.
 *
 * @param {object} config — full parsed env/CLI config
 * @returns {Promise<object>} provider object
 */
export const createReportProvider = async (config) => {
  const provider = config.aiProvider || 'openai';

  switch (provider) {
    case 'openai': {
      const {createOpenAIProvider} = await import('./openai.mjs');
      return createOpenAIProvider(config);
    }
    case 'anthropic': {
      const {createAnthropicProvider} = await import('./anthropic.mjs');
      return createAnthropicProvider(config);
    }
    case 'google': {
      const {createGoogleProvider} = await import('./google.mjs');
      return createGoogleProvider(config);
    }
    case 'openai-compat': {
      const {createOpenAICompatProvider} = await import('./openai-compat.mjs');
      return createOpenAICompatProvider(config);
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Supported: openai, anthropic, google, openai-compat.`,
      );
  }
};

/**
 * Create a transcription provider with smart fallback.
 *
 * Resolution order:
 * 1. TRANSCRIPTION_PROVIDER env var (explicit override)
 * 2. AI_PROVIDER if it supports transcription
 * 3. 'openai' as universal fallback (requires OPENAI_API_KEY)
 *
 * @param {object} config — full parsed env/CLI config
 * @returns {Promise<object>} provider object with transcribe() method
 */
export const createTranscriptionProvider = async (config) => {
  const requested = config.transcriptionProvider || config.aiProvider || 'openai';

  // Providers that support transcription natively
  const transcriptionProviders = ['openai', 'openai-compat'];

  if (transcriptionProviders.includes(requested)) {
    try {
      return await createReportProvider({...config, aiProvider: requested});
    } catch {
      // If the requested provider fails, fall through to the generic fallback
    }
  }

  // If user explicitly requested a non-transcription provider (anthropic, google),
  // or the transcription-capable provider failed, fall back to OpenAI for transcription
  if (!config.openaiApiKey) {
    throw new Error(
      `Transcription requires an OpenAI-compatible provider but OPENAI_API_KEY is not set.\n` +
        `AI_PROVIDER "${requested}" does not support transcription.\n` +
        `Set TRANSCRIPTION_PROVIDER=openai (or openai-compat) and provide the corresponding API key.`,
    );
  }

  const {createOpenAIProvider} = await import('./openai.mjs');
  return createOpenAIProvider(config);
};
