/**
 * BorjieChatPanel — the expanded chat panel that fades in when the
 * floating bubble is clicked.
 *
 * Header:
 *   - warm-gold gradient bar
 *   - BorjieMark (24px) + two-line title
 *     (canonical `name_full` first line; muted "AI Mining Operations
 *     Manager" subtitle second line — sourced from MESSAGES so it stays
 *     bilingual but is NOT part of the canonical identity check; the
 *     identity-lock test only asserts the panel exposes name_full and
 *     omits internal specialisation signals like "Specialist" /
 *     "Advisor" / "Officer" / "Junior" / "Concierge")
 *   - ContextBadge pill (visible when the latest assistant turn cited a
 *     borjie:* evidence id)
 *   - EN/SW language toggle + close X
 *
 * Body:
 *   - welcome message on empty
 *   - message list with segment-header dividers + framer-motion entry
 *   - streaming bubbles
 *
 * Footer:
 *   - 2×2 suggestion-chip grid before the first user message
 *   - composer (textarea + send) — Enter sends, Shift+Enter newlines,
 *     ESC closes
 *   - 3-segment LitFin-parity attribution micro-copy
 *
 * Variants:
 *   - `floating`     desktop corner panel
 *   - `bottom-sheet` mobile full-screen sheet
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { BorjieMark, BORJIE_GOLD_GRADIENT } from './BorjieMark';
import {
  MESSAGES,
  SUGGESTION_CHIPS,
  evidenceContextLabel,
  t,
  type BilingualString,
} from './messages';
import { BorjieSegmentHeader, segmentLabel } from './BorjieSegmentHeader';
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
  readonly reducedMotion?: boolean;
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
    reducedMotion = false,
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

  const handleChipClick = useCallback(
    (prompt: BilingualString) => {
      void onSend(t(prompt, language));
    },
    [onSend, language],
  );

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
  const tagline = t(MESSAGES.brandTagline, language);
  const welcomeBody = t(MESSAGES.welcomeBody, language);
  const footerAttribution = t(MESSAGES.footerAttribution, language);
  const placeholder = t(MESSAGES.placeholder, language);
  const sendLabel = t(MESSAGES.send, language);

  // Most-recent assistant evidence id drives the ContextBadge pill.
  const contextLabel = useMemo<string | null>(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (!m || m.role !== 'assistant') continue;
      const lastId = m.evidenceIds[m.evidenceIds.length - 1];
      if (!lastId) continue;
      const label = evidenceContextLabel(lastId);
      if (label) return t(label, language);
    }
    return null;
  }, [chat.messages, language]);

  const containerStyle = useMemo<CSSProperties>(() => {
    if (variant === 'bottom-sheet') {
      return {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#FFFFFF',
        zIndex: 10_001,
      };
    }
    return {
      position: 'fixed',
      bottom: 24,
      right: 24,
      width: 'min(92vw, 380px)',
      height: 'min(80vh, 720px)',
      display: 'flex',
      flexDirection: 'column',
      background: '#FFFFFF',
      borderRadius: 18,
      boxShadow: '0 28px 80px rgba(15, 23, 42, 0.22)',
      overflow: 'hidden',
      zIndex: 10_001,
      border: '1px solid rgba(15, 23, 42, 0.10)',
    };
  }, [variant]);

  const hasMessages = chat.messages.length > 0;
  const showChips = !hasMessages && authenticated;
  const ariaCloseLabel = t(MESSAGES.ariaClose, language);
  const switchLanguageLabel = t(MESSAGES.switchLanguage, language);

  // Pre-compute the visible list with segment dividers spliced in.
  const visibleItems = useMemo(() => {
    const items: Array<
      | { readonly kind: 'segment'; readonly key: string; readonly label: string }
      | { readonly kind: 'message'; readonly key: string; readonly msg: BorjieMessage }
    > = [];
    let prevCreatedAt: string | null = null;
    const nowMs = Date.now();
    for (const m of chat.messages) {
      const seg = segmentLabel(prevCreatedAt, m.createdAt, language, nowMs);
      if (seg) {
        items.push({ kind: 'segment', key: `seg-${m.id}`, label: seg });
      }
      items.push({ kind: 'message', key: m.id, msg: m });
      prevCreatedAt = m.createdAt;
    }
    return items;
  }, [chat.messages, language]);

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
          padding: '12px 14px 10px 14px',
          borderBottom: '1px solid rgba(15, 23, 42, 0.10)',
          gap: 10,
          background: `linear-gradient(90deg, ${BORJIE_GOLD_GRADIENT.from} 0%, ${BORJIE_GOLD_GRADIENT.to} 100%)`,
          color: '#17100A',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span aria-hidden="true" style={{ flexShrink: 0 }}>
            <BorjieMark size={24} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <strong
              style={{
                fontSize: 13,
                lineHeight: 1.25,
                color: '#17100A',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {brand}
            </strong>
            <span
              style={{
                fontSize: 11,
                lineHeight: 1.25,
                color: 'rgba(23, 16, 10, 0.72)',
                marginTop: 1,
              }}
            >
              {tagline}
            </span>
            {contextLabel ? (
              <span
                data-testid="borjie-context-badge"
                style={{
                  marginTop: 6,
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 9px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  background: 'rgba(255, 255, 255, 0.55)',
                  color: '#17100A',
                  border: '1px solid rgba(23, 16, 10, 0.18)',
                  borderRadius: 999,
                  animation: reducedMotion ? 'none' : 'borjie-chip-in 240ms ease both',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: '#17100A',
                  }}
                />
                {t(MESSAGES.contextDiscussing, language)} {contextLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BorjieModeSelector
            value={mode}
            language={language}
            onChange={onChangeMode}
            disabled={chat.isStreaming}
          />
          <button
            type="button"
            data-testid="borjie-language-toggle"
            onClick={() => onChangeLanguage(language === 'en' ? 'sw' : 'en')}
            aria-label={switchLanguageLabel}
            title={switchLanguageLabel}
            style={{
              background: 'rgba(255, 255, 255, 0.50)',
              border: '1px solid rgba(23, 16, 10, 0.22)',
              color: '#17100A',
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
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
            aria-label={ariaCloseLabel}
            title={ariaCloseLabel}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#17100A',
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
          background: '#FBFAF7',
        }}
      >
        {!hasMessages ? (
          <div
            data-testid="borjie-intro"
            style={{
              display: 'flex',
              gap: 10,
              padding: 12,
              borderRadius: 14,
              background: '#F7F8FA',
              border: '1px solid rgba(15, 23, 42, 0.06)',
            }}
          >
            <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
              <BorjieMark size={22} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <strong style={{ fontSize: 13, lineHeight: 1.35, color: '#0B0F19' }}>
                {t(MESSAGES.welcomeTitle, language)}
              </strong>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: '#334155' }}>
                {welcomeBody}
              </p>
            </div>
          </div>
        ) : null}
        <ul style={{ padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleItems.map((item) => {
            if (item.kind === 'segment') {
              return (
                <BorjieSegmentHeader
                  key={item.key}
                  label={item.label}
                  language={language}
                />
              );
            }
            return (
              <BorjieChatBubble
                key={item.key}
                message={item.msg}
                language={language}
                onOpenEvidence={onOpenEvidence}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </ul>
        <div ref={listEndRef} />
      </div>

      {showChips ? (
        <SuggestionChips
          language={language}
          disabled={chat.isStreaming}
          onPick={handleChipClick}
          reducedMotion={reducedMotion}
        />
      ) : null}

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
            borderTop: '1px solid rgba(15, 23, 42, 0.08)',
            background: '#FFFFFF',
          }}
        >
          <textarea
            ref={inputRef}
            data-testid="borjie-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            rows={1}
            aria-label={placeholder}
            disabled={chat.isStreaming}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid rgba(15, 23, 42, 0.18)',
              borderRadius: 12,
              padding: '9px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              minHeight: 38,
              maxHeight: 120,
              outline: 'none',
              background: '#FFFFFF',
              color: '#0B0F19',
            }}
          />
          <button
            type="submit"
            data-testid="borjie-send"
            disabled={chat.isStreaming || !draft.trim()}
            aria-label={sendLabel}
            style={{
              background: '#0B0F19',
              color: '#F7F8FA',
              border: 'none',
              borderRadius: 12,
              padding: '9px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: chat.isStreaming || !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: chat.isStreaming || !draft.trim() ? 0.5 : 1,
            }}
          >
            {sendLabel}
          </button>
        </form>
      )}

      <div
        data-testid="borjie-footer-attribution"
        style={{
          padding: '6px 14px 10px 14px',
          fontSize: 10.5,
          color: 'rgba(15, 23, 42, 0.45)',
          textAlign: 'center',
          background: '#FFFFFF',
          borderTop: '1px solid rgba(15, 23, 42, 0.04)',
          letterSpacing: '0.01em',
        }}
      >
        {footerAttribution}
      </div>
    </section>
  );
}

interface SuggestionChipsProps {
  readonly language: BorjieLanguage;
  readonly disabled: boolean;
  readonly onPick: (prompt: BilingualString) => void;
  readonly reducedMotion: boolean;
}

function SuggestionChips({
  language,
  disabled,
  onPick,
  reducedMotion,
}: SuggestionChipsProps): JSX.Element {
  // 4 chips in a 2×2 grid per spec (royalty / mererani / pilot / human).
  const VISIBLE_CHIP_IDS = ['royalty', 'mererani', 'pilot', 'human'] as const;
  const chips = SUGGESTION_CHIPS.filter((c) =>
    (VISIBLE_CHIP_IDS as readonly string[]).includes(c.id),
  );
  return (
    <div
      data-testid="borjie-suggestion-chips"
      style={{
        padding: '8px 12px 0 12px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        background: '#FFFFFF',
      }}
    >
      {chips.map((chip, i) => (
        <button
          key={chip.id}
          type="button"
          data-testid={`borjie-suggestion-${chip.id}`}
          disabled={disabled}
          onClick={() => onPick(chip.prompt)}
          style={{
            background: '#FBFAF7',
            border: '1px solid rgba(15, 23, 42, 0.12)',
            color: '#0B0F19',
            padding: '8px 10px',
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 500,
            textAlign: 'left',
            lineHeight: 1.35,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            transition: reducedMotion
              ? 'none'
              : 'background 150ms ease, border-color 150ms ease, transform 150ms ease',
            animation: reducedMotion
              ? 'none'
              : `borjie-chip-in 260ms ease both ${i * 60}ms`,
          }}
          onMouseEnter={(e) => {
            if (reducedMotion || disabled) return;
            e.currentTarget.style.background = '#FFF6E1';
            e.currentTarget.style.borderColor = 'rgba(245, 178, 62, 0.55)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#FBFAF7';
            e.currentTarget.style.borderColor = 'rgba(15, 23, 42, 0.12)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {t(chip.label, language)}
        </button>
      ))}
    </div>
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
        borderTop: '1px solid rgba(15, 23, 42, 0.08)',
        background: '#FFF6E1',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: '#7A5A12' }}>
        {t(MESSAGES.signInPrompt, language)}
      </p>
      <a
        href={signInHref}
        style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          fontWeight: 600,
          color: '#0B0F19',
          textDecoration: 'underline',
        }}
      >
        {t(MESSAGES.signInCta, language)}
      </a>
    </div>
  );
}
