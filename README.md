# PolyRisk

**Transparent Polygenic Risk Score MCP Server**

PolyRisk calculates evidence-backed polygenic risk scores (PRS) for three well-studied diseases by pulling live data from the NHGRI-EBI GWAS Catalog and NCBI PubMed, reasoning through which studies are reliable enough to include, and producing a transparent, citation-backed report.

> **This is an educational and evidence-transparency tool — NOT a diagnostic or medical device.**

---

## Supported Diseases

| Disease | Sample Set Key | Key Variants |
|---|---|---|
| Type 2 Diabetes | `T2D_SAMPLE` | TCF7L2, IGF2BP2, CDKAL1, HHEX, SLC30A8 |
| Coronary Artery Disease | `CAD_SAMPLE` | 9p21.3 locus (CDKN2A/B) |
| Age-Related Macular Degeneration | `AMD_SAMPLE` | CFH, ARMS2 |

Only these three diseases are supported. PRS reliability varies enormously by how well a disease's genetic architecture is characterized — these three have robust, heavily-replicated GWAS evidence.

---

## Data Sources

- **NHGRI-EBI GWAS Catalog** (`https://www.ebi.ac.uk/gwas/`) — Live REST API for association data, effect sizes, sample sizes, and ancestry information
- **NCBI PubMed E-utilities** (`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`) — Live API for citation details (title, authors, journal, year)

All data is fetched in real time. Results are cached within a session. If either API is unavailable, hardcoded fallback data from published literature is used.

---

## The 8 Tools (in order)

1. **`parse_variants`** — Validate rsIDs; or load a pre-built demo sample set
2. **`fetch_gwas_associations`** — Query GWAS Catalog for associations with the target disease
3. **`filter_evidence`** ⭐ — Core reasoning step: include/exclude studies with specific human-readable reasons
4. **`calculate_prs`** — Weighted-sum PRS using log(OR) × genotype per included variant
5. **`fetch_citations`** — Retrieve real PubMed citations for included studies
6. **`interpret_risk`** — Convert PRS to risk tier (low/moderate/high) with confidence level
7. **`get_lifestyle_context`** — Evidence-based modifiable lifestyle factors for the disease
8. **`generate_report`** — Full structured report combining all outputs above

---

## Evidence Filtering Criteria (Tool 3)

| Criterion | Threshold | Rationale |
|---|---|---|
| P-value | p < 5×10⁻⁸ | Genome-wide significance standard |
| Sample size | n ≥ 1,000 | Below this, effect size estimates are unstable |
| Effect size | Must have OR or β | Cannot contribute to weighted-sum without it |
| Ancestry | Flagged if single non-European ancestry | Effect sizes may not transfer across populations |
| Superseded | Excluded if larger study exists for same variant | Retains best-powered result per variant |

---

## Widgets

**Evidence Filtering Visualizer** — Bound to `filter_evidence`. Cards animate to included/excluded with specific per-study reasons. Click to expand full study details and PubMed links.

**Risk Report** — Bound to `generate_report`. Gauge dial for risk tier, confidence level, per-variant PRS breakdown, real PubMed citations, lifestyle context, and prominent disclaimer. Tabs: Summary · Variants · Citations · Lifestyle.

---

## Demo Script (T2D)

```
1. parse_variants  sampleSet=T2D_SAMPLE
2. fetch_gwas_associations
3. filter_evidence  ← watch the evidence-filter widget animate cards
4. Click an excluded card to see the specific exclusion reason
5. Click a PubMed link to confirm it's a real paper
6. calculate_prs → fetch_citations → interpret_risk → get_lifestyle_context
7. generate_report  ← switch to the risk-report widget
8. Navigate tabs: Summary / Variants / Citations / Lifestyle
```

---

## Architecture

```
src/
├── types.ts
├── app.module.ts
├── modules/
│   ├── variant/       parse_variants, disease://{condition}/known-variants resource
│   ├── evidence/      fetch_gwas_associations, filter_evidence, fetch_citations
│   ├── scoring/       calculate_prs
│   └── report/        interpret_risk, get_lifestyle_context, generate_report, explain_polyrisk_finding prompt
└── widgets/app/
    ├── evidence-filter/page.tsx
    └── risk-report/page.tsx
```

---

## Running

```bash
npm run dev
```

Widgets run on port 3001 (Next.js). MCP server over STDIO in development.
