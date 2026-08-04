// ---------------------------------------------------------------------------
// Iterative deep research — multiple search passes with gap analysis.
//
// Phase 6: For --research-depth deep, the system:
//   1. Runs initial search
//   2. Synthesizes evidence → identifies gaps
//   3. Runs targeted searches for gaps
//   4. Re-verifies with expanded literature
//   5. Caps at configurable iterations or convergence
// ---------------------------------------------------------------------------

import {EvidenceSynthesizer} from './evidence-synthesis.mjs';
import {LiteratureSearcher} from './literature-search.mjs';
import {CitationManager} from './citation-manager.mjs';

/**
 * Run iterative deep research.
 *
 * @param {object} opts
 * @param {object}   opts.ai                — AI provider
 * @param {string}   opts.transcriptText    — transcript
 * @param {string}   opts.title             — video title
 * @param {object}   opts.config            — resolved config
 * @param {object}   opts.citationManager   — existing CitationManager with Phase 1 results
 * @param {object}   opts.auditLog           — AuditLog instance
 * @param {string[]} opts.initialClaims     — claims extracted in Phase 1
 * @param {object[]} opts.initialSources    — sources selected in Phase 1
 * @param {object[]} opts.topics            — research topics from Phase 1
 * @param {object}   opts.domain            — domain profile
 * @param {number}   [opts.maxIterations]   — default 3
 * @returns {Promise<{expandedSources: object[], evidence: object, iterations: number}>}
 */
export const runIterativeResearch = async ({
  ai,
  transcriptText,
  title,
  config,
  citationManager,
  auditLog,
  initialClaims,
  initialSources,
  topics,
  domain,
  maxIterations = 3,
}) => {
  const synthesizer = new EvidenceSynthesizer({ai});
  const apis = config.researchApis ?? ['arxiv', 'semantic_scholar', 'crossref', 'openalex'];
  const searcher = new LiteratureSearcher({
    apis,
    s2ApiKey: config.semanticScholarApiKey,
    mailto: config.researchMailto,
    maxResults: config.maxPapersPerTopic ?? 5,
    concurrency: 2,
  });

  let currentSources = [...initialSources];
  let iteration = 0;
  let converged = false;
  const allGaps = [];

  while (iteration < maxIterations && !converged) {
    iteration++;
    console.log(`  Deep research iteration ${iteration}/${maxIterations}...`);

    // 1. Synthesize evidence with current sources
    const evidence = await synthesizer.assessClaims({
      claims: initialClaims.slice(0, 20), // Cap at 20 claims for performance
      references: currentSources,
      transcriptContext: transcriptText.slice(0, 4000),
      domain,
    });

    // 2. Identify gaps — claims with low confidence + literature topics not covered
    const lowConfidenceClaims = (evidence.assessments ?? [])
      .filter((a) => ['speculative', 'contested'].includes(a.confidence))
      .map((a) => a.claim);

    const gapTopics = (evidence.gapAnalysis ?? [])
      .map((g) => g.whatTheVideoMissed);

    const allSearchTargets = [...lowConfidenceClaims, ...gapTopics];
    allGaps.push(...allSearchTargets);

    if (allSearchTargets.length === 0) {
      console.log('  No gaps found — research converged.');
      converged = true;
      auditLog.logSearchQuery({
        query: `convergence-iteration-${iteration}`,
        source: 'iterative',
        hitCount: 0,
        durationMs: 0,
      });
      break;
    }

    // 3. Targeted searches for gaps
    console.log(`  Found ${lowConfidenceClaims.length} low-confidence claims, ${gapTopics.length} literature gaps. Searching...`);
    const gapResults = await searcher.searchAll(allSearchTargets.slice(0, 10));

    // Flatten and deduplicate
    const newSources = [];
    const seenKeys = new Set(currentSources.map((s) => s.doi?.toLowerCase() || s.title?.toLowerCase()));
    for (const batch of gapResults) {
      for (const r of batch) {
        const key = r.doi?.toLowerCase() || r.title?.toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          newSources.push(r);
        }
      }
    }

    // Log the iteration
    auditLog.logSearchQuery({
      query: `deep-research-iteration-${iteration}`,
      source: 'iterative',
      hitCount: newSources.length,
      durationMs: 0,
    });

    // 4. Register new sources
    const newRefIds = citationManager.addReferences(
      newSources.map((s) => ({
        title: s.title,
        authors: s.authors,
        venue: s.venue,
        year: s.year,
        doi: s.doi,
        url: s.url,
        sourceType: s.source === 'arxiv' ? 'preprint' : 'peer_reviewed',
        relevanceNote: `Deep research iteration ${iteration}`,
        provenance: s.source,
        citationCount: s.citationCount,
      })),
    );

    currentSources = [...currentSources, ...newSources];

    if (newSources.length === 0) {
      console.log('  No new sources found — research converged.');
      converged = true;
      break;
    }

    console.log(`  Added ${newSources.length} new sources (total: ${currentSources.length}).`);
  }

  // Final evidence synthesis with expanded source pool
  const finalEvidence = iteration > 0
    ? await synthesizer.assessClaims({
        claims: initialClaims.slice(0, 20),
        references: currentSources,
        transcriptContext: transcriptText.slice(0, 4000),
        domain,
      })
    : {assessments: [], gapAnalysis: [], sourceQuality: synthesizer._emptyQuality()};

  return {
    expandedSources: currentSources,
    evidence: finalEvidence,
    iterations: iteration,
    gapsFound: allGaps.length,
  };
};
