import type { LeaseTimelineDiagramBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: LeaseTimelineDiagramBlock;
  readonly language: Language;
  readonly t?: Translator;
}

const STATUS_COLOR = {
  completed: '#16a34a',
  current: '#3b82f6',
  upcoming: '#94a3b8',
} as const;

export function LeaseTimelineDiagram({ block, language: _language, t: _t }: Props) {
  const events = block.events ?? [];
  return (
    <div
      data-testid="lease-timeline-diagram"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h4 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        {block.title}
      </h4>
      {events.length === 0 ? (
        <div data-testid="lease-timeline-empty" style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          No lease events
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, position: 'relative' }}>
          {events.map((e, idx) => {
            const color = STATUS_COLOR[e.status];
            return (
              <li
                key={idx}
                data-testid={`lease-event-${e.status}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  paddingBottom: 12,
                  borderLeft: idx === events.length - 1 ? 'none' : '2px solid #e2e8f0',
                  marginLeft: 7,
                  paddingLeft: 16,
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -9,
                    top: 0,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: e.status === 'completed' ? color : '#fff',
                    border: `2px solid ${color}`,
                  }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{e.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{e.date}</div>
                  {e.description && (
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{e.description}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
