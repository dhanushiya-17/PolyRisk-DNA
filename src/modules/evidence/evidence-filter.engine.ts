import { Injectable } from '@nitrostack/core';
import { GWASAssociation, FilterDecision, EffectType, Disease } from '../../types.js';

const GWS_PVALUE = 5e-8;
const MIN_SAMPLE_SIZE = 1000;

const DISEASE_TRAIT_KEYWORDS: Record<Disease, string[]> = {
  T2D: ['type 2 diabetes', 'type ii diabetes'],
  CAD: ['coronary artery', 'coronary heart disease', 'myocardial infarction'],
  AMD: ['macular degeneration'],
};

interface BasicQualityResult {
  valid: boolean;
  reason: string;
}

@Injectable()
export class EvidenceFilterEngine {
  filter(
    associations: GWASAssociation[],
    disease: Disease,
    userAncestry: string | null
  ): FilterDecision[] {
    const targetTraitKeywords = DISEASE_TRAIT_KEYWORDS[disease];
    const byRsid = new Map<string, GWASAssociation[]>();

    for (const association of associations) {
      if (!association?.rsid) continue;
      if (!byRsid.has(association.rsid)) byRsid.set(association.rsid, []);
      byRsid.get(association.rsid)!.push(association);
    }

    const decisions: FilterDecision[] = [];

    for (const [, group] of byRsid.entries()) {
      const evaluated = group.map((association) => ({
        association,
        pvalue: this.resolvePvalue(association),
        quality: this.evaluateBasicQuality(association, targetTraitKeywords),
      }));

      const validCandidates = evaluated.filter((item) => item.quality.valid);

      if (validCandidates.length === 0) {
        for (const item of evaluated) {
          decisions.push(this.buildExcludedDecision(item.association, item.pvalue, item.quality.reason));
        }
        continue;
      }

      const ranked = [...validCandidates].sort((a, b) => {
        const sizeDiff = this.getSampleSize(b.association) - this.getSampleSize(a.association);
        if (sizeDiff !== 0) return sizeDiff;
        return a.pvalue - b.pvalue;
      });

      const best = ranked[0];
      decisions.push(this.buildIncludedDecision(best.association, best.pvalue, userAncestry));

      for (const item of evaluated) {
        if (item.association === best.association) continue;

        if (!item.quality.valid) {
          decisions.push(this.buildExcludedDecision(item.association, item.pvalue, item.quality.reason));
          continue;
        }

        decisions.push(
          this.buildSupersededDecision(item.association, item.pvalue, best.association.risk_allele)
        );
      }
    }

    return decisions.sort((a, b) => {
      if (a.decision !== b.decision) return a.decision === 'included' ? -1 : 1;
      return a.rsid.localeCompare(b.rsid);
    });
  }

  private evaluateBasicQuality(
    assoc: GWASAssociation,
    targetTraitKeywords: string[]
  ): BasicQualityResult {
    if (!this.matchesTargetTrait(assoc.trait, targetTraitKeywords)) {
      return {
        valid: false,
        reason: `excluded: trait (${assoc.trait?.join(', ') || 'unspecified'}) is not relevant to the target condition`,
      };
    }

    const pvalue = this.resolvePvalue(assoc);
    if (!Number.isFinite(pvalue) || pvalue < 0 || pvalue > 1) {
      return { valid: false, reason: 'excluded: association has a missing or invalid p-value' };
    }

    if (pvalue >= GWS_PVALUE) {
      return {
        valid: false,
        reason: `excluded: does not meet genome-wide significance threshold (p=${this.formatPvalue(assoc, pvalue)}, required p < 5×10⁻⁸)`,
      };
    }

    if (!this.hasValidRiskAllele(assoc.risk_allele)) {
      return { valid: false, reason: 'excluded: effect/risk allele is missing or in an unparseable format' };
    }

    const effectSize = this.getEffectSize(assoc);
    if (effectSize === null) {
      return { valid: false, reason: 'excluded: no usable effect size (odds ratio or beta) was reported' };
    }
    if (this.getEffectType(assoc) === 'OR' && effectSize <= 0) {
      return { valid: false, reason: 'excluded: odds ratio is invalid; OR must be greater than zero' };
    }

    const sampleSize = this.getSampleSize(assoc);
    if (sampleSize < MIN_SAMPLE_SIZE) {
      return {
        valid: false,
        reason: `excluded: study sample size (n≈${sampleSize}) is below PolyRisk's MVP minimum evidence threshold (n=${MIN_SAMPLE_SIZE}); this is a project heuristic, not a universal GWAS quality cutoff`,
      };
    }

    return { valid: true, reason: 'passes PolyRisk basic evidence QC' };
  }

  private buildIncludedDecision(assoc: GWASAssociation, pvalue: number, userAncestry: string | null): FilterDecision {
    const effectSize = this.getEffectSize(assoc)!;
    const effectType = this.getEffectType(assoc);
    const ancestralGroups = this.parseAncestryGroups(assoc.ancestry);
    const ancestryMessage = this.getAncestryMessage(ancestralGroups, userAncestry);
    const effectDescription = effectType === 'OR' ? `OR=${effectSize.toFixed(3)}` : `β=${effectSize.toFixed(3)}`;

    return {
      rsid: assoc.rsid,
      riskAllele: this.parseAllele(assoc.risk_allele),
      riskAlleleCount: assoc.risk_allele_count ?? null,
      pubmedId: assoc.pubmed_id ?? null,
      studyAccession: assoc.study_accession ?? null,
      traitName: assoc.trait?.join(', ') ?? '',
      effectSize,
      effectType,
      pvalue,
      pvalueFormatted: this.formatPvalue(assoc, pvalue),
      ancestryDisplay: assoc.ancestry ?? null,
      ancestralGroups,
      totalSampleSize: this.getSampleSize(assoc),
      decision: 'included',
      reason:
        `included: genome-wide significant (p=${this.formatPvalue(assoc, pvalue)}); ` +
        `adequate study size (n≈${this.getSampleSize(assoc)}); ` +
        `valid effect estimate (${effectDescription}); effect allele=${this.parseAllele(assoc.risk_allele)}` +
        ancestryMessage,
    };
  }

  private buildExcludedDecision(assoc: GWASAssociation, pvalue: number, reason: string): FilterDecision {
    const ancestralGroups = this.parseAncestryGroups(assoc.ancestry);
    return {
      rsid: assoc.rsid,
      riskAllele: this.parseAllele(assoc.risk_allele) ?? '',
      riskAlleleCount: assoc.risk_allele_count ?? null,
      pubmedId: assoc.pubmed_id ?? null,
      studyAccession: assoc.study_accession ?? null,
      traitName: assoc.trait?.join(', ') ?? '',
      effectSize: this.getEffectSize(assoc) ?? 0,
      effectType: this.getEffectType(assoc),
      pvalue,
      pvalueFormatted: Number.isFinite(pvalue) ? this.formatPvalue(assoc, pvalue) : 'unknown',
      ancestryDisplay: assoc.ancestry ?? null,
      ancestralGroups,
      totalSampleSize: this.getSampleSize(assoc),
      decision: 'excluded',
      reason,
    };
  }

  private buildSupersededDecision(assoc: GWASAssociation, pvalue: number, supersededByAllele: string): FilterDecision {
    const ancestralGroups = this.parseAncestryGroups(assoc.ancestry);
    return {
      rsid: assoc.rsid,
      riskAllele: this.parseAllele(assoc.risk_allele),
      riskAlleleCount: assoc.risk_allele_count ?? null,
      pubmedId: assoc.pubmed_id ?? null,
      studyAccession: assoc.study_accession ?? null,
      traitName: assoc.trait?.join(', ') ?? '',
      effectSize: this.getEffectSize(assoc) ?? 0,
      effectType: this.getEffectType(assoc),
      pvalue,
      pvalueFormatted: this.formatPvalue(assoc, pvalue),
      ancestryDisplay: assoc.ancestry ?? null,
      ancestralGroups,
      totalSampleSize: this.getSampleSize(assoc),
      decision: 'excluded',
      reason: `excluded from scoring: another qualifying association for ${assoc.rsid} has stronger study support (${supersededByAllele}); retaining one effect estimate prevents double-counting the same variant`,
    };
  }

  private matchesTargetTrait(traits: string[] | undefined, keywords: string[]): boolean {
    if (!traits || traits.length === 0) return false;
    const normalized = traits.map((t) => t.toLowerCase());
    return keywords.some((kw) => normalized.some((t) => t.includes(kw.toLowerCase())));
  }

  private resolvePvalue(assoc: GWASAssociation): number {
    if (Number.isFinite(assoc.pvalue_mantissa) && Number.isFinite(assoc.pvalue_exponent)) {
      return (assoc.pvalue_mantissa as number) * Math.pow(10, assoc.pvalue_exponent as number);
    }
    return Number.isFinite(assoc.pvalue) ? (assoc.pvalue as number) : NaN;
  }

  private formatPvalue(assoc: GWASAssociation, resolvedPvalue: number): string {
    if (Number.isFinite(assoc.pvalue_mantissa) && Number.isFinite(assoc.pvalue_exponent)) {
      return `${assoc.pvalue_mantissa} × 10^${assoc.pvalue_exponent}`;
    }
    return Number.isFinite(resolvedPvalue) ? resolvedPvalue.toExponential(2) : 'unknown';
  }

  private getEffectSize(assoc: GWASAssociation): number | null {
    if (assoc.odds_ratio !== null && assoc.odds_ratio !== undefined && Number.isFinite(assoc.odds_ratio) && assoc.odds_ratio > 0) {
      return assoc.odds_ratio;
    }
    if (assoc.beta_num !== null && assoc.beta_num !== undefined && Number.isFinite(assoc.beta_num)) {
      return this.getSignedBeta(assoc.beta_num, assoc.beta_direction ?? null);
    }
    return null;
  }

  private getEffectType(assoc: GWASAssociation): EffectType {
    if (assoc.odds_ratio !== null && assoc.odds_ratio !== undefined && Number.isFinite(assoc.odds_ratio) && assoc.odds_ratio > 0) return 'OR';
    if (assoc.beta_num !== null && assoc.beta_num !== undefined && Number.isFinite(assoc.beta_num)) return 'beta';
    return 'unknown';
  }

  private getSignedBeta(beta: number, direction: string | null): number {
    if (!direction) return beta;
    const d = direction.trim().toLowerCase();
    if (d.includes('decrease') || d.includes('negative') || d === '-') return -Math.abs(beta);
    if (d.includes('increase') || d.includes('positive') || d === '+') return Math.abs(beta);
    return beta;
  }

  private parseAllele(raw: string | null | undefined): string {
    if (!raw) return '';
    const parts = raw.split('-');
    return (parts.length > 1 ? parts[parts.length - 1] : raw).trim().toUpperCase();
  }

  private hasValidRiskAllele(raw: string | null | undefined): boolean {
    return ['A', 'C', 'G', 'T'].includes(this.parseAllele(raw));
  }

  private getSampleSize(assoc: GWASAssociation): number {
    return Number.isFinite(assoc.total_sample_size) && (assoc.total_sample_size as number) > 0
      ? (assoc.total_sample_size as number)
      : 0;
  }

  /**
   * Parses group names out of Person 1's formatted ancestry string,
   * e.g. "case: European (N=4162); control: European, African (N=5000)"
   * -> ["European", "African"]
   */
  private parseAncestryGroups(ancestry: string | null | undefined): string[] {
    if (!ancestry) return [];
    const groups = new Set<string>();
    const segmentPattern = /:\s*([^(]+)\(N=/g;
    let match: RegExpExecArray | null;
    while ((match = segmentPattern.exec(ancestry)) !== null) {
      match[1].split(',').forEach((g) => {
        const trimmed = g.trim();
        if (trimmed) groups.add(trimmed);
      });
    }
    return Array.from(groups);
  }

  private getAncestryMessage(studyGroups: string[], userAncestry: string | null): string {
    if (!userAncestry) {
      return studyGroups.length === 0 ? '; ancestry information unavailable' : `; study ancestry=${studyGroups.join(', ')}`;
    }
    const informative = studyGroups.filter((g) => !['nr', 'not reported', 'unknown'].includes(g.trim().toLowerCase()));
    if (informative.length === 0) {
      return '; CAUTION: study ancestry not reported, so transferability cannot be assessed';
    }
    if (this.ancestryMatches(informative, userAncestry)) {
      return `; ancestry compatible with target (${userAncestry})`;
    }
    return `; CAUTION: study ancestry (${informative.join(', ')}) differs from target ancestry (${userAncestry}); effect-size transferability may be reduced`;
  }

  private ancestryMatches(studyGroups: string[], userAncestry: string): boolean {
    const target = this.normalizeAncestry(userAncestry);
    return studyGroups.some((g) => {
      const study = this.normalizeAncestry(g);
      return study === target || study.includes(target) || target.includes(study);
    });
  }

  private normalizeAncestry(value: string): string {
    return value.trim().toLowerCase().replace(/ancestry/g, '').replace(/\s+/g, ' ').trim();
  }
}
