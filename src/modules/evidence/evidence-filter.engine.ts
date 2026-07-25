import { Injectable } from '@nitrostack/core';
import {
  GWASAssociation,
  FilterDecision,
  EffectType,
} from '../../types.js';

const GWS_PVALUE = 5e-8;

/**
 * PolyRisk MVP heuristic.
 *
 * IMPORTANT:
 * This is NOT a universal GWAS quality threshold.
 * It is used as one evidence-quality signal for the hackathon MVP.
 */
const MIN_SAMPLE_SIZE = 1000;

function formatPvalue(
  mantissa: number,
  exponent: number
): string {
  if (
    Number.isFinite(mantissa) &&
    Number.isFinite(exponent)
  ) {
    return `${mantissa} × 10^${exponent}`;
  }

  return 'unknown';
}

function parseSampleSizeFromString(
  sizeStr: string | null | undefined
): number {

  if (!sizeStr) return 0;

  const numbers =
    sizeStr
      .match(/[\d,]+/g)
      ?.map(n =>
        parseInt(n.replace(/,/g, ''), 10)
      )
      .filter(n => Number.isFinite(n)) ?? [];

  return numbers.reduce(
    (sum, n) => sum + n,
    0
  );
}

@Injectable()
export class EvidenceFilterEngine {

  filter(
    associations: GWASAssociation[],
    userAncestry: string | null
  ): FilterDecision[] {

    /*
     * Group all associations belonging
     * to the same SNP.
     */

    const byRsid =
      new Map<string, GWASAssociation[]>();

    for (const association of associations) {

      if (!association?.rsid) continue;

      if (!byRsid.has(association.rsid)) {
        byRsid.set(
          association.rsid,
          []
        );
      }

      byRsid
        .get(association.rsid)!
        .push(association);
    }

    const decisions: FilterDecision[] = [];

    /*
     * Process every SNP independently.
     */

    for (const [rsid, group] of byRsid.entries()) {

      /*
       * FIRST:
       * determine which studies are scientifically
       * usable.
       *
       * We must NOT select the largest study before
       * checking whether it is valid.
       */

      const evaluated = group.map(
        association => ({
          association,
          basicQuality:
            this.evaluateBasicQuality(association),
        })
      );

      /*
       * Candidate studies satisfy basic requirements.
       */

      const candidates = evaluated
        .filter(x => x.basicQuality.valid)
        .map(x => x.association);

      /*
       * If nothing survives basic QC,
       * return the real rejection reason
       * for every study.
       */

      if (candidates.length === 0) {

        for (const item of evaluated) {

          decisions.push(
            this.buildRejectedDecision(
              item.association,
              item.basicQuality.reason
            )
          );
        }

        continue;
      }

      /*
       * Rank ONLY scientifically usable studies.
       *
       * Primary:
       * sample size
       *
       * Secondary:
       * smaller p-value
       */

      candidates.sort((a, b) => {

        const sizeA =
          this.getSampleSize(a);

        const sizeB =
          this.getSampleSize(b);

        if (sizeA !== sizeB) {
          return sizeB - sizeA;
        }

        return a.pvalue - b.pvalue;
      });

      const best = candidates[0];

      /*
       * Evaluate selected study with ancestry context.
       */

      decisions.push(
        this.evaluateSelectedAssociation(
          best,
          userAncestry
        )
      );

      /*
       * Handle remaining studies.
       */

      for (const item of evaluated) {

        const association =
          item.association;

        if (association === best) {
          continue;
        }

        /*
         * Invalid studies get their ACTUAL
         * rejection reason.
         */

        if (!item.basicQuality.valid) {

          decisions.push(
            this.buildRejectedDecision(
              association,
              item.basicQuality.reason
            )
          );

          continue;
        }

        /*
         * Valid but lower-ranked study.
         */

        decisions.push(
          this.buildSupersededDecision(
            association,
            best.studyAccession
          )
        );
      }
    }

    /*
     * Included results first.
     */

    return decisions.sort((a, b) => {

      if (a.decision !== b.decision) {

        return a.decision === 'included'
          ? -1
          : 1;
      }

      return a.rsid.localeCompare(b.rsid);
    });
  }

  // ========================================================
  // BASIC SCIENTIFIC QC
  // ========================================================

  private evaluateBasicQuality(
    assoc: GWASAssociation
  ): {
    valid: boolean;
    reason: string;
  } {

    /*
     * 1. P-value must exist and be valid.
     */

    if (
      !Number.isFinite(assoc.pvalue) ||
      assoc.pvalue <= 0 ||
      assoc.pvalue > 1
    ) {

      return {
        valid: false,
        reason:
          'excluded: missing or invalid p-value',
      };
    }

    /*
     * 2. Genome-wide significance.
     */

    if (assoc.pvalue >= GWS_PVALUE) {

      return {
        valid: false,
        reason:
          `excluded: association does not meet ` +
          `genome-wide significance ` +
          `(p=${this.getFormattedPvalue(assoc)}, ` +
          `required p < 5×10⁻⁸)`,
      };
    }

    /*
     * 3. Effect allele must exist.
     */

    if (
      !assoc.riskAllele ||
      assoc.riskAllele === '?' ||
      assoc.riskAllele.toLowerCase() === 'nr'
    ) {

      return {
        valid: false,
        reason:
          'excluded: effect/risk allele is missing or ambiguous',
      };
    }

    /*
     * 4. Quantitative effect size.
     */

    const effectType =
      this.getEffectType(assoc);

    const effectSize =
      this.getEffectSize(assoc);

    if (
      effectType === 'unknown' ||
      !Number.isFinite(effectSize)
    ) {

      return {
        valid: false,
        reason:
          'excluded: no usable quantitative effect size (OR or beta)',
      };
    }

    /*
     * OR must be > 0.
     */

    if (
      effectType === 'OR' &&
      effectSize <= 0
    ) {

      return {
        valid: false,
        reason:
          'excluded: invalid odds ratio (OR must be > 0)',
      };
    }

    /*
     * 5. Sample size.
     */

    const sampleSize =
      this.getSampleSize(assoc);

    if (sampleSize === 0) {

      return {
        valid: false,
        reason:
          'excluded: study sample size is unavailable',
      };
    }

    if (sampleSize < MIN_SAMPLE_SIZE) {

      return {
        valid: false,
        reason:
          `excluded: study sample size ` +
          `(n≈${sampleSize}) is below ` +
          `PolyRisk's MVP minimum evidence threshold ` +
          `(n=${MIN_SAMPLE_SIZE})`,
      };
    }

    return {
      valid: true,
      reason: 'passes basic evidence QC',
    };
  }

  // ========================================================
  // SELECTED ASSOCIATION
  // ========================================================

  private evaluateSelectedAssociation(
    assoc: GWASAssociation,
    userAncestry: string | null
  ): FilterDecision {

    const effectSize =
      this.getEffectSize(assoc);

    const effectType =
      this.getEffectType(assoc);

    const sampleSize =
      this.getSampleSize(assoc);

    const pvalueFormatted =
      this.getFormattedPvalue(assoc);

    const ancestryWarning =
      this.getAncestryWarning(
        assoc.ancestralGroups ?? [],
        userAncestry
      );

    return {
      rsid: assoc.rsid,

      riskAllele:
        assoc.riskAllele,

      studyAccession:
        assoc.studyAccession,

      pubmedId:
        assoc.pubmedId,

      traitName:
        assoc.traitName,

      effectSize,

      effectType,

      pvalue:
        assoc.pvalue,

      pvalueFormatted,

      ancestralGroups:
        assoc.ancestralGroups ?? [],

      totalSampleSize:
        sampleSize,

      decision:
        'included',

      reason:
        `included: genome-wide significant ` +
        `(p=${pvalueFormatted}); ` +
        `sample size n≈${sampleSize}; ` +
        `valid effect size ` +
        `(${effectType === 'OR' ? 'OR=' : 'β='}` +
        `${effectSize.toFixed(3)})` +
        ancestryWarning,
    };
  }

  // ========================================================
  // REJECTED STUDY
  // ========================================================

  private buildRejectedDecision(
    assoc: GWASAssociation,
    reason: string
  ): FilterDecision {

    return {
      rsid:
        assoc.rsid,

      riskAllele:
        assoc.riskAllele,

      studyAccession:
        assoc.studyAccession,

      pubmedId:
        assoc.pubmedId,

      traitName:
        assoc.traitName,

      effectSize:
        this.getEffectSize(assoc),

      effectType:
        this.getEffectType(assoc),

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        this.getFormattedPvalue(assoc),

      ancestralGroups:
        assoc.ancestralGroups ?? [],

      totalSampleSize:
        this.getSampleSize(assoc),

      decision:
        'excluded',

      reason,
    };
  }

  // ========================================================
  // SUPERSEDED STUDY
  // ========================================================

  private buildSupersededDecision(
    assoc: GWASAssociation,
    supersededBy: string
  ): FilterDecision {

    return {
      rsid:
        assoc.rsid,

      riskAllele:
        assoc.riskAllele,

      studyAccession:
        assoc.studyAccession,

      pubmedId:
        assoc.pubmedId,

      traitName:
        assoc.traitName,

      effectSize:
        this.getEffectSize(assoc),

      effectType:
        this.getEffectType(assoc),

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        this.getFormattedPvalue(assoc),

      ancestralGroups:
        assoc.ancestralGroups ?? [],

      totalSampleSize:
        this.getSampleSize(assoc),

      decision:
        'excluded',

      reason:
        `excluded: another qualifying association ` +
        `for ${assoc.rsid} has stronger study support ` +
        `(${supersededBy}); retaining one effect ` +
        `estimate prevents double-counting the same variant`,
    };
  }

  // ========================================================
  // EFFECT SIZE
  // ========================================================

  private getEffectSize(
    assoc: GWASAssociation
  ): number {

    if (
      assoc.orPerCopyNum !== null &&
      assoc.orPerCopyNum !== undefined &&
      assoc.orPerCopyNum > 0
    ) {

      return assoc.orPerCopyNum;
    }

    if (
      assoc.betaNum !== null &&
      assoc.betaNum !== undefined &&
      Number.isFinite(assoc.betaNum)
    ) {

      return assoc.betaNum;
    }

    return 0;
  }

  private getEffectType(
    assoc: GWASAssociation
  ): EffectType {

    if (
      assoc.orPerCopyNum !== null &&
      assoc.orPerCopyNum !== undefined &&
      assoc.orPerCopyNum > 0
    ) {

      return 'OR';
    }

    if (
      assoc.betaNum !== null &&
      assoc.betaNum !== undefined &&
      Number.isFinite(assoc.betaNum)
    ) {

      return 'beta';
    }

    return 'unknown';
  }

  // ========================================================
  // SAMPLE SIZE
  // ========================================================

  private getSampleSize(
    assoc: GWASAssociation
  ): number {

    if (
      Number.isFinite(assoc.totalSampleSize) &&
      assoc.totalSampleSize > 0
    ) {

      return assoc.totalSampleSize;
    }

    return parseSampleSizeFromString(
      assoc.initialSampleSize
    );
  }

  // ========================================================
  // P-VALUE
  // ========================================================

  private getFormattedPvalue(
    assoc: GWASAssociation
  ): string {

    if (
      Number.isFinite(assoc.pvalueMantissa) &&
      Number.isFinite(assoc.pvalueExponent)
    ) {

      return formatPvalue(
        assoc.pvalueMantissa,
        assoc.pvalueExponent
      );
    }

    if (Number.isFinite(assoc.pvalue)) {
      return assoc.pvalue.toExponential(2);
    }

    return 'unknown';
  }

  // ========================================================
  // ANCESTRY
  // ========================================================

  private getAncestryWarning(
    studyGroups: string[],
    userAncestry: string | null
  ): string {

    if (
      !userAncestry ||
      studyGroups.length === 0
    ) {

      return '';
    }

    const informativeGroups =
      studyGroups.filter(group => {

        const lower =
          group.toLowerCase();

        return ![
          'nr',
          'not reported',
          'mixed',
        ].includes(lower);
      });

    if (informativeGroups.length === 0) {
      return '';
    }

    if (
      this.ancestryMatches(
        informativeGroups,
        userAncestry
      )
    ) {

      return `; ancestry compatible with target (${userAncestry})`;
    }

    return (
      `; CAUTION: study ancestry ` +
      `(${informativeGroups.join(', ')}) ` +
      `differs from target ancestry ` +
      `(${userAncestry}); effect-size ` +
      `transferability may be reduced`
    );
  }

  private ancestryMatches(
    studyGroups: string[],
    userAncestry: string
  ): boolean {

    const target =
      userAncestry
        .trim()
        .toLowerCase();

    return studyGroups.some(group => {

      const study =
        group
          .trim()
          .toLowerCase();

      return (
        study === target ||
        study.includes(target) ||
        target.includes(study)
      );
    });
  }
}
