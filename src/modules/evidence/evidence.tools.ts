import { ToolDecorator as Tool, Widget, ExecutionContext, z } from '@nitrostack/core';
import { GWASCatalogService } from './gwas-catalog.service.js';
import { PubMedService } from './pubmed.service.js';
import { EvidenceFilterEngine } from './evidence-filter.engine.js';
import { Disease, GWASAssociation, FilterEvidenceResult } from '../../types.js';

const SUPPORTED_DISEASES = ['type2_diabetes', 'coronary_artery_disease', 'age_related_macular_degeneration'] as const;

const gwasService = new GWASCatalogService();
const pubmedService = new PubMedService();
const filterEngine = new EvidenceFilterEngine();

export class EvidenceTools {

  @Tool({
    name: 'fetch_gwas_associations',
    description:
      'Queries the live NHGRI-EBI GWAS Catalog for published genetic associations between the given validated rsIDs and the selected disease. Returns raw association data: effect sizes, p-values, sample sizes, ancestries, study accessions, and PubMed IDs. Results are cached per-session since GWAS Catalog data does not change mid-session.',
    inputSchema: z.object({
      variants: z
        .array(
          z.object({
            rsid: z.string().describe('Validated rsID (e.g. rs7903146)'),
            isValid: z.boolean(),
            normalizedRsid: z.string(),
          })
        )
        .describe('Output of parse_variants — validated rsID list'),
      disease: z
        .enum(SUPPORTED_DISEASES)
        .describe('Target disease for association lookup'),
    }),
    examples: {
      request: {
        variants: [{ rsid: 'rs7903146', isValid: true, normalizedRsid: 'rs7903146' }],
        disease: 'type2_diabetes',
      },
      response: {
        disease: 'type2_diabetes',
        associationCount: 1,
        associations: [
          {
            rsid: 'rs7903146', riskAllele: 'T', pvalue: 1.5e-25,
            orPerCopyNum: 1.37, studyAccession: 'GCST000028', pubmedId: '17293876',
            traitName: 'Type 2 diabetes', ancestralGroups: ['European'], totalSampleSize: 116981,
          },
        ],
      },
    },
  })
  async fetchGwasAssociations(input: any, ctx: ExecutionContext) {
    const validVariants = (input.variants as any[]).filter((v: any) => v.isValid);
    ctx.logger.info('Fetching GWAS associations', {
      disease: input.disease,
      variantCount: validVariants.length,
    });

    const allAssociations: GWASAssociation[] = [];
    const errors: string[] = [];

    for (const variant of validVariants) {
      try {
        const assocs = await gwasService.getAssociationsForVariant(
          variant.normalizedRsid,
          input.disease as Disease
        );
        allAssociations.push(...assocs);
      } catch (err: any) {
        errors.push(`${variant.rsid}: ${err.message}`);
        ctx.logger.warn('Failed to fetch associations for variant', { rsid: variant.rsid, error: err.message });
      }
    }

    return {
      disease: input.disease,
      associationCount: allAssociations.length,
      associations: allAssociations,
      fetchErrors: errors,
      dataSource: 'NHGRI-EBI GWAS Catalog (https://www.ebi.ac.uk/gwas/)',
    };
  }

  @Tool({
    name: 'filter_evidence',
    description:
      'The core agentic reasoning step. Evaluates each GWAS association from fetch_gwas_associations and decides include/exclude based on: (1) genome-wide significance threshold p < 5×10⁻⁸, (2) minimum study sample size, (3) presence of a quantitative effect size, (4) population/ancestry transferability, (5) whether a study has been superseded by a larger replication. Every decision has a specific, human-readable reason. If population ancestry data is ambiguous or missing, may pause to ask for your ancestry background via requestInput.',
    taskSupport: 'optional',
    inputSchema: z.object({
      associations: z
        .array(z.any())
        .describe('Raw associations from fetch_gwas_associations'),
      disease: z.enum(SUPPORTED_DISEASES),
      userAncestry: z
        .string()
        .optional()
        .describe('Your ancestry background (e.g. European, East Asian, South Asian). Helps with ancestry-matched filtering.'),
    }),
    examples: {
      request: { associations: [], disease: 'type2_diabetes' },
      response: {
        disease: 'type2_diabetes',
        total: 6,
        includedCount: 5,
        excludedCount: 1,
        ancestryNote: null,
        allDecisions: [
          {
            rsid: 'rs7903146', decision: 'included',
            reason: 'included: genome-wide significant (p=1.5 × 10^-25), adequately powered (n≈116981), valid effect size (OR=1.370)',
          },
        ],
      },
    },
  })
  @Widget('evidence-filter')
  async filterEvidence(input: any, ctx: ExecutionContext) {
    ctx.logger.info('Running evidence filter', {
      disease: input.disease,
      candidateCount: input.associations?.length ?? 0,
    });

    const associations: GWASAssociation[] = input.associations ?? [];
    let userAncestry: string | null = input.userAncestry ?? null;

    // Check if ancestry context is needed and not provided
    const hasNonEuropeanStudies = associations.some(a => {
      const groups: string[] = a.ancestralGroups ?? [];
      return groups.length > 0 && groups.every((g: string) => !g.toLowerCase().includes('european') && g !== 'NR');
    });

    if (hasNonEuropeanStudies && !userAncestry && ctx.task) {
      ctx.task.requestInput(
        'Some associations come from non-European cohorts. To improve filtering accuracy, what is your ancestry background? (e.g., European, East Asian, South Asian, African, Hispanic, Mixed — or skip to proceed without ancestry filtering)'
      );
    }

    const decisions = filterEngine.filter(associations, userAncestry);
    const included = decisions.filter(d => d.decision === 'included');
    const excluded = decisions.filter(d => d.decision === 'excluded');

    const result: FilterEvidenceResult = {
      disease: input.disease as Disease,
      total: decisions.length,
      includedCount: included.length,
      excludedCount: excluded.length,
      ancestryNote: userAncestry
        ? `Ancestry context applied: ${userAncestry}`
        : null,
      allDecisions: decisions,
    };

    ctx.logger.info('Evidence filtering complete', {
      included: included.length,
      excluded: excluded.length,
    });

    return result;
  }

  @Tool({
    name: 'fetch_citations',
    description:
      'Fetches real citation details (title, authors, journal, year, PubMed URL) for included studies using the NCBI PubMed E-utilities API. Uses the PubMed IDs gathered from GWAS Catalog study records.',
    inputSchema: z.object({
      pubmedIds: z
        .array(z.string())
        .describe('List of PubMed IDs from included associations (e.g. from filter_evidence included decisions)'),
    }),
    examples: {
      request: { pubmedIds: ['17293876', '17460697'] },
      response: {
        citations: [
          {
            pubmedId: '17293876',
            title: 'TCF7L2 polymorphisms and progression to diabetes in the Diabetes Prevention Program',
            authors: 'Florez JC et al.',
            journal: 'N Engl J Med',
            year: '2006',
            url: 'https://pubmed.ncbi.nlm.nih.gov/17293876/',
          },
        ],
      },
    },
  })
  async fetchCitations(input: any, ctx: ExecutionContext) {
    ctx.logger.info('Fetching PubMed citations', { count: input.pubmedIds?.length });
    const citations = await pubmedService.getCitations(input.pubmedIds ?? []);
    return {
      citations,
      dataSource: 'NCBI PubMed E-utilities (https://www.ncbi.nlm.nih.gov/)',
    };
  }
}
