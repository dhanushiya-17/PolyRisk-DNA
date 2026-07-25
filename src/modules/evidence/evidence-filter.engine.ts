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
 * This is NOT claimed to be a universal GWAS quality threshold.
 */
const MIN_SAMPLE_SIZE = 1000;


interface BasicQualityResult {
  valid: boolean;
  reason: string;
}


@Injectable()
export class EvidenceFilterEngine {

  // ============================================================
  // MAIN FILTER
  // ============================================================

  /**
   * Disease/trait relevance is handled upstream by
   * GWASCatalogService.matchesDisease().
   *
   * This layer handles:
   *
   * 1. p-value validity
   * 2. genome-wide significance
   * 3. effect allele validity
   * 4. quantitative effect-size validity
   * 5. sample-size QC
   * 6. one best qualifying association per SNP
   * 7. ancestry transferability warnings
   */
  filter(
    associations: GWASAssociation[],
    userAncestry: string | null
  ): FilterDecision[] {

    const byRsid =
      new Map<string, GWASAssociation[]>();


    // ----------------------------------------------------------
    // GROUP ASSOCIATIONS BY SNP
    // ----------------------------------------------------------

    for (const association of associations) {

      if (!association?.rsid) {
        continue;
      }

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


    const decisions:
      FilterDecision[] = [];


    // ----------------------------------------------------------
    // PROCESS EACH SNP
    // ----------------------------------------------------------

    for (const [rsid, group] of byRsid.entries()) {

      const evaluated =
        group.map((association) => ({
          association,

          quality:
            this.evaluateBasicQuality(
              association
            ),
        }));


      const validCandidates =
        evaluated.filter(
          (item) =>
            item.quality.valid
        );


      // --------------------------------------------------------
      // NO VALID STUDY EXISTS
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // SELECT BEST QUALIFYING STUDY
      // --------------------------------------------------------

      /**
       * Priority:
       *
       * 1. larger sample size
       * 2. stronger p-value
       *
       * The p-value comparator uses the original
       * mantissa/exponent representation if normal JS floating
       * point values become equal due to underflow.
       */

      const ranked =
        [...validCandidates].sort(
          (a, b) =>
            this.compareCandidates(
              a.association,
              b.association
            )
        );


      const best =
        ranked[0].association;


      decisions.push(
        this.buildIncludedDecision(
          best,
          userAncestry
        )
      );


      // --------------------------------------------------------
      // PROCESS REMAINING STUDIES
      // --------------------------------------------------------

      for (const item of evaluated) {

        if (
          item.association === best
        ) {
          continue;
        }


        // Study failed QC independently
        if (!item.quality.valid) {

          decisions.push(
            this.buildExcludedDecision(
              item.association,
              item.quality.reason
            )
          );

          continue;
        }


        // Study was valid but another association was chosen
        // for the same SNP.
        decisions.push(
          this.buildSupersededDecision(
            item.association,
            best
          )
        );
      }


      // Explicitly reference rsid so the intent of grouping is clear.
      void rsid;
    }


    // ----------------------------------------------------------
    // INCLUDED FIRST
    // ----------------------------------------------------------

    return decisions.sort(
      (a, b) => {

        if (
          a.decision !==
          b.decision
        ) {
          return a.decision ===
            'included'
            ? -1
            : 1;
        }

        return a.rsid.localeCompare(
          b.rsid
        );
      }
    );
  }


  // ============================================================
  // CANDIDATE RANKING
  // ============================================================

  private compareCandidates(
    a: GWASAssociation,
    b: GWASAssociation
  ): number {

    // Primary criterion: statistical power proxy
    const sizeDiff =
      b.totalSampleSize -
      a.totalSampleSize;

    if (sizeDiff !== 0) {
      return sizeDiff;
    }


    // Secondary criterion: numeric p-value
    if (a.pvalue !== b.pvalue) {
      return a.pvalue - b.pvalue;
    }


    /**
     * Extremely tiny p-values may underflow to zero:
     *
     * 1 × 10^-400
     * 5 × 10^-350
     *
     * could both become:
     *
     * 0
     *
     * in JavaScript.
     *
     * Therefore compare the original exponent/mantissa.
     */

    const expA =
      Number.isFinite(
        a.pvalueExponent
      )
        ? a.pvalueExponent
        : 0;

    const expB =
      Number.isFinite(
        b.pvalueExponent
      )
        ? b.pvalueExponent
        : 0;


    // More negative exponent = smaller p-value.
    if (expA !== expB) {
      return expA - expB;
    }


    const mantA =
      Number.isFinite(
        a.pvalueMantissa
      )
        ? a.pvalueMantissa
        : 1;

    const mantB =
      Number.isFinite(
        b.pvalueMantissa
      )
        ? b.pvalueMantissa
        : 1;


    return mantA - mantB;
  }


  // ============================================================
  // BASIC QUALITY CONTROL
  // ============================================================

  private evaluateBasicQuality(
    assoc: GWASAssociation
  ): BasicQualityResult {

    // ----------------------------------------------------------
    // P-VALUE VALIDITY
    // ----------------------------------------------------------

    if (
      !Number.isFinite(
        assoc.pvalue
      ) ||
      assoc.pvalue < 0 ||
      assoc.pvalue > 1
    ) {

      return {
        valid: false,

        reason:
          'excluded: association has a missing or invalid p-value',
      };
    }


    // ----------------------------------------------------------
    // GENOME-WIDE SIGNIFICANCE
    // ----------------------------------------------------------

    if (
      assoc.pvalue >=
      GWS_PVALUE
    ) {

      return {
        valid: false,

        reason:
          `excluded: does not meet genome-wide significance threshold ` +
          `(p=${this.formatPvalue(assoc)}, required p < 5×10⁻⁸)`,
      };
    }


    // ----------------------------------------------------------
    // EFFECT ALLELE VALIDATION
    // ----------------------------------------------------------

    if (
      !this.hasValidRiskAllele(
        assoc.riskAllele
      )
    ) {

      return {
        valid: false,

        reason:
          'excluded: effect/risk allele is missing or invalid',
      };
    }


    // ----------------------------------------------------------
    // EFFECT SIZE VALIDATION
    // ----------------------------------------------------------

    const effectSize =
      this.getEffectSize(
        assoc
      );


    if (effectSize === null) {

      return {
        valid: false,

        reason:
          'excluded: no usable quantitative effect size (odds ratio or beta) was reported',
      };
    }


    const effectType =
      this.getEffectType(
        assoc
      );


    if (
      effectType === 'OR' &&
      effectSize <= 0
    ) {

      return {
        valid: false,

        reason:
          'excluded: odds ratio is invalid; OR must be greater than zero',
      };
    }


    // ----------------------------------------------------------
    // SAMPLE SIZE
    // ----------------------------------------------------------

    if (
      !Number.isFinite(
        assoc.totalSampleSize
      ) ||
      assoc.totalSampleSize <
        MIN_SAMPLE_SIZE
    ) {

      return {
        valid: false,

        reason:
          `excluded: study sample size (n≈${assoc.totalSampleSize ?? 0}) ` +
          `is below PolyRisk's MVP minimum evidence threshold ` +
          `(n=${MIN_SAMPLE_SIZE}); this is a project heuristic, ` +
          `not a universal GWAS quality cutoff`,
      };
    }


    return {
      valid: true,

      reason:
        'passes PolyRisk basic evidence QC',
    };
  }


  // ============================================================
  // INCLUDED DECISION
  // ============================================================

  private buildIncludedDecision(
    assoc: GWASAssociation,
    userAncestry: string | null
  ): FilterDecision {

    const effectSize =
      this.getEffectSize(
        assoc
      )!;


    const effectType =
      this.getEffectType(
        assoc
      );


    const ancestryMessage =
      this.getAncestryMessage(
        assoc.ancestralGroups ??
          [],
        userAncestry
      );


    const effectDescription =
      effectType === 'OR'
        ? `OR=${effectSize.toFixed(3)}`
        : `β=${effectSize.toFixed(3)}`;


    return {

      rsid:
        assoc.rsid,

      riskAllele:
        assoc.riskAllele,

      pubmedId:
        assoc.pubmedId ||
        null,

      studyAccession:
        assoc.studyAccession ||
        null,

      traitName:
        assoc.traitName,

      effectSize,

      effectType,

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        this.formatPvalue(
          assoc
        ),

      ancestralGroups:
        assoc.ancestralGroups ??
        [],

      totalSampleSize:
        assoc.totalSampleSize,

      decision:
        'included',

      reason:
        `included: genome-wide significant ` +
        `(p=${this.formatPvalue(assoc)}); ` +
        `adequate study size (n≈${assoc.totalSampleSize}); ` +
        `valid effect estimate (${effectDescription}); ` +
        `effect allele=${assoc.riskAllele}` +
        ancestryMessage,
    };
  }


  // ============================================================
  // EXCLUDED DECISION
  // ============================================================

  private buildExcludedDecision(
    assoc: GWASAssociation,
    reason: string
  ): FilterDecision {

    return {

      rsid:
        assoc.rsid,

      riskAllele:
        assoc.riskAllele ||
        '',

      pubmedId:
        assoc.pubmedId ||
        null,

      studyAccession:
        assoc.studyAccession ||
        null,

      traitName:
        assoc.traitName ||
        '',

      effectSize:
        this.getEffectSize(
          assoc
        ) ?? 0,

      effectType:
        this.getEffectType(
          assoc
        ),

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        Number.isFinite(
          assoc.pvalue
        )
          ? this.formatPvalue(
              assoc
            )
          : 'unknown',

      ancestralGroups:
        assoc.ancestralGroups ??
        [],

      totalSampleSize:
        Number.isFinite(
          assoc.totalSampleSize
        )
          ? assoc.totalSampleSize
          : 0,

      decision:
        'excluded',

      reason,
    };
  }


  // ============================================================
  // SUPERSEDED ASSOCIATION
  // ============================================================

  private buildSupersededDecision(
    assoc: GWASAssociation,
    best: GWASAssociation
  ): FilterDecision {

    return {

      rsid:
        assoc.rsid,

      riskAllele:
        assoc.riskAllele,

      pubmedId:
        assoc.pubmedId ||
        null,

      studyAccession:
        assoc.studyAccession ||
        null,

      traitName:
        assoc.traitName,

      effectSize:
        this.getEffectSize(
          assoc
        ) ?? 0,

      effectType:
        this.getEffectType(
          assoc
        ),

      pvalue:
        assoc.pvalue,

      pvalueFormatted:
        this.formatPvalue(
          assoc
        ),

      ancestralGroups:
        assoc.ancestralGroups ??
        [],

      totalSampleSize:
        assoc.totalSampleSize,

      decision:
        'excluded',

      reason:
        `excluded from scoring: another qualifying association for ` +
        `${assoc.rsid} has stronger study support ` +
        `(selected study=${best.studyAccession || 'unknown'}, ` +
        `n≈${best.totalSampleSize}, ` +
        `p=${this.formatPvalue(best)}); ` +
        `retaining one effect estimate prevents double-counting the same variant`,
    };
  }


  // ============================================================
  // P-VALUE FORMATTING
  // ============================================================

  private formatPvalue(
    assoc: GWASAssociation
  ): string {

    if (
      Number.isFinite(
        assoc.pvalueMantissa
      ) &&
      Number.isFinite(
        assoc.pvalueExponent
      )
    ) {

      return (
        `${assoc.pvalueMantissa} × ` +
        `10^${assoc.pvalueExponent}`
      );
    }


    if (
      Number.isFinite(
        assoc.pvalue
      )
    ) {

      return assoc.pvalue.toExponential(
        2
      );
    }


    return 'unknown';
  }


  // ============================================================
  // EFFECT SIZE
  // ============================================================

  private getEffectSize(
    assoc: GWASAssociation
  ): number | null {

    // ----------------------------------------------------------
    // ODDS RATIO
    // ----------------------------------------------------------

    if (
      assoc.orPerCopyNum !==
        null &&
      assoc.orPerCopyNum !==
        undefined &&
      Number.isFinite(
        assoc.orPerCopyNum
      ) &&
      assoc.orPerCopyNum >
        0
    ) {

      return assoc.orPerCopyNum;
    }


    // ----------------------------------------------------------
    // BETA
    // ----------------------------------------------------------

    if (
      assoc.betaNum !==
        null &&
      assoc.betaNum !==
        undefined &&
      Number.isFinite(
        assoc.betaNum
      )
    ) {

      return this.getSignedBeta(
        assoc.betaNum,
        assoc.betaDirection
      );
    }


    return null;
  }


  // ============================================================
  // EFFECT TYPE
  // ============================================================

  private getEffectType(
    assoc: GWASAssociation
  ): EffectType {

    if (
      assoc.orPerCopyNum !==
        null &&
      assoc.orPerCopyNum !==
        undefined &&
      Number.isFinite(
        assoc.orPerCopyNum
      ) &&
      assoc.orPerCopyNum >
        0
    ) {

      return 'OR';
    }


    if (
      assoc.betaNum !==
        null &&
      assoc.betaNum !==
        undefined &&
      Number.isFinite(
        assoc.betaNum
      )
    ) {

      return 'beta';
    }


    return 'unknown';
  }


  // ============================================================
  // BETA DIRECTION
  // ============================================================

  private getSignedBeta(
    beta: number,
    direction: string | null
  ): number {

    if (!direction) {
      return beta;
    }


    const d =
      direction
        .trim()
        .toLowerCase();


    if (
      d.includes(
        'decrease'
      ) ||
      d.includes(
        'negative'
      ) ||
      d === '-'
    ) {

      return -Math.abs(
        beta
      );
    }


    if (
      d.includes(
        'increase'
      ) ||
      d.includes(
        'positive'
      ) ||
      d === '+'
    ) {

      return Math.abs(
        beta
      );
    }


    return beta;
  }


  // ============================================================
  // EFFECT ALLELE VALIDATION
  // ============================================================

  private hasValidRiskAllele(
    allele:
      | string
      | null
      | undefined
  ): boolean {

    if (!allele) {
      return false;
    }


    const normalized =
      allele
        .trim()
        .toUpperCase();


    return [
      'A',
      'C',
      'G',
      'T',
    ].includes(
      normalized
    );
  }


  // ============================================================
  // ANCESTRY
  // ============================================================

  private getAncestryMessage(
    studyGroups: string[],
    userAncestry: string | null
  ): string {

    const informative =
      studyGroups.filter(
        (group) => {

          const normalized =
            group
              .trim()
              .toLowerCase();


          return ![
            '',
            'nr',
            'not reported',
            'unknown',
          ].includes(
            normalized
          );
        }
      );


    // No user ancestry supplied
    if (!userAncestry) {

      if (
        informative.length ===
        0
      ) {

        return (
          '; ancestry information unavailable'
        );
      }


      return (
        `; study ancestry=` +
        informative.join(', ')
      );
    }


    // Study ancestry unavailable
    if (
      informative.length ===
      0
    ) {

      return (
        '; CAUTION: study ancestry not reported, ' +
        'so transferability cannot be assessed'
      );
    }


    // Compatible ancestry
    if (
      this.ancestryMatches(
        informative,
        userAncestry
      )
    ) {

      return (
        `; ancestry compatible with target ` +
        `(${userAncestry})`
      );
    }


    // Mismatch = warning, NOT automatic exclusion
    return (
      `; CAUTION: study ancestry ` +
      `(${informative.join(', ')}) differs from target ancestry ` +
      `(${userAncestry}); effect-size transferability may be reduced`
    );
  }


  private ancestryMatches(
    studyGroups: string[],
    userAncestry: string
  ): boolean {

    const target =
      this.normalizeAncestry(
        userAncestry
      );


    return studyGroups.some(
      (group) => {

        const study =
          this.normalizeAncestry(
            group
          );


        return (
          study === target ||
          study.includes(
            target
          ) ||
          target.includes(
            study
          )
        );
      }
    );
  }


  private normalizeAncestry(
    value: string
  ): string {

    return value
      .trim()
      .toLowerCase()
      .replace(
        /ancestry/g,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }
}
