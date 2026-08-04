// ---------------------------------------------------------------------------
// Research orchestrator — ties together query planning, literature search,
// source selection, and citation management.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import {CitationManager} from './citation-manager.mjs';
import {LiteratureSearcher} from './literature-search.mjs';
import {AuditLog} from './provenance.mjs';
import {
  QUERY_PLAN_SCHEMA,
  buildQueryPlannerSystemPrompt,
  buildQueryPlannerUserInput,
  buildSourcesBlock,
} from '../prompts/index.mjs';

/**
 * Run the full research pipeline for one video.
 *
 * @param {object}   opts
 * @param {string}   opts.transcriptText      — timestamped transcript
 * @param {string}   opts.title               — video / source title
 * @param {object}   opts.ai                  — AI provider (must have generateStructured)
 * @param {object}   opts.config              — resolved config from ai-config.mjs
 * @param {string}   opts.researchDir         — path to run's research/ directory
 * @param {string}   opts.itemSlug            — slug for this item
 * @returns {Promise<{topics: object[], selectedSources: object[], citationManager: CitationManager, auditLog: AuditLog, sourcesBlock: string, queryCount: number}>}
 */
export const runResearch = async ({transcriptText, title, ai, config, researchDir, itemSlug}) => {
  const startedAt = new Date().toISOString();

  // Ensure research directory exists
  fs.mkdirSync(researchDir, {recursive: true});

  // ---- init --------------------------------------------------------------

  const citationManager = new CitationManager();
  const auditLog = new AuditLog(researchDir);

  const apis = config.researchApis ?? ['arxiv', 'semantic_scholar', 'crossref', 'openalex'];
  const maxResults = config.maxPapersPerTopic ?? 5;
  const searcher = new LiteratureSearcher({
    apis,
    s2ApiKey: config.semanticScholarApiKey,
    mailto: config.researchMailto,
    maxResults,
    concurrency: 2,
  });

  // ---- 1. Query planning (LLM pass) --------------------------------------

  console.log('  Planning research queries...');
  let topics = [];
  let allQueries = [];

  if (config.researchTopics && config.researchTopics.length > 0) {
    // User supplied explicit topics — use directly
    topics = config.researchTopics.map((t, i) => ({
      topic: t,
      description: `User-supplied topic`,
      queries: [t],
    }));
    allQueries = config.researchTopics;
  } else {
    // Auto-extract topics via LLM
    try {
      const planResult = await ai.generateStructured({
        systemPrompt: buildQueryPlannerSystemPrompt(),
        userInput: buildQueryPlannerUserInput({title, transcriptText}),
        jsonSchema: QUERY_PLAN_SCHEMA,
        schemaName: 'research_query_plan',
        maxOutputTokens: 4000,
      });
      topics = planResult.outputJson?.topics ?? [];
      allQueries = topics.flatMap((t) => t.queries ?? []);
    } catch (err) {
      console.warn(`  Query planning failed: ${err.message}. Falling back to title-based search.`);
      topics = [{topic: title, description: 'Auto-generated from title', queries: [title]}];
      allQueries = [title];
    }
  }

  console.log(`  Research topics: ${topics.length}, queries: ${allQueries.length}`);

  // ---- 2. Literature search ----------------------------------------------

  console.log(`  Searching ${apis.join(', ')}...`);
  const searchResults = await searcher.searchAll(allQueries);

  // Flatten and deduplicate across all queries
  const allRetrieved = [];
  const seen = new Set();
  for (const batch of searchResults) {
    for (const r of batch) {
      const key = r.doi?.toLowerCase() || r.title?.toLowerCase() || r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      allRetrieved.push(r);
    }
  }

  // Log each query result
  let qi = 0;
  for (const batch of searchResults) {
    const query = allQueries[qi] ?? 'unknown';
    for (const source of apis) {
      const fromSource = batch.filter((r) => r.source === source);
      auditLog.logSearchQuery({query, source, hitCount: fromSource.length});
    }
    qi++;
  }

  // ---- 3. Score and select -----------------------------------------------

  const maxSources = config.maxSources ?? 10;
  const scored = allRetrieved.map((r) => ({
    ...r,
    _score: scoreResult(r),
  }));
  scored.sort((a, b) => b._score - a._score);

  const selectedSources = scored.slice(0, maxSources);
  console.log(`  Retrieved ${allRetrieved.length} unique sources, selected top ${selectedSources.length}`);

  // ---- 4. Register in citation manager -----------------------------------

  for (const s of selectedSources) {
    citationManager.addReference({
      title: s.title,
      authors: s.authors,
      venue: s.venue,
      year: s.year,
      doi: s.doi,
      url: s.url,
      sourceType: s.source === 'arxiv' ? 'preprint' : 'peer_reviewed',
      relevanceNote: `Retrieved via ${s.source} search`,
      provenance: s.source,
      citationCount: s.citationCount,
    });
  }

  // ---- 5. Log and return -------------------------------------------------

  auditLog.logSources({allRetrieved, selected: selectedSources});

  const sourcesBlock = buildSourcesBlock(selectedSources);

  return {
    topics,
    selectedSources,
    allQueries,
    citationManager,
    auditLog,
    sourcesBlock,
    sourcesRetrieved: allRetrieved.length,
    sourcesCited: selectedSources.length,
    apis,
  };
};

// ---- Scoring --------------------------------------------------------------

/**
 * Score a search result for relevance ranking.
 * Weight: keyword overlap (0.6) + normalized log(citationCount) (0.25) + recency (0.15).
 */
const scoreResult = (result) => {
  let score = 0;

  // Citation count: log-normalized
  const citations = result.citationCount ?? 0;
  if (citations > 0) {
    score += 0.25 * Math.min(1, Math.log10(citations + 1) / Math.log10(1001));
  } else {
    score += 0.05; // small baseline for uncited papers
  }

  // Recency: prefer newer, but not drastically
  const year = result.year ?? 2020;
  const age = Math.max(0, 2026 - year);
  score += 0.15 * Math.max(0, 1 - age / 20);

  // Source weight: prefer peer-reviewed sources
  if (result.source === 'semantic_scholar' || result.source === 'crossref') {
    score += 0.10;
  }

  // Has abstract
  if (result.abstract && result.abstract.length > 50) {
    score += 0.10;
  }

  return score;
};
