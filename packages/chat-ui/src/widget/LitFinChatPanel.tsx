'use client';

/**
 * Borjie AI Chat Panel — carbon copy of LitFin's ChatPanel, Borjie-skinned.
 *
 * The expanded chat interface for the floating widget. Renders:
 *   - Gradient header (Logomark + persona + ContextBadge + EN/SW + voice
 *     toggles + new-chat + expand/collapse + close)
 *   - Session strip ("Public · 12:45 PM · 2 msgs")
 *   - Centered empty state (logomark + Mr. Mwikila greeting)
 *   - Message list with LitFin-style bubbles + typing dots
 *   - Composer (5-state voice mic + image upload + textarea + send)
 *   - Drag-and-drop / paste image, sounds, auto-speak (TTS)
 *   - "Chat in <Lang>" pill + "Mic ready" status
 *   - Disclaimer footer
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/ChatPanel.tsx
 *
 * Brand / locale invariants (do NOT regress):
 *   - Persona stays "Mr. Mwikila" (Borjie brand).
 *   - Language follows the page locale via `useWidgetLanguage`; the toggle
 *     writes `borjie_locale` + reloads (site-wide). No widget-only state.
 *   - Single language per active locale (zero EN/SW mixing).
 *   - Borjie copper/navy brand tokens (CHAT_HEADER_GRADIENT etc.).
 *   - Endpoint stays /api/chat (the marketing proxy), persona "public".
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type JSX,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BorjieMark } from '../borjie/BorjieMark';
import {
  CHAT_HEADER_GRADIENT,
  ChatHeaderIconButton,
  TypingDots,
} from '../litfin-primitives';
import { useLitFinAI } from './LitFinAIProvider';
import { useWidgetLanguage } from './useWidgetLanguage';
import { useChatSounds } from './useChatSounds';
import { LitFinMessageBubble, type LitFinMessage } from './LitFinMessageBubble';
import { LitFinSegmentHeader } from './LitFinSegmentHeader';
import { LitFinContextBadge } from './LitFinContextBadge';
import {
  LitFinVoiceCapture,
  type VoiceCaptureVisualState,
} from './LitFinVoiceCapture.js';
import { createWebSpeechAudioPort } from '../voice/web-speech-adapter.js';
import type { VoiceAudioPort } from '../voice/voice-audio-port.js';
import type { Language } from '../chat-modes/types.js';

interface LitFinChatPanelProps {
  readonly onClose: () => void;
  /**
   * EN compliance line shown in the bottom footer. Defaults to the
   * generic "owner" copy so a missing prop never reverts to the wrong
   * domain (the Borjie mining domain says "mine owner"). Mount
   * components MUST pass the domain-specific copy.
   */
  readonly disclaimerEn?: string;
  /** SW compliance line. Same fallback rules as disclaimerEn. */
  readonly disclaimerSw?: string;
}

/**
 * Generic compliance copy used when no prop is passed. Mount sites that
 * skip the prop will at least never display the wrong domain term.
 */
const DEFAULT_DISCLAIMER_EN =
  'AI-generated. Not legal advice. Decisions are made by the owner.';
const DEFAULT_DISCLAIMER_SW =
  'AI-iliyotengenezwa . Si ushauri wa kisheria . Maamuzi yanafanywa na mmiliki';

// ============================================================================
// Bilingual UI strings — single language per active locale.
// ============================================================================

type Bilingual = Readonly<Record<Language, string>>;

const PANEL_TEXT = {
  placeholder: {
    en: 'Ask Mr. Mwikila anything...',
    sw: 'Uliza Mr. Mwikila chochote...',
  },
  placeholderImage: { en: 'Describe the image...', sw: 'Eleza picha...' },
  placeholderRecording: { en: 'Speak now...', sw: 'Ongea sasa...' },
  emptyGreeting: {
    en: "Hi. I'm Mr. Mwikila, your AI mining managing director. I can walk you through licences, royalty, workforce, compliance, and offtake. What do you want to start with?",
    sw: 'Habari. Mimi ni Mr. Mwikila, mkurugenzi mtendaji wa uchimbaji wa AI. Naweza kukupitisha kwenye leseni, mrabaha, wafanyakazi, uzingatiaji, na uuzaji wa madini. Tuanzie wapi?',
  },
  send: { en: 'Send', sw: 'Tuma' },
  close: { en: 'Close', sw: 'Funga' },
  minimize: { en: 'Minimize', sw: 'Punguza' },
  expand: { en: 'Expand', sw: 'Panua' },
  collapse: { en: 'Collapse', sw: 'Kunja' },
  expandChat: { en: 'Expand chat', sw: 'Panua gumzo' },
  collapseChat: { en: 'Collapse chat', sw: 'Kunja gumzo' },
  newConversation: { en: 'New conversation', sw: 'Mazungumzo mapya' },
  newConfirmTitle: {
    en: 'Start a new conversation?',
    sw: 'Anza mazungumzo mapya?',
  },
  newConfirmMessage: {
    en: 'This will clear your current chat. I will not remember anything from this conversation in the new one.',
    sw: 'Hii itafuta mazungumzo yako ya sasa. Sitakumbuka chochote kutoka mazungumzo haya katika mazungumzo mapya.',
  },
  newConfirmYes: { en: 'Yes, start fresh', sw: 'Ndio, anza upya' },
  newConfirmCancel: { en: 'Cancel', sw: 'Ghairi' },
  attachImage: { en: 'Attach image', sw: 'Ambatanisha picha' },
  dropImage: { en: 'Drop image here', sw: 'Dondosha picha hapa' },
  autoSpeak: { en: 'Auto-speak responses', sw: 'Jibu kwa sauti' },
  speaking: { en: 'Speaking...', sw: 'Inaongea...' },
  stop: { en: 'Stop', sw: 'Simamisha' },
  listening: { en: 'Listening...', sw: 'Nasikiliza...' },
  micReady: { en: 'Mic ready', sw: 'Mic tayari' },
  micUnavailable: { en: 'Mic unavailable', sw: 'Mic haipatikani' },
  chatIn: { en: 'Chat in English', sw: 'Zungumza kwa Kiswahili' },
  notUnderstood: {
    en: "I didn't quite catch that. Could you say that again?",
    sw: 'Sijasikia vizuri, tafadhali sema tena?',
  },
  removeImage: { en: 'Remove image', sw: 'Ondoa picha' },
  readyToSend: { en: 'Ready to send', sw: 'Tayari kutuma' },
} as const satisfies Readonly<Record<string, Bilingual>>;

const PENDING_CHIP_KEY = 'borjie-litfin-pending-chip-prompt';

function makeId(prefix: string): string {
  const cryptoApi =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;

interface PendingImage {
  readonly data: string;
  readonly mediaType: string;
  readonly fileName: string;
}

async function fileToImage(file: File): Promise<PendingImage | null> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return null;
  if (file.size > MAX_IMAGE_SIZE_BYTES) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        resolve(null);
        return;
      }
      resolve({ data: base64, mediaType: file.type, fileName: file.name });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

const AUTO_SPEAK_KEY = 'borjie-litfin-auto-speak';

function getAutoSpeak(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTO_SPEAK_KEY) === 'true';
  } catch {
    return false;
  }
}

function setAutoSpeakStorage(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTO_SPEAK_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export function LitFinChatPanel({
  onClose,
  disclaimerEn,
  disclaimerSw,
}: LitFinChatPanelProps): JSX.Element {
  const {
    portalId,
    currentRoute,
    endpoint,
    disclaimerEn: ctxDisclaimerEn,
    disclaimerSw: ctxDisclaimerSw,
  } = useLitFinAI();
  const { language, toggleLanguage } = useWidgetLanguage();
  const t = useCallback((m: Bilingual): string => m[language] ?? m.en, [
    language,
  ]);

  // Resolution order: explicit prop wins (lets tests pin a value),
  // then provider context (the mount-site choice), then the generic
  // "owner" default so a missing wiring never displays the wrong domain.
  const resolvedDisclaimerEn =
    disclaimerEn ?? ctxDisclaimerEn ?? DEFAULT_DISCLAIMER_EN;
  const resolvedDisclaimerSw =
    disclaimerSw ?? ctxDisclaimerSw ?? DEFAULT_DISCLAIMER_SW;

  const [messages, setMessages] = useState<ReadonlyArray<LitFinMessage>>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [voiceState, setVoiceState] =
    useState<VoiceCaptureVisualState>('idle');
  const [voiceClarification, setVoiceClarification] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(getAutoSpeak);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [sessionId] = useState(() => makeId('bn-sess'));
  const [sessionStartedAt] = useState(() => new Date().toISOString());

  const isRecording = voiceState === 'listening' || voiceState === 'arming';

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ttsPortRef = useRef<VoiceAudioPort | null>(null);
  const spokenCountRef = useRef(0);
  const prevStreamingRef = useRef(false);

  const { playSound } = useChatSounds(true);

  // ── TTS port (browser SpeechSynthesis) ────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const port = createWebSpeechAudioPort({
      recognitionLang: language === 'sw' ? 'sw-TZ' : 'en-US',
    });
    ttsPortRef.current = port;
    setTtsSupported(port.ttsSupported);
  }, [language]);

  // ── Auto-scroll + send/receive sounds ─────────────────────────────
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (isStreaming && !wasStreaming) playSound('open');
    else if (!isStreaming && wasStreaming) playSound('receive');
    const behavior = isStreaming || wasStreaming ? 'auto' : 'smooth';
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages, isStreaming, playSound]);

  // ── Focus on open, and after the AI finishes responding ───────────
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (isStreaming) return undefined;
    inputRef.current?.focus();
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [isStreaming]);

  // ── Auto-speak new assistant messages ─────────────────────────────
  useEffect(() => {
    if (!autoSpeak || !ttsSupported || isStreaming) {
      spokenCountRef.current = messages.length;
      return;
    }
    if (messages.length <= spokenCountRef.current) {
      spokenCountRef.current = messages.length;
      return;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && last.content.trim().length > 0) {
      const paragraphs = last.content.split(/\n\n+/);
      const speakText = paragraphs.slice(0, 2).join('\n\n').slice(0, 500);
      const port = ttsPortRef.current;
      if (port) {
        setIsSpeaking(true);
        void port
          .speak(speakText)
          .catch(() => undefined)
          .finally(() => setIsSpeaking(false));
      }
    }
    spokenCountRef.current = messages.length;
  }, [messages, autoSpeak, ttsSupported, isStreaming]);

  // Cancel any TTS on unmount.
  useEffect(() => {
    return () => ttsPortRef.current?.cancelSpeech();
  }, []);

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || isStreaming) return;

      playSound('send');

      const userMsg: LitFinMessage = {
        id: makeId('user'),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      const aiMsg: LitFinMessage = {
        id: makeId('ai'),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setInput('');
      const imageToSend = pendingImage;
      setPendingImage(null);
      setIsStreaming(true);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Ask the route to forward upstream SSE — keeps the widget on the
            // streaming code path. The route still falls back to JSON when the
            // upstream cannot stream, so this header is safe everywhere.
            accept: 'text/event-stream',
          },
          body: JSON.stringify({
            message: text,
            sessionId,
            language,
            portalId,
            currentRoute,
            ...(imageToSend ? { image: imageToSend } : {}),
          }),
        });

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && res.body) {
          await readEventStream(res.body, (chunk) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant') return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + chunk },
              ];
            });
          });
          // An error-only stream (gateway emitted just an `error` frame and no
          // `message_chunk`) leaves the bubble empty — the parser only honours
          // message_chunk. Surface a localized fallback so the visitor never
          // gets a silent dead reply (single language per active locale).
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant' || last.content.length > 0) {
              return prev;
            }
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content:
                  language === 'sw'
                    ? 'Samahani, hakuna jibu kwa sasa.'
                    : 'Sorry, no reply right now.',
              },
            ];
          });
        } else {
          const json = (await res.json().catch(() => null)) as
            | {
                reply?: string;
                text?: string;
                error?: string;
                blocks?: ReadonlyArray<{
                  type: string;
                  [key: string]: unknown;
                }>;
              }
            | null;
          const reply =
            json?.reply ??
            json?.text ??
            (json?.error
              ? `(${json.error})`
              : language === 'sw'
                ? 'Samahani, hakuna jibu kwa sasa.'
                : 'Sorry, no reply right now.');
          // Narrow port: AI may include inline learning blocks alongside
          // the reply. Only `concept_card` and `ui_block` are honored.
          const blocks = Array.isArray(json?.blocks)
            ? (json!.blocks.filter(
                (b) => b?.type === 'concept_card' || b?.type === 'ui_block',
              ) as unknown as LitFinMessage['blocks'])
            : undefined;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: reply,
                ...(blocks && blocks.length > 0 ? { blocks } : {}),
              },
            ];
          });
        }
      } catch (err) {
        playSound('error');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const errText = err instanceof Error ? err.message : 'unknown error';
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content:
                language === 'sw'
                  ? `Samahani, hakuna mawasiliano. (${errText})`
                  : `Sorry, no network. (${errText})`,
            },
          ];
        });
      } finally {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        });
        setIsStreaming(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [
      input,
      isStreaming,
      endpoint,
      sessionId,
      language,
      portalId,
      currentRoute,
      pendingImage,
      playSound,
    ],
  );

  // ── Pending chip prompt: send once on mount when chat is ready ────
  useEffect(() => {
    let prompt: string | null = null;
    try {
      prompt = sessionStorage.getItem(PENDING_CHIP_KEY);
      if (prompt) sessionStorage.removeItem(PENDING_CHIP_KEY);
    } catch {
      /* ignore */
    }
    if (prompt) void handleSend(prompt);
    // Intentionally run once on mount (the chip prompt is consumed once).
  }, []);

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

  const handleImageFile = useCallback(async (file: File) => {
    const img = await fileToImage(file);
    if (img) {
      setPendingImage(img);
      inputRef.current?.focus();
    }
  }, []);

  const onPickImage = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await handleImageFile(file);
      e.target.value = '';
    },
    [handleImageFile],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) void handleImageFile(file);
          return;
        }
      }
    },
    [handleImageFile],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && ACCEPTED_IMAGE_TYPES.has(file.type)) void handleImageFile(file);
    },
    [handleImageFile],
  );

  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setVoiceClarification(false);
      void handleSend(text.trim());
    },
    [handleSend],
  );

  const handleVoiceNeedsRepetition = useCallback(() => {
    setVoiceClarification(true);
    setTimeout(() => setVoiceClarification(false), 5000);
  }, []);

  const toggleAutoSpeak = useCallback(() => {
    setAutoSpeak((prev) => {
      const next = !prev;
      setAutoSpeakStorage(next);
      if (!next) ttsPortRef.current?.cancelSpeech();
      return next;
    });
  }, []);

  const clearMessages = useCallback(() => {
    ttsPortRef.current?.cancelSpeech();
    setMessages([]);
    setInput('');
    setPendingImage(null);
    spokenCountRef.current = 0;
  }, []);

  const sessionLabel = useMemo(
    () =>
      portalId === 'public'
        ? language === 'sw'
          ? 'Umma'
          : 'Public'
        : portalId.charAt(0).toUpperCase() + portalId.slice(1),
    [portalId, language],
  );

  const placeholder = isRecording
    ? t(PANEL_TEXT.placeholderRecording)
    : pendingImage
      ? t(PANEL_TEXT.placeholderImage)
      : t(PANEL_TEXT.placeholder);

  return (
    <motion.section
      data-testid="litfin-chat-panel"
      role="dialog"
      aria-label="Mr. Mwikila chat"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`fixed bottom-4 right-4 z-50 flex flex-col overflow-hidden rounded-[28px] border bg-background/92 shadow-[0_28px_80px_rgb(15_23_42_/_0.22)] ring-1 ring-border/20 backdrop-blur-2xl transition-[height,width] duration-300 ease-out motion-reduce:transition-none md:bottom-6 md:right-6 ${
        isExpanded
          ? 'h-[min(92vh,920px)] w-[min(96vw,760px)]'
          : 'h-[min(80vh,760px)] w-[min(94vw,500px)]'
      } ${isDragging ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border/50'}`}
    >
      {/* ── Drag overlay ── */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[28px] bg-primary/5 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-primary">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span className="text-sm font-medium">{t(PANEL_TEXT.dropImage)}</span>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div
        className={`relative flex items-center justify-between overflow-hidden border-b border-white/10 px-4 py-3 text-primary-foreground ${CHAT_HEADER_GRADIENT}`}
      >
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          initial={{ x: 0 }}
          animate={{ x: ['-30%', '330%'] }}
          transition={{
            duration: 5,
            repeat: Infinity,
            repeatDelay: 2,
            ease: 'easeInOut',
          }}
        />
        <div className="relative flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-foreground/15 ring-1 ring-primary-foreground/20 shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] backdrop-blur-sm">
            <BorjieMark size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">
              Mr. Mwikila
            </h3>
            <LitFinContextBadge
              currentRoute={currentRoute}
              portalId={portalId}
              language={language}
            />
          </div>
        </div>
        <div className="relative flex items-center gap-0.5">
          {/* Language toggle (site-wide via useWidgetLanguage). */}
          <ChatHeaderIconButton
            onClick={toggleLanguage}
            ariaLabel={
              language === 'sw' ? 'Switch to English' : 'Badili Kiswahili'
            }
            title={language === 'sw' ? 'EN' : 'SW'}
          >
            <span className="text-[11px] font-semibold">
              {language === 'sw' ? 'EN' : 'SW'}
            </span>
          </ChatHeaderIconButton>

          {/* Auto-speak toggle. */}
          {ttsSupported && (
            <ChatHeaderIconButton
              onClick={toggleAutoSpeak}
              active={autoSpeak}
              ariaLabel={t(PANEL_TEXT.autoSpeak)}
              title={t(PANEL_TEXT.autoSpeak)}
            >
              {autoSpeak ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              )}
            </ChatHeaderIconButton>
          )}

          {/* New conversation — confirms before wiping a live chat. */}
          <ChatHeaderIconButton
            onClick={() => {
              if (messages.some((m) => m.role === 'user')) {
                setShowNewChatConfirm(true);
              } else {
                clearMessages();
              }
            }}
            ariaLabel={t(PANEL_TEXT.newConversation)}
            title={t(PANEL_TEXT.newConversation)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </ChatHeaderIconButton>

          {/* Expand / collapse. */}
          <ChatHeaderIconButton
            onClick={() => setIsExpanded((v) => !v)}
            ariaLabel={
              isExpanded ? t(PANEL_TEXT.collapseChat) : t(PANEL_TEXT.expandChat)
            }
            title={isExpanded ? t(PANEL_TEXT.collapse) : t(PANEL_TEXT.expand)}
          >
            {isExpanded ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </ChatHeaderIconButton>

          {/* Minimize / close. */}
          <ChatHeaderIconButton
            onClick={onClose}
            ariaLabel={t(PANEL_TEXT.close)}
            title={t(PANEL_TEXT.minimize)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </ChatHeaderIconButton>
        </div>
      </div>

      <div className="px-3 pt-1">
        <LitFinSegmentHeader
          portalId={portalId}
          label={sessionLabel}
          startedAt={sessionStartedAt}
          messageCount={messages.length}
          language={language}
        />
      </div>

      {/* ── Messages ── */}
      <div
        className="flex-1 overflow-y-auto px-3 pb-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-[320px] space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <BorjieMark size={28} />
              </div>
              <p className="text-sm font-medium text-foreground">Mr. Mwikila</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(PANEL_TEXT.emptyGreeting)}
              </p>
            </div>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id}>
              <LitFinMessageBubble message={m} language={language} />
            </li>
          ))}
          {isStreaming && messages[messages.length - 1]?.role === 'user' && (
            <li>
              <TypingDots />
            </li>
          )}
        </ul>
        <div ref={messagesEndRef} />
      </div>

      {/* Pending image preview */}
      <AnimatePresence>
        {pendingImage && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1.5"
          >
            <img
              src={`data:${pendingImage.mediaType};base64,${pendingImage.data}`}
              alt={pendingImage.fileName}
              className="h-9 w-9 rounded border border-primary/20 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-primary">
                {pendingImage.fileName}
              </p>
              <p className="text-[10px] text-primary/60">
                {t(PANEL_TEXT.readyToSend)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="ml-auto shrink-0 text-primary/60 hover:text-primary"
              aria-label={t(PANEL_TEXT.removeImage)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        {/* Voice clarification — STT couldn't understand */}
        {voiceClarification && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-500">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <p className="flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              {t(PANEL_TEXT.notUnderstood)}
            </p>
          </div>
        )}

        {/* TTS speaking indicator */}
        {isSpeaking && (
          <div
            className="mb-2 flex items-center gap-2 text-primary"
            role="status"
            aria-live="polite"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-pulse">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            <span className="text-xs font-medium">{t(PANEL_TEXT.speaking)}</span>
            <button
              type="button"
              onClick={() => {
                ttsPortRef.current?.cancelSpeech();
                setIsSpeaking(false);
              }}
              className="ml-auto text-xs text-primary/70 hover:text-primary"
            >
              {t(PANEL_TEXT.stop)}
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* 5-state voice capture (mic + partial overlay + level meter). */}
          <LitFinVoiceCapture
            onTranscript={handleVoiceTranscript}
            onSendSound={() => playSound('send')}
            onNeedsRepetition={handleVoiceNeedsRepetition}
            onStateChange={setVoiceState}
            composerIsEmpty={input.trim().length === 0}
            disabled={isStreaming}
            language={language}
          />

          {/* Image attachment */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || isRecording || !!pendingImage}
            aria-label={t(PANEL_TEXT.attachImage)}
            title={t(PANEL_TEXT.attachImage)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={onPickImage}
            className="hidden"
          />

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            disabled={isStreaming || isRecording}
            rows={1}
            className="min-h-9 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isStreaming || isRecording || !input.trim()}
            aria-label={t(PANEL_TEXT.send)}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,hsl(36_86%_64%)_0%,hsl(24_78%_54%)_50%,hsl(14_62%_36%)_100%)] text-primary-foreground shadow-[0_8px_20px_-4px_hsl(24_72%_50%/0.45),0_2px_6px_hsl(14_62%_30%/0.2)] transition-all hover:scale-[1.04] hover:shadow-[0_10px_24px_-4px_hsl(24_72%_50%/0.55),0_3px_8px_hsl(14_62%_30%/0.25)] active:scale-[0.96] disabled:opacity-40 disabled:hover:scale-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={toggleLanguage}
              className="rounded-full bg-muted/60 px-2 py-0.5 font-medium text-foreground/80 underline-offset-2 transition-colors hover:bg-muted hover:underline"
            >
              {t(PANEL_TEXT.chatIn)}
            </button>
          </span>
          <span>
            {isRecording ? (
              <span className="font-medium text-red-400">
                {t(PANEL_TEXT.listening)}
              </span>
            ) : (
              t(PANEL_TEXT.micReady)
            )}
          </span>
        </div>
      </div>

      {/* ── AI compliance disclaimer ── */}
      <div
        role="note"
        aria-label="AI compliance notice"
        className="flex items-center gap-2 border-t border-border/40 bg-gradient-to-r from-gray-50/80 via-gray-50/60 to-gray-50/80 px-4 py-1.5 dark:from-white/5 dark:via-white/[0.025] dark:to-white/5"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-emerald-600/60 dark:text-emerald-400/60" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight text-muted-foreground/80">
          {language === 'sw' ? resolvedDisclaimerSw : resolvedDisclaimerEn}
        </p>
      </div>

      {/* ── New-conversation confirmation modal ── */}
      {showNewChatConfirm && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bn-new-chat-confirm-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setShowNewChatConfirm(false);
            }
          }}
        >
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 shadow-[0_24px_48px_-16px_hsl(14_62%_24%/0.45),0_8px_16px_hsl(14_50%_24%/0.18)]">
            <h2
              id="bn-new-chat-confirm-title"
              className="text-base font-semibold text-foreground"
            >
              {t(PANEL_TEXT.newConfirmTitle)}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(PANEL_TEXT.newConfirmMessage)}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setShowNewChatConfirm(false)}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/50"
              >
                {t(PANEL_TEXT.newConfirmCancel)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewChatConfirm(false);
                  clearMessages();
                }}
                className="rounded-lg bg-[linear-gradient(135deg,hsl(24_78%_54%)_0%,hsl(14_62%_30%)_100%)] px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-[0_6px_14px_-4px_hsl(14_62%_30%/0.45)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {t(PANEL_TEXT.newConfirmYes)}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}

/**
 * Parse a Borjie / BossNyumba public-chat SSE stream incrementally.
 *
 * Frame shape (one per blank-line separated record):
 *   event: <name>
 *   data: <json>
 *
 * Events we honour:
 *   - message_chunk → emit `data.text` to the bubble
 *   - turn.accepted / suggested_actions / done / error → ignored on the
 *     widget side (the bubble only cares about the running text)
 *
 * The parser also tolerates `data: <json-with-text>` frames that have no
 * `event:` line (Anthropic-style stream) and the OpenAI-style `[DONE]`
 * sentinel for forward compatibility.
 */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let currentEvent: string | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (line.length === 0) {
        currentEvent = null;
        continue;
      }
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (!data) continue;
      if (currentEvent !== null && currentEvent !== 'message_chunk') continue;
      try {
        const parsed = JSON.parse(data) as { text?: string; delta?: string };
        const text = parsed.text ?? parsed.delta ?? '';
        if (text) onChunk(text);
      } catch {
        if (currentEvent === null) onChunk(data);
      }
    }
  }
}
