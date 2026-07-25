import {
  ToolDecorator as Tool,
  Widget,
  ExecutionContext,
  z,
} from '@nitrostack/core';

import {
  GWASCatalogService,
} from './gwas-catalog.service.js';

import {
  PubMedService,
} from './pubmed.service.js';

import {
  EvidenceFilterEngine,
} from './evidence-filter.engine.js';

import {
  Disease,
  GWASAssociation,
  FilterEvidenceResult,
} from '../../types.js';


const SUPPORTED_DISEASES = [
  'type2_diabetes',
  'coronary_artery_disease',
  'age_related_macular_degeneration',
] as const;


const gwasService =
  new GWASCatalogService();


const pubmedService =
  new PubMedService();


const filterEngine =
  new EvidenceFilterEngine();


export class EvidenceTools {

  // ============================================================
  // FETCH GWAS ASSOCIATIONS
  // ============================================================

  @Tool({

    name:
      'fetch_gwas_associations',

    description:
      'Queries the NHGRI-EBI GWAS Catalog for published genetic associations for validated rsIDs and the selected disease. Returns raw effect estimates, p-values, study sample size, ancestry, study accession and PubMed ID. Disease relevance is checked by the GWAS service before records reach evidence filtering. Project demo fallback records may be used if the live GWAS Catalog is unavailable or returns no disease-matched record for a supported demo SNP.',

    inputSchema:
      z.object({

        variants:
          z.array(

            z.object({

              rsid:
                z.string(),

              isValid:
                z.boolean(),

              normalizedRsid:
                z.string(),
            })

          ).describe(
            'Validated variant list returned by parse_variants'
          ),

        disease:
          z.enum(
            SUPPORTED_DISEASES
          ),
      }),


    examples: {

      request: {

        variants: [
          {
            rsid:
              'rs7903146',

            isValid:
              true,

            normalizedRsid:
              'rs7903146',
          },
        ],

        disease:
          'type2_diabetes',
      },


      response: {

        disease:
          'type2_diabetes',

        associationCount:
          1,

        associations: [
          {
            rsid:
              'rs7903146',

            riskAllele:
              'T',

            pvalue:
              1.5e-25,

            pvalueMantissa:
              1.5,

            pvalueExponent:
              -25,

            orPerCopyNum:
              1.37,

            studyAccession:
              'GCST000028',

            pubmedId:
              '17293876',

            traitName:
              'Type 2 diabetes',

            ancestralGroups: [
              'European',
            ],

            totalSampleSize:
              116981,
          },
        ],
      },
    },
  })


  async fetchGwasAssociations(
    input: any,
    ctx: ExecutionContext
  ) {

    const validVariants =
      (
        input.variants ??
        []
      ).filter(
        (variant: any) =>
          variant?.isValid &&
          variant?.normalizedRsid
      );


    ctx.logger.info(
      'Fetching GWAS associations',
      {

        disease:
          input.disease,

        variantCount:
          validVariants.length,
      }
    );


    const allAssociations:
      GWASAssociation[] = [];


    const errors:
      string[] = [];


    for (
      const variant of
      validVariants
    ) {

      try {

        const associations =
          await gwasService
            .getAssociationsForVariant(
              variant.normalizedRsid,
              input.disease as Disease
            );


        allAssociations.push(
          ...associations
        );

      } catch (
        error: any
      ) {

        const message =
          error?.message ??
          String(error);


        errors.push(
          `${variant.rsid}: ${message}`
        );


        ctx.logger.warn(
          'Failed to fetch GWAS associations for variant',
          {

            rsid:
              variant.rsid,

            error:
              message,
          }
        );
      }
    }


    return {

      disease:
        input.disease,

      associationCount:
        allAssociations.length,

      associations:
        allAssociations,

      fetchErrors:
        errors,

      dataSource:
        'NHGRI-EBI GWAS Catalog',
    };
  }


  // ============================================================
  // FILTER EVIDENCE
  // ============================================================

  @Tool({

    name:
      'filter_evidence',

    description:
      'Evaluates disease-relevant GWAS associations before PRS calculation. Applies genome-wide significance, PolyRisk MVP sample-size QC, effect-allele validation and quantitative effect-size validation. When multiple qualifying associations exist for the same rsID, one best-supported estimate is retained to prevent double counting. Ancestry mismatch is reported as a transferability caution rather than automatically excluding otherwise valid evidence.',

    taskSupport:
      'optional',

    inputSchema:
      z.object({

        associations:
          z
            .array(
              z.any()
            )
            .describe(
              'GWASAssociation records returned by fetch_gwas_associations'
            ),

        disease:
          z.enum(
            SUPPORTED_DISEASES
          ),

        userAncestry:
          z
            .string()
            .optional()
            .describe(
              'Optional target ancestry, for example European, East Asian, South Asian, African, Hispanic or Mixed'
            ),
      }),


    examples: {

      request: {

        associations: [
          {
            rsid:
              'rs7903146',

            riskAllele:
              'T',

            pvalue:
              1.5e-25,

            pvalueMantissa:
              1.5,

            pvalueExponent:
              -25,

            orPerCopyNum:
              1.37,

            betaNum:
              null,

            betaUnit:
              null,

            betaDirection:
              null,

            riskFrequency:
              0.30,

            studyAccession:
              'GCST000028',

            pubmedId:
              '17293876',

            traitName:
              'Type 2 diabetes',

            initialSampleSize:
              '1,924 cases, 2,938 controls',

            replicationSampleSize:
              '',

            ancestralGroups: [
              'European',
            ],

            totalSampleSize:
              116981,
          },
        ],

        disease:
          'type2_diabetes',

        userAncestry:
          'European',
      },


      response: {

        disease:
          'type2_diabetes',

        total:
          1,

        includedCount:
          1,

        excludedCount:
          0,

        ancestryNote:
          'Ancestry context applied: European',

        allDecisions: [
          {

            rsid:
              'rs7903146',

            decision:
              'included',

            effectType:
              'OR',

            effectSize:
              1.37,

            reason:
              'included: genome-wide significant; adequate study size; valid effect estimate',
          },
        ],
      },
    },
  })


  @Widget(
    'evidence-filter'
  )


  async filterEvidence(
    input: any,
    ctx: ExecutionContext
  ) {

    ctx.logger.info(
      'Running evidence filter',
      {

        disease:
          input.disease,

        candidateCount:
          input.associations
            ?.length ?? 0,
      }
    );


    const associations:
      GWASAssociation[] =
      input.associations ??
      [];


    const userAncestry:
      string | null =
      input.userAncestry ??
      null;


    // ==========================================================
    // DETECT USEFUL ANCESTRY DATA
    // ==========================================================

    const ancestryDataExists =
      associations.some(
        (association) => {

          const groups =
            association
              .ancestralGroups ??
            [];


          return groups.some(
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
        }
      );


    // ==========================================================
    // OPTIONAL ANCESTRY REQUEST
    // ==========================================================

    /**
     * Ancestry is supplementary context.
     *
     * It does NOT block evidence filtering.
     *
     * If the user supplies ancestry, the engine reports whether
     * study transferability may be limited.
     */

    if (
      ancestryDataExists &&
      !userAncestry &&
      ctx.task
    ) {

      ctx.task.requestInput(
        'Study ancestry information is available. If you want an ancestry-transferability check, provide your ancestry background (for example European, East Asian, South Asian, African, Hispanic or Mixed). You may skip this and continue without ancestry matching.'
      );
    }


    // ==========================================================
    // CORE FILTER
    // ==========================================================

    const decisions =
      filterEngine.filter(
        associations,
        userAncestry
      );


    const included =
      decisions.filter(
        (decision) =>
          decision.decision ===
          'included'
      );


    const excluded =
      decisions.filter(
        (decision) =>
          decision.decision ===
          'excluded'
      );


    const result:
      FilterEvidenceResult = {

        disease:
          input.disease as Disease,

        total:
          decisions.length,

        includedCount:
          included.length,

        excludedCount:
          excluded.length,

        ancestryNote:
          userAncestry
            ? `Ancestry context applied: ${userAncestry}`
            : 'No target ancestry supplied; ancestry was not used as a hard filtering criterion.',

        allDecisions:
          decisions,
      };


    ctx.logger.info(
      'Evidence filtering complete',
      {

        included:
          included.length,

        excluded:
          excluded.length,
      }
    );


    return result;
  }


  // ============================================================
  // FETCH CITATIONS
  // ============================================================

  @Tool({

    name:
      'fetch_citations',

    description:
      'Fetches citation metadata for included GWAS studies using their PubMed IDs.',

    inputSchema:
      z.object({

        pubmedIds:
          z
            .array(
              z.string()
            )
            .describe(
              'PubMed IDs from included evidence decisions'
            ),
      }),


    examples: {

      request: {

        pubmedIds: [
          '17293876',
          '17460697',
        ],
      },


      response: {

        citations: [
          {

            pubmedId:
              '17293876',

            title:
              'Example publication title',

            authors:
              'Author et al.',

            journal:
              'Journal',

            year:
              '2007',

            url:
              'PubMed publication URL',
          },
        ],
      },
    },
  })


  async fetchCitations(
    input: any,
    ctx: ExecutionContext
  ) {

    /**
     * Remove:
     * - empty IDs
     * - duplicates
     */

    const ids =
      Array.from(
        new Set<string>(
          (
            input.pubmedIds ??
            []
          )
            .map(
              (id: any) =>
                String(id).trim()
            )
            .filter(
              (id: string) =>
                id.length > 0
            )
        )
      );


    ctx.logger.info(
      'Fetching PubMed citations',
      {
        count:
          ids.length,
      }
    );


    if (
      ids.length === 0
    ) {

      return {

        citations:
          [],

        dataSource:
          'NCBI PubMed E-utilities',
      };
    }


    const citations =
      await pubmedService
        .getCitations(
          ids
        );


    return {

      citations,

      dataSource:
        'NCBI PubMed E-utilities',
    };
  }
}
