import {withRetry} from './interface.mjs';
import fs from 'node:fs';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

// Reasoning effort → thinking budget token mapping
const THINKING_BUDGETS = {low: 4000, medium: 16000, high: 32000};

// Verbosity mapping to system prompt additions
const VERBOSITY_INSTRUCTIONS = {
  low: 'Be concise and direct. Use brief paragraphs.',
  medium:
    'Write with balanced detail — thorough but not verbose. Aim for clear, well-structured prose.',
  high: 'Write comprehensively with rich detail, examples, and deep exploration of ideas.',
};

const resolveThinkingBudget = (effort) =>
  THINKING_BUDGETS[String(effort)] ?? THINKING_BUDGETS.medium;

const resolveVerbosityInstruction = (verbosity) =>
  VERBOSITY_INSTRUCTIONS[String(verbosity)] ?? VERBOSITY_INSTRUCTIONS.medium;

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export const createAnthropicProvider = (config) => {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for the Anthropic provider.');
  }

  const reportModel = config.anthropicReportModel || 'claude-sonnet-5-20251001';
  const maxOutputTokens = config.anthropicMaxOutputTokens || 16000;
  const thinkingBudget = resolveThinkingBudget(config.reasoningEffort);
  const verbosityInstruction = resolveVerbosityInstruction(config.verbosity);

  // ---- report generation --------------------------------------------

  const generateStructured = async ({
    systemPrompt,
    userInput,
    jsonSchema,
    schemaName,
  }) =>
    withRetry(schemaName, async () => {
      const body = {
        model: reportModel,
        max_tokens: maxOutputTokens,
        system: `${systemPrompt}\n\n${verbosityInstruction}`,
        messages: [{role: 'user', content: userInput}],
        tools: [
          {
            name: schemaName,
            description: `Generate the ${schemaName} as structured JSON matching the provided schema.`,
            input_schema: jsonSchema,
          },
        ],
        tool_choice: {type: 'tool', name: schemaName},
        thinking: {type: 'enabled', budget_tokens: thinkingBudget},
      };

      console.log(
        `Calling Anthropic ${reportModel} (thinking budget: ${thinkingBudget} tokens)...`,
      );

      const response = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw Object.assign(new Error(`Anthropic API error ${response.status}`), {
          status: response.status,
          response: {status: response.status},
          code: errorText,
        });
      }

      const data = await response.json();

      // Handle incomplete responses
      if (data.stop_reason === 'max_tokens') {
        throw new Error(
          `${schemaName} was truncated (max_tokens). Try increasing ANTHROPIC_MAX_OUTPUT_TOKENS.`,
        );
      }

      // Extract tool use from content blocks
      const toolUse = (data.content ?? []).find((block) => block.type === 'tool_use');
      if (!toolUse?.input) {
        throw new Error(`${schemaName}: No structured output found in Anthropic response.`);
      }

      return {
        outputJson: toolUse.input,
        outputText: JSON.stringify(toolUse.input),
        usage: data.usage,
      };
    });

  return {
    name: 'anthropic',
    supportsTranscription: false,
    capabilities: {transcription: false, webSearch: false, vision: true},
    generateStructured,
    // Vision: anthropic supports image content blocks
    analyzeImages: async ({imagePaths, prompt, jsonSchema, schemaName, maxOutputTokens = 6000}) => {
      const imageBlocks = imagePaths.map((p) => {
        const data = fs.readFileSync(p);
        const b64 = data.toString('base64');
        const ext = p.split('.').pop()?.toLowerCase() || 'jpeg';
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        return {type: 'image', source: {type: 'base64', media_type: mime, data: b64}};
      });

      const body = {
        model: reportModel,
        max_tokens: maxOutputTokens,
        system: 'You analyze visual frames from educational videos. Return valid JSON.',
        messages: [{role: 'user', content: [{type: 'text', text: prompt}, ...imageBlocks]}],
        tools: [{
          name: schemaName || 'vision_analysis',
          description: 'Generate structured visual analysis.',
          input_schema: jsonSchema || {type: 'object'},
        }],
        tool_choice: {type: 'tool', name: schemaName || 'vision_analysis'},
        thinking: {type: 'enabled', budget_tokens: 4000},
      };

      const response = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw Object.assign(new Error(`Anthropic vision API error ${response.status}`), {status: response.status});
      }

      const data = await response.json();
      const toolUse = (data.content ?? []).find((block) => block.type === 'tool_use');
      if (!toolUse?.input) throw new Error('Vision analysis: no structured output.');
      return {outputJson: toolUse.input, outputText: JSON.stringify(toolUse.input)};
    },
  };
};
