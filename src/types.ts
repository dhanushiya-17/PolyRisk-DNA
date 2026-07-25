export type Disease = 'type2_diabetes' | 'coronary_artery_disease' | 'age_related_macular_degeneration';
export type SampleSet = 'T2D_SAMPLE' | 'CAD_SAMPLE' | 'AMD_SAMPLE';
export type RiskTier = 'low' | 'moderate' | 'high';
export type EffectType = 'OR' | 'beta' | 'unknown';
export type FilterDecisionType = 'included' | 'excluded';

export interface ValidatedVariant {
  rsid: string;
  isValid: boolean;
  normalizedRsid: string;
  error?: string;
}

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

export interface FilterDecision {
  rsid: string;
  riskAllele: string;
  studyAccession: string;
  pubmedId: string;
  traitName: string;
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

export interface PRSContribution {
  rsid: string;
  riskAllele: string;
  genotypeAlleleCount: number;
  effectSize: number;
  effectType: 'OR_log' | 'beta';
  contribution: number;
  studyAccession: string;
  pubmedId: string;
}

export interface PRSResult {
  disease: Disease;
  totalScore: number;
  contributions: PRSContribution[];
  variantsIncluded: number;
  genotypeAssumed: boolean;
}

export interface Citation {
  pubmedId: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
}

export interface RiskInterpretation {
  disease: Disease;
  tier: RiskTier;
  prsScore: number;
  zScore: number;
  percentileApprox: number;
  confidenceLevel: 'low' | 'moderate' | 'high';
  confidenceReason: string;
  description: string;
}

export interface LifestyleContext {
  disease: Disease;
  factors: Array<{ category: string; description: string }>;
  source: string;
}

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
