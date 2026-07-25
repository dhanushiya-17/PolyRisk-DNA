import { Injectable } from '@nitrostack/core';
import {
  GWASAssociation,
  FilterDecision,
  EffectType,
} from '../../types.js';

/**
 * Conventional GWAS genome-wide significance threshold.
 */
const GWS_PVALUE = 5e-8;

/**
 * PolyRisk MVP heuristic.
 *
 * This is NOT a universal scientific threshold.
 * It is an internal evidence-quality rule used by the hackathon MVP.
 */
const MIN_SAMPLE_SIZE = 1000;

interface BasicQualityResult {
  valid: boolean;
  reason: string;
}

function parseSampleSizeFromString(
  sizeStr: string | null | undefined
): number {
  if (!sizeStr) return 0;

  const numbers =
    sizeStr
      .match(/[\d,]+/g)
      ?.map((n) => parseInt(n.replace(/,/g, ''), 10))
      .filter((n) => Number.isFinite(n)) ?? [];

  return numbers.reduce((sum, n) => sum + n, 0);
}

@Injectable()
export class EvidenceFilterEngine {
  /**
   * Main evidence-filtering pipeline.
   *
   * 1. Group associations by SNP.
   * 2. Run basic QC on every association.
   * 3. Rank only associations that pass QC.
   * 4. Select one best-supported association per SNP.
   * 5. Exclude weaker duplicate studies to avoid double counting.
   * 6. Add ancestry-transferability warnings when appropriate.
   */
  filter(
    associations: GWASAssociation[],
    userAncestry: string | null
  ): FilterDecision[] {
    const byRsid = new Map<string, GWASAssociation[]>();

    // -------------------------------------------------------
    // GROUP ASSOCIATIONS BY SNP
    // -------------------------------------------------------

    for (const association of associations) {
      if (!association?.rsid) continue;

      if (!byRsid.has(association.rsid)) {
        byRsid.set(association.rsid, []);
      }

      byRsid.get(association.rsid)!.push(association);
    }

    const decisions: FilterDecision[] = [];

    // -------------------------------------------------------
    // PROCESS EACH SNP
    // -------------------------------------------------------

    for (const [, group] of byRsid.entries()) {
      const evaluated = group.map((association) => ({
        association,
        quality: this.evaluateBasicQuality(association),
      }));

      const validCandidates = evaluated
        .filter((item) => item.quality.valid)
        .map((item) => item.association);

      // No study for this SNP passed basic QC.
      if (validCandidates.length === 0) {
        for (const item of evaluated) {
          decisions.push(
            this.buildExcludedDecision(
              item.association,
              item.quality.reason
            )
          );
        }

        continue;
      }

      // -----------------------------------------------------
      // RANK VALID STUDIES
      //
      // IMPORTANT:
      // We rank AFTER QC.
      //
      // Otherwise a huge but non-significant study could
      // incorrectly "supersede" a smaller high-quality study.
      // -----------------------------------------------------

      const ranked = [...validCandidates].sort((a, b) => {
        const sizeDifference =
          this.getSampleSize(b) - this.getSampleSize(a);

        if (sizeDifference !== 0) {
          return sizeDifference;
        }

        return a.pvalue - b.pvalue;
      });

      const best = ranked[0];

      // Best valid association survives.
      decisions.push(
        this.buildIncludedDecision(best, userAncestry)
      );

      // -----------------------------------------------------
      // HANDLE ALL OTHER ASSOCIATIONS FOR THIS SNP
      // -----------------------------------------------------

      for (const item of evaluated) {
        const association = item.association;

        if (association === best) {
          continue;
        }

        // Invalid study gets its actual QC rejection reason.
        if (!item.quality.valid) {
          decisions.push(
            this.buildExcludedDecision(
              association,
              item.quality.reason
            )
          );

          continue;
        }

        // Valid but not selected: avoid double counting SNP.
        decisions.push(
          this.buildSupersededDecision(
            association,
            best.studyAccession
          )
        );
      }
    }

    // Included results first.
    return decisions.sort((a, b) => {
      if (a.decision !== b.decision) {
        return a.decision === 'included' ? -1 : 1;
      }

      return a.rsid.localeCompare(b.rsid);
    });
  }

  // ========================================================
  // BASIC QUALITY CONTROL
  // ========================================================

  private evaluateBasicQuality(
    assoc: GWASAssociation
  ): BasicQualityResult {
    // -------------------------------------------------------
    // 1. VALID P-VALUE
    // -------------------------------------------------------

    if (
      !Number.isFinite(assoc.pvalue) ||
      assoc.pvalue <= 0 ||
      assoc.pvalue > 1
    ) {
      return {
        valid: false,
        reason:
          'excluded: association has a missing or invalid p-value',
      };
    }

    // -------------------------------------------------------
    // 2. GENOME-WIDE SIGNIFICANCE
    // -------------------------------------------------------

    if (assoc.pvalue >= GWS_PVALUE) {
      return {
        valid: false,
        reason:
          `excluded: association does not meet the conventional ` +
          `GWAS genome-wide significance threshold ` +
          `(p=${this.formatAssociationPvalue(assoc)}, required p < 5×10⁻⁸)`,
      };
    }

    // -------------------------------------------------------
    // 3. EFFECT / RISK ALLELE
    // -------------------------------------------------------

    if (!this.hasValidRiskAllele(assoc.riskAllele)) {
      return {
        valid: false,
        reason:
          'excluded: effect/risk allele is missing or ambiguous, so the effect cannot be safely aligned for PRS calculation',
      };
    }

    // -------------------------------------------------------
    // 4. EFFECT SIZE
    // -------------------------------------------------------

    const effectType = this.getEffectType(assoc);
    const effectSize = this.getEffectSize(assoc);

    if (
      effectType === 'unknown' ||
      effectSize === null ||
      !Number.isFinite(effectSize)
    ) {
      return {
        valid: false,
        reason:
          'excluded: no usable quantitative effect size (odds ratio or beta) was reported',
      };
    }

    if (effectType === 'OR' && effectSize <= 0) {
      return {
        valid: false,
        reason:
          'excluded: odds ratio is invalid; OR must be greater than zero',
      };
    }

    // Beta = 0 is valid mathematically.
    // Do NOT treat beta === 0 as "missing".

    // -------------------------------------------------------
    // 5. SAMPLE SIZE
    // -------------------------------------------------------

    const sampleSize = this.getSampleSize(assoc);

    if (sampleSize <= 0) {
      return {
        valid: false,
        reason:
          'excluded: study sample size could not be determined',
      };
    }

    if (sampleSize < MIN_SAMPLE_SIZE) {
      return {
        valid: false,
        reason:
          `excluded: study sample size (n≈${sampleSize}) is below ` +
          `PolyRisk's MVP minimum evidence threshold ` +
          `(n=${MIN_SAMPLE_SIZE}); this is a project heuristic, ` +
          `not a universal GWAS quality cutoff`,
      };
    }

    return {
      valid: true,
      reason: 'passes PolyRisk basic evidence QC',
    };
  }

  // ========================================================
  // INCLUDED DECISION
  // ========================================================

  private buildIncludedDecision(
    assoc: GWASAssociation,
    userAncestry: string | null
  ): FilterDecision {
    const effectType = this.getEffectType(assoc);
    const effectSize = this.getEffectSize(assoc)!;
    const sampleSize = this.getSampleSize(assoc);

    const ancestryMessage = this.getAncestryMessage(
      assoc.ancestralGroups ?? [],
      userAncestry
    );

    const effectDescription =
      effectType === 'OR'
        ? `OR=${effectSize.toFixed(3)}`
        : `β=${effectSize.toFixed(3)}`;

    return {
      rsid: assoc.rsid,
      riskAllele: assoc.riskAllele,

      studyAccession: assoc.studyAccession,
      pubmedId: assoc.pubmedId,

      traitName: assoc.traitName,

      effectSize,
      effectType,

      pvalue: assoc.pvalue,
      pvalueFormatted:
        this.formatAssociationPvalue(assoc),

      ancestralGroups:
        assoc.ancestralGroups ?? [],

      totalSampleSize: sampleSize,

      decision: 'included',

      reason:
        `included: genome-wide significant ` +
        `(p=${this.formatAssociationPvalue(assoc)}); ` +
        `adequate study size for PolyRisk MVP ` +
        `(n≈${sampleSize}); ` +
        `valid effect estimate (${effectDescription}); ` +
        `effect allele=${assoc.riskAllele}` +
        ancestryMessage,
    };
  }

  // ========================================================
  // EXCLUDED DECISION
  // ========================================================

  private buildExcludedDecision(
    assoc: GWASAssociation,
    reason: string
  ): FilterDecision {
    return {
      rsid: assoc.rsid,

      riskAllele:
        assoc.riskAllele ?? '',

      studyAccession:
        assoc.studyAccession ?? '',

      pubmedId:
        assoc.pubmedId ?? '',

      traitName:
        assoc.traitName ?? '',

      effectSize:
        this.getEffectSize(assoc) ?? 0,

      effectType:
        this.getEffectType(assoc),

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        this.formatAssociationPvalue(assoc),

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
      rsid: assoc.rsid,
      riskAllele: assoc.riskAllele,

      studyAccession: assoc.studyAccession,
      pubmedId: assoc.pubmedId,

      traitName: assoc.traitName,

      effectSize:
        this.getEffectSize(assoc) ?? 0,

      effectType:
        this.getEffectType(assoc),

      pvalue: assoc.pvalue,

      pvalueFormatted:
        this.formatAssociationPvalue(assoc),

      ancestralGroups:
        assoc.ancestralGroups ?? [],

      totalSampleSize:
        this.getSampleSize(assoc),

      decision: 'excluded',

      reason:
        `excluded from scoring: another qualifying association ` +
        `for ${assoc.rsid} has stronger study support ` +
        `(${supersededBy}); retaining one effect estimate prevents ` +
        `double-counting the same variant`,
    };
  }

  // ========================================================
  // EFFECT SIZE
  // ========================================================

  /**
   * Returns the quantitative effect estimate in the ORIGINAL
   * representation:
   *
   * OR   -> odds ratio
   * beta -> signed beta
   *
   * OR is converted to log(OR) later by calculate_prs().
   */
  private getEffectSize(
    assoc: GWASAssociation
  ): number | null {
    if (
      assoc.orPerCopyNum !== null &&
      assoc.orPerCopyNum !== undefined &&
      Number.isFinite(assoc.orPerCopyNum) &&
      assoc.orPerCopyNum > 0
    ) {
      return assoc.orPerCopyNum;
    }

    if (
      assoc.betaNum !== null &&
      assoc.betaNum !== undefined &&
      Number.isFinite(assoc.betaNum)
    ) {
      return this.getSignedBeta(
        assoc.betaNum,
        assoc.betaDirection
      );
    }

    return null;
  }

  private getEffectType(
    assoc: GWASAssociation
  ): EffectType {
    if (
      assoc.orPerCopyNum !== null &&
      assoc.orPerCopyNum !== undefined &&
      Number.isFinite(assoc.orPerCopyNum) &&
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

  /**
   * GWAS Catalog may expose beta magnitude and betaDirection
   * separately.
   *
   * Examples:
   *
   * betaNum = 0.15
   * betaDirection = "increase"
   *      -> +0.15
   *
   * betaNum = 0.15
   * betaDirection = "decrease"
   *      -> -0.15
   *
   * If direction is unavailable, preserve the numeric sign.
   */
  private getSignedBeta(
    beta: number,
    betaDirection: string | null
  ): number {
    if (!betaDirection) {
      return beta;
    }

    const direction =
      betaDirection
        .trim()
        .toLowerCase();

    if (
      direction.includes('decrease') ||
      direction.includes('negative') ||
      direction === '-'
    ) {
      return -Math.abs(beta);
    }

    if (
      direction.includes('increase') ||
      direction.includes('positive') ||
      direction === '+'
    ) {
      return Math.abs(beta);
    }

    return beta;
  }

  // ========================================================
  // RISK ALLELE
  // ========================================================

  private hasValidRiskAllele(
    allele: string | null | undefined
  ): boolean {
    if (!allele) return false;

    const cleaned =
      allele.trim().toUpperCase();

    return ['A', 'C', 'G', 'T'].includes(cleaned);
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

    /**
     * Fallback only.
     *
     * Person 1's service normally derives totalSampleSize
     * directly from GWAS ancestry records.
     */
    return parseSampleSizeFromString(
      assoc.initialSampleSize
    );
  }

  // ========================================================
  // P-VALUE
  // ========================================================

  private formatAssociationPvalue(
    assoc: GWASAssociation
  ): string {
    if (
      Number.isFinite(assoc.pvalueMantissa) &&
      Number.isFinite(assoc.pvalueExponent)
    ) {
      return (
        `${assoc.pvalueMantissa} × 10^` +
        `${assoc.pvalueExponent}`
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

  /**
   * Ancestry mismatch is an applicability warning, NOT proof
   * that the study itself is scientifically invalid.
   */
  private getAncestryMessage(
    studyGroups: string[],
    userAncestry: string | null
  ): string {
    if (!userAncestry) {
      if (studyGroups.length === 0) {
        return '; ancestry information unavailable';
      }

      return (
        `; study ancestry=${studyGroups.join(', ')}`
      );
    }

    const informativeGroups =
      studyGroups.filter((group) => {
        const normalized =
          group.trim().toLowerCase();

        return ![
          'nr',
          'not reported',
          'unknown',
        ].includes(normalized);
      });

    if (informativeGroups.length === 0) {
      return (
        '; CAUTION: study ancestry was not reported, ' +
        'so transferability to the target ancestry cannot be assessed'
      );
    }

    if (
      this.ancestryMatches(
        informativeGroups,
        userAncestry
      )
    ) {
      return (
        `; ancestry compatible with target (${userAncestry})`
      );
    }

    return (
      `; CAUTION: study ancestry ` +
      `(${informativeGroups.join(', ')}) differs from target ancestry ` +
      `(${userAncestry}); the association may still be valid, ` +
      `but effect-size transferability may be reduced`
    );
  }

  private ancestryMatches(
    studyGroups: string[],
    userAncestry: string
  ): boolean {
    const target =
      this.normalizeAncestry(userAncestry);

    return studyGroups.some((group) => {
      const study =
        this.normalizeAncestry(group);

      return (
        study === target ||
        study.includes(target) ||
        target.includes(study)
      );
    });
  }

  private normalizeAncestry(
    value: string
  ): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/ancestry/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
