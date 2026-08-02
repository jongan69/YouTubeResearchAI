import fs from 'node:fs';
import OpenAI from 'openai';
import {withRetry} from './interface.mjs';

// Verbosity mapping to system prompt additions
const VERBOSITY_INSTRUCTIONS = {
  low: 'Be concise and direct. Use brief paragraphs.',
  medium:
    'Write with balanced detail — thorough but not verbose. Aim for clear, well-structured prose.',
  high: 'Write comprehensively with rich detail, examples, and deep exploration of ideas.',
};

const resolveVerbosityInstruction = (verbosity) =>
  VERBOSITY_INSTRUCTIONS[String(verbosity)] ?? VERBOSITY_INSTRUCTIONS.medium;

// Reasoning effort mapped to system prompt guidance
const REASONING_INSTRUCTIONS = {
  low: 'Think quickly and give a straightforward response.',
  medium: 'Take time to reason carefully through the material before responding.',
  high: 'Reason deeply and exhaustively. Consider multiple angles, counterpoints, and nuances.',
};

const resolveReasoningInstruction = (effort) =>
  REASONING_INSTRUCTIONS[String(effort)] ?? REASONING_INSTRUCTIONS.medium;

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export const createOpenAICompatProvider = (config) => {
  if (!config.openaiApiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for the openai-compat provider. Set it in .env.',
    );
  }

  if (!config.openaiBaseUrl) {
    throw new Error(
      'OPENAI_BASE_URL is required for the openai-compat provider. Set it in .env (e.g. https://api.groq.com/openai/v1).',
    );
  }

  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    maxRetries: 0,
    timeout: config.openaiTimeoutMs ?? 20 * 60 * 1000,
  });

  const reportModel = config.reportModel;
  const transcriptionModel = config.transcriptionModel || 'whisper-1';
  const reasoningInstruction = resolveReasoningInstruction(config.reasoningEffort);
  const verbosityInstruction = resolveVerbosityInstruction(config.verbosity);

  // ---- transcription ------------------------------------------------

  const transcribe = async ({audioPath, model, prompt}) =>
    withRetry('Transcription', async (attempt) => {
      console.log(
        `Transcribing with ${model || transcriptionModel}, attempt ${attempt}/5...`,
      );
      // Note: not all OpenAI-compatible providers support word timestamps.
      // We request verbose_json but fall back gracefully if unsupported.
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: model || transcriptionModel,
        response_format: 'verbose_json',
        prompt,
        timestamp_granularities: ['word'],
      });
      return {
        text: transcription.text ?? '',
        words: (transcription.words ?? []).map((w) => ({
          word: w.word,
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        })),
        segments: (transcription.segments ?? []).map((s) => ({
          text: s.text ?? '',
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
        })),
        duration: Number(transcription.duration ?? 0),
      };
    });

  // ---- report generation (Chat Completions API) ---------------------

  const generateStructured = async ({
    systemPrompt,
    userInput,
    jsonSchema,
    schemaName,
    maxOutputTokens,
  }) =>
    withRetry(schemaName, async () => {
      const systemContent = [
        systemPrompt,
        reasoningInstruction,
        verbosityInstruction,
        'You must respond with valid JSON matching the provided schema. Do not include any text outside the JSON.',
      ].join('\n\n');

      console.log(`Calling ${reportModel} via OpenAI-compatible endpoint...`);

      try {
        const completion = await client.chat.completions.create({
          model: reportModel,
          messages: [
            {role: 'system', content: systemContent},
            {role: 'user', content: userInput},
          ],
          max_completion_tokens: maxOutputTokens,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: schemaName,
              strict: true,
              schema: jsonSchema,
            },
          },
        });

        const text = completion.choices?.[0]?.message?.content ?? '';
        if (!text) {
          const finishReason = completion.choices?.[0]?.finish_reason ?? 'unknown';
          throw new Error(`${schemaName}: empty response (finish_reason: ${finishReason}).`);
        }

        return {outputJson: JSON.parse(text), outputText: text};
      } catch (error) {
        // If json_schema mode fails (some providers don't support it),
        // retry with json_object mode
        if (
          error.message?.includes('json_schema') ||
          error.message?.includes('response_format') ||
          error.status === 400
        ) {
          console.warn(
            'json_schema response format not supported by this endpoint; retrying with json_object...',
          );
          const completion = await client.chat.completions.create({
            model: reportModel,
            messages: [
              {role: 'system', content: systemContent},
              {role: 'user', content: userInput},
            ],
            max_completion_tokens: maxOutputTokens,
            response_format: {type: 'json_object'},
          });
          const text = completion.choices?.[0]?.message?.content ?? '';
          if (!text) {
            throw new Error(`${schemaName}: empty response from json_object retry.`);
          }
          return {outputJson: JSON.parse(text), outputText: text};
        }
        throw error;
      }
    });

  return {
    name: 'openai-compat',
    supportsTranscription: true,
    transcribe,
    generateStructured,
  };
};
