import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';
import { Disease, PRSContribution, PRSResult, FilterDecision } from '../../types.js';

const SUPPORTED_DISEASES = ['type2_diabetes', 'coronary_artery_disease', 'age_related_macular_degeneration'] as const;

export class ScoringTools {
  @Tool({
    name: 'calculate_prs',
    description:
      'Calculates the Polygenic Risk Score (PRS) using the standard weighted-sum method: PRS = Σ(effect_size_i × genotype_i) for each included variant. Effect sizes are log(OR) for binary disease traits. If genotype (number of risk alleles: 0, 1, or 2) is not provided, defaults to 1 (heterozygous) for all variants — this approximates population-average risk and is clearly flagged. Shows a per-variant contribution breakdown, not just the final sum.',
    inputSchema: z.object({
      disease: z.enum(SUPPORTED_DISEASES),
      includedDecisions: z
        .array(z.any())
        .describe('Included FilterDecision objects from filter_evidence (decision === "included" only)'),
      genotypes: z
        .record(z.string(), z.number().min(0).max(2))
        .optional()
        .describe('Optional: map of rsid → number of risk alleles carried (0, 1, or 2). Omit to assume 1 per variant.'),
    }),
    examples: {
      request: {
        disease: 'type2_diabetes',
        includedDecisions: [
          { rsid: 'rs7903146', riskAllele: 'T', effectSize: 1.37, effectType: 'OR', studyAccession: 'GCST000028', pubmedId: '17293876' },
        ],
      },
      response: {
        disease: 'type2_diabetes',
        totalScore: 0.314,
        variantsIncluded: 5,
        genotypeAssumed: true,
        contributions: [
          {
            rsid: 'rs7903146', riskAllele: 'T', genotypeAlleleCount: 1,
            effectSize: 0.314, effectType: 'OR_log', contribution: 0.314,
          },
        ],
      },
    },
  })
  async calculatePrs(input: any, ctx: ExecutionContext) {
    const includedDecisions: FilterDecision[] = (input.includedDecisions ?? []).filter(
      (d: any) => d.decision === 'included'
    );

    if (includedDecisions.length === 0) {
      return {
        disease: input.disease,
        totalScore: 0,
        contributions: [],
        variantsIncluded: 0,
        genotypeAssumed: false,
        warning: 'No included variants — PRS is zero. All variants were filtered out during evidence filtering.',
      };
    }

    const genotypes: Record<string, number> = input.genotypes ?? {};
    const genotypeAssumed = Object.keys(genotypes).length === 0;

    const contributions: PRSContribution[] = [];
    let totalScore = 0;

    for (const decision of includedDecisions) {
      const d = decision as any;
      const genotypeAlleleCount: number = genotypes[d.rsid] ?? 1;

      let effectSize: number;
      let effectType: 'OR_log' | 'beta';

      if (d.effectType === 'OR' && d.effectSize > 0) {
        effectSize = Math.log(d.effectSize);
        effectType = 'OR_log';
      } else if (d.effectType === 'beta') {
        effectSize = d.effectSize;
        effectType = 'beta';
      } else {
        ctx.logger.warn('Skipping variant with unknown effect type', { rsid: d.rsid });
        continue;
      }

      const contribution = effectSize * genotypeAlleleCount;
      totalScore += contribution;

      contributions.push({
        rsid: d.rsid,
        riskAllele: d.riskAllele ?? '',
        genotypeAlleleCount,
        effectSize,
        effectType,
        contribution,
        studyAccession: d.studyAccession ?? '',
        pubmedId: d.pubmedId ?? '',
      });
    }

    const result: PRSResult = {
      disease: input.disease as Disease,
      totalScore: Math.round(totalScore * 10000) / 10000,
      contributions,
      variantsIncluded: contributions.length,
      genotypeAssumed,
    };

    ctx.logger.info('PRS calculation complete', {
      disease: input.disease,
      score: result.totalScore,
      variants: result.variantsIncluded,
      assumed: genotypeAssumed,
    });

    return result;
  }
}
