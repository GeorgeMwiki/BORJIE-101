import type { ReactNode } from 'react';
import type { ClassroomModeData, Language, Translator, ChatMode } from './types';

interface ClassroomChatAdapterProps {
  readonly data: ClassroomModeData;
  readonly mode: ChatMode;
  readonly language: Language;
  readonly t?: Translator;
  readonly children: ReactNode;
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.classroom.session': 'Session',
  'chatUi.classroom.phase': 'Phase',
  'chatUi.classroom.recording': 'Recording',
  'chatUi.classroom.liveClassroom': 'Live classroom',
  'chatUi.classroom.roster': 'Participants',
};

function tr(t: Translator | undefined, key: string): string {
  if (t) return t(key);
  return DEFAULT_LABELS[key] ?? key;
}

/**
 * ClassroomChatAdapter wraps the chat in a cohort-aware shell.
 * Shows participant roster on the right, session metadata on top,
 * and the underlying mode layout (teaching, quiz, discussion, review)
 * inside the children slot.
 */
export function ClassroomChatAdapter({ data, mode, language: _language, t, children }: ClassroomChatAdapterProps) {
  return (
    <div
      data-testid="classroom-chat-adapter"
      data-mode={mode}
      style={{
        display: 'flex',
        gap: 16,
        background: '#f8fafc',
        borderRadius: 16,
        padding: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 11,
            color: '#64748b',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span>{tr(t, 'chatUi.classroom.liveClassroom')}</span>
          <span>·</span>
          <span>
            {tr(t, 'chatUi.classroom.session')} {data.sessionCode}
          </span>
          <span>·</span>
          <span>
            {tr(t, 'chatUi.classroom.phase')}: {data.currentPhase}
          </span>
          {data.isRecording && (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>● {tr(t, 'chatUi.classroom.recording')}</span>
          )}
        </div>
        {children}
      </div>
      <aside
        data-testid="classroom-roster"
        style={{
          width: 200,
          flexShrink: 0,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          {tr(t, 'chatUi.classroom.roster')} ({data.participants.length})
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.participants.slice(0, 12).map((p) => (
            <li key={p.userId} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: p.isPresent ? '#0f172a' : '#94a3b8' }}>
                {p.displayName}
                {p.isModerator ? ' ★' : ''}
              </span>
              <EngagementDot level={p.engagementLevel} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function EngagementDot({ level }: { readonly level: ClassroomModeData['participants'][number]['engagementLevel'] }) {
  const colors: Record<string, string> = {
    active: '#16a34a',
    passive: '#64748b',
    disengaged: '#f59e0b',
    struggling: '#dc2626',
  };
  return (
    <span
      data-testid={`engagement-${level}`}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 4,
        background: colors[level] ?? '#64748b',
      }}
    />
  );
}
