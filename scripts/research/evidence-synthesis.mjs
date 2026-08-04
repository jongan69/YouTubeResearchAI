// ---------------------------------------------------------------------------
// EvidenceSynthesizer — compares video claims against retrieved literature.
//
// Uses the LLM to assess each claim's support in the academic literature,
// assign confidence levels, and identify gaps/contradictions.
// ---------------------------------------------------------------------------

const CONFIDENCE_LEVELS = [
  'well_supported',   // Multiple papers agree with the claim
  'plausible',        // Consistent with literature but not directly tested
  'contested',        // Papers disagree or evidence is mixed
  'speculative',      // No evidence found in retrieved literature
  'opinion',          // Normative claim, can't be empirically verified
];

// ---- Schemas ------------------------------------------------------------

const EVIDENCE_ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          claimId: {type: 'string'},
          claim: {type: 'string'},
          confidence: {type: 'string', enum: CONFIDENCE_LEVELS},
          supportingRefs: {type: 'array', items: {type: 'string'}},
          contradictingRefs: {type: 'array', items: {type: 'string'}},
          reasoning: {type: 'string'},
          notes: {type: 'string'},
        },
        required: [
          'claimId', 'claim', 'confidence', 'supportingRefs',
          'contradictingRefs', 'reasoning', 'notes',
        ],
      },
    },
    gapAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {type: 'string'},
          whatTheVideoMissed: {type: 'string'},
          relevantRefs: {type: 'array', items: {type: 'string'}},
        },
        required: ['topic', 'whatTheVideoMissed', 'relevantRefs'],
      },
    },
    sourceQuality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overallConfidence: {type: 'string', enum: ['high', 'moderate', 'low', 'unverifiable']},
        expertiseAssessment: {type: 'string'},
        methodologyNotes: {type: 'string'},
        biasConsiderations: {type: 'string'},
      },
      required: ['overallConfidence', 'expertiseAssessment', 'methodologyNotes', 'biasConsiderations'],
    },
  },
  required: ['assessments', 'gapAnalysis', 'sourceQuality'],
};

// ---- EvidenceSynthesizer --------------------------------------------------

export class EvidenceSynthesizer {
  /**
   * @param {object} opts
   * @param {object} opts.ai — AI provider with generateStructured()
   */
  constructor({ai}) {
    this._ai = ai;
  }

  /**
   * Assess all claims against the provided literature.
   *
   * @param {object}   opts
   * @param {string[]} opts.claims          — list of claim strings
   * @param {object[]} opts.references      — retrieved reference objects
   * @param {string}   opts.transcriptContext — relevant transcript excerpt
   * @param {object}   [opts.domain]        — domain profile for contextual prompts
   * @returns {Promise<object>} {assessments, gapAnalysis, sourceQuality}
   */
  async assessClaims({claims, references, transcriptContext, domain}) {
    if (!claims || claims.length === 0) {
      return {assessments: [], gapAnalysis: [], sourceQuality: this._emptyQuality()};
    }

    const refsBlock = references.map((r, i) =>
      `[S${i + 1}] ${r.title} (${(r.authors ?? []).slice(0, 3).join('; ')}, ${r.year ?? 'n.d.'}). ${r.abstract ?? ''}`.slice(0, 300),
    ).join('\n');

    const systemPrompt = [
      'You are a senior academic peer reviewer evaluating claims from educational material against the provided scholarly literature.',
      'For each claim, determine whether the literature supports, contradicts, or is silent on it.',
      'Be rigorous and conservative: only mark "well_supported" when multiple sources clearly back the claim.',
      'Mark claims as "contested" when the literature shows genuine disagreement.',
      'Mark as "speculative" when no evidence was found in the provided sources.',
      'Mark as "opinion" for normative/value claims that cannot be empirically verified.',
      domain?.evidenceSystemPrompt ?? '',
    ].filter(Boolean).join(' ');

    const userInput = [
      '## Claims to Assess',
      ...claims.map((c, i) => `[C${i + 1}] ${c}`),
      '',
      '## Available Literature',
      refsBlock || '(No literature available)',
      '',
      '## Context from Source Material',
      transcriptContext.slice(0, 2000),
      '',
      'For each claim, provide a confidence assessment. Reference supporting/contradicting sources by their [Sn] marker.',
      'Also identify topics that the literature covers but the source material omits (gapAnalysis).',
      'Finally, rate the overall epistemic quality of the source material (sourceQuality).',
    ].join('\n');

    try {
      const result = await this._ai.generateStructured({
        systemPrompt,
        userInput,
        jsonSchema: EVIDENCE_ASSESSMENT_SCHEMA,
        schemaName: 'evidence_assessment',
        maxOutputTokens: 8000,
      });
      return result.outputJson;
    } catch (err) {
      console.warn(`  Evidence synthesis failed: ${err.message}. Returning empty assessment.`);
      return this._emptyResult(claims);
    }
  }

  /**
   * Rate source quality without claim-by-claim assessment (lightweight pass).
   */
  async rateSourceQuality({transcriptContext, references, domain}) {
    // Use a quick assessment of just the first 5 claims extracted from context
    const dummyClaims = ['The source material is factually accurate and methodologically sound.'];
    const result = await this.assessClaims({
      claims: dummyClaims,
      references,
      transcriptContext,
      domain,
    });
    return result.sourceQuality;
  }

  /** @private */
  _emptyQuality() {
    return {
      overallConfidence: 'unverifiable',
      expertiseAssessment: '',
      methodologyNotes: '',
      biasConsiderations: '',
    };
  }

  /** @private */
  _emptyResult(claims) {
    return {
      assessments: claims.map((c, i) => ({
        claimId: `C${i + 1}`,
        claim: c,
        confidence: 'speculative',
        supportingRefs: [],
        contradictingRefs: [],
        reasoning: 'Evidence synthesis unavailable.',
        notes: '',
      })),
      gapAnalysis: [],
      sourceQuality: this._emptyQuality(),
    };
  }
}
