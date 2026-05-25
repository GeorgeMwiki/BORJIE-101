import { useMemo } from 'react';
import type { FivePsRiskWheelBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: FivePsRiskWheelBlock;
  readonly language: Language;
  readonly t?: Translator;
}

export interface FivePsBreakdown {
  readonly dimensions: readonly {
    readonly key: keyof FivePsRiskWheelBlock['scores'];
    readonly label: string;
    readonly score: number;
    readonly share: number; // fraction of total (sums to 1)
  }[];
  readonly dominant: {
    readonly key: keyof FivePsRiskWheelBlock['scores'];
    readonly label: string;
    readonly score: number;
  };
  readonly total: number;
}

const LABELS: Record<keyof FivePsRiskWheelBlock['scores'], string> = {
  paymentHistory: 'Payment history',
  propertyFit: 'Property fit',
  purpose: 'Purpose',
  person: 'Person',
  protection: 'Protection',
};

/**
 * Compute each dimension's share of total, identify the dominant risk
 * dimension (highest raw score). Exported for tests.
 */
export function computeFivePs(
  scores: FivePsRiskWheelBlock['scores'],
): FivePsBreakdown {
  const entries = (Object.entries(scores) as [keyof typeof scores, number][]).map(([key, score]) => ({
    key,
    label: LABELS[key],
    score,
  }));
  const total = entries.reduce((acc, e) => acc + e.score, 0);
  const dimensions = entries.map((e) => ({
    ...e,
    share: total > 0 ? e.score / total : 0,
  }));
  const dominant = entries.reduce((acc, cur) => (cur.score > acc.score ? cur : acc), entries[0]);
  return { dimensions, dominant, total };
}

export function FivePsTenancyRiskWheel({ block, language: _language, t: _t }: Props) {
  const breakdown = useMemo(() => computeFivePs(block.scores), [block.scores]);
  const cx = 150;
  const cy = 150;
  const maxRadius = 110;
  const angles = breakdown.dimensions.map((_, i) => (i / breakdown.dimensions.length) * Math.PI * 2 - Math.PI / 2);

  const polygon = breakdown.dimensions
    .map((d, i) => {
      const r = (d.score / 100) * maxRadius;
      const angle = angles[i] ?? 0;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div
      data-testid="five-ps-tenancy-risk-wheel"
      data-rating={block.overallRating}
      data-dominant={breakdown.dominant.key}
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{block.title}</h4>
        <span
          style={{
            background: '#f1f5f9',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            color: '#475569',
          }}
        >
          {block.overallRating}
        </span>
      </div>
      <svg viewBox="0 0 300 300" style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={cx} cy={cy} r={f * maxRadius} fill="none" stroke="#e2e8f0" strokeWidth={1} />
        ))}
        {breakdown.dimensions.map((d, i) => {
          const angle = angles[i] ?? 0;
          const x2 = cx + Math.cos(angle) * maxRadius;
          const y2 = cy + Math.sin(angle) * maxRadius;
          return <line key={d.key} x1={cx} y1={cy} x2={x2} y2={y2} stroke="#e2e8f0" strokeWidth={1} />;
        })}
        <polygon points={polygon} fill="#3b82f6" fillOpacity={0.3} stroke="#3b82f6" strokeWidth={2} />
        {breakdown.dimensions.map((d, i) => {
          const angle = angles[i] ?? 0;
          const x = cx + Math.cos(angle) * (maxRadius + 18);
          const y = cy + Math.sin(angle) * (maxRadius + 18);
          return (
            <text
              key={d.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={600}
              fill="#475569"
            >
              {d.label} · {d.score}
            </text>
          );
        })}
      </svg>
      <div
        data-testid="five-ps-dominant"
        style={{ marginTop: 8, fontSize: 12, color: '#475569', textAlign: 'center' }}
      >
        Dominant dimension: <strong>{breakdown.dominant.label}</strong> ({breakdown.dominant.score})
      </div>
    </div>
  );
}
