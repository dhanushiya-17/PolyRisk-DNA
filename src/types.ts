export type EffectType = 'OR' | 'beta' | 'unknown';
export type Disease = 'T2D' | 'CAD' | 'AMD';

/** Matches the enriched dict shape from analyze_person_variants(enrich_studies=True). */
export interface GWASAssociation {
  rsid: string;
  genotype?: string | null;
  risk_allele: string;
  risk_allele_count?: number | null;
  gene?: string | null;
  trait: string[];
  odds_ratio: number | null;
  beta_num: number | null;
  beta_unit?: string | null;
  beta_direction?: string | null;
  pvalue: number | null;
  pvalue_mantissa?: number | null;
  pvalue_exponent?: number | null;
  study_accession?: string | null;
  pubmed_id?: string | null;
  ancestry?: string | null;          // formatted display string, e.g. "case: European (N=4162)"
  total_sample_size?: number | null;
}

export interface FilterDecision {
  rsid: string;
  riskAllele: string;
  riskAlleleCount: number | null;
  pubmedId: string | null;
  studyAccession: string | null;
  traitName: string;
  effectSize: number;
  effectType: EffectType;
  pvalue: number;
  pvalueFormatted: string;
  ancestryDisplay: string | null;
  ancestralGroups: string[];
  totalSampleSize: number;
  decision: 'included' | 'excluded';
  reason: string;
}
