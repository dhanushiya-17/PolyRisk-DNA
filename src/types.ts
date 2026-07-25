export type Disease = 'type2_diabetes' | 'coronary_artery_disease' | 'age_related_macular_degeneration';
export type EffectType = 'OR' | 'beta' | 'unknown';

/** Matches the exact camelCase shape produced by GWASCatalogService. */
export interface GWASAssociation {
  rsid: string;
  riskAllele: string;              // already stripped to bare letter, e.g. "T"
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
  pubmedId: string | null;
  studyAccession: string | null;
  traitName: string;
  effectSize: number;
  effectType: EffectType;
  pvalue: number;
  pvalueFormatted: string;
  ancestralGroups: string[];
  totalSampleSize: number;
  decision: 'included' | 'excluded';
  reason: string;
}

export interface FilterEvidenceResult {
  disease: Disease;
  total: number;
  includedCount: number;
  excludedCount: number;
  ancestryNote: string;
  allDecisions: FilterDecision[];
}
