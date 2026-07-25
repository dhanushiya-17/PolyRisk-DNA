import { Injectable } from '@nitrostack/core';
import { GWASAssociation, FilterDecision, EffectType } from '../../types.js';

const GWS_PVALUE = 5e-8;
const MIN_SAMPLE_SIZE = 1000;

function formatPvalue(mantissa: number, exponent: number): string {
  return `${mantissa} × 10^${exponent}`;
}

function parseSampleSizeFromString(sizeStr: string): number {
  const numbers = sizeStr.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''), 10)) ?? [];
  return numbers.reduce((sum, n) => sum + n, 0);
}

@Injectable()
export class EvidenceFilterEngine {
  filter(
    associations: GWASAssociation[],
    userAncestry: string | null
  ): FilterDecision[] {
    // De-duplicate by rsid: if multiple studies for same rsid, keep highest-powered
    const byRsid = new Map<string, GWASAssociation[]>();
    for (const a of associations) {
      if (!byRsid.has(a.rsid)) byRsid.set(a.rsid, []);
      byRsid.get(a.rsid)!.push(a);
    }

    const decisions: FilterDecision[] = [];

    for (const [rsid, group] of byRsid.entries()) {
      // Sort by sample size descending, then p-value ascending
      const sorted = [...group].sort((a, b) => {
        if (b.totalSampleSize !== a.totalSampleSize) return b.totalSampleSize - a.totalSampleSize;
        return a.pvalue - b.pvalue;
      });

      const best = sorted[0];
      const rest = sorted.slice(1);

      // Evaluate the best study
      const bestDecision = this.evaluateAssociation(best, userAncestry, false);
      decisions.push(bestDecision);

      // Superseded studies (same variant, weaker study)
      for (const weaker of rest) {
        decisions.push(this.evaluateAssociation(weaker, userAncestry, true, best.studyAccession));
      }
    }

    return decisions.sort((a, b) => {
      if (a.decision !== b.decision) return a.decision === 'included' ? -1 : 1;
      return a.rsid.localeCompare(b.rsid);
    });
  }

  private evaluateAssociation(
    assoc: GWASAssociation,
    userAncestry: string | null,
    isSuperseded: boolean,
    supersededBy?: string
  ): FilterDecision {
    const effectSize = this.getEffectSize(assoc);
    const effectType = this.getEffectType(assoc);
    const pvalueFormatted = formatPvalue(assoc.pvalueMantissa, assoc.pvalueExponent);

    if (isSuperseded) {
      return {
        rsid: assoc.rsid, riskAllele: assoc.riskAllele,
        studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
        traitName: assoc.traitName, effectSize, effectType,
        pvalue: assoc.pvalue, pvalueFormatted,
        ancestralGroups: assoc.ancestralGroups,
        totalSampleSize: assoc.totalSampleSize,
        decision: 'excluded',
        reason: `excluded: superseded by larger study (${supersededBy}) for the same variant — retaining the best-powered result only`,
      };
    }

    // Check genome-wide significance
    if (assoc.pvalue >= GWS_PVALUE) {
      return {
        rsid: assoc.rsid, riskAllele: assoc.riskAllele,
        studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
        traitName: assoc.traitName, effectSize, effectType,
        pvalue: assoc.pvalue, pvalueFormatted,
        ancestralGroups: assoc.ancestralGroups,
        totalSampleSize: assoc.totalSampleSize,
        decision: 'excluded',
        reason: `excluded: p-value (${pvalueFormatted}) does not meet genome-wide significance threshold (p < 5×10⁻⁸) — association may be spurious`,
      };
    }

    // Check sample size
    const parsedSize = assoc.totalSampleSize > 0
      ? assoc.totalSampleSize
      : parseSampleSizeFromString(assoc.initialSampleSize);

    if (parsedSize < MIN_SAMPLE_SIZE) {
      return {
        rsid: assoc.rsid, riskAllele: assoc.riskAllele,
        studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
        traitName: assoc.traitName, effectSize, effectType,
        pvalue: assoc.pvalue, pvalueFormatted,
        ancestralGroups: assoc.ancestralGroups,
        totalSampleSize: parsedSize,
        decision: 'excluded',
        reason: `excluded: study sample size (n≈${parsedSize}) is below the reliable threshold (n=${MIN_SAMPLE_SIZE}) — underpowered for this effect size`,
      };
    }

    // Check effect size exists
    if (effectSize === 0 || effectType === 'unknown') {
      return {
        rsid: assoc.rsid, riskAllele: assoc.riskAllele,
        studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
        traitName: assoc.traitName, effectSize, effectType,
        pvalue: assoc.pvalue, pvalueFormatted,
        ancestralGroups: assoc.ancestralGroups,
        totalSampleSize: parsedSize,
        decision: 'excluded',
        reason: 'excluded: no quantitative effect size (odds ratio or beta) reported — cannot include in polygenic score calculation',
      };
    }

    // Check ancestry transferability
    const isNonEuropeanOnly = assoc.ancestralGroups.length > 0
      && !assoc.ancestralGroups.some(g => ['European', 'NR', 'Not reported', 'Mixed'].includes(g))
      && assoc.ancestralGroups.every(g => !g.toLowerCase().includes('european'));

    if (isNonEuropeanOnly && userAncestry && !this.ancestryMatches(assoc.ancestralGroups, userAncestry)) {
      return {
        rsid: assoc.rsid, riskAllele: assoc.riskAllele,
        studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
        traitName: assoc.traitName, effectSize, effectType,
        pvalue: assoc.pvalue, pvalueFormatted,
        ancestralGroups: assoc.ancestralGroups,
        totalSampleSize: parsedSize,
        decision: 'excluded',
        reason: `excluded: study population (${assoc.ancestralGroups.join(', ')}) does not match your stated ancestry (${userAncestry}) — effect size transferability not established, would inflate score`,
      };
    }

    const ancestryWarning = isNonEuropeanOnly
      ? ` (note: study population is ${assoc.ancestralGroups.join(', ')} — effect sizes may differ in other ancestries)`
      : '';

    return {
      rsid: assoc.rsid, riskAllele: assoc.riskAllele,
      studyAccession: assoc.studyAccession, pubmedId: assoc.pubmedId,
      traitName: assoc.traitName, effectSize, effectType,
      pvalue: assoc.pvalue, pvalueFormatted,
      ancestralGroups: assoc.ancestralGroups,
      totalSampleSize: parsedSize,
      decision: 'included',
      reason: `included: genome-wide significant (p=${pvalueFormatted}), adequately powered (n≈${parsedSize}), valid effect size (${effectType === 'OR' ? 'OR=' : 'β='}${effectSize.toFixed(3)})${ancestryWarning}`,
    };
  }

  private getEffectSize(assoc: GWASAssociation): number {
    if (assoc.orPerCopyNum !== null && assoc.orPerCopyNum > 0) return assoc.orPerCopyNum;
    if (assoc.betaNum !== null) return assoc.betaNum;
    return 0;
  }

  private getEffectType(assoc: GWASAssociation): EffectType {
    if (assoc.orPerCopyNum !== null && assoc.orPerCopyNum > 0) return 'OR';
    if (assoc.betaNum !== null) return 'beta';
    return 'unknown';
  }

  private ancestryMatches(studyGroups: string[], userAncestry: string): boolean {
    const lower = userAncestry.toLowerCase();
    return studyGroups.some(g => g.toLowerCase().includes(lower) || lower.includes(g.toLowerCase()));
  }
}
