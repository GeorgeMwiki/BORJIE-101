import type { MaintenanceCaseFlowDiagramBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: MaintenanceCaseFlowDiagramBlock;
  readonly language: Language;
  readonly t?: Translator;
}

const STAGE_ORDER = ['reported', 'triaged', 'assigned', 'in_progress', 'resolved', 'closed'] as const;

export function MaintenanceCaseFlowDiagram({ block, language: _language, t: _t }: Props) {
  const stages = block.stages ?? [];
  const currentIdx = STAGE_ORDER.indexOf(block.currentStage);

  return (
    <div
      data-testid="maintenance-case-flow-diagram"
      data-current-stage={block.currentStage}
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
      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
        }}
      >
        {stages.map((s, idx) => {
          const stageIdx = STAGE_ORDER.indexOf(s.id);
          const done = stageIdx <= currentIdx && currentIdx >= 0;
          const isCurrent = s.id === block.currentStage;
          const color = isCurrent ? '#3b82f6' : done ? '#16a34a' : '#94a3b8';
          return (
            <li key={s.id} data-testid={`maintenance-stage-${s.id}`} style={{ flex: 1, minWidth: 100 }}>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: `${color}15`,
                  border: `1px solid ${color}40`,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 10, color, fontWeight: 600 }}>
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{s.label}</div>
                {s.timestamp && <div style={{ fontSize: 10, color: '#64748b' }}>{s.timestamp}</div>}
                {s.actor && <div style={{ fontSize: 10, color: '#64748b' }}>{s.actor}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
