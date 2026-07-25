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
      'Calculates a weighted polygenic score using PRS = Σ(weight_i × genotype_i). ' +
      'For binary disease associations reported as odds ratios, weight_i = ln(OR_i). ' +
      'For beta associations, weight_i = beta_i. ' +
      'Genotype_i is the number of effect alleles carried (0, 1, or 2). ' +
      'If no genotype map is supplied, dosage=1 is assumed for every included variant and the result is explicitly flagged as genotypeAssumed=true. ' +
      'This score is a relative weighted genetic score and is not an absolute probability of developing disease.',

    inputSchema: z.object({

      disease:
        z.enum(
          SUPPORTED_DISEASES
        ),

      includedDecisions:
        z
          .array(
            z.any()
          )
          .describe(
            'FilterDecision objects produced by filter_evidence. Only decision="included" records are scored.'
          ),

      genotypes:
        z
          .record(
            z.string(),
            z
              .number()
              .int()
              .min(0)
              .max(2)
          )
          .optional()
          .describe(
            'Optional rsID → effect-allele dosage map. Each value must be 0, 1 or 2.'
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
          rs7903146: 1,
        },
      },

      response: {

        disease:
          'type2_diabetes',

        totalScore:
          0.3147,

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
              1,

            weight:
              0.3147,

            effectType:
              'OR_log',

            contribution:
              0.3147,

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

    // ==========================================================
    // ONLY INCLUDED EVIDENCE CAN ENTER THE SCORE
    // ==========================================================

    const includedDecisions:
      FilterDecision[] =
      (
        input.includedDecisions ??
        []
      ).filter(
        (decision: any) =>
          decision?.decision ===
          'included'
      );


    // ==========================================================
    // NOTHING TO SCORE
    // ==========================================================

    if (
      includedDecisions.length ===
      0
    ) {

      return {

        disease:
          input.disease,

        totalScore:
          0,

        contributions:
          [],

        variantsIncluded:
          0,

        genotypeAssumed:
          false,

        warning:
          'No included variants were available for scoring. The PRS is therefore zero.',
      };
    }


    // ==========================================================
    // GENOTYPE INPUT
    // ==========================================================

    const genotypes:
      Record<string, number> =
      input.genotypes ?? {};


    const genotypeAssumed =
      Object.keys(
        genotypes
      ).length === 0;


    const contributions:
      PRSContribution[] = [];


    let totalScore =
      0;


    // ==========================================================
    // SCORE EACH SNP
    // ==========================================================

    for (
      const decision of
      includedDecisions
    ) {

      // --------------------------------------------------------
      // GENOTYPE DOSAGE
      // --------------------------------------------------------

      let genotypeAlleleCount:
        number;


      if (
        Object.prototype.hasOwnProperty.call(
          genotypes,
          decision.rsid
        )
      ) {

        genotypeAlleleCount =
          genotypes[
            decision.rsid
          ];


        if (
          !Number.isInteger(
            genotypeAlleleCount
          ) ||
          genotypeAlleleCount <
            0 ||
          genotypeAlleleCount >
            2
        ) {

          ctx.logger.warn(
            'Skipping variant because genotype dosage is invalid',
            {
              rsid:
                decision.rsid,

              dosage:
                genotypeAlleleCount,
            }
          );

          continue;
        }

      } else {

        /**
         * If a genotype map exists but this particular SNP is
         * missing, dosage=1 is still used as an MVP fallback.
         *
         * This behaviour should be shown clearly in reports.
         */
        genotypeAlleleCount =
          1;
      }


      // --------------------------------------------------------
      // CONVERT RAW EFFECT → PRS WEIGHT
      // --------------------------------------------------------

      let weight:
        number;


      let contributionEffectType:
        'OR_log' |
        'beta';


      if (
        decision.effectType ===
        'OR'
      ) {

        if (
          !Number.isFinite(
            decision.effectSize
          ) ||
          decision.effectSize <=
            0
        ) {

          ctx.logger.warn(
            'Skipping variant because OR is invalid',
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
         * OR -> log odds coefficient
         *
         * weight = ln(OR)
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
            'Skipping variant because beta is invalid',
            {
              rsid:
                decision.rsid,

              effectSize:
                decision.effectSize,
            }
          );

          continue;
        }


        weight =
          decision.effectSize;


        contributionEffectType =
          'beta';

      } else {

        ctx.logger.warn(
          'Skipping variant with unsupported effect type',
          {
            rsid:
              decision.rsid,

            effectType:
              decision.effectType,
          }
        );

        continue;
      }


      // --------------------------------------------------------
      // PRS CONTRIBUTION
      // --------------------------------------------------------

      const contribution =
        weight *
        genotypeAlleleCount;


      totalScore +=
        contribution;


      contributions.push({

        rsid:
          decision.rsid,

        riskAllele:
          decision.riskAllele ??
          '',

        genotypeAlleleCount,

        weight:
          this.round(
            weight
          ),

        effectType:
          contributionEffectType,

        contribution:
          this.round(
            contribution
          ),

        studyAccession:
          decision.studyAccession ??
          null,

        pubmedId:
          decision.pubmedId ??
          null,
      });
    }


    // ==========================================================
    // FINAL RESULT
    // ==========================================================

    const result:
      PRSResult = {

        disease:
          input.disease as Disease,

        totalScore:
          this.round(
            totalScore
          ),

        contributions,

        variantsIncluded:
          contributions.length,

        genotypeAssumed,
    };


    ctx.logger.info(
      'PRS calculation complete',
      {

        disease:
          input.disease,

        score:
          result.totalScore,

        variants:
          result.variantsIncluded,

        genotypeAssumed:
          result.genotypeAssumed,
      }
    );


    return result;
  }


  // ============================================================
  // ROUNDING
  // ============================================================

  private round(
    value: number,
    decimals = 6
  ): number {

    const factor =
      Math.pow(
        10,
        decimals
      );


    return (
      Math.round(
        value *
        factor
      ) /
      factor
    );
  }
}
