export type Disease =
  | 'type2_diabetes'
  | 'coronary_artery_disease'
  | 'age_related_macular_degeneration';

export type SampleSet =
  | 'T2D_SAMPLE'
  | 'CAD_SAMPLE'
  | 'AMD_SAMPLE';

export type RiskTier =
  | 'low'
  | 'moderate'
  | 'high';

export type EffectType =
  | 'OR'
  | 'beta'
  | 'unknown';

export type FilterDecisionType =
  | 'included'
  | 'excluded';


// ============================================================
// VARIANT INPUT
// ============================================================

export interface ValidatedVariant {
  rsid: string;
  isValid: boolean;
  normalizedRsid: string;
  error?: string;
}


// ============================================================
// GWAS ASSOCIATION
// ============================================================

/**
 * Normalised association returned by GWASCatalogService.
 *
 * Important:
 * - riskAllele is the bare allele, e.g. "T"
 * - orPerCopyNum is the RAW odds ratio
 * - betaNum is the RAW beta
 * - pvalueMantissa/pvalueExponent are preserved because extremely
 *   small GWAS p-values can underflow to 0 in JavaScript
 */
export interface GWASAssociation {
  rsid: string;

  riskAllele: string;

  pvalue: number;
  pvalueMantissa: number;
  pvalueExponent: number;

  orPerCopyNum: number | null;

  betaNum: number | null;
  betaUnit: string | null;
  betaDirection: string | null;

  riskFrequency: number | null;

  studyAccession: string;
  pubmedId: string;

  traitName: string;

  initialSampleSize: string;
  replicationSampleSize: string;

  ancestralGroups: string[];

  totalSampleSize: number;
}


// ============================================================
// EVIDENCE FILTERING
// ============================================================

export interface FilterDecision {
  rsid: string;

  riskAllele: string;

  pubmedId: string | null;
  studyAccession: string | null;

  traitName: string;

  /**
   * RAW study effect estimate.
   *
   * If effectType === "OR":
   *     effectSize is the raw odds ratio.
   *
   * If effectType === "beta":
   *     effectSize is the signed beta.
   *
   * Do NOT confuse this with PRSContribution.weight.
   */
  effectSize: number;

  effectType: EffectType;

  pvalue: number;
  pvalueFormatted: string;

  ancestralGroups: string[];

  totalSampleSize: number;

  decision: FilterDecisionType;

  reason: string;
}


export interface FilterEvidenceResult {
  disease: Disease;

  total: number;

  includedCount: number;

  excludedCount: number;

  ancestryNote: string | null;

  allDecisions: FilterDecision[];
}


// ============================================================
// PRS SCORING
// ============================================================

export interface PRSContribution {
  rsid: string;

  riskAllele: string;

  /**
   * Number of effect/risk alleles carried:
   * 0, 1 or 2.
   */
  genotypeAlleleCount: number;

  /**
   * Weight actually used in the PRS formula.
   *
   * For odds ratios:
   *
   *     weight = ln(OR)
   *
   * For beta effects:
   *
   *     weight = beta
   *
   * This is intentionally NOT named effectSize because
   * FilterDecision.effectSize stores the RAW study estimate.
   */
  weight: number;

  effectType:
    | 'OR_log'
    | 'beta';

  /**
   * contribution =
   * weight × genotypeAlleleCount
   */
  contribution: number;

  studyAccession: string | null;

  pubmedId: string | null;
}


export interface PRSResult {
  disease: Disease;

  /**
   * PRS = Σ(weight_i × genotype_i)
   */
  totalScore: number;

  contributions: PRSContribution[];

  variantsIncluded: number;

  /**
   * True when no genotype map was supplied and dosage=1
   * was assumed for all included variants.
   */
  genotypeAssumed: boolean;
}


// ============================================================
// CITATIONS
// ============================================================

export interface Citation {
  pubmedId: string;

  title: string;

  authors: string;

  journal: string;

  year: string;

  url: string;
}


// ============================================================
// RISK INTERPRETATION
// ============================================================

export interface RiskInterpretation {
  disease: Disease;

  tier: RiskTier;

  prsScore: number;

  zScore: number;

  percentileApprox: number;

  confidenceLevel:
    | 'low'
    | 'moderate'
    | 'high';

  confidenceReason: string;

  description: string;
}


// ============================================================
// LIFESTYLE CONTEXT
// ============================================================

export interface LifestyleContext {
  disease: Disease;

  factors: Array<{
    category: string;
    description: string;
  }>;

  source: string;
}


// ============================================================
// FINAL REPORT
// ============================================================

export interface PolyRiskReport {
  disease: Disease;

  diseaseName: string;

  riskInterpretation: RiskInterpretation;

  prsResult: PRSResult;

  filterResult: FilterEvidenceResult;

  citations: Citation[];

  lifestyleContext: LifestyleContext;

  disclaimer: string;

  generatedAt: string;
}
