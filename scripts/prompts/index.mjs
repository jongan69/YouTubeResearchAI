// ---------------------------------------------------------------------------
// JSON Schemas and prompt builders for YTResearchAI
//
// All LLM schemas live here so the orchestrator and providers stay focused.
// ---------------------------------------------------------------------------

// ---- Chunk summary schema (unchanged from original) ------------------------

export const CHUNK_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {type: 'string'},
    keyIdeas: {type: 'array', items: {type: 'string'}},
    importantMoments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timestamp: {type: 'string'},
          point: {type: 'string'},
        },
        required: ['timestamp', 'point'],
      },
    },
    notableQuotes: {type: 'array', items: {type: 'string'}},
    claimsToVerify: {type: 'array', items: {type: 'string'}},
  },
  required: ['summary', 'keyIdeas', 'importantMoments', 'notableQuotes', 'claimsToVerify'],
};

// ---- Report schema (extended with research fields) -------------------------

export const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {type: 'string'},
    executiveSummary: {type: 'string'},
    coreThesis: {type: 'string'},
    detailedSummary: {type: 'string'},
    keyIdeas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          idea: {type: 'string'},
          explanation: {type: 'string'},
          whyItMatters: {type: 'string'},
        },
        required: ['idea', 'explanation', 'whyItMatters'],
      },
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timestamp: {type: 'string'},
          moment: {type: 'string'},
          significance: {type: 'string'},
        },
        required: ['timestamp', 'moment', 'significance'],
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: {type: 'string'},
          definition: {type: 'string'},
        },
        required: ['term', 'definition'],
      },
    },
    memorableQuotes: {type: 'array', items: {type: 'string'}},
    claimsToVerify: {type: 'array', items: {type: 'string'}},
    studyQuestions: {type: 'array', items: {type: 'string'}},
    practicalApplications: {type: 'array', items: {type: 'string'}},
    followUpResearch: {type: 'array', items: {type: 'string'}},
    sevenDayStudyPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          day: {type: 'integer'},
          focus: {type: 'string'},
          task: {type: 'string'},
        },
        required: ['day', 'focus', 'task'],
      },
    },
    reportMarkdown: {type: 'string'},
  },
  required: [
    'title',
    'executiveSummary',
    'coreThesis',
    'detailedSummary',
    'keyIdeas',
    'timeline',
    'glossary',
    'memorableQuotes',
    'claimsToVerify',
    'studyQuestions',
    'practicalApplications',
    'followUpResearch',
    'sevenDayStudyPlan',
    'reportMarkdown',
  ],
};

// ---- Research query plan schema (Phase 1) ----------------------------------

export const QUERY_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {type: 'string'},
          description: {type: 'string'},
          queries: {
            type: 'array',
            items: {type: 'string'},
            minItems: 1,
            maxItems: 4,
          },
        },
        required: ['topic', 'description', 'queries'],
      },
    },
  },
  required: ['topics'],
};

// ---- Prompt builders -------------------------------------------------------

/**
 * System prompt for chunk summarization (unchanged from original).
 */
export const buildChunkSystemPrompt = () =>
  'You summarize timestamped video transcripts for a serious learner and essay writer. Preserve argument structure, important timestamps, claims, concepts, examples, quotes, tensions, counterpoints, and unanswered questions. Do not invent facts beyond the transcript.';

/**
 * Build the user input for a chunk summarization call.
 */
export const buildChunkUserInput = ({chunk, index, total}) =>
  `Chunk ${index} of ${total}:\n\n${chunk}`;

/**
 * System prompt for the final report generation.
 *
 * When `sources` (retrieved literature) is provided, the prompt instructs the
 * model to cite them with [Sn] markers.
 */
export const buildReportSystemPrompt = ({hasSources = false} = {}) => {
  const base = [
    'You are a senior research analyst and essay editor creating high-grade standalone learning articles from source notes.',
    'Write with a clear thesis, narrative flow, strong section headings, concrete examples, and useful synthesis.',
    'The Markdown report should feel like a polished article first and a study guide second, not a generic bullet dump.',
    'The reader should not need to watch, hear, or know about the original source material. Do not refer to a video, transcript, talk, lecture, presenter, speaker, host, or episode in reportMarkdown.',
    'Transform the material into a self-contained document that presents the ideas directly.',
    'Base every substantive point on the supplied material. Frame uncertain claims as claims that need verification and list them under claimsToVerify.',
    'Preserve useful timestamps. Prefer precise, readable prose over hype. Do not pad.',
  ];

  if (hasSources) {
    base.push(
      '',
      'You are also provided with peer-reviewed and scholarly sources retrieved from academic databases.',
      'When a substantive point is supported by one of these sources, cite it inline using the marker format [Sn] where n is the source number (e.g., [S1], [S2]).',
      'Only cite sources from the provided source list. Do not fabricate citations.',
      'Distinguish clearly between claims from the source material and claims from external scholarly sources.',
      'If the provided sources contradict the source material, note the tension explicitly.',
    );
  }

  return base.join(' ');
};

/**
 * User input for the final report generation.
 *
 * When `sourcesBlock` is provided, it is injected as a "## Sources" section
 * listing each retrieved paper with its [Sn] marker.
 */
export const buildReportUserInput = ({title, source, reportInput, sourcesBlock = ''}) => {
  const lines = [
    `Source: ${source}`,
    `Working title: ${title}`,
    '',
    'Create a polished medium-length research article and study artifact from this material.',
    'The final Markdown must stand alone. Write as if it were an original article/briefing, not a recap of source media.',
    'Avoid phrases like "the video", "the speaker", "the presenter", "the transcript", "the talk", "the episode", or "the source says".',
  ];

  if (sourcesBlock) {
    lines.push(
      '',
      sourcesBlock,
      '',
      'Cite sources by their [Sn] marker when a claim rests on external evidence.',
      'The References section will be appended automatically after generation — do not write it yourself.',
    );
  }

  lines.push(
    '',
    'ReportMarkdown requirements:',
    '- 1,500 to 2,500 words unless the transcript cannot support that length.',
    '- Start with an H1 title and a short deck/subtitle.',
    '- Use H2 sections with article-style headings.',
    '- Explain the central argument, why it matters, the best examples, the tradeoffs, and the practical lesson.',
    '- Include a concise "What to remember" section near the end.',
    '- Include a short "Questions to keep thinking about" section.',
    '- Avoid overusing bullets; use paragraphs for the main article body.',
    '',
    `Material:\n\n${reportInput}`,
  );

  return lines.join('\n');
};

/**
 * Build the sources block injected into the report user input.
 *
 * Each source is presented as `[Sn] title (authors, year) — venue. abstract`.
 */
export const buildSourcesBlock = (selectedSources) => {
  if (!selectedSources || selectedSources.length === 0) return '';

  const entries = selectedSources.map(
    (s, i) =>
      `[S${i + 1}] ${s.title} (${(s.authors ?? []).join(', ')}, ${s.year ?? 'n.d.'}) — ${s.venue ?? 'Unknown venue'}. ${s.abstract ?? ''}`,
  );

  return ['## Provided Sources', '', ...entries, ''].join('\n');
};

/**
 * System prompt for the research query planner.
 */
export const buildQueryPlannerSystemPrompt = () =>
  [
    'You are a research librarian helping plan academic literature searches.',
    'Given a transcript from an educational video, extract 3-6 researchable topics and for each topic write 2-3 precise academic search queries.',
    'Use scholarly phrasing: prefer technical terms, avoid colloquial language, include key theorists/methods/concepts.',
    'Queries should be suitable for arXiv, Semantic Scholar, CrossRef, and similar academic databases.',
  ].join(' ');

/**
 * User input for the query planner.
 */
export const buildQueryPlannerUserInput = ({title, transcriptText}) =>
  [`Video title: ${title}`, '', 'Transcript excerpt:', transcriptText.slice(0, 8000)].join('\n');
