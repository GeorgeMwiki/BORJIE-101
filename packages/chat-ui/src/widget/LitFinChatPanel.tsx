'use client';

/**
 * Borjie AI Chat Panel — carbon copy of LitFin's ChatPanel, Borjie-skinned.
 *
 * The expanded chat interface for the floating widget. Renders:
 *   - Gradient header (Logomark + persona + ContextBadge + EN/SW + close)
 *   - Session strip ("Public · 12:45 PM · 2 msgs")
 *   - Message list with LitFin-style bubbles
 *   - Composer (mic + image upload + textarea + send)
 *   - "Chat in English" pill + "Mic ready" status
 *   - Disclaimer footer
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/ChatPanel.tsx
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ChangeEvent,
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
import { LitFinMessageBubble, type LitFinMessage } from './LitFinMessageBubble';
import { LitFinSegmentHeader } from './LitFinSegmentHeader';
import { LitFinContextBadge } from './LitFinContextBadge';

interface LitFinChatPanelProps {
  readonly onClose: () => void;
}

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
      resolve({
        data: base64,
        mediaType: file.type,
        fileName: file.name,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function LitFinChatPanel({ onClose }: LitFinChatPanelProps): JSX.Element {
  const { portalId, currentRoute, endpoint } = useLitFinAI();
  const { language, toggleLanguage } = useWidgetLanguage();

  const [messages, setMessages] = useState<ReadonlyArray<LitFinMessage>>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [sessionId] = useState(() => makeId('bn-sess'));
  const [sessionStartedAt] = useState(() => new Date().toISOString());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((res) =>
        setIsMicReady(res.state === 'granted' || res.state === 'prompt'),
      )
      .catch(() => setIsMicReady(false));
  }, []);

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || isStreaming) return;

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
      setPendingImage(null);
      setIsStreaming(true);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: text,
            sessionId,
            language,
            portalId,
            currentRoute,
            ...(pendingImage ? { image: pendingImage } : {}),
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
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const errText =
            err instanceof Error ? err.message : 'unknown error';
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
    ],
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

  const onPickImage = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    const img = await fileToImage(file);
    if (img) setPendingImage(img);
    e.target.value = '';
  }, []);

  const toggleMic = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const Recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Recognition) return;
    if (isRecording) {
      const rec = recognitionRef.current as { stop?: () => void } | null;
      rec?.stop?.();
      setIsRecording(false);
      return;
    }
    const rec = new Recognition() as {
      lang: string;
      interimResults: boolean;
      onresult: (e: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = language === 'sw' ? 'sw-TZ' : 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const transcript = last?.[0]?.transcript ?? '';
      if (transcript)
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }, [isRecording, language]);

  const sessionLabel = useMemo(
    () =>
      portalId === 'public'
        ? language === 'sw'
          ? 'Umma'
          : 'Public'
        : portalId.charAt(0).toUpperCase() + portalId.slice(1),
    [portalId, language],
  );

  return (
    <motion.section
      data-testid="litfin-chat-panel"
      role="dialog"
      aria-label="Mr. Mwikila chat"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="fixed bottom-4 right-4 z-50 flex h-[min(78vh,720px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-[28px] border border-border/50 bg-background/92 shadow-[0_28px_80px_rgb(15_23_42_/_0.22)] ring-1 ring-border/20 backdrop-blur-2xl md:bottom-6 md:right-6"
    >
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
        <div className="relative flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-foreground/15 ring-1 ring-primary-foreground/20 shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] backdrop-blur-sm">
            <BorjieMark size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">
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
          <ChatHeaderIconButton
            onClick={onClose}
            ariaLabel="Close chat"
            title="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
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

      <div
        className="flex-1 overflow-y-auto px-3 pb-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 && (
          <div className="px-2 pt-4 text-sm text-muted-foreground">
            {language === 'sw'
              ? 'Habari, niulize chochote kuhusu mali zako.'
              : 'Hi, ask me anything about your portfolio.'}
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

      <AnimatePresence>
        {pendingImage && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-2 py-1.5 text-[11px]"
          >
            <span className="truncate">{pendingImage.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="ml-auto text-muted-foreground hover:text-foreground"
              aria-label="Remove image"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleMic}
            disabled={isStreaming}
            title={language === 'sw' ? 'Bofya kuongea' : 'Tap to talk'}
            aria-label={
              isRecording
                ? 'Stop recording'
                : language === 'sw'
                  ? 'Bofya kuongea'
                  : 'Tap to talk'
            }
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
              isRecording
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
          >
            {isRecording ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            aria-label={language === 'sw' ? 'Pakia picha' : 'Upload image'}
            title={language === 'sw' ? 'Pakia picha' : 'Upload image'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPickImage}
            className="hidden"
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              language === 'sw'
                ? 'Uliza Mr. Mwikila chochote...'
                : 'Ask Mr. Mwikila anything...'
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isStreaming || !input.trim()}
            aria-label="Send"
            className="relative flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground transition-all hover:scale-[1.04] active:scale-[0.96] disabled:opacity-40 disabled:hover:scale-100 bg-[linear-gradient(135deg,hsl(36_86%_64%)_0%,hsl(24_78%_54%)_50%,hsl(14_62%_36%)_100%)] shadow-[0_8px_20px_-4px_hsl(24_72%_50%/0.45),0_2px_6px_hsl(14_62%_30%/0.2)] hover:shadow-[0_10px_24px_-4px_hsl(24_72%_50%/0.55),0_3px_8px_hsl(14_62%_30%/0.25)]"
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
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5">
            {language === 'sw' ? 'Zungumza kwa Kiswahili' : 'Chat in English'}
          </span>
          <span>
            {isMicReady
              ? language === 'sw'
                ? 'Mic tayari'
                : 'Mic ready'
              : language === 'sw'
                ? 'Mic haipatikani'
                : 'Mic unavailable'}
          </span>
        </div>
      </div>

      <div
        role="note"
        aria-label="AI compliance notice"
        className="flex items-center gap-2 border-t border-border/40 px-4 py-1.5 bg-gradient-to-r from-gray-50/80 via-gray-50/60 to-gray-50/80 dark:from-white/5 dark:via-white/[0.025] dark:to-white/5"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-emerald-600/60 dark:text-emerald-400/60"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight text-muted-foreground/80">
          {language === 'sw'
            ? 'AI-iliyotengenezwa . Si ushauri wa kisheria . Maamuzi yanafanywa na mmiliki'
            : 'AI-generated. Not legal advice. Decisions are made by the landlord.'}
        </p>
      </div>
    </motion.section>
  );
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as { text?: string; delta?: string };
        const text = parsed.text ?? parsed.delta ?? '';
        if (text) onChunk(text);
      } catch {
        onChunk(data);
      }
    }
  }
}
