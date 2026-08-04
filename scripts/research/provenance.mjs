// ---------------------------------------------------------------------------
// Provenance / audit logging for the research pipeline.
//
// Every search query, retrieval, and selection decision is logged to JSONL.
// A methodology block is built for inclusion in the final report.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

export class AuditLog {
  /**
   * @param {string} researchDir — path to the run's research/ directory
   */
  constructor(researchDir) {
    this._researchDir = researchDir;
    this._queriesPath = path.join(researchDir, 'search-queries.jsonl');
    this._sourcesPath = path.join(researchDir, 'sources.json');
    this._startedAt = new Date().toISOString();
    this._queryCount = 0;
    this._sourceCounts = {};
    this._queries = [];
  }

  // -- logging ------------------------------------------------------------

  /**
   * Log a search query execution.
   * @param {object} entry
   * @param {string} entry.query        — the search query text
   * @param {string} entry.source       — which API ("arxiv", "semantic_scholar", …)
   * @param {number} entry.hitCount     — number of raw results returned
   * @param {number} [entry.durationMs] — how long the request took
   * @param {string} [entry.error]      — error message if the search failed
   */
  logSearchQuery({query, source, hitCount, durationMs, error}) {
    this._queryCount++;
    this._sourceCounts[source] = (this._sourceCounts[source] ?? 0) + (hitCount ?? 0);
    this._queries.push(query);

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      queryN: this._queryCount,
      query: query.slice(0, 200),
      source,
      hitCount: hitCount ?? 0,
      durationMs: durationMs ?? undefined,
      error: error ?? undefined,
    });
    fs.appendFileSync(this._queriesPath, `${line}\n`);
  }

  /**
   * Log the final set of retrieved and selected sources.
   * @param {object[]} allRetrieved  — every normalized result before selection
   * @param {object[]} selected       — sources chosen for the report
   */
  logSources({allRetrieved, selected}) {
    const payload = {
      ts: new Date().toISOString(),
      totalRetrieved: allRetrieved.length,
      totalSelected: selected.length,
      bySource: this._sourceCounts,
      selected: selected.map((s) => ({
        title: s.title,
        source: s.source,
        doi: s.doi ?? null,
        year: s.year ?? null,
        citationCount: s.citationCount ?? null,
      })),
    };
    fs.writeFileSync(this._sourcesPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  // -- methodology block ---------------------------------------------------

  /**
   * Build the methodology object for the report JSON.
   * @param {object} opts
   * @param {boolean}  opts.researchEnabled
   * @param {string}   [opts.domain]
   * @param {string[]} [opts.researchTopics]
   * @param {string[]} opts.sourcesQueried
   * @param {string[]} opts.queries
   * @param {number}   opts.sourcesRetrieved
   * @param {number}   opts.sourcesCited
   * @param {boolean}  opts.verificationCompleted
   * @param {string}   opts.provider
   * @param {string}   opts.model
   * @param {string}   opts.reportModel
   * @returns {object}
   */
  buildMethodology(opts = {}) {
    return {
      researchEnabled: opts.researchEnabled ?? false,
      domain: opts.domain ?? null,
      researchTopics: opts.researchTopics ?? [],
      sourcesQueried: opts.sourcesQueried ?? [],
      queries: opts.queries ?? [],
      sourcesRetrieved: opts.sourcesRetrieved ?? 0,
      sourcesCited: opts.sourcesCited ?? 0,
      verificationCompleted: opts.verificationCompleted ?? false,
      provider: opts.provider ?? null,
      model: opts.model ?? null,
      reportModel: opts.reportModel ?? null,
      startedAt: this._startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  /**
   * Build a human-readable "Research Methods" Markdown section.
   */
  buildMethodsMarkdown({sourcesQueried, sourcesRetrieved, sourcesCited, queries, researchTopics = []}) {
    if (!queries || queries.length === 0) return '';

    const lines = [
      '## Research Methods',
      '',
      'This report was augmented with automated literature research. The following describes the process.',
      '',
      '### Search Strategy',
      '',
      `- **Databases searched**: ${(sourcesQueried ?? []).join(', ') || 'none'}`,
      `- **Sources retrieved**: ${sourcesRetrieved ?? 0}`,
      `- **Sources cited in report**: ${sourcesCited ?? 0}`,
    ];

    if (researchTopics.length > 0) {
      lines.push('', '### Research Topics', '');
      for (const topic of researchTopics) {
        lines.push(`- ${topic}`);
      }
    }

    lines.push(
      '',
      '### Search Queries',
      '',
      'The following queries were executed against academic databases:',
      '',
    );
    const uniqueQueries = [...new Set(queries)];
    for (const q of uniqueQueries) {
      lines.push(`- \`${q.slice(0, 120)}${q.length > 120 ? '...' : ''}\``);
    }

    lines.push(
      '',
      '### Limitations',
      '',
      '- This automated research process retrieves metadata (titles, abstracts, citation counts) and does not perform full-text analysis of papers.',
      '- Search results are ranked by keyword relevance and citation count; some relevant papers may have been missed.',
      '- The system does not perform peer review; citations indicate that a retrievable source exists for a claim, not that the claim has been independently verified.',
      '- All citations reference the source as of the retrieval date; papers may have been updated, retracted, or superseded.',
    );

    return lines.join('\n');
  }
}
