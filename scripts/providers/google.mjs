import {withRetry} from './interface.mjs';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Models that support thinking
const THINKING_MODELS = /^gemini-2\.5/i;

// Verbosity mapping
const VERBOSITY_INSTRUCTIONS = {
  low: 'Be concise and direct. Use brief paragraphs.',
  medium:
    'Write with balanced detail — thorough but not verbose. Aim for clear, well-structured prose.',
  high: 'Write comprehensively with rich detail, examples, and deep exploration of ideas.',
};

const resolveVerbosityInstruction = (verbosity) =>
  VERBOSITY_INSTRUCTIONS[String(verbosity)] ?? VERBOSITY_INSTRUCTIONS.medium;

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export const createGoogleProvider = (config) => {
  if (!config.googleApiKey) {
    throw new Error('GOOGLE_API_KEY is required for the Google provider.');
  }

  const reportModel = config.googleReportModel || 'gemini-2.5-pro';
  const maxOutputTokens = config.googleMaxOutputTokens || 16000;
  const verbosityInstruction = resolveVerbosityInstruction(config.verbosity);

  // ---- report generation --------------------------------------------

  const generateStructured = async ({
    systemPrompt,
    userInput,
    jsonSchema,
    schemaName,
  }) =>
    withRetry(schemaName, async () => {
      // Convert JSON Schema to Google's OpenAPI 3.0 subset format
      // Google Gemini requires response_schema in a specific format
      const googleSchema = convertToGoogleSchema(jsonSchema);

      const generationConfig = {
        maxOutputTokens,
        response_mime_type: 'application/json',
        response_schema: googleSchema,
      };

      // Enable thinking for compatible models
      if (THINKING_MODELS.test(reportModel)) {
        generationConfig.thinkingConfig = {
          include_thoughts: true,
        };
      }

      const body = {
        system_instruction: {
          parts: [{text: `${systemPrompt}\n\nOutput style: ${verbosityInstruction}`}],
        },
        contents: [
          {
            role: 'user',
            parts: [{text: `${userInput}\n\nRespond with valid JSON matching the schema.`}],
          },
        ],
        generationConfig,
      };

      console.log(`Calling Google ${reportModel}...`);

      const response = await fetch(
        `${GEMINI_BASE}/models/${reportModel}:generateContent?key=${config.googleApiKey}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw Object.assign(new Error(`Google API error ${response.status}`), {
          status: response.status,
          response: {status: response.status},
          code: errorText,
        });
      }

      const data = await response.json();

      // Extract text from the response
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('');

      if (!text) {
        const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
        if (finishReason === 'MAX_TOKENS') {
          throw new Error(
            `${schemaName} was truncated (MAX_TOKENS). Try increasing GOOGLE_MAX_OUTPUT_TOKENS.`,
          );
        }
        throw new Error(`${schemaName}: No output text in Google response (${finishReason}).`);
      }

      // Try parsing as JSON. Google may wrap in markdown code fences.
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      const outputJson = JSON.parse(jsonStr);

      return {outputJson, outputText: jsonStr, usage: data.usageMetadata};
    });

  return {
    name: 'google',
    supportsTranscription: false,
    capabilities: {transcription: false, webSearch: false, vision: true},
    generateStructured,
    analyzeImages: null, // Set below if vision is desired — basic Gemini vision supported
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema to Google's expected format.
 * Google requires: type, properties (as object with key→schema), required (array of strings).
 * We strip non-Google fields and convert nested objects.
 */
const convertToGoogleSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return schema;

  const result = {};

  if (schema.type) result.type = String(schema.type).toUpperCase();

  if (schema.description) result.description = schema.description;

  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      result.properties[key] = convertToGoogleSchema(propSchema);
    }
  }

  if (Array.isArray(schema.required)) {
    result.required = schema.required;
  }

  if (schema.items) {
    result.items = convertToGoogleSchema(schema.items);
  }

  if (Array.isArray(schema.enum)) {
    result.enum = schema.enum;
  }

  // Handle oneOf/anyOf for nullable fields (Google doesn't support these natively)
  if (Array.isArray(schema.anyOf)) {
    const nonNull = schema.anyOf.filter((s) => s.type !== 'null');
    if (nonNull.length === 1) {
      Object.assign(result, convertToGoogleSchema(nonNull[0]));
      result.nullable = true;
    }
  }

  return result;
};
