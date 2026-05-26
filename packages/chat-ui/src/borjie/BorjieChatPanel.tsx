/**
 * BorjieChatPanel — the expanded chat panel that fades in when the
 * floating bubble is clicked.
 *
 * Header: brand label + mode selector + language toggle + close.
 * Body:   message list + streaming bubbles + intro greeting on empty.
 * Footer: textarea + send button. ESC closes; Enter sends; Shift+Enter newlines.
 *
 * Variants:
 *   - `floating`     desktop corner panel (380×560)
 *   - `bottom-sheet` mobile full-screen sheet
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type {
  BorjieLanguage,
  BorjieMessage,
  BorjieMode,
  UseBorjieChatResult,
} from './useBorjieChat';
import { BorjieModeSelector } from './BorjieModeSelector';
import { BorjieChatBubble } from './BorjieChatBubble';
// Display identity is locked — see CAPABILITIES_UNIFICATION.md
// "User-facing identity is locked". Every header on the chat surface
// renders the canonical name_full; specialisation/subtitle is
// internal-only.
import { MR_MWIKILA_CANONICAL_DISPLAY } from '../canonical-display.js';

export const BORJIE_BRAND_EN = MR_MWIKILA_CANONICAL_DISPLAY.name_full;
export const BORJIE_BRAND_SW = 'Borjie — Meneja wa AI wa Shughuli za Mgodi';

export const BORJIE_INTRO_EN =
  `Hi, I'm ${MR_MWIKILA_CANONICAL_DISPLAY.name_full}. I run your mining business end-to-end. Ask me about your sites, licences, ore parcels, FX exposure, or anything in the mining corpus.`;
export const BORJIE_INTRO_SW =
  'Habari, mimi ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Ninaendesha biashara yako ya mgodi mwanzo hadi mwisho. Niulize kuhusu migodi yako, leseni, vifurushi vya madini, hatari ya kubadilisha sarafu, au lolote katika kanzi ya uchimbaji madini.';

interface BorjieChatPanelProps {
  readonly chat: UseBorjieChatResult;
  readonly mode: BorjieMode;
  readonly language: BorjieLanguage;
  readonly onChangeMode: (mode: BorjieMode) => void;
  readonly onChangeLanguage: (lang: BorjieLanguage) => void;
  readonly onClose: () => void;
  readonly variant: 'floating' | 'bottom-sheet';
  readonly authenticated: boolean;
  readonly signInHref?: string | undefined;
  readonly onSend: (text: string) => Promise<void>;
  readonly onOpenEvidence?: ((evidenceId: string) => void) | undefined;
}

export function BorjieChatPanel(props: BorjieChatPanelProps): JSX.Element {
  const {
    chat,
    mode,
    language,
    onChangeMode,
    onChangeLanguage,
    onClose,
    variant,
    authenticated,
    signInHref = '/sign-in',
    onSend,
    onOpenEvidence,
  } = props;

  const [draft, setDraft] = useState('');
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Initial focus → input field (focus trap entrypoint).
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (listEndRef.current && typeof listEndRef.current.scrollIntoView === 'function') {
      listEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [chat.messages.length, chat.isStreaming]);

  const handleSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await onSend(text);
  }, [draft, onSend]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  const brand = language === 'sw' ? BORJIE_BRAND_SW : BORJIE_BRAND_EN;
  const intro = language === 'sw' ? BORJIE_INTRO_SW : BORJIE_INTRO_EN;

  const containerStyle = useMemo<React.CSSProperties>(() => {
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
      boxShadow: '0 24px 48px rgba(15, 23, 42, 0.22)',
      overflow: 'hidden',
      zIndex: 10_001,
      border: '1px solid #e2e8f0',
    };
  }, [variant]);

  return (
    <section
      ref={panelRef}
      data-testid="borjie-chat-panel"
      data-variant={variant}
      role="dialog"
      aria-modal="false"
      aria-label={brand}
      style={containerStyle}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid #e2e8f0',
          gap: 8,
          background: '#0f172a',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{brand}</strong>
          <BorjieModeSelector
            value={mode}
            language={language}
            onChange={onChangeMode}
            disabled={chat.isStreaming}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            data-testid="borjie-language-toggle"
            onClick={() => onChangeLanguage(language === 'en' ? 'sw' : 'en')}
            aria-label={language === 'sw' ? 'Switch to English' : 'Badilisha kwenda Kiswahili'}
            style={{
              background: 'transparent',
              border: '1px solid #475569',
              color: '#f8fafc',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {language.toUpperCase()}
          </button>
          <button
            type="button"
            data-testid="borjie-close"
            onClick={onClose}
            aria-label={language === 'sw' ? 'Funga' : 'Close'}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#cbd5e1',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            {'×'}
          </button>
        </div>
      </header>

      <div
        data-testid="borjie-live-region"
        aria-live="polite"
        aria-atomic="false"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {chat.messages.length === 0 ? (
          <p
            data-testid="borjie-intro"
            style={{
              background: '#f1f5f9',
              color: '#334155',
              padding: 12,
              borderRadius: 12,
              fontSize: 13,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {intro}
          </p>
        ) : null}
        <ul style={{ padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chat.messages.map((m: BorjieMessage) => (
            <BorjieChatBubble
              key={m.id}
              message={m}
              language={language}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </ul>
        <div ref={listEndRef} />
      </div>

      {!authenticated ? (
        <SignInPrompt language={language} signInHref={signInHref} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: 12,
            borderTop: '1px solid #e2e8f0',
            background: '#fff',
          }}
        >
          <textarea
            ref={inputRef}
            data-testid="borjie-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={language === 'sw' ? 'Andika swali...' : 'Type a question...'}
            rows={1}
            aria-label={language === 'sw' ? 'Uliza Borjie' : 'Ask Borjie'}
            disabled={chat.isStreaming}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              minHeight: 36,
              maxHeight: 120,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            data-testid="borjie-send"
            disabled={chat.isStreaming || !draft.trim()}
            aria-label={language === 'sw' ? 'Tuma' : 'Send'}
            style={{
              background: '#0f172a',
              color: '#f8fafc',
              border: 'none',
              borderRadius: 10,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: chat.isStreaming || !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: chat.isStreaming || !draft.trim() ? 0.5 : 1,
            }}
          >
            {language === 'sw' ? 'Tuma' : 'Send'}
          </button>
        </form>
      )}
    </section>
  );
}

function SignInPrompt({
  language,
  signInHref,
}: {
  readonly language: BorjieLanguage;
  readonly signInHref: string;
}): JSX.Element {
  return (
    <div
      data-testid="borjie-signin-prompt"
      style={{
        padding: 14,
        borderTop: '1px solid #e2e8f0',
        background: '#fff8e1',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: '#92400e' }}>
        {language === 'sw'
          ? 'Ingia ili kuongea na Borjie.'
          : 'Sign in to talk to Borjie.'}
      </p>
      <a
        href={signInHref}
        style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          fontWeight: 600,
          color: '#0f172a',
          textDecoration: 'underline',
        }}
      >
        {language === 'sw' ? 'Ingia' : 'Sign in'}
      </a>
    </div>
  );
}
