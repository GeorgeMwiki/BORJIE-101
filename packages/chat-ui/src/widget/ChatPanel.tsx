/**
 * ChatPanel — the expanded chat panel (LitFin-style adapted).
 *
 * Header (persona name + context badge + language toggle + close) / message
 * list (with segment dividers + live-region) / input row (text + voice mic
 * + image attach + send).  Keyboard shortcuts: Enter send, Shift+Enter
 * newline, Esc collapse.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import type { ChatAttachment, UnifiedChat, WidgetStrings } from './types';
import { MessageBubble } from './MessageBubble';
import { ContextBadge } from './ContextBadge';
import { SegmentHeader } from './SegmentHeader';
import { VoiceOverlay } from './VoiceOverlay';
import { buildAttachment } from './useUnifiedChat';

interface ChatPanelProps {
  readonly chat: UnifiedChat;
  readonly strings: WidgetStrings;
  readonly onClose: () => void;
  readonly variant?: 'floating' | 'full' | 'bottom-sheet';
  readonly renderBlockSlot?: (messageId: string) => ReactNode;
}

export function ChatPanel({ chat, strings, onClose, variant = 'floating', renderBlockSlot }: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [stagedAttachments, setStagedAttachments] = useState<readonly ChatAttachment[]>([]);
  const [voiceLevels, setVoiceLevels] = useState<readonly number[]>([]);
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = listEndRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'end' });
    }
  }, [chat.messages.length]);

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text) return;
      const attachments = stagedAttachments.length > 0 ? stagedAttachments : undefined;
      setDraft('');
      setStagedAttachments([]);
      await chat.sendMessage(text, attachments ? { attachments } : undefined);
    },
    [chat, draft, stagedAttachments],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleSend, onClose],
  );

  const onFilePick = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const next: ChatAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const f: File | null =
        typeof (files as FileList).item === 'function'
          ? (files as FileList).item(i)
          : ((files as unknown as ReadonlyArray<File>)[i] ?? null);
      if (f) next.push(buildAttachment(f));
    }
    setStagedAttachments((prev) => [...prev, ...next]);
    e.target.value = '';
  }, []);

  const onMicDown = useCallback(() => {
    setIsListening(true);
    setVoiceLevels(Array.from({ length: 16 }, () => Math.random()));
  }, []);

  const onMicUp = useCallback(() => {
    setIsListening(false);
    setVoiceLevels([]);
  }, []);

  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (variant === 'full') {
      return {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      };
    }
    if (variant === 'bottom-sheet') {
      return {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        zIndex: 10_001,
      };
    }
    return {
      position: 'fixed',
      bottom: 24,
      right: 24,
      width: 380,
      height: 560,
      maxHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      borderRadius: 16,
      boxShadow: '0 24px 48px rgba(15, 23, 42, 0.18)',
      overflow: 'hidden',
      zIndex: 10_001,
    };
  }, [variant]);

  return (
    <section
      data-testid="chat-panel"
      data-variant={variant}
      aria-label={strings.personaName}
      style={containerStyle}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid #e2e8f0',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>{strings.personaName}</strong>
          <ContextBadge route={chat.route} language={chat.language} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            data-testid="chat-language-toggle"
            onClick={() => chat.setLanguage(chat.language === 'en' ? 'sw' : 'en')}
            aria-label={strings.languageSwitched}
            style={{
              background: 'transparent',
              border: '1px solid #cbd5e1',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {chat.language.toUpperCase()}
          </button>
          <button
            type="button"
            data-testid="chat-close"
            onClick={onClose}
            aria-label={strings.collapse}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ×
          </button>
        </div>
      </header>

      <div
        data-testid="chat-live-region"
        aria-live="polite"
        aria-atomic="false"
        style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {chat.messages.length === 0 ? (
          <p data-testid="chat-empty-greet" style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
            {strings.greet}
          </p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chat.messages.map((m) => {
            const segment = chat.segments.find((s) => s.id === m.segmentId);
            return (
              <div key={m.id}>
                {segment ? <SegmentHeader segment={segment} language={chat.language} /> : null}
                <MessageBubble
                  message={m}
                  personaName={strings.personaName}
                  blockSlot={renderBlockSlot ? renderBlockSlot(m.id) : undefined}
                />
              </div>
            );
          })}
        </ul>
        <div ref={listEndRef} />
      </div>

      {stagedAttachments.length > 0 ? (
        <ul
          data-testid="chat-staged-attachments"
          style={{ listStyle: 'none', margin: 0, padding: '6px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #e2e8f0' }}
        >
          {stagedAttachments.map((att) => (
            <li key={att.id} style={{ fontSize: 11, background: '#e2e8f0', padding: '2px 6px', borderRadius: 6 }}>
              {att.name}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: 10, borderTop: '1px solid #e2e8f0' }}
      >
        <button
          type="button"
          data-testid="chat-attach"
          aria-label={strings.attachmentAccepted}
          onClick={() => fileInputRef.current?.click()}
          style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          data-testid="chat-file-input"
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={onFilePick}
          style={{ display: 'none' }}
        />
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={strings.placeholder}
          rows={1}
          aria-label={strings.placeholder}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #cbd5e1',
            borderRadius: 12,
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
            minHeight: 32,
            maxHeight: 120,
          }}
        />
        <button
          type="button"
          data-testid="chat-mic"
          aria-label={strings.mic}
          aria-pressed={isListening}
          onMouseDown={onMicDown}
          onMouseUp={onMicUp}
          onMouseLeave={isListening ? onMicUp : undefined}
          onTouchStart={onMicDown}
          onTouchEnd={onMicUp}
          style={{
            background: isListening ? '#dc2626' : '#0f172a',
            color: '#fff',
            border: 'none',
            borderRadius: 999,
            width: 36,
            height: 36,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          ◉
        </button>
        <button
          type="submit"
          data-testid="chat-send"
          disabled={chat.isStreaming || !draft.trim()}
          aria-label={strings.send}
          style={{
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
            opacity: chat.isStreaming || !draft.trim() ? 0.5 : 1,
          }}
        >
          {strings.send}
        </button>
      </form>

      {isListening ? (
        <VoiceOverlay levels={voiceLevels} isListening={isListening} strings={strings} onClose={onMicUp} />
      ) : null}
    </section>
  );
}
