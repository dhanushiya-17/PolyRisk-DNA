'use client';

import { useTheme, useWidgetState, useWidgetSDK } from '@nitrostack/widgets';
import { useState } from 'react';

interface Citation {
  pubmedId: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  url: string;
}

interface PRSContribution {
  rsid: string;
  riskAllele: string;
  genotypeAlleleCount: number;
  effectSize: number;
  effectType: string;
  contribution: number;
  studyAccession: string;
  pubmedId: string;
}

interface PolyRiskReport {
  disease: string;
  diseaseName: string;
  riskInterpretation: {
    tier: 'low' | 'moderate' | 'high';
    prsScore: number;
    zScore: number;
    percentileApprox: number;
    confidenceLevel: 'low' | 'moderate' | 'high';
    confidenceReason: string;
    description: string;
  };
  prsResult: {
    totalScore: number;
    contributions: PRSContribution[];
    variantsIncluded: number;
    genotypeAssumed: boolean;
  };
  filterResult: {
    total: number;
    includedCount: number;
    excludedCount: number;
  };
  citations: Citation[];
  lifestyleContext: {
    factors: Array<{ category: string; description: string }>;
    source: string;
  };
  disclaimer: string;
  generatedAt: string;
}

const TIER_COLORS = {
  low: { bg: '#064e3b', light: '#ecfdf5', text: '#34d399', lightText: '#065f46', label: '🟢 Low' },
  moderate: { bg: '#78350f', light: '#fffbeb', text: '#fbbf24', lightText: '#92400e', label: '🟡 Moderate' },
  high: { bg: '#7f1d1d', light: '#fef2f2', text: '#f87171', lightText: '#991b1b', label: '🔴 High' },
};

const CONFIDENCE_LABELS = { low: '⚠️ Low', moderate: '📊 Moderate', high: '✅ High' };

function GaugeDial({ zScore, tier, isDark }: { zScore: number; tier: string; isDark: boolean }) {
  const clampedZ = Math.max(-2.5, Math.min(2.5, zScore));
  const percent = (clampedZ + 2.5) / 5;
  const angle = -140 + percent * 280;
  const tierColors = TIER_COLORS[tier as keyof typeof TIER_COLORS];

  return (
    <svg viewBox="0 0 200 120" width="200" height="120" style={{ display: 'block', margin: '0 auto' }}>
      {/* Background track */}
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={isDark ? '#374151' : '#e5e7eb'} strokeWidth="12" strokeLinecap="round" />
      {/* Low segment */}
      <path d="M 20 100 A 80 80 0 0 1 73 38" fill="none" stroke="#10b981" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      {/* Moderate segment */}
      <path d="M 73 38 A 80 80 0 0 1 127 38" fill="none" stroke="#f59e0b" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      {/* High segment */}
      <path d="M 127 38 A 80 80 0 0 1 180 100" fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
      {/* Needle */}
      <g transform={`rotate(${angle}, 100, 100)`}>
        <line x1="100" y1="100" x2="100" y2="32" stroke={tierColors?.text ?? '#888'} strokeWidth="3" strokeLinecap="round" />
        <circle cx="100" cy="100" r="6" fill={tierColors?.text ?? '#888'} />
      </g>
      {/* Center label */}
      <text x="100" y="115" textAnchor="middle" fontSize="11" fill={isDark ? '#9ca3af' : '#6b7280'} fontFamily="system-ui">
        {tier.charAt(0).toUpperCase() + tier.slice(1)} risk
      </text>
    </svg>
  );
}

export default function RiskReportWidget() {
  const theme = useTheme();
  const { getToolOutput } = useWidgetSDK();
  const [expandedSection, setExpandedSection] = useState<string | null>('risk');
  const [state, setState] = useWidgetState<{ activeTab: 'summary' | 'variants' | 'citations' | 'lifestyle' }>(() => ({ activeTab: 'summary' }));

  const data = getToolOutput<PolyRiskReport>();
  const isDark = theme === 'dark';

  const bg = isDark ? '#111827' : '#f9fafb';
  const cardBg = isDark ? '#1f2937' : '#ffffff';
  const text = isDark ? '#f3f4f6' : '#111827';
  const muted = isDark ? '#9ca3af' : '#6b7280';
  const border = isDark ? '#374151' : '#e5e7eb';

  if (!data) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: muted, background: bg, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 14 }}>Generating report...</div>
        </div>
      </div>
    );
  }

  const { riskInterpretation, prsResult, filterResult, citations, lifestyleContext } = data;
  const tier = riskInterpretation.tier;
  const tierColor = TIER_COLORS[tier];
  const activeTab = state?.activeTab ?? 'summary';

  const tabs = [
    { id: 'summary', label: '📋 Summary' },
    { id: 'variants', label: `🧬 Variants (${prsResult.variantsIncluded})` },
    { id: 'citations', label: `📄 Citations (${citations.length})` },
    { id: 'lifestyle', label: '🌿 Lifestyle' },
  ];

  return (
    <div style={{ background: bg, borderRadius: 16, padding: 24, color: text, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 24 }}>🧬</span>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>PolyRisk Report</h2>
        </div>
        <div style={{ fontSize: 13, color: muted }}>
          {data.diseaseName} · {new Date(data.generatedAt).toLocaleDateString()}
        </div>
      </div>

      {/* Risk gauge */}
      <div style={{ background: cardBg, borderRadius: 12, padding: 20, marginBottom: 16, border: `1px solid ${border}` }}>
        <GaugeDial zScore={riskInterpretation.zScore} tier={tier} isDark={isDark} />
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <div style={{
            display: 'inline-block', padding: '6px 16px', borderRadius: 20, fontSize: 14, fontWeight: 700,
            background: isDark ? tierColor.bg : tierColor.light,
            color: isDark ? tierColor.text : tierColor.lightText,
          }}>
            {tierColor.label} Relative Risk
          </div>
          <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
            Approx. {riskInterpretation.percentileApprox}th percentile vs. population · PRS: {prsResult.totalScore.toFixed(4)}
          </div>
        </div>

        {/* Confidence */}
        <div style={{ marginTop: 16, padding: '10px 12px', background: isDark ? '#111827' : '#f9fafb', borderRadius: 8, border: `1px solid ${border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: muted, marginBottom: 4 }}>
            CONFIDENCE: {CONFIDENCE_LABELS[riskInterpretation.confidenceLevel]}
          </div>
          <div style={{ fontSize: 12, color: text }}>{riskInterpretation.confidenceReason}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${border}`, paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setState({ activeTab: tab.id as any })}
            style={{
              padding: '7px 10px', fontSize: 12, cursor: 'pointer', border: 'none',
              background: 'transparent', color: activeTab === tab.id ? (isDark ? '#60a5fa' : '#2563eb') : muted,
              fontWeight: activeTab === tab.id ? 700 : 400,
              borderBottom: activeTab === tab.id ? `2px solid ${isDark ? '#60a5fa' : '#2563eb'}` : '2px solid transparent',
              transition: 'color 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'summary' && (
        <div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: text, margin: '0 0 12px 0' }}>
            {riskInterpretation.description}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              ['Variants used', `${prsResult.variantsIncluded}/${filterResult.total}`],
              ['PRS score', prsResult.totalScore.toFixed(4)],
              ['Genotype', prsResult.genotypeAssumed ? 'Assumed (1 allele)' : 'Provided'],
            ].map(([label, value]) => (
              <div key={label} style={{ background: isDark ? '#111827' : '#f3f4f6', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: muted, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 13, color: text, fontWeight: 600 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'variants' && (
        <div>
          {prsResult.genotypeAssumed && (
            <div style={{ padding: '8px 10px', background: isDark ? '#1e3a5f' : '#eff6ff', borderRadius: 6, fontSize: 11, color: isDark ? '#93c5fd' : '#1d4ed8', marginBottom: 10 }}>
              ℹ️ Genotype assumed as 1 risk allele per variant (heterozygous). Actual genotype would refine this score.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {prsResult.contributions.map((contrib, i) => {
              const maxContrib = Math.max(...prsResult.contributions.map(c => Math.abs(c.contribution)));
              const barWidth = maxContrib > 0 ? Math.abs(contrib.contribution) / maxContrib * 100 : 0;
              return (
                <div key={contrib.rsid} style={{ background: cardBg, borderRadius: 8, padding: '10px 12px', border: `1px solid ${border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{contrib.rsid}</span>
                      <span style={{ fontSize: 11, color: muted, marginLeft: 8 }}>risk allele: {contrib.riskAllele}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: contrib.contribution > 0 ? (isDark ? '#f87171' : '#dc2626') : (isDark ? '#34d399' : '#059669') }}>
                      {contrib.contribution > 0 ? '+' : ''}{contrib.contribution.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ background: isDark ? '#374151' : '#e5e7eb', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: isDark ? '#f87171' : '#dc2626', borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ fontSize: 10, color: muted, marginTop: 4 }}>
                    {contrib.effectType === 'OR_log' ? `log(OR)=${contrib.effectSize.toFixed(4)}` : `β=${contrib.effectSize.toFixed(4)}`} × {contrib.genotypeAlleleCount} allele{contrib.genotypeAlleleCount !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'citations' && (
        <div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 10 }}>Real peer-reviewed publications from NCBI PubMed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {citations.map(cite => (
              <div key={cite.pubmedId} style={{ background: cardBg, borderRadius: 8, padding: '10px 12px', border: `1px solid ${border}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: text, marginBottom: 4, lineHeight: 1.4 }}>{cite.title}</div>
                <div style={{ fontSize: 11, color: muted }}>{cite.authors} · {cite.journal} ({cite.year})</div>
                <a
                  href={cite.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: isDark ? '#60a5fa' : '#2563eb', textDecoration: 'underline', display: 'inline-block', marginTop: 4 }}
                >
                  PMID {cite.pubmedId} → View on PubMed
                </a>
              </div>
            ))}
            {citations.length === 0 && (
              <div style={{ textAlign: 'center', color: muted, fontSize: 13, padding: 20 }}>No citations fetched yet</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'lifestyle' && (
        <div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 10 }}>Evidence-based modifiable risk factors for {data.diseaseName}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(lifestyleContext?.factors ?? []).map(factor => (
              <div key={factor.category} style={{ background: cardBg, borderRadius: 8, padding: '10px 12px', border: `1px solid ${border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 4 }}>{factor.category}</div>
                <div style={{ fontSize: 12, color: muted, lineHeight: 1.5 }}>{factor.description}</div>
              </div>
            ))}
          </div>
          {lifestyleContext?.source && (
            <div style={{ marginTop: 10, fontSize: 10, color: muted }}>Source: {lifestyleContext.source}</div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div style={{
        marginTop: 20,
        padding: '12px 14px',
        background: isDark ? '#1f2937' : '#fffbeb',
        border: `1px solid ${isDark ? '#92400e' : '#fde68a'}`,
        borderRadius: 10,
        fontSize: 11,
        color: isDark ? '#fbbf24' : '#92400e',
        lineHeight: 1.5,
      }}>
        <strong>⚠️ NOT A DIAGNOSTIC TOOL</strong> — {data.disclaimer?.slice(0, 280)}…
      </div>
    </div>
  );
}
