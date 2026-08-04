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
    apiKey: overrideApiKey,
  }) => {
    // Use override API key if provided (BYO key per-job), otherwise default client
    const activeClient = overrideApiKey
      ? new OpenAI({apiKey: overrideApiKey, baseURL: config.openaiBaseUrl || undefined, maxRetries: 0, timeout: config.openaiTimeoutMs ?? 20 * 60 * 1000})
      : client;
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
      activeClient.responses.create(request),
    );

    assertCompleteResponse(response, schemaName);
    return {
      outputJson: JSON.parse(response.output_text),
      outputText: response.output_text,
    };
  };

  // ---- vision / image analysis ----------------------------------------

  const analyzeImages = async ({imagePaths, prompt, jsonSchema, schemaName, maxOutputTokens = 6000}) => {
    // Read images as base64
    const imageContents = imagePaths.map((p) => {
      const data = fs.readFileSync(p);
      const b64 = data.toString('base64');
      const ext = p.split('.').pop()?.toLowerCase() || 'jpeg';
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
      return `data:${mime};base64,${b64}`;
    });

    const messages = [
      {role: 'system', content: 'You analyze visual frames from educational videos. Return valid JSON matching the schema. Do not include text outside the JSON.'},
      {role: 'user', content: [
        {type: 'text', text: prompt},
        ...imageContents.map((url) => ({
          type: 'image_url',
          image_url: {url, detail: 'auto'},
        })),
      ]},
    ];

    const completion = await withRetry(schemaName || 'vision_analysis', () =>
      client.chat.completions.create({
        model: reportModel,
        messages,
        max_completion_tokens: maxOutputTokens,
        response_format: jsonSchema ? {
          type: 'json_schema',
          json_schema: {name: schemaName || 'vision_analysis', strict: true, schema: jsonSchema},
        } : {type: 'json_object'},
      }),
    );

    const text = completion.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('Vision analysis: empty response.');
    return {outputJson: JSON.parse(text), outputText: text};
  };

  return {
    name: 'openai',
    supportsTranscription: true,
    capabilities: {transcription: true, webSearch: false, vision: true},
    transcribe,
    generateStructured,
    analyzeImages,
  };
};
