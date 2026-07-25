import {
  ToolDecorator as Tool,
  ExecutionContext,
  z,
} from '@nitrostack/core';

import {
  Disease,
  PRSContribution,
  PRSResult,
  FilterDecision,
} from '../../types.js';

const SUPPORTED_DISEASES = [
  'type2_diabetes',
  'coronary_artery_disease',
  'age_related_macular_degeneration',
] as const;

export class ScoringTools {
  @Tool({
    name: 'calculate_prs',

    description:
      'Calculates a raw weighted polygenic score using PRS = Σ(βᵢ × Gᵢ) for variants that passed evidence filtering. For odds-ratio associations, β = ln(OR). For beta associations, the signed beta is used directly. Gᵢ is the supplied effect/risk-allele dosage: 0, 1 or 2. Variants without genotype dosage are skipped rather than assumed. The returned totalScore is a raw weighted score, not a disease probability or percentile.',

    inputSchema: z.object({
      disease: z.enum(
        SUPPORTED_DISEASES
      ),

      includedDecisions: z
        .array(z.any())
        .describe(
          'FilterDecision records from filter_evidence. Only records with decision="included" are used.'
        ),

      genotypes: z
        .record(
          z.string(),
          z
            .number()
            .int()
            .min(0)
            .max(2)
        )
        .describe(
          'Map of rsID to effect/risk-allele dosage. Example: {"rs7903146": 2}. Values must be 0, 1 or 2.'
        ),
    }),

    examples: {
      request: {
        disease:
          'type2_diabetes',

        includedDecisions: [
          {
            rsid:
              'rs7903146',

            riskAllele:
              'T',

            effectSize:
              1.37,

            effectType:
              'OR',

            decision:
              'included',

            studyAccession:
              'GCST000028',

            pubmedId:
              '17293876',
          },
        ],

        genotypes: {
          rs7903146: 2,
        },
      },

      response: {
        disease:
          'type2_diabetes',

        totalScore:
          0.6294,

        variantsIncluded:
          1,

        genotypeAssumed:
          false,

        contributions: [
          {
            rsid:
              'rs7903146',

            riskAllele:
              'T',

            genotypeAlleleCount:
              2,

            effectSize:
              0.3147,

            effectType:
              'OR_log',

            contribution:
              0.6294,

            studyAccession:
              'GCST000028',

            pubmedId:
              '17293876',
          },
        ],
      },
    },
  })

  async calculatePrs(
    input: any,
    ctx: ExecutionContext
  ) {
    // -------------------------------------------------------
    // USE INCLUDED EVIDENCE ONLY
    // -------------------------------------------------------

    const includedDecisions:
      FilterDecision[] =
      (input.includedDecisions ?? [])
        .filter(
          (decision: any) =>
            decision.decision ===
            'included'
        );

    if (
      includedDecisions.length === 0
    ) {
      ctx.logger.warn(
        'PRS calculation received no included variants',
        {
          disease:
            input.disease,
        }
      );

      const emptyResult:
        PRSResult = {
          disease:
            input.disease as Disease,

          totalScore:
            0,

          contributions:
            [],

          variantsIncluded:
            0,

          genotypeAssumed:
            false,
        };

      return {
        ...emptyResult,

        variantsSkipped:
          0,

        missingGenotypes:
          [],

        warning:
          'No included variants were available for PRS calculation.',

        interpretation:
          'No raw PRS was calculated because no variant passed evidence filtering.',
      };
    }

    // -------------------------------------------------------
    // GENOTYPES
    // -------------------------------------------------------

    const genotypes:
      Record<string, number> =
      input.genotypes ?? {};

    const contributions:
      PRSContribution[] = [];

    const missingGenotypes:
      string[] = [];

    let totalScore = 0;

    // -------------------------------------------------------
    // CALCULATE EACH VARIANT CONTRIBUTION
    // -------------------------------------------------------

    for (
      const decision
      of includedDecisions
    ) {
      const genotypeAlleleCount =
        genotypes[
          decision.rsid
        ];

      // Never invent a genotype.
      if (
        genotypeAlleleCount ===
        undefined
      ) {
        missingGenotypes.push(
          decision.rsid
        );

        ctx.logger.warn(
          'Skipping included variant because genotype dosage was not provided',
          {
            rsid:
              decision.rsid,

            riskAllele:
              decision.riskAllele,
          }
        );

        continue;
      }

      // Defensive runtime validation.
      if (
        !Number.isInteger(
          genotypeAlleleCount
        ) ||
        genotypeAlleleCount < 0 ||
        genotypeAlleleCount > 2
      ) {
        ctx.logger.warn(
          'Skipping variant with invalid genotype dosage',
          {
            rsid:
              decision.rsid,

            genotypeAlleleCount,
          }
        );

        continue;
      }

      // -----------------------------------------------------
      // CONVERT EFFECT TO PRS WEIGHT
      // -----------------------------------------------------

      let weight: number;

      let contributionEffectType:
        'OR_log' | 'beta';

      if (
        decision.effectType ===
        'OR'
      ) {
        if (
          !Number.isFinite(
            decision.effectSize
          ) ||
          decision.effectSize <= 0
        ) {
          ctx.logger.warn(
            'Skipping variant with invalid odds ratio',
            {
              rsid:
                decision.rsid,

              effectSize:
                decision.effectSize,
            }
          );

          continue;
        }

        /**
         * Logistic GWAS:
         *
         * beta = ln(OR)
         */
        weight =
          Math.log(
            decision.effectSize
          );

        contributionEffectType =
          'OR_log';
      } else if (
        decision.effectType ===
        'beta'
      ) {
        if (
          !Number.isFinite(
            decision.effectSize
          )
        ) {
          ctx.logger.warn(
            'Skipping variant with invalid beta',
            {
              rsid:
                decision.rsid,

              effectSize:
                decision.effectSize,
            }
          );

          continue;
        }

        /**
         * EvidenceFilterEngine has already
         * harmonised betaDirection.
         */
        weight =
          decision.effectSize;

        contributionEffectType =
          'beta';
      } else {
        ctx.logger.warn(
          'Skipping variant with unknown effect type',
          {
            rsid:
              decision.rsid,
          }
        );

        continue;
      }

      // -----------------------------------------------------
      // PRS CONTRIBUTION
      //
      // contribution_i = beta_i × G_i
      // -----------------------------------------------------

      const contribution =
        weight *
        genotypeAlleleCount;

      totalScore +=
        contribution;

      contributions.push({
        rsid:
          decision.rsid,

        riskAllele:
          decision.riskAllele,

        genotypeAlleleCount,

        effectSize:
          this.round(
            weight,
            6
          ),

        effectType:
          contributionEffectType,

        contribution:
          this.round(
            contribution,
            6
          ),

        studyAccession:
          decision.studyAccession,

        pubmedId:
          decision.pubmedId,
      });
    }

    // -------------------------------------------------------
    // RESULT
    // -------------------------------------------------------

    const result:
      PRSResult = {
        disease:
          input.disease as Disease,

        totalScore:
          this.round(
            totalScore,
            6
          ),

        contributions,

        variantsIncluded:
          contributions.length,

        /**
         * We no longer assume G=1.
         */
        genotypeAssumed:
          false,
      };

    ctx.logger.info(
      'PRS calculation complete',
      {
        disease:
          input.disease,

        score:
          result.totalScore,

        variantsUsed:
          result.variantsIncluded,

        variantsMissingGenotype:
          missingGenotypes.length,
      }
    );

    return {
      ...result,

      variantsSkipped:
        includedDecisions.length -
        contributions.length,

      missingGenotypes,

      warning:
        missingGenotypes.length > 0
          ? `${missingGenotypes.length} included variant(s) were skipped because genotype dosage was not provided.`
          : null,

      interpretation:
        'totalScore is a raw weighted polygenic score. It is not an absolute disease probability, percentage risk, or percentile without an appropriate validated reference distribution and calibration model.',
    };
  }

  private round(
    value: number,
    digits: number
  ): number {
    const factor =
      Math.pow(
        10,
        digits
      );

    return (
      Math.round(
        value * factor
      ) / factor
    );
  }
}
