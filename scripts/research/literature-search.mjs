// ---------------------------------------------------------------------------
// LiteratureSearcher — academic database adapters with normalization.
//
// All adapters use plain fetch() — zero new dependencies.
// arXiv returns Atom XML, parsed with a minimal regex-based extractor.
// Semantic Scholar, CrossRef, and OpenAlex return JSON.
// ---------------------------------------------------------------------------

import {withRetry} from '../providers/interface.mjs';

// ---- Normalized result shape ---------------------------------------------

/**
 * @typedef {object} SearchResult
 * @property {string}   id            — unique within the source (arXiv id, DOI, etc.)
 * @property {string}   title
 * @property {string[]} authors
 * @property {number}   [year]
 * @property {string}   [venue]
 * @property {string}   [doi]
 * @property {string}   [url]
 * @property {string}   [abstract]
 * @property {string}   source         — "arxiv" | "semantic_scholar" | "crossref" | "openalex"
 * @property {number}   [citationCount]
 * @property {string}   [openAccessUrl]
 */

// ---- Adapter helpers ------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000;

const fetchTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    return response;
  } finally {
    clearTimeout(timer);
  }
};

// ---- arXiv adapter -------------------------------------------------------

/**
 * Search arXiv via the public API (Atom XML, no key required).
 * Polite: 1 request per 3 seconds recommended.
 */
const searchArxiv = async ({query, maxResults = 5}) => {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
  const response = await withRetry('arXiv', () => fetchTimeout(url));
  if (!response.ok) throw Object.assign(new Error(`arXiv HTTP ${response.status}`), {status: response.status});
  const xml = await response.text();
  return parseArxivXml(xml);
};

const parseArxivXml = (xml) => {
  const results = [];
  // Minimal regex-based XML extraction — avoids a full XML parser dependency.
  const entries = xml.split(/<entry>/g).slice(1);
  for (const entry of entries) {
    const endIdx = entry.indexOf('</entry>');
    const block = endIdx > 0 ? entry.slice(0, endIdx) : entry;
    const tag = (name) => {
      const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
      return m ? decodeHtmlEntities(m[1].trim()) : '';
    };
    const authors = [];
    const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi;
    let am;
    while ((am = authorRe.exec(block)) !== null) {
      authors.push(decodeHtmlEntities(am[1].trim()));
    }
    const arxivId = tag('id').replace(/^.*\/abs\//, '');
    const title = tag('title');
    const abstract = tag('summary');
    const published = tag('published');
    const year = published ? Number(published.slice(0, 4)) : undefined;
    const categories = [];
    const catRe = /<category[^>]*term="([^"]*)"/gi;
    let cm;
    while ((cm = catRe.exec(block)) !== null) {
      categories.push(cm[1]);
    }

    if (!title) continue;

    results.push({
      id: arxivId || `arxiv-${Math.random().toString(36).slice(2, 8)}`,
      title,
      authors,
      year,
      venue: categories.slice(0, 2).join('; ') || undefined,
      doi: tag('arxiv:doi') || undefined,
      url: `https://arxiv.org/abs/${arxivId}`,
      abstract: abstract.slice(0, 800) || undefined,
      source: 'arxiv',
      citationCount: undefined,
      openAccessUrl: `https://arxiv.org/pdf/${arxivId}`,
    });
  }
  return results;
};

// ---- Semantic Scholar adapter --------------------------------------------

/**
 * Search Semantic Scholar (free, optional API key for higher rate limits).
 */
const searchSemanticScholar = async ({query, maxResults = 5, apiKey}) => {
  const fields = 'title,abstract,authors,year,externalIds,citationCount,venue,url,openAccessPdf,publicationTypes';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=${fields}`;
  const headers = {'Content-Type': 'application/json'};
  if (apiKey) headers['x-api-key'] = apiKey;

  const response = await withRetry('Semantic Scholar', () => fetchTimeout(url, {headers}));
  if (!response.ok) {
    if (response.status === 429) throw Object.assign(new Error('Semantic Scholar rate limit exceeded'), {status: 429});
    throw Object.assign(new Error(`Semantic Scholar HTTP ${response.status}`), {status: response.status});
  }
  const data = await response.json();
  return (data.data ?? []).map(normalizeS2Paper);
};

const normalizeS2Paper = (paper) => ({
  id: paper.paperId ?? `s2-${Math.random().toString(36).slice(2, 8)}`,
  title: paper.title ?? 'Untitled',
  authors: (paper.authors ?? []).map((a) => a.name ?? ''),
  year: paper.year ?? undefined,
  venue: paper.venue ?? undefined,
  doi: paper.externalIds?.DOI ?? undefined,
  url: paper.url ?? (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : undefined),
  abstract: paper.abstract?.slice(0, 800) ?? undefined,
  source: 'semantic_scholar',
  citationCount: paper.citationCount ?? undefined,
  openAccessUrl: paper.openAccessPdf?.url ?? undefined,
});

// ---- CrossRef adapter ----------------------------------------------------

/**
 * Search CrossRef (free, polite pool — provide mailto).
 */
const searchCrossref = async ({query, maxResults = 5, mailto}) => {
  const params = new URLSearchParams({
    query,
    rows: String(maxResults),
    filter: 'type:journal-article,type:proceedings-article,type:book-chapter',
  });
  const url = `https://api.crossref.org/works?${params.toString()}`;
  const headers = {};
  if (mailto) headers['User-Agent'] = `YTResearchAI/0.1 (mailto:${mailto})`;

  const response = await withRetry('CrossRef', () => fetchTimeout(url, {headers}));
  if (!response.ok) {
    throw Object.assign(new Error(`CrossRef HTTP ${response.status}`), {status: response.status});
  }
  const data = await response.json();
  return (data.message?.items ?? []).map(normalizeCrossrefItem);
};

const normalizeCrossrefItem = (item) => {
  const authors = (item.author ?? []).map(
    (a) => `${a.family ?? ''}, ${a.given ?? ''}`.replace(/^, /, '').trim(),
  );
  const pubParts = [];
  if (item['container-title']?.[0]) pubParts.push(item['container-title'][0]);
  if (item.publisher) pubParts.push(item.publisher);
  return {
    id: item.DOI ?? `cr-${Math.random().toString(36).slice(2, 8)}`,
    title: (item.title ?? ['Untitled'])[0],
    authors,
    year: item['published-print']?.['date-parts']?.[0]?.[0] ??
          item['created']?.['date-parts']?.[0]?.[0] ?? undefined,
    venue: pubParts.join(' / ') || undefined,
    doi: item.DOI ?? undefined,
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : undefined),
    abstract: item.abstract?.slice(0, 800) ?? undefined,
    source: 'crossref',
    citationCount: item['is-referenced-by-count'] ?? undefined,
    openAccessUrl: undefined,
  };
};

// ---- OpenAlex adapter ----------------------------------------------------

/**
 * Search OpenAlex (free, no key required, broadest coverage).
 */
const searchOpenAlex = async ({query, maxResults = 5}) => {
  const params = new URLSearchParams({
    search: query,
    'per-page': String(maxResults),
    sort: 'cited_by_count:desc',
  });
  const url = `https://api.openalex.org/works?${params.toString()}`;
  const headers = {'User-Agent': 'YTResearchAI/0.1'};

  const response = await withRetry('OpenAlex', () => fetchTimeout(url, {headers}));
  if (!response.ok) {
    throw Object.assign(new Error(`OpenAlex HTTP ${response.status}`), {status: response.status});
  }
  const data = await response.json();
  return (data.results ?? []).map(normalizeOpenAlexItem);
};

const normalizeOpenAlexItem = (item) => {
  // Reconstruct abstract from inverted index
  let abstract = '';
  if (item.abstract_inverted_index) {
    const idx = item.abstract_inverted_index;
    const words = [];
    for (const [word, positions] of Object.entries(idx)) {
      for (const pos of positions) {
        words[pos] = word;
      }
    }
    abstract = words.filter(Boolean).join(' ');
  }

  const authors = (item.authorships ?? []).map(
    (a) => a.author?.display_name ?? '',
  ).filter(Boolean);

  return {
    id: item.id?.replace(/^.*\//, '') ?? `oa-${Math.random().toString(36).slice(2, 8)}`,
    title: item.title ?? 'Untitled',
    authors,
    year: item.publication_year ?? undefined,
    venue: item.primary_location?.source?.display_name ?? undefined,
    doi: item.doi?.replace(/^https:\/\/doi\.org\//, '') ?? undefined,
    url: item.doi ?? (item.primary_location?.landing_page_url ?? undefined),
    abstract: abstract.slice(0, 800) || undefined,
    source: 'openalex',
    citationCount: item.cited_by_count ?? undefined,
    openAccessUrl: item.open_access?.oa_url ?? undefined,
  };
};

// ---- LiteratureSearcher ---------------------------------------------------

const ADAPTERS = {
  arxiv: searchArxiv,
  semantic_scholar: searchSemanticScholar,
  crossref: searchCrossref,
  openalex: searchOpenAlex,
};

/** @type {Record<string, number>} Milliseconds to wait between calls per source. */
const RATE_LIMIT_MS = {
  arxiv: 3100,            // 1 req / 3 sec polite
  semantic_scholar: 200,  // 100 req / 5 min
  crossref: 200,          // 50 req / sec polite pool
  openalex: 200,          // generous free tier
};

export class LiteratureSearcher {
  /**
   * @param {object} opts
   * @param {string[]} [opts.apis]         — which adapters to use (default: all)
   * @param {string}   [opts.s2ApiKey]     — Semantic Scholar API key (optional)
   * @param {string}   [opts.mailto]       — mailto for CrossRef polite pool
   * @param {number}   [opts.maxResults]   — max results per adapter per query (default: 5)
   * @param {number}   [opts.concurrency]  — concurrent adapter calls (default: 2)
   */
  constructor(opts = {}) {
    this._apis = opts.apis ?? Object.keys(ADAPTERS);
    this._s2ApiKey = opts.s2ApiKey ?? undefined;
    this._mailto = opts.mailto ?? undefined;
    this._maxResults = opts.maxResults ?? 5;
    this._concurrency = opts.concurrency ?? 2;
  }

  /**
   * Search across all enabled adapters for a single query.
   * Results are merged and deduplicated by DOI, then by normalized title.
   * @param {string} query
   * @returns {Promise<SearchResult[]>}
   */
  async search(query) {
    const results = [];
    const enabled = this._apis.filter((a) => a in ADAPTERS);

    // Run adapters with controlled concurrency
    for (let i = 0; i < enabled.length; i += this._concurrency) {
      const batch = enabled.slice(i, i + this._concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((source) => this._searchOne(source, query)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(...r.value);
        } else {
          console.warn(`  Literature search [${query.slice(0, 60)}...] source failed: ${r.reason?.message ?? r.reason}`);
        }
      }
      // Small delay between batches for politeness
      if (i + this._concurrency < enabled.length) {
        await sleep(500);
      }
    }

    return deduplicateResults(results);
  }

  /**
   * Search across all enabled adapters for multiple queries in parallel.
   * @param {string[]} queries
   * @returns {Promise<SearchResult[][]>}
   */
  async searchAll(queries) {
    const results = [];
    for (let i = 0; i < queries.length; i += this._concurrency) {
      const batch = queries.slice(i, i + this._concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((q) => this.search(q)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push([]);
        }
      }
    }
    return results;
  }

  /** @private */
  async _searchOne(source, query) {
    const adapter = ADAPTERS[source];
    if (!adapter) return [];
    const opts = {query, maxResults: this._maxResults};
    if (source === 'semantic_scholar' && this._s2ApiKey) opts.apiKey = this._s2ApiKey;
    if (source === 'crossref' && this._mailto) opts.mailto = this._mailto;
    return adapter(opts);
  }
}

// ---- Deduplication --------------------------------------------------------

const deduplicateResults = (results) => {
  const seenDois = new Set();
  const seenTitles = new Set();
  const out = [];

  // Sort: prefer items with citation counts, then higher counts
  const sorted = [...results].sort((a, b) => {
    const ac = a.citationCount ?? -1;
    const bc = b.citationCount ?? -1;
    return bc - ac;
  });

  for (const r of sorted) {
    const doi = r.doi?.toLowerCase().trim();
    if (doi) {
      if (seenDois.has(doi)) continue;
      seenDois.add(doi);
    }
    const normTitle = (r.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);
    out.push(r);
  }

  return out;
};

// ---- Helpers --------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtmlEntities = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
