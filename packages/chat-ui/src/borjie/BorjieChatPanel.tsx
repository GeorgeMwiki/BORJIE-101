/**
 * BorjieChatPanel — the expanded chat panel that fades in when the
 * floating bubble is clicked.
 *
 * Visual chrome is a near-verbatim port of LitFin's marketing
 * `ChatPanel` (see LITFIN PROJECT/src/core/litfin-ai/components/
 * ChatPanel.tsx and src/components/chat-ui/index.tsx). Only the colour
 * palette changes — LitFin's copper-on-cream becomes Borjie's
 * navy-on-cream-with-gold-accents. All structural elements (header
 * gradient, gloss sweep, copper-gradient circular send button, mic
 * icon, compliance disclaimer, typing dots, EN/SW toggle position) are
 * laid out identically so the two surfaces read as siblings.
 *
 * Header:
 *   - warm-gold gradient bar with a subtle gloss sweep
 *   - BorjieMark (20px) in a translucent ring + canonical name_full
 *   - ContextBadge pill (when the latest assistant turn cited a
 *     borjie:* evidence id)
 *   - mode dropdown · EN/SW toggle · close X (right side, like LitFin's
 *     action row)
 *
 * Body:
 *   - welcome bubble on empty state
 *   - message list with segment-header dividers + framer-motion entry
 *   - streaming bubbles with the canonical typing dots from
 *     BorjieChatBubble
 *
 * Disclaimer:
 *   - hairline compliance notice ("Imezalishwa na AI · Si ushauri wa
 *     kifedha · Maamuzi ni yako") above the composer
 *
 * Footer / composer:
 *   - mic ghost button · textarea · gold-gradient circular send arrow
 *   - status row ("Chat in Kiswahili" toggle, "Mic ready") underneath
 *
 * Variants:
 *   - `floating`     desktop corner panel (380px × 720px max)
 *   - `bottom-sheet` mobile full-screen sheet
 *
 * Identity contract:
 *   - header always renders `MR_MWIKILA_CANONICAL_DISPLAY.name_full`
 *   - panel text NEVER contains internal specialisation signals
 *     (Specialist/Advisor/Officer/Concierge/Junior/subtitle). See
 *     `__tests__/BorjieChatPanel-canonical-lock.test.tsx`.
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
import { BorjieMark, BORJIE_GOLD_GRADIENT, BORJIE_GOLD_DEEP } from './BorjieMark';
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
export const BORJIE_BRAND_SW = 'Borjie · Mkurugenzi Mtendaji wa AI wa Madini';

// NOTE: These intro constants stay exported so the canonical-display
// contract test can assert the name_full is part of the documented
// greeting surface, but the panel UI no longer renders a canned welcome
// bubble. Instead the live brain produces the first turn on open via a
// synthetic "hello" message routed through /api/v1/public/chat.
export const BORJIE_INTRO_EN =
  `Hi, I'm ${MR_MWIKILA_CANONICAL_DISPLAY.name_full}. I run your mining business end-to-end. Ask me about your sites, licences, ore parcels, FX exposure, or anything in the mining corpus.`;
export const BORJIE_INTRO_SW =
  'Habari, mimi ni Bw. Mwikila, Mkurugenzi Mtendaji wa AI wa Madini wa Borjie. Ninaendesha biashara yako ya mgodi mwanzo hadi mwisho. Niulize kuhusu migodi yako, leseni, vifurushi vya madini, hatari ya kubadilisha sarafu, au lolote katika kanzi ya uchimbaji madini.';

// Canonical LitFin parity colours, mapped to the Borjie palette:
//   LitFin header copper       → Borjie warm-gold
//   LitFin user-bubble copper  → Borjie deep navy (BorjieChatBubble.tsx)
//   LitFin AI-bubble cream     → Borjie cream (BorjieChatBubble.tsx)
//   LitFin disclaimer hairline → emerald accent retained (compliance)
const HEADER_GRADIENT = `linear-gradient(135deg, ${BORJIE_GOLD_GRADIENT.from} 0%, ${BORJIE_GOLD_GRADIENT.via} 45%, ${BORJIE_GOLD_GRADIENT.to} 100%)`;
const HEADER_TEXT = BORJIE_GOLD_DEEP;
const HEADER_BORDER = 'rgba(23, 16, 10, 0.10)';
const PANEL_BG = '#FFFFFF';
const BODY_BG = '#FBFAF7';
const COMPOSER_BG = '#FFFFFF';
const COMPOSER_BORDER = 'rgba(15, 23, 42, 0.08)';
const MUTED_BG = '#F1F3F7';
const MUTED_FG = '#475569';

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
  // Tracks whether we've already fired the synthetic "hello" so the
  // live brain produces the welcome turn instead of a canned string.
  // We fire it exactly once per panel-open lifetime; further opens
  // restore the persisted transcript and skip the auto-greet.
  const autoGreetFiredRef = useRef<boolean>(chat.messages.length > 0);

  useEffect(() => {
    // Initial focus → input field (focus trap entrypoint).
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (listEndRef.current && typeof listEndRef.current.scrollIntoView === 'function') {
      listEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [chat.messages.length, chat.isStreaming]);

  // ── Live first-open greeting ──
  // No canned welcome string. When the panel opens with an empty
  // transcript and the user is allowed to talk, we dispatch a single
  // synthetic "hello" through the same /api/v1/public/chat pipeline
  // any normal message uses. The Anthropic-backed persona generates
  // the short identity + one qualifying question + chip-style next
  // actions positioning that mirrors LitFin's pattern.
  useEffect(() => {
    if (autoGreetFiredRef.current) return;
    if (!authenticated) return;
    if (chat.messages.length > 0) {
      autoGreetFiredRef.current = true;
      return;
    }
    autoGreetFiredRef.current = true;
    void onSend('hello');
    // Intentionally empty deps so the auto-greet only fires once on
    // mount; subsequent opens replay from persisted history and the
    // ref is initialised true above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const footerAttribution = t(MESSAGES.footerAttribution, language);
  const placeholder = t(MESSAGES.placeholder, language);
  const sendLabel = t(MESSAGES.send, language);
  const micLabel = language === 'sw' ? 'Sauti' : 'Voice';
  const disclaimerText =
    language === 'sw'
      ? 'Imezalishwa na AI · Si ushauri wa kifedha · Maamuzi ni yako'
      : 'AI-generated · Not financial advice · Decisions are yours';

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
        background: PANEL_BG,
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
      background: PANEL_BG,
      borderRadius: 28,
      boxShadow:
        '0 28px 80px rgba(15, 23, 42, 0.22), 0 6px 18px rgba(15, 23, 42, 0.08)',
      overflow: 'hidden',
      zIndex: 10_001,
      border: '1px solid rgba(15, 23, 42, 0.10)',
    };
  }, [variant]);

  // The synthetic "hello" we dispatch on first open is filtered out
  // so the user never sees their own greeting echoed back at them.
  // The shape we detect: very first message in the transcript, role
  // === 'user', text trim-lowers to 'hello'. After the assistant turn
  // streams in we keep filtering it so the visual history stays clean
  // even when the panel re-renders with persisted state.
  const visibleMessages = useMemo(() => {
    const list = chat.messages;
    if (list.length > 0) {
      const first = list[0];
      if (
        first &&
        first.role === 'user' &&
        (first.text ?? '').trim().toLowerCase() === 'hello'
      ) {
        return list.slice(1);
      }
    }
    return list;
  }, [chat.messages]);

  // Chips show until the user types their first real message. The
  // auto-greet does NOT count, so chips render alongside the live
  // welcome response (LitFin parity: short identity + qualifying
  // question + chip-style next actions visible together).
  const hasUserTurn = visibleMessages.some((m) => m.role === 'user');
  const showChips = !hasUserTurn && authenticated;
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
    for (const m of visibleMessages) {
      const seg = segmentLabel(prevCreatedAt, m.createdAt, language, nowMs);
      if (seg) {
        items.push({ kind: 'segment', key: `seg-${m.id}`, label: seg });
      }
      items.push({ kind: 'message', key: m.id, msg: m });
      prevCreatedAt = m.createdAt;
    }
    return items;
  }, [visibleMessages, language]);

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
      {/* ── Header: gold gradient + gloss sweep ── */}
      <header
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '12px 14px 12px 14px',
          borderBottom: `1px solid ${HEADER_BORDER}`,
          gap: 10,
          background: HEADER_GRADIENT,
          color: HEADER_TEXT,
          overflow: 'hidden',
        }}
      >
        {/* Gloss sweep — same slow shimmer LitFin uses on the canonical
            ChatShellHeader. Pauses under prefers-reduced-motion. */}
        {!reducedMotion ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '-30%',
              width: '30%',
              pointerEvents: 'none',
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)',
              animation: 'borjie-header-gloss 7s ease-in-out 2s infinite',
            }}
          />
        ) : null}

        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.20)',
              boxShadow:
                '0 4px 12px rgba(0, 0, 0, 0.10), inset 0 0 0 1px rgba(255, 255, 255, 0.30)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <BorjieMark size={20} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <strong
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                lineHeight: 1.2,
                color: HEADER_TEXT,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {brand}
            </strong>
            <span
              style={{
                fontSize: 10.5,
                lineHeight: 1.2,
                color: 'rgba(23, 16, 10, 0.72)',
                marginTop: 2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 600,
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
                  color: HEADER_TEXT,
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
                    background: HEADER_TEXT,
                  }}
                />
                {t(MESSAGES.contextDiscussing, language)} {contextLabel}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right-side action row — mirrors LitFin's tools-not-actions row.
            Mode selector first (most decisional), then language toggle,
            then close. */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <BorjieModeSelector
            value={mode}
            language={language}
            onChange={onChangeMode}
            disabled={chat.isStreaming}
          />
          <HeaderIconButton
            ariaLabel={switchLanguageLabel}
            title={switchLanguageLabel}
            onClick={() => onChangeLanguage(language === 'en' ? 'sw' : 'en')}
            testId="borjie-language-toggle"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>
              {language.toUpperCase()}
            </span>
          </HeaderIconButton>
          <HeaderIconButton
            ariaLabel={ariaCloseLabel}
            title={ariaCloseLabel}
            onClick={onClose}
            testId="borjie-close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 15l6 6 6-6" />
            </svg>
          </HeaderIconButton>
        </div>
      </header>

      {/* ── Body ── */}
      <div
        data-testid="borjie-live-region"
        aria-live="polite"
        aria-atomic="false"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: BODY_BG,
        }}
      >
        {/* Canned welcome bubble removed. The live brain produces the
            first turn via the synthetic "hello" dispatched in the
            mount effect above so the marketing widget never shows a
            stale, identity-locked greeting. The empty state stays
            visually blank for the ~one frame between mount and the
            first SSE chunk, then the assistant bubble streams in with
            ThinkingDots followed by the persona-shaped response. */}
        <ul
          style={{
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
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

      {/* ── AI compliance disclaimer ──
          Mirrors LitFin's hairline notice. Sits ABOVE the composer so
          the user always sees it before sending a question. */}
      <div
        role="note"
        aria-label="AI compliance notice"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderTop: `1px solid ${COMPOSER_BORDER}`,
          padding: '6px 14px',
          background: 'rgba(15, 23, 42, 0.025)',
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          style={{ flexShrink: 0, color: 'rgba(16, 122, 87, 0.75)' }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1.3,
            color: 'rgba(15, 23, 42, 0.55)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {disclaimerText}
        </p>
      </div>

      {/* ── Composer ── */}
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
            flexDirection: 'column',
            gap: 6,
            padding: '10px 12px 10px 12px',
            background: COMPOSER_BG,
            borderTop: `1px solid ${COMPOSER_BORDER}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {/* Mic ghost — matches LitFin's idle voice button. The chat-ui
                package does not own the STT pipeline; the button is a
                visual affordance that links to the standalone voice
                page so the user can record there. */}
            <button
              type="button"
              data-testid="borjie-mic"
              aria-label={micLabel}
              title={micLabel}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/voice';
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 12,
                background: MUTED_BG,
                color: MUTED_FG,
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
                transition: reducedMotion ? 'none' : 'background 150ms ease, color 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (reducedMotion) return;
                e.currentTarget.style.background = '#E2E8F0';
                e.currentTarget.style.color = '#0B0F19';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = MUTED_BG;
                e.currentTarget.style.color = MUTED_FG;
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
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
                lineHeight: 1.4,
                minHeight: 36,
                maxHeight: 120,
                outline: 'none',
                background: '#FFFFFF',
                color: '#0B0F19',
              }}
            />
            {/* Send — gold-gradient circular arrow. Mirrors LitFin's
                copper-on-cream copper-gradient round send. */}
            <button
              type="submit"
              data-testid="borjie-send"
              disabled={chat.isStreaming || !draft.trim()}
              aria-label={sendLabel}
              title={sendLabel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 999,
                background: `linear-gradient(135deg, ${BORJIE_GOLD_GRADIENT.from} 0%, ${BORJIE_GOLD_GRADIENT.via} 50%, ${BORJIE_GOLD_GRADIENT.to} 100%)`,
                color: BORJIE_GOLD_DEEP,
                border: 'none',
                cursor: chat.isStreaming || !draft.trim() ? 'not-allowed' : 'pointer',
                opacity: chat.isStreaming || !draft.trim() ? 0.45 : 1,
                boxShadow:
                  '0 8px 20px -4px rgba(245, 178, 62, 0.45), 0 2px 6px rgba(122, 90, 18, 0.20)',
                flexShrink: 0,
                transition: reducedMotion
                  ? 'none'
                  : 'transform 160ms ease, box-shadow 160ms ease',
              }}
              onMouseEnter={(e) => {
                if (reducedMotion || chat.isStreaming || !draft.trim()) return;
                e.currentTarget.style.transform = 'scale(1.04)';
                e.currentTarget.style.boxShadow =
                  '0 10px 24px -4px rgba(245, 178, 62, 0.55), 0 3px 8px rgba(122, 90, 18, 0.25)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow =
                  '0 8px 20px -4px rgba(245, 178, 62, 0.45), 0 2px 6px rgba(122, 90, 18, 0.20)';
              }}
              onMouseDown={(e) => {
                if (reducedMotion) return;
                e.currentTarget.style.transform = 'scale(0.96)';
              }}
              onMouseUp={(e) => {
                if (reducedMotion) return;
                e.currentTarget.style.transform = 'scale(1.04)';
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          {/* Status row — "Chat in <Language>" toggle (LitFin parity). */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 2px',
            }}
          >
            <span style={{ fontSize: 10, color: 'rgba(15, 23, 42, 0.55)' }}>
              {language === 'sw' ? 'Ongea kwa' : 'Chat in'}{' '}
              <button
                type="button"
                onClick={() => onChangeLanguage(language === 'en' ? 'sw' : 'en')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#7A5A12',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                {language === 'sw' ? 'Kiswahili' : 'English'}
              </button>
            </span>
            <span style={{ fontSize: 10, color: 'rgba(15, 23, 42, 0.45)' }}>
              {language === 'sw' ? 'Sauti tayari' : 'Mic ready'}
            </span>
          </div>
        </form>
      )}

      <div
        data-testid="borjie-footer-attribution"
        style={{
          padding: '6px 14px 10px 14px',
          fontSize: 10.5,
          color: 'rgba(15, 23, 42, 0.45)',
          textAlign: 'center',
          background: COMPOSER_BG,
          borderTop: `1px solid ${COMPOSER_BORDER}`,
          letterSpacing: '0.01em',
          fontStyle: 'italic',
        }}
      >
        {footerAttribution}
      </div>
    </section>
  );
}

/** Header icon button — translucent-on-gradient pill matching LitFin's
 *  `ChatHeaderIconButton`. Inline styles only because the chat-ui
 *  package ships with no Tailwind dependency. */
function HeaderIconButton(props: {
  readonly ariaLabel: string;
  readonly title?: string;
  readonly onClick: () => void;
  readonly testId?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  const { ariaLabel, title, onClick, testId, children } = props;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '6px 8px',
        borderRadius: 8,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'rgba(23, 16, 10, 0.78)',
        transition: 'background 150ms ease, color 150ms ease',
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.28)';
        e.currentTarget.style.color = BORJIE_GOLD_DEEP;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'rgba(23, 16, 10, 0.78)';
      }}
    >
      {children}
    </button>
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
        background: COMPOSER_BG,
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
        borderTop: `1px solid ${COMPOSER_BORDER}`,
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
