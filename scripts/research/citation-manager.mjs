// ---------------------------------------------------------------------------
// CitationManager — tracks references through the research lifecycle.
//
// References are stored with a stable internal id. The `formatInline` and
// `formatReferenceList` methods produce APA / Chicago / IEEE style output.
// ---------------------------------------------------------------------------

let nextRefNum = 1;

/**
 * @typedef {object} Reference
 * @property {string}   id            — stable internal id (e.g. "ref-001")
 * @property {string}   title         — paper / source title
 * @property {string[]} authors       — author name strings (e.g. "Smith, J.")
 * @property {number}   [year]        — publication year
 * @property {string}   [venue]       — journal / conference / publisher
 * @property {string}   [doi]         — DOI without URL prefix
 * @property {string}   [url]         — full resolvable URL
 * @property {string}   sourceType    — "peer_reviewed" | "preprint" | "web" | "video_transcript" | "llm_synthesis"
 * @property {string}   [relevanceNote] — why this source is relevant
 * @property {string}   [provenance]  — which API returned this ("semantic_scholar" | "arxiv" | "crossref" | "openalex" | "manual")
 * @property {number}   [citationCount] — citation count from Semantic Scholar
 * @property {number}   [markerIndex] — assigned [Sn] number (0-based), set after finalization
 */

export class CitationManager {
  constructor() {
    /** @type {Reference[]} */
    this._refs = [];
  }

  // -- mutation -----------------------------------------------------------

  /**
   * Add a reference. Returns the stable id.
   * If a reference with the same DOI already exists, returns the existing id.
   */
  addReference({authors, title, venue, year, doi, url, sourceType, relevanceNote, provenance, citationCount}) {
    // Deduplicate by DOI
    if (doi) {
      const existing = this._refs.find((r) => r.doi === doi);
      if (existing) return existing.id;
    }

    // Deduplicate by normalized title
    const normTitle = normalizeTitle(title);
    const existingByTitle = this._refs.find(
      (r) => normalizeTitle(r.title) === normTitle,
    );
    if (existingByTitle) return existingByTitle.id;

    const id = `ref-${String(nextRefNum++).padStart(3, '0')}`;
    this._refs.push({
      id,
      title: title ?? 'Untitled',
      authors: authors ?? [],
      year: year ?? undefined,
      venue: venue ?? undefined,
      doi: doi ?? undefined,
      url: url ?? (doi ? `https://doi.org/${doi}` : undefined),
      sourceType: sourceType ?? 'web',
      relevanceNote: relevanceNote ?? undefined,
      provenance: provenance ?? 'manual',
      citationCount: citationCount ?? undefined,
      markerIndex: undefined,
    });
    return id;
  }

  /** Add multiple references at once. Returns array of ids. */
  addReferences(refs) {
    return refs.map((r) => this.addReference(r));
  }

  /** Remove duplicate references (by DOI or normalized title). */
  deduplicate() {
    const seenDois = new Set();
    const seenTitles = new Set();
    this._refs = this._refs.filter((r) => {
      if (r.doi && seenDois.has(r.doi)) return false;
      const nt = normalizeTitle(r.title);
      if (seenTitles.has(nt)) return false;
      if (r.doi) seenDois.add(r.doi);
      seenTitles.add(nt);
      return true;
    });
  }

  // -- accessors ----------------------------------------------------------

  /** All references in insertion order. */
  getReferences() {
    return [...this._refs];
  }

  /** References that have been assigned [Sn] markers. */
  getCitedReferences() {
    return this._refs.filter((r) => r.markerIndex !== undefined);
  }

  /** Find a reference by its stable id. */
  getById(id) {
    return this._refs.find((r) => r.id === id) ?? null;
  }

  /** Number of references. */
  get count() {
    return this._refs.length;
  }

  // -- formatting ---------------------------------------------------------

  /**
   * Format an inline citation marker.
   * @param {string} refId — stable id
   * @param {'apa'|'chicago'|'ieee'} style
   */
  formatInline(refId, style = 'apa') {
    const ref = this.getById(refId);
    if (!ref) return '[?]';

    const num = ref.markerIndex !== undefined ? ref.markerIndex + 1 : '?';

    switch (style) {
      case 'apa': {
        const authors = ref.authors ?? [];
        if (authors.length === 0) return `(${ref.year ?? 'n.d.'})`;
        if (authors.length === 1) return `(${authors[0].split(',')[0].trim()}, ${ref.year ?? 'n.d.'})`;
        if (authors.length === 2) return `(${authors[0].split(',')[0].trim()} & ${authors[1].split(',')[0].trim()}, ${ref.year ?? 'n.d.'})`;
        return `(${authors[0].split(',')[0].trim()} et al., ${ref.year ?? 'n.d.'})`;
      }
      case 'chicago':
        return `[${num}]`;
      case 'ieee':
        return `[${num}]`;
      default:
        return `[${num}]`;
    }
  }

  /**
   * Format the full reference list in the given style.
   * @param {'apa'|'chicago'|'ieee'} style
   * @returns {string} formatted reference list (Markdown)
   */
  formatReferenceList(style = 'apa') {
    const cited = this._refs
      .filter((r) => r.markerIndex !== undefined)
      .sort((a, b) => (a.markerIndex ?? 999) - (b.markerIndex ?? 999));

    if (cited.length === 0) return '';

    const entries = cited.map((r, i) => {
      const num = r.markerIndex !== undefined ? r.markerIndex + 1 : i + 1;
      return formatReferenceEntry(r, num, style);
    });

    return ['## References', '', ...entries, ''].join('\n');
  }

  // -- serialization ------------------------------------------------------

  toJSON() {
    return this._refs.map((r) => ({...r}));
  }
}

// ---- internal helpers ----------------------------------------------------

const normalizeTitle = (title) =>
  (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const formatReferenceEntry = (ref, num, style) => {
  const authors = (ref.authors ?? []).join(', ') || '(no authors listed)';
  const year = ref.year ?? 'n.d.';
  const title = ref.title ?? 'Untitled';
  const venue = ref.venue ?? '';
  const doi = ref.doi ?? '';
  const url = ref.url ?? (doi ? `https://doi.org/${doi}` : '');

  switch (style) {
    case 'apa':
      return [
        `[${num}] ${authors} (${year}). *${title}*.`,
        venue ? ` *${venue}*.` : '',
        url ? ` ${url}` : '',
      ].join('');

    case 'chicago':
      return [
        `[${num}] ${authors}, "${title},"`,
        venue ? ` *${venue}*` : '',
        ` (${year})`,
        url ? `, ${url}` : '',
        '.',
      ].join('');

    case 'ieee':
      return [
        `[${num}] ${authors}, "${title},"`,
        venue ? ` *${venue}*` : '',
        `, ${year}`,
        url ? `. [Online]. Available: ${url}` : '.',
      ].join('');

    default:
      return `[${num}] ${authors}, "${title}," ${venue}, ${year}. ${url}`;
  }
};
