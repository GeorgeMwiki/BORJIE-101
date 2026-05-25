import type { PropertyComparisonTableBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: PropertyComparisonTableBlock;
  readonly language: Language;
  readonly t?: Translator;
}

export function PropertyComparisonTable({ block, language: _language, t: _t }: Props) {
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];
  return (
    <div
      data-testid="property-comparison-table"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
        overflow: 'auto',
      }}
    >
      <h4 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        {block.title}
      </h4>
      {columns.length === 0 || rows.length === 0 ? (
        <div data-testid="property-comparison-empty" style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          No data
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}> </th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    ...thStyle,
                    background: c.highlight ? '#dbeafe' : '#f8fafc',
                    color: c.highlight ? '#1d4ed8' : '#475569',
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#475569' }}>{row.label}</td>
                {row.values.map((v, vIdx) => (
                  <td key={vIdx} style={tdStyle}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  background: '#f8fafc',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  color: '#0f172a',
};
