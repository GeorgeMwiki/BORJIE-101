import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Language, Translator } from '../chat-modes/types';

interface BlackboardProps {
  readonly language: Language;
  readonly t?: Translator;
  /** The active concept title to display above the board. */
  readonly conceptTitle?: string;
  /** Slot for a rendered UI block (chart, calculator, diagram). */
  readonly children?: ReactNode;
  /** Optional handler invoked when the board is cleared. */
  readonly onClear?: () => void;
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.blackboard.title': 'Blackboard',
  'chatUi.blackboard.empty': 'The tutor will draw here when a concept is introduced.',
  'chatUi.blackboard.clear': 'Clear',
  'chatUi.blackboard.notes': 'Notes',
};

function tr(t: Translator | undefined, key: string): string {
  if (t) return t(key);
  return DEFAULT_LABELS[key] ?? key;
}

/**
 * Blackboard shell — proactive teaching surface that opens whenever a
 * teaching concept is introduced. Holds the active UI block on top and a
 * freeform note area below. In BORJIE the board is shared across all
 * four portals (manager, coworker, owner, tenant).
 */
export function Blackboard({ language: _language, t, conceptTitle, children, onClear }: BlackboardProps) {
  const [notes, setNotes] = useState('');
  const handleClear = useCallback(() => {
    setNotes('');
    onClear?.();
  }, [onClear]);

  return (
    <section
      data-testid="blackboard"
      aria-label={tr(t, 'chatUi.blackboard.title')}
      style={{
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 16,
        padding: 16,
        color: '#f1f5f9',
        minHeight: 240,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {tr(t, 'chatUi.blackboard.title')}
          </div>
          {conceptTitle && (
            <div data-testid="blackboard-concept" style={{ fontSize: 15, fontWeight: 700 }}>
              {conceptTitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleClear}
          style={{
            background: 'transparent',
            border: '1px solid #334155',
            color: '#cbd5e1',
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {tr(t, 'chatUi.blackboard.clear')}
        </button>
      </header>

      <div
        data-testid="blackboard-canvas"
        style={{
          background: '#f8fafc',
          color: '#0f172a',
          borderRadius: 12,
          padding: 12,
          minHeight: 140,
        }}
      >
        {children ? (
          children
        ) : (
          <div
            data-testid="blackboard-empty"
            style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: 24 }}
          >
            {tr(t, 'chatUi.blackboard.empty')}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
          {tr(t, 'chatUi.blackboard.notes')}
        </label>
        <textarea
          data-testid="blackboard-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{
            width: '100%',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            color: '#f1f5f9',
            fontSize: 13,
            padding: 8,
            resize: 'vertical',
          }}
        />
      </div>
    </section>
  );
}
