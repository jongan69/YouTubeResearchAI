import fs from 'node:fs';
import OpenAI from 'openai';
import {withRetry, assertCompleteResponse} from './interface.mjs';

// ---------------------------------------------------------------------------
// Model feature detection
// ---------------------------------------------------------------------------

const modelSupportsReasoningEffort = (model) =>
  /^(o1|o3|o4|gpt-5)(?:[.-]|$)/i.test(String(model));

const modelSupportsTextVerbosity = (model) => /^gpt-5(?:[.-]|$)/i.test(String(model));

const resolveVerbosity = (model, verbosity) => {
  const normalized = ['low', 'medium', 'high'].includes(String(verbosity))
    ? String(verbosity)
    : 'medium';
  return modelSupportsTextVerbosity(model) ? normalized : 'medium';
};

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export const createOpenAIProvider = (config) => {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for the OpenAI provider.');
  }

  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl || undefined,
    maxRetries: 0,
    timeout: config.openaiTimeoutMs ?? 20 * 60 * 1000,
  });

  const reportModel = config.reportModel;
  const reasoningEffort = config.reasoningEffort;
  const verbosity = config.verbosity;

  // ---- transcription ------------------------------------------------

  const transcribe = async ({audioPath, model, prompt}) =>
    withRetry('Transcription', async (attempt) => {
      console.log(`Transcribing with OpenAI (${model}), attempt ${attempt}/5...`);
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model,
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

  // ---- report generation --------------------------------------------

  const generateStructured = async ({
    systemPrompt,
    userInput,
    jsonSchema,
    schemaName,
    maxOutputTokens,
  }) => {
    const request = {
      model: reportModel,
      ...(modelSupportsReasoningEffort(reportModel)
        ? {reasoning: {effort: reasoningEffort}}
        : {}),
      text: {
        verbosity: resolveVerbosity(reportModel, verbosity),
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema: jsonSchema,
        },
      },
      input: [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: userInput},
      ],
      max_output_tokens: maxOutputTokens,
    };

    const response = await withRetry(schemaName, () =>
      client.responses.create(request),
    );

    assertCompleteResponse(response, schemaName);
    return {
      outputJson: JSON.parse(response.output_text),
      outputText: response.output_text,
    };
  };

  return {
    name: 'openai',
    supportsTranscription: true,
    transcribe,
    generateStructured,
  };
};
