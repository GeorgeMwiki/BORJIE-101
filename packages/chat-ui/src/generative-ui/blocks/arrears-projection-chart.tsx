import type { ArrearsProjectionChartBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: ArrearsProjectionChartBlock;
  readonly language: Language;
  readonly t?: Translator;
}

export function ArrearsProjectionChart({ block, language: _language, t: _t }: Props) {
  const points = block.points.length > 0 ? block.points : [{ month: 0, cumulative: 0 }];
  const maxCumulative = Math.max(...points.map((p) => p.cumulative), 1);
  const maxMonth = Math.max(...points.map((p) => p.month), 1);

  const title = block.title || 'Arrears projection';
  const caption = `${block.monthsDelinquent} months at ${block.monthlyRent.toLocaleString()} ${block.currency}/mo + ${block.lateFeePerMonth.toLocaleString()} ${block.currency} late fee`;

  const width = 400;
  const height = 200;
  const pad = 24;

  return (
    <div
      data-testid="arrears-projection-chart"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h4 style={{ margin: 0, marginBottom: 8, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{title}</h4>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={title}>
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#cbd5e1" strokeWidth={1} />
        <polyline
          data-testid="arrears-line"
          fill="none"
          stroke="#dc2626"
          strokeWidth={2}
          points={points
            .map((p) => {
              const x = pad + (p.month / maxMonth) * (width - 2 * pad);
              const y = height - pad - (p.cumulative / maxCumulative) * (height - 2 * pad);
              return `${x},${y}`;
            })
            .join(' ')}
        />
        {points.map((p) => {
          const x = pad + (p.month / maxMonth) * (width - 2 * pad);
          const y = height - pad - (p.cumulative / maxCumulative) * (height - 2 * pad);
          return (
            <g key={p.month}>
              <circle cx={x} cy={y} r={4} fill="#dc2626" />
              <text x={x} y={y - 8} fontSize={10} fill="#475569" textAnchor="middle">
                {p.cumulative.toLocaleString()}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{caption}</div>
    </div>
  );
}
