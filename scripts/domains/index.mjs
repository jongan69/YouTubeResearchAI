// ---------------------------------------------------------------------------
// Domain profiles — field-specific research behavior.
//
// Each domain defines: trigger keywords, preferred APIs, claim patterns,
// prompt augmentations, and evaluation rubrics.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DomainProfile
 * @property {string}   name
 * @property {string[]} triggers          — keywords that match this domain
 * @property {string[]} preferredApis     — APIs to prioritize (order matters)
 * @property {string[]} claimPatterns     — types of claims characteristic of the field
 * @property {string[]} preferredVenues   — venues to weight higher
 * @property {string}   reportSystemPrompt  — appended to report system prompt
 * @property {string}   evidenceSystemPrompt — appended to evidence synthesis prompt
 * @property {string}   queryPlannerPrompt   — appended to query planner prompt
 * @property {string}   evaluationRubric     — how to evaluate source quality
 */

/** @type {Record<string, DomainProfile>} */
const PROFILES = {
  'computer-science': {
    name: 'Computer Science',
    triggers: [
      'algorithm', 'compiler', 'database', 'api', 'rust', 'python', 'javascript',
      'react', 'node', 'expo', 'typescript', 'swift', 'kotlin', 'android', 'ios',
      'machine learning', 'neural network', 'transformer', 'llm', 'language model',
      'gpu', 'cuda', 'docker', 'kubernetes', 'aws', 'cloud', 'server',
      'http', 'tcp', 'protocol', 'encryption', 'security', 'vulnerability',
      'programming', 'code', 'software', 'framework', 'library', 'dependency',
      'concurrency', 'parallel', 'distributed', 'scalability', 'latency',
      'benchmark', 'performance', 'optimization', 'memory', 'cache',
      'compiler', 'interpreter', 'runtime', 'jvm', 'webassembly', 'wasm',
      'git', 'ci/cd', 'devops', 'testing', 'debugging', 'refactoring',
    ],
    preferredApis: ['arxiv', 'semantic_scholar', 'crossref', 'openalex'],
    claimPatterns: [
      'performance claim', 'scalability claim', 'correctness claim',
      'security claim', 'complexity claim', 'benchmark result',
      'comparative claim', 'architectural claim',
    ],
    preferredVenues: [
      'ACM', 'IEEE', 'USENIX', 'NeurIPS', 'ICML', 'ICLR', 'AAAI',
      'OSDI', 'SOSP', 'PLDI', 'POPL', 'ICSE', 'FSE', 'OOPSLA',
      'CVPR', 'ICCV', 'ACL', 'EMNLP', 'NAACL',
      'arXiv', 'ArXiv', 'CoRR',
    ],
    reportSystemPrompt:
      'This is a computer science / software engineering topic. Prioritize technical accuracy, cite established systems and methods, distinguish implementation details from theoretical claims, and note when findings are based on benchmarks vs. proofs.',
    evidenceSystemPrompt:
      'For CS topics: prioritize peer-reviewed conference proceedings (ACM, IEEE, USENIX) and high-quality preprints (arXiv). Treat benchmark claims as needing replication evidence. Distinguish between theoretical guarantees and empirical observations.',
    queryPlannerPrompt:
      'For CS topics, prefer technical terms used in the research literature. Include benchmark terms, architecture names, and algorithmic concepts. Query for both theoretical and systems-level papers.',
    evaluationRubric:
      'Evaluate CS claims based on: (1) peer-reviewed evidence vs. preprints, (2) benchmark methodology quality, (3) reproducibility of results, (4) whether claims are theoretical or empirical.',
  },

  medicine: {
    name: 'Medicine & Health Sciences',
    triggers: [
      'clinical', 'patient', 'diagnosis', 'treatment', 'therapy', 'drug',
      'surgery', 'trial', 'rct', 'randomized', 'placebo', 'double-blind',
      'epidemiology', 'mortality', 'morbidity', 'symptom', 'disease',
      'cancer', 'cardiovascular', 'diabetes', 'infection', 'immune',
      'vaccine', 'vaccination', 'dosage', 'side effect', 'contraindication',
      'anatomy', 'physiology', 'pathology', 'pharmacology', 'toxicology',
      'medical', 'health', 'physician', 'nurse', 'hospital',
      'pubmed', 'cochrane', 'meta-analysis', 'systematic review',
    ],
    preferredApis: ['semantic_scholar', 'crossref', 'openalex'],
    claimPatterns: [
      'treatment efficacy', 'risk factor', 'diagnostic accuracy',
      'prognostic factor', 'dose-response', 'adverse effect',
      'prevalence', 'incidence', 'sensitivity', 'specificity',
    ],
    preferredVenues: [
      'NEJM', 'The Lancet', 'JAMA', 'BMJ', 'Nature Medicine',
      'Annals of Internal Medicine', 'Cochrane', 'PLOS Medicine',
    ],
    reportSystemPrompt:
      'This is a medical / health sciences topic. Apply evidence-based medicine standards: prioritize systematic reviews and RCTs over observational studies, note the strength of evidence, and flag when claims would change clinical practice.',
    evidenceSystemPrompt:
      'For medical topics: apply evidence hierarchy — systematic reviews > RCTs > cohort studies > case reports > expert opinion. Note sample sizes, effect sizes, and statistical significance. Flag claims unsupported by clinical evidence.',
    queryPlannerPrompt:
      'For medical topics, use MeSH terms where possible. Query for systematic reviews, meta-analyses, and RCTs. Include population, intervention, comparison, outcome (PICO) elements.',
    evaluationRubric:
      'Evaluate medical claims based on: (1) study design quality, (2) sample size and power, (3) effect size and clinical significance, (4) conflict of interest disclosures, (5) replication status.',
  },

  'social-sciences': {
    name: 'Social Sciences',
    triggers: [
      'economics', 'psychology', 'sociology', 'anthropology', 'political science',
      'education', 'behavioral', 'cognitive', 'social', 'cultural',
      'policy', 'regulation', 'governance', 'democracy', 'inequality',
      'bias', 'discrimination', 'survey', 'interview', 'qualitative',
      'quantitative', 'correlation', 'causation', 'experiment',
      'nudge', 'incentive', 'market', 'trade', 'development',
    ],
    preferredApis: ['crossref', 'semantic_scholar', 'openalex'],
    claimPatterns: [
      'causal claim', 'correlational claim', 'intervention effect',
      'policy impact', 'behavioral mechanism', 'social trend',
    ],
    preferredVenues: [
      'AER', 'QJE', 'JPE', 'Econometrica', 'APSR', 'AJPS',
      'ASR', 'AJS', 'Psych Science', 'JPSP', 'Psych Bulletin',
    ],
    reportSystemPrompt:
      'This is a social science topic. Attend to methodology (causal identification, sampling, measurement), distinguish correlation from causation, note generalizability limits, and surface underlying theoretical frameworks.',
    evidenceSystemPrompt:
      'For social science topics: weigh causal evidence (RCTs, natural experiments, IV, DiD, RDD) above correlational. Note sample representativeness, effect sizes, and replication status. Flag WEIRD-sample limitations.',
    queryPlannerPrompt:
      'For social science topics, include methodology terms (RCT, difference-in-differences, regression discontinuity, instrumental variables). Query for both empirical findings and theoretical frameworks.',
    evaluationRubric:
      'Evaluate social science claims based on: (1) causal identification strategy, (2) sample size and representativeness, (3) effect size and practical significance, (4) replication record, (5) theoretical grounding.',
  },

  humanities: {
    name: 'Humanities',
    triggers: [
      'philosophy', 'history', 'literature', 'art', 'music', 'religion',
      'ethics', 'aesthetics', 'hermeneutics', 'phenomenology', 'critique',
      'discourse', 'narrative', 'identity', 'meaning', 'interpretation',
      'ancient', 'medieval', 'renaissance', 'modern', 'postmodern',
      'colonial', 'decolonization', 'feminist', 'marxist', 'critical theory',
    ],
    preferredApis: ['crossref', 'openalex', 'semantic_scholar'],
    claimPatterns: [
      'interpretive claim', 'historical claim', 'textual analysis',
      'theoretical claim', 'critical claim', 'comparative analysis',
    ],
    preferredVenues: [
      'University Press', 'Routledge', 'Oxford', 'Cambridge', 'Harvard',
      'Princeton', 'Yale', 'Stanford', 'MIT Press', 'Duke',
    ],
    reportSystemPrompt:
      'This is a humanities topic. Situate claims within intellectual traditions, acknowledge interpretive frameworks, distinguish between descriptive and normative claims, and surface competing interpretations.',
    evidenceSystemPrompt:
      'For humanities topics: primary sources are central. Distinguish between textual evidence, archival evidence, and interpretive argument. Note scholarly consensus vs. minority views. Flag presentist assumptions.',
    queryPlannerPrompt:
      'For humanities topics, include theoretical frameworks, key thinkers, period terms, and methodological approaches. Query for both primary source analyses and theoretical treatments.',
    evaluationRubric:
      'Evaluate humanities claims based on: (1) engagement with primary sources, (2) awareness of scholarly traditions, (3) argumentative rigor, (4) acknowledgment of competing interpretations.',
  },

  'natural-sciences': {
    name: 'Natural Sciences',
    triggers: [
      'physics', 'chemistry', 'biology', 'genetics', 'evolution',
      'quantum', 'molecular', 'cellular', 'organism', 'ecosystem',
      'climate', 'geology', 'astronomy', 'cosmology', 'particle',
      'experiment', 'laboratory', 'measurement', 'observation',
      'hypothesis', 'theory', 'law', 'constant', 'equation',
      'dna', 'rna', 'protein', 'enzyme', 'receptor', 'pathway',
    ],
    preferredApis: ['arxiv', 'semantic_scholar', 'crossref', 'openalex'],
    claimPatterns: [
      'experimental result', 'observational finding', 'theoretical prediction',
      'measurement', 'mechanism', 'causal pathway',
    ],
    preferredVenues: [
      'Nature', 'Science', 'Cell', 'PNAS', 'Physical Review',
      'JACS', 'Angewandte', 'eLife', 'PLOS', 'Royal Society',
    ],
    reportSystemPrompt:
      'This is a natural sciences topic. Prioritize empirical evidence, note measurement precision and uncertainty, distinguish hypothesis from established theory, and flag unreplicated findings.',
    evidenceSystemPrompt:
      'For natural science topics: weigh replicated findings heavily, note effect sizes and confidence intervals, distinguish in vitro from in vivo evidence, flag sensationalized findings, and check for replication/refutation.',
    queryPlannerPrompt:
      'For natural science topics, use standard scientific terminology and nomenclature. Query for both original research articles and review papers. Include methodological terms.',
    evaluationRubric:
      'Evaluate natural science claims based on: (1) experimental design and controls, (2) measurement precision, (3) statistical analysis, (4) replication status, (5) mechanistic plausibility.',
  },
};

// ---- Default / General profile -------------------------------------------

const GENERAL_PROFILE = {
  name: 'General',
  triggers: [],
  preferredApis: ['arxiv', 'semantic_scholar', 'crossref', 'openalex'],
  claimPatterns: ['factual claim', 'causal claim', 'comparative claim', 'definitional claim'],
  preferredVenues: [],
  reportSystemPrompt: '',
  evidenceSystemPrompt: '',
  queryPlannerPrompt: '',
  evaluationRubric: '',
};

// ---- Domain detection ----------------------------------------------------

/**
 * Detect the most likely domain from text content.
 * Returns the matching profile or the general profile.
 *
 * @param {string} text — transcript or title text
 * @returns {DomainProfile}
 */
export const detectDomain = (text) => {
  const lower = (text ?? '').toLowerCase();
  let bestScore = 0;
  let bestDomain = GENERAL_PROFILE;

  for (const profile of Object.values(PROFILES)) {
    const hits = profile.triggers.filter((t) => lower.includes(t.toLowerCase()));
    // Weight: number of unique trigger hits + bonus for title hits
    const score = hits.length;
    if (score > bestScore) {
      bestScore = score;
      bestDomain = profile;
    }
  }

  // Require at least 3 trigger hits to switch from general
  return bestScore >= 3 ? bestDomain : GENERAL_PROFILE;
};

/**
 * Get a domain profile by name. Returns null if not found.
 *
 * @param {string} name
 * @returns {DomainProfile|null}
 */
export const getDomain = (name) => {
  if (!name || name === 'general') return GENERAL_PROFILE;
  return PROFILES[name] ?? null;
};

/**
 * List all available domain names.
 * @returns {string[]}
 */
export const listDomains = () => Object.keys(PROFILES);

export {GENERAL_PROFILE, PROFILES};
