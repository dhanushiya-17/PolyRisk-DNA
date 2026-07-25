'use client';

import { useTheme, useWidgetState, useWidgetSDK } from '@nitrostack/widgets';
import { useState, useEffect } from 'react';

interface FilterDecision {
  rsid: string;
  riskAllele: string;
  studyAccession: string;
  pubmedId: string;
  traitName: string;
  effectSize: number;
  effectType: string;
  pvalue: number;
  pvalueFormatted: string;
  ancestralGroups: string[];
  totalSampleSize: number;
  decision: 'included' | 'excluded';
  reason: string;
}

interface FilterEvidenceResult {
  disease: string;
  total: number;
  includedCount: number;
  excludedCount: number;
  ancestryNote: string | null;
  allDecisions: FilterDecision[];
}

const DISEASE_LABELS: Record<string, string> = {
  type2_diabetes: 'Type 2 Diabetes',
  coronary_artery_disease: 'Coronary Artery Disease',
  age_related_macular_degeneration: 'Age-Related Macular Degeneration',
};

export default function EvidenceFilterWidget() {
  const theme = useTheme();
  const { getToolOutput } = useWidgetSDK();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [revealedCards, setRevealedCards] = useState<Set<number>>(new Set());
  const [state, setState] = useWidgetState<{ showAll: boolean }>(() => ({ showAll: false }));

  const data = getToolOutput<FilterEvidenceResult>();
  const isDark = theme === 'dark';

  const bg = isDark ? '#111827' : '#f9fafb';
  const cardBg = isDark ? '#1f2937' : '#ffffff';
  const text = isDark ? '#f3f4f6' : '#111827';
  const muted = isDark ? '#9ca3af' : '#6b7280';
  const border = isDark ? '#374151' : '#e5e7eb';

  // Stagger card reveal animation
  useEffect(() => {
    if (!data?.allDecisions) return;
    const decisions = data.allDecisions;
    decisions.forEach((_, i) => {
      setTimeout(() => {
        setRevealedCards(prev => {
          const next = new Set(prev);
          next.add(i);
          return next;
        });
      }, i * 120);
    });
  }, [data]);

  if (!data) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: muted, background: bg, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧬</div>
          <div style={{ fontSize: 14 }}>Evaluating evidence...</div>
        </div>
      </div>
    );
  }

  const decisions = data.allDecisions ?? [];
  const showAll = state?.showAll ?? false;
  const visibleDecisions = showAll ? decisions : decisions.slice(0, 12);

  return (
    <div style={{ background: bg, borderRadius: 16, padding: 24, color: text, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>🔬</span>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Evidence Filtering</h2>
        </div>
        <div style={{ fontSize: 13, color: muted }}>
          {DISEASE_LABELS[data.disease] ?? data.disease} · {data.total} candidate {data.total === 1 ? 'study' : 'studies'}
        </div>
        {data.ancestryNote && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: isDark ? '#1e3a5f' : '#eff6ff', borderRadius: 6, fontSize: 12, color: isDark ? '#93c5fd' : '#1d4ed8' }}>
            ℹ️ {data.ancestryNote}
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, background: isDark ? '#064e3b' : '#ecfdf5', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#34d399' : '#059669' }}>{data.includedCount}</div>
          <div style={{ fontSize: 11, color: isDark ? '#6ee7b7' : '#047857', fontWeight: 600 }}>INCLUDED</div>
        </div>
        <div style={{ flex: 1, background: isDark ? '#450a0a' : '#fef2f2', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f87171' : '#dc2626' }}>{data.excludedCount}</div>
          <div style={{ fontSize: 11, color: isDark ? '#fca5a5' : '#b91c1c', fontWeight: 600 }}>EXCLUDED</div>
        </div>
        <div style={{ flex: 1, background: isDark ? '#1f2937' : '#f3f4f6', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: text }}>
            {data.total > 0 ? Math.round((data.includedCount / data.total) * 100) : 0}%
          </div>
          <div style={{ fontSize: 11, color: muted, fontWeight: 600 }}>PASS RATE</div>
        </div>
      </div>

      {/* Decision cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleDecisions.map((decision, i) => {
          const isIncluded = decision.decision === 'included';
          const isExpanded = expandedCard === `${decision.rsid}-${i}`;
          const isRevealed = revealedCards.has(i);
          const cardKey = `${decision.rsid}-${i}`;

          return (
            <div
              key={cardKey}
              onClick={() => setExpandedCard(isExpanded ? null : cardKey)}
              style={{
                background: cardBg,
                border: `1px solid ${isIncluded ? (isDark ? '#065f46' : '#bbf7d0') : (isDark ? '#7f1d1d' : '#fecaca')}`,
                borderLeft: `4px solid ${isIncluded ? '#10b981' : '#ef4444'}`,
                borderRadius: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                opacity: isRevealed ? 1 : 0,
                transform: isRevealed ? 'translateY(0)' : 'translateY(8px)',
                transition: 'opacity 0.3s ease, transform 0.3s ease, border-color 0.2s',
                userSelect: 'none',
              }}
            >
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{isIncluded ? '✅' : '❌'}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: text }}>{decision.rsid}</div>
                    <div style={{ fontSize: 11, color: muted }}>
                      Risk allele: {decision.riskAllele || '?'} · {decision.effectType === 'OR' ? `OR=${decision.effectSize?.toFixed(2)}` : decision.effectType === 'beta' ? `β=${decision.effectSize?.toFixed(3)}` : 'effect unknown'}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    background: isIncluded ? (isDark ? '#065f46' : '#d1fae5') : (isDark ? '#7f1d1d' : '#fee2e2'),
                    color: isIncluded ? (isDark ? '#34d399' : '#065f46') : (isDark ? '#f87171' : '#991b1b'),
                  }}>
                    {isIncluded ? 'INCLUDED' : 'EXCLUDED'}
                  </div>
                  <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>click for detail</div>
                </div>
              </div>

              {/* Collapsed preview */}
              {!isExpanded && (
                <div style={{ marginTop: 8, fontSize: 12, color: muted, borderTop: `1px solid ${border}`, paddingTop: 6 }}>
                  {decision.reason.length > 90 ? decision.reason.slice(0, 90) + '…' : decision.reason}
                </div>
              )}

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 12, color: text, lineHeight: 1.5, marginBottom: 10 }}>
                    <strong>Decision reason:</strong> {decision.reason}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {[
                      ['p-value', decision.pvalueFormatted || `${decision.pvalue?.toExponential(2)}`],
                      ['Sample size', decision.totalSampleSize > 0 ? `n≈${decision.totalSampleSize.toLocaleString()}` : 'unknown'],
                      ['Study', decision.studyAccession],
                      ['Ancestry', (decision.ancestralGroups ?? []).join(', ') || 'not reported'],
                      ['Trait', decision.traitName || 'unknown'],
                      ['PubMed', decision.pubmedId || '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ background: isDark ? '#111827' : '#f9fafb', borderRadius: 6, padding: '6px 8px' }}>
                        <div style={{ fontSize: 10, color: muted, fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: 12, color: text, fontWeight: 500 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {decision.pubmedId && (
                    <div style={{ marginTop: 8 }}>
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${decision.pubmedId}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 11, color: isDark ? '#60a5fa' : '#2563eb', textDecoration: 'underline' }}
                      >
                        View on PubMed →
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show more */}
      {decisions.length > 12 && (
        <button
          onClick={() => setState({ showAll: !showAll })}
          style={{
            marginTop: 12, width: '100%', padding: '10px', background: 'transparent',
            border: `1px solid ${border}`, borderRadius: 8, color: muted, fontSize: 13, cursor: 'pointer',
          }}
        >
          {showAll ? 'Show fewer' : `Show all ${decisions.length} studies`}
        </button>
      )}

      {/* Footer */}
      <div style={{ marginTop: 16, fontSize: 11, color: muted, borderTop: `1px solid ${border}`, paddingTop: 10, lineHeight: 1.5 }}>
        Data source: NHGRI-EBI GWAS Catalog · Criteria: GWS p&lt;5×10⁻⁸, n≥1,000, valid effect size, ancestry consideration
      </div>
    </div>
  );
}
