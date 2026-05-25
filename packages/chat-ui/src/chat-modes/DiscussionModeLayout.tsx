import type { DiscussionModeData, Language, Translator } from './types';

interface DiscussionModeLayoutProps {
  readonly data: DiscussionModeData;
  readonly language: Language;
  readonly t?: Translator;
  readonly onReply?: (text: string) => void;
  readonly onRaiseHand?: () => void;
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.discussion.title': 'Discussion',
  'chatUi.discussion.handRaised': '{count} hand raised',
  'chatUi.discussion.raiseHand': 'Raise hand',
  'chatUi.discussion.empty': 'No replies yet. Share your thoughts.',
};

function tr(t: Translator | undefined, key: string, vars?: Record<string, string | number>): string {
  let value = t ? t(key, vars) : DEFAULT_LABELS[key] ?? key;
  if (vars && !t) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

export function DiscussionModeLayout({ data, language, t, onRaiseHand }: DiscussionModeLayoutProps) {
  const topic = language === 'sw' && data.topicSw ? data.topicSw : data.topic;
  return (
    <div
      data-testid="discussion-mode-layout"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {tr(t, 'chatUi.discussion.title')}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{topic}</div>
        </div>
        {onRaiseHand && (
          <button
            type="button"
            onClick={onRaiseHand}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ✋ {tr(t, 'chatUi.discussion.raiseHand')}
          </button>
        )}
      </div>
      {data.handRaisedCount > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          {tr(t, 'chatUi.discussion.handRaised', { count: data.handRaisedCount })}
        </div>
      )}
      {data.replies.length === 0 ? (
        <div data-testid="discussion-empty" style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          {tr(t, 'chatUi.discussion.empty')}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.replies.map((reply) => (
            <li
              key={reply.id}
              style={{ padding: 8, borderLeft: '2px solid #3b82f6', background: '#f8fafc', borderRadius: 4 }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{reply.author}</div>
              <div style={{ fontSize: 13, color: '#1e293b' }}>{reply.text}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
