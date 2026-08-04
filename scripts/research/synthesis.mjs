// ---------------------------------------------------------------------------
// Multi-source synthesis — cross-reference analysis across multiple videos.
//
// Phase 4: When --synthesis is enabled and 2+ videos are processed, generates
// a meta-report identifying consensus, disagreements, and unique contributions.
// ---------------------------------------------------------------------------

const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {type: 'string'},
    summary: {type: 'string'},
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          theme: {type: 'string'},
          consensus: {type: 'string'},
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                slug: {type: 'string'},
                position: {type: 'string'},
                ref: {type: 'string'},
              },
              required: ['slug', 'position', 'ref'],
            },
          },
        },
        required: ['theme', 'consensus', 'sources'],
      },
    },
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          point: {type: 'string'},
          positions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                slug: {type: 'string'},
                position: {type: 'string'},
              },
              required: ['slug', 'position'],
            },
          },
        },
        required: ['point', 'positions'],
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {type: 'string'},
          why: {type: 'string'},
          recommendedSearch: {type: 'string'},
        },
        required: ['topic', 'why', 'recommendedSearch'],
      },
    },
    synthesisMarkdown: {type: 'string'},
  },
  required: ['title', 'summary', 'themes', 'contradictions', 'gaps', 'synthesisMarkdown'],
};

/**
 * Generate a cross-source synthesis report.
 *
 * @param {object} opts
 * @param {object}   opts.ai              — AI provider
 * @param {object[]} opts.items            — per-video metadata: {slug, title, source, keyIdeas[], claimsToVerify[], references[], evidenceReview?}
 * @param {object[]} opts.sharedRefs       — deduplicated references across all videos
 * @param {object}   opts.config           — resolved config
 * @returns {Promise<object>} synthesis report
 */
export const runSynthesis = async ({ai, items, sharedRefs, config}) => {
  if (!items || items.length < 2) {
    return null;
  }

  console.log(`  Generating cross-source synthesis across ${items.length} sources...`);

  const itemBlocks = items.map((item, i) => {
    const claims = (item.claimsToVerify ?? []).slice(0, 10).map((c) => `  - ${c}`).join('\n');
    const ideas = (item.keyIdeas ?? []).slice(0, 5).map((k) => `  - ${k.idea ?? k}`).join('\n');
    return [
      `### Source ${i + 1}: ${item.title || item.slug}`,
      `**Key Ideas:**`,
      ideas || '  (none extracted)',
      `**Claims to Verify:**`,
      claims || '  (none)',
    ].join('\n');
  }).join('\n\n');

  const refsBlock = (sharedRefs ?? []).slice(0, 20).map((r, i) =>
    `[R${i + 1}] ${r.title} (${(r.authors ?? []).slice(0, 2).join('; ')}, ${r.year ?? 'n.d.'})`,
  ).join('\n');

  const systemPrompt = [
    'You are a senior research synthesizer creating a cross-source analysis report.',
    'You have multiple source materials on related topics. Identify:',
    '1. Themes where sources agree (consensus)',
    '2. Points where sources disagree (contradictions)',
    '3. Important topics missing from all sources (gaps)',
    'Write a polished synthesis article that treats the sources as a collective body of knowledge.',
    'Do not refer to "videos," "speakers," or "transcripts." Present the ideas directly.',
  ].join(' ');

  const userInput = [
    '## Source Materials',
    itemBlocks,
    '',
    '## Shared References',
    refsBlock || '(none)',
    '',
    'Create a synthesis report identifying consensus themes, points of disagreement, and gaps across all sources.',
    'For synthesisMarkdown: write a 800-1500 word article synthesizing the collective knowledge.',
    'Start with an H1 title and deck. Use H2 sections. Cite shared references by [Rn] markers.',
  ].join('\n');

  try {
    const result = await ai.generateStructured({
      systemPrompt,
      userInput,
      jsonSchema: SYNTHESIS_SCHEMA,
      schemaName: 'cross_source_synthesis',
      maxOutputTokens: config.reportMaxOutputTokens ?? 16000,
    });
    return result.outputJson;
  } catch (err) {
    console.warn(`  Synthesis generation failed: ${err.message}`);
    return null;
  }
};
