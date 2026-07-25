import { Injectable } from '@nitrostack/core';
import { GWASAssociation, FilterDecision, EffectType } from '../../types.js';

const GWS_PVALUE = 5e-8;
const MIN_SAMPLE_SIZE = 1000;

interface BasicQualityResult {
  valid: boolean;
  reason: string;
}

@Injectable()
export class EvidenceFilterEngine {
  /**
   * Trait/disease relevance is already enforced upstream by
   * GWASCatalogService.matchesDisease() before associations reach
   * this engine — so this engine does NOT re-check trait relevance.
   * It focuses purely on evidence quality: significance, sample
   * size, valid effect estimates, and best-per-SNP selection.
   */
  filter(associations: GWASAssociation[], userAncestry: string | null): FilterDecision[] {
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
        quality: this.evaluateBasicQuality(association),
      }));

      const validCandidates = evaluated.filter((item) => item.quality.valid);

      if (validCandidates.length === 0) {
        for (const item of evaluated) {
          decisions.push(this.buildExcludedDecision(item.association, item.quality.reason));
        }
        continue;
      }

      const ranked = [...validCandidates].sort((a, b) => {
        const sizeDiff = b.association.totalSampleSize - a.association.totalSampleSize;
        if (sizeDiff !== 0) return sizeDiff;
        return a.association.pvalue - b.association.pvalue;
      });

      const best = ranked[0].association;
      decisions.push(this.buildIncludedDecision(best, userAncestry));

      for (const item of evaluated) {
        if (item.association === best) continue;

        if (!item.quality.valid) {
          decisions.push(this.buildExcludedDecision(item.association, item.quality.reason));
          continue;
        }

        decisions.push(this.buildSupersededDecision(item.association, best.riskAllele));
      }
    }

    return decisions.sort((a, b) => {
      if (a.decision !== b.decision) return a.decision === 'included' ? -1 : 1;
      return a.rsid.localeCompare(b.rsid);
    });
  }

  private evaluateBasicQuality(assoc: GWASAssociation): BasicQualityResult {
    if (!Number.isFinite(assoc.pvalue) || assoc.pvalue < 0 || assoc.pvalue > 1) {
      return { valid: false, reason: 'excluded: association has a missing or invalid p-value' };
    }

    if (assoc.pvalue >= GWS_PVALUE) {
      return {
        valid: false,
        reason: `excluded: does not meet genome-wide significance threshold (p=${this.formatPvalue(assoc)}, required p < 5×10⁻⁸)`,
      };
    }

    if (!this.hasValidRiskAllele(assoc.riskAllele)) {
      return { valid: false, reason: 'excluded: effect/risk allele is missing or invalid' };
    }

    const effectSize = this.getEffectSize(assoc);
    if (effectSize === null) {
      return { valid: false, reason: 'excluded: no usable effect size (odds ratio or beta) was reported' };
    }
    if (this.getEffectType(assoc) === 'OR' && effectSize <= 0) {
      return { valid: false, reason: 'excluded: odds ratio is invalid; OR must be greater than zero' };
    }

    if (assoc.totalSampleSize < MIN_SAMPLE_SIZE) {
      return {
        valid: false,
        reason: `excluded: study sample size (n≈${assoc.totalSampleSize}) is below PolyRisk's MVP minimum evidence threshold (n=${MIN_SAMPLE_SIZE}); this is a project heuristic, not a universal GWAS quality cutoff`,
      };
    }

    return { valid: true, reason: 'passes PolyRisk basic evidence QC' };
  }

  private buildIncludedDecision(assoc: GWASAssociation, userAncestry: string | null): FilterDecision {
    const effectSize = this.getEffectSize(assoc)!;
    const effectType = this.getEffectType(assoc);
    const ancestryMessage = this.getAncestryMessage(assoc.ancestralGroups ?? [], userAncestry);
    const effectDescription = effectType === 'OR' ? `OR=${effectSize.toFixed(3)}` : `β=${effectSize.toFixed(3)}`;

    return {
      rsid: assoc.rsid,
      riskAllele: assoc.riskAllele,
      pubmedId: assoc.pubmedId || null,
      studyAccession: assoc.studyAccession || null,
      traitName: assoc.traitName,
      effectSize,
      effectType,
      pvalue: assoc.pvalue,
      pvalueFormatted: this.formatPvalue(assoc),
      ancestralGroups: assoc.ancestralGroups ?? [],
      totalSampleSize: assoc.totalSampleSize,
      decision: 'included',
      reason:
        `included: genome-wide significant (p=${this.formatPvalue(assoc)}); ` +
        `adequate study size (n≈${assoc.totalSampleSize}); ` +
        `valid effect estimate (${effectDescription}); effect allele=${assoc.riskAllele}` +
        ancestryMessage,
    };
  }

  private buildExcludedDecision(assoc: GWASAssociation, reason: string): FilterDecision {
    return {
      rsid: assoc.rsid,
      riskAllele: assoc.riskAllele || '',
      pubmedId: assoc.pubmedId || null,
      studyAccession: assoc.studyAccession || null,
      traitName: assoc.traitName || '',
      effectSize: this.getEffectSize(assoc) ?? 0,
      effectType: this.getEffectType(assoc),
      pvalue: assoc.pvalue,
      pvalueFormatted: Number.isFinite(assoc.pvalue) ? this.formatPvalue(assoc) : 'unknown',
      ancestralGroups: assoc.ancestralGroups ?? [],
      totalSampleSize: assoc.totalSampleSize ?? 0,
      decision: 'excluded',
      reason,
    };
  }

  private buildSupersededDecision(assoc: GWASAssociation, supersededByAllele: string): FilterDecision {
    return {
      rsid: assoc.rsid,
      riskAllele: assoc.riskAllele,
      pubmedId: assoc.pubmedId || null,
      studyAccession: assoc.studyAccession || null,
      traitName: assoc.traitName,
      effectSize: this.getEffectSize(assoc) ?? 0,
      effectType: this.getEffectType(assoc),
      pvalue: assoc.pvalue,
      pvalueFormatted: this.formatPvalue(assoc),
      ancestralGroups: assoc.ancestralGroups ?? [],
      totalSampleSize: assoc.totalSampleSize,
      decision: 'excluded',
      reason: `excluded from scoring: another qualifying association for ${assoc.rsid} has stronger study support (${supersededByAllele}); retaining one effect estimate prevents double-counting the same variant`,
    };
  }

  private formatPvalue(assoc: GWASAssociation): string {
    if (Number.isFinite(assoc.pvalueMantissa) && Number.isFinite(assoc.pvalueExponent)) {
      return `${assoc.pvalueMantissa} × 10^${assoc.pvalueExponent}`;
    }
    return Number.isFinite(assoc.pvalue) ? assoc.pvalue.toExponential(2) : 'unknown';
  }

  private getEffectSize(assoc: GWASAssociation): number | null {
    if (assoc.orPerCopyNum !== null && assoc.orPerCopyNum !== undefined && Number.isFinite(assoc.orPerCopyNum) && assoc.orPerCopyNum > 0) {
      return assoc.orPerCopyNum;
    }
    if (assoc.betaNum !== null && assoc.betaNum !== undefined && Number.isFinite(assoc.betaNum)) {
      return this.getSignedBeta(assoc.betaNum, assoc.betaDirection);
    }
    return null;
  }

  private getEffectType(assoc: GWASAssociation): EffectType {
    if (assoc.orPerCopyNum !== null && assoc.orPerCopyNum !== undefined && Number.isFinite(assoc.orPerCopyNum) && assoc.orPerCopyNum > 0) return 'OR';
    if (assoc.betaNum !== null && assoc.betaNum !== undefined && Number.isFinite(assoc.betaNum)) return 'beta';
    return 'unknown';
  }

  private getSignedBeta(beta: number, direction: string | null): number {
    if (!direction) return beta;
    const d = direction.trim().toLowerCase();
    if (d.includes('decrease') || d.includes('negative') || d === '-') return -Math.abs(beta);
    if (d.includes('increase') || d.includes('positive') || d === '+') return Math.abs(beta);
    return beta;
  }

  private hasValidRiskAllele(allele: string | null | undefined): boolean {
    if (!allele) return false;
    return ['A', 'C', 'G', 'T'].includes(allele.trim().toUpperCase());
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
