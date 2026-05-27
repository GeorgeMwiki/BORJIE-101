/**
 * useUnifiedChat — the ONE hook every surface uses.
 *
 * Wraps the lower-level `useChatStream` SSE hook from `../hooks` and
 * exposes a UI-friendly `{ messages, sendMessage, isStreaming, mode,
 * switchMode, abort, … }` shape. Floating widget, expanded panel and
 * full-page surfaces all consume this same hook via
 * BorjieAIProvider context, so one conversation is shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatAttachment,
  ChatMessage,
  ChatSegment,
  PersonaId,
  RouteContext,
  SendOptions,
  SubPersona,
  UnifiedChat,
  WidgetMode,
} from './types';
import type { Language } from '../chat-modes/types';
import { useChatStream, type ChatStreamEvent } from '../hooks/useChatStream';

export interface UseUnifiedChatOptions {
  readonly endpoint?: string | undefined;
  readonly persona: PersonaId;
  readonly tenantId: string | null;
  readonly language: Language;
  readonly setLanguage: (lang: Language) => void;
  readonly route: RouteContext;
  readonly soundsEnabled: boolean;
  readonly setSoundsEnabled: (on: boolean) => void;
  readonly voiceEnabled: boolean;
  readonly setVoiceEnabled: (on: boolean) => void;
  readonly onReceive?: ((msg: ChatMessage) => void) | undefined;
}

/**
 * Bug fix A-BUG-DEEP #11: `Math.random()` is not unguessable; clients
 * observing the message-ID stream could correlate predictable IDs across
 * sessions. `crypto.randomUUID()` is available in every modern browser
 * (and Node ≥19) — fall back to a Math.random shim only in the rare
 * environments where `crypto.randomUUID` is missing.
 */
function randId(prefix: string): string {
  const cryptoApi =
    (typeof globalThis !== 'undefined' &&
      (globalThis as { crypto?: { randomUUID?: () => string } }).crypto) ||
    undefined;
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  // Fallback for unsupported runtimes; collision-safe enough for transient UI IDs.
  // eslint-disable-next-line no-restricted-syntax -- SCRUB-5f: rule-disabled because Math.random is an acceptable last-ditch fallback for transient UI ids when crypto.randomUUID is unavailable
  const fallback = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${fallback}`;
}

export function useUnifiedChat(options: UseUnifiedChatOptions): UnifiedChat {
  const {
    endpoint = '/api/v1/ai/chat',
    persona,
    tenantId,
    language,
    setLanguage,
    route,
    soundsEnabled,
    setSoundsEnabled,
    voiceEnabled,
    setVoiceEnabled,
    onReceive,
  } = options;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [segments, setSegments] = useState<readonly ChatSegment[]>([]);
  const [mode, setMode] = useState<WidgetMode>('collapsed');
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionId] = useState<string>(() => randId('sess'));

  const activeMwikilaIdRef = useRef<string | null>(null);
  const modeRef = useRef<WidgetMode>('collapsed');
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const extraBody = useMemo(
    () => ({
      language,
      sessionId,
      routeContext: route,
    }),
    [language, sessionId, route],
  );

  const headers = useMemo<Record<string, string>>(
    () => {
      const h: Record<string, string> = {};
      if (tenantId) h['x-tenant-id'] = tenantId;
      return h;
    },
    [tenantId],
  );

  const onEvent = useCallback(
    (event: ChatStreamEvent) => {
      const activeId = activeMwikilaIdRef.current;
      if (!activeId) return;
      if (event.type === 'delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === activeId ? { ...m, text: m.text + event.content, isStreaming: true } : m,
          ),
        );
      } else if (event.type === 'turn_end' || event.type === 'error') {
        setMessages((prev) => {
          const next = prev.map((m) => (m.id === activeId ? { ...m, isStreaming: false } : m));
          const finalised = next.find((m) => m.id === activeId);
          if (finalised && onReceive) onReceive(finalised);
          return next;
        });
        if (modeRef.current === 'collapsed') {
          setUnreadCount((n) => n + 1);
        }
        activeMwikilaIdRef.current = null;
      }
    },
    [onReceive],
  );

  const stream = useChatStream(persona, {
    endpoint,
    headers,
    extraBody,
    onEvent,
  });

  const sendMessage = useCallback(
    async (text: string, opts?: SendOptions) => {
      if (!text.trim() || stream.state.isStreaming) return;

      const userMsg: ChatMessage = {
        id: randId('u'),
        role: 'user',
        text,
        language,
        createdAt: new Date().toISOString(),
        attachments: opts?.attachments,
      };
      const mwikilaMsgId = randId('m');
      const mwikilaMsg: ChatMessage = {
        id: mwikilaMsgId,
        role: 'mwikila',
        text: '',
        language,
        createdAt: new Date().toISOString(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, userMsg, mwikilaMsg]);
      activeMwikilaIdRef.current = mwikilaMsgId;

      await stream.sendMessage(text, { subPersonaId: route.activeSubPersona });
    },
    [language, route.activeSubPersona, stream],
  );

  const switchMode = useCallback((next: WidgetMode) => {
    setMode(next);
    if (next !== 'collapsed') setUnreadCount(0);
  }, []);

  const abort = useCallback(() => {
    stream.cancel();
    activeMwikilaIdRef.current = null;
  }, [stream]);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled(!voiceEnabled);
  }, [setVoiceEnabled, voiceEnabled]);

  const toggleSounds = useCallback(() => {
    setSoundsEnabled(!soundsEnabled);
  }, [setSoundsEnabled, soundsEnabled]);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  const startSegment = useCallback((label: string, subPersona: SubPersona) => {
    setSegments((prev) => [
      ...prev,
      { id: randId('seg'), label, startedAt: new Date().toISOString(), subPersona },
    ]);
  }, []);

  return {
    messages,
    segments,
    mode,
    isStreaming: stream.state.isStreaming,
    unreadCount,
    language,
    persona,
    route,
    voiceEnabled,
    soundsEnabled,
    error: stream.state.error,
    sessionId,
    tenantId,
    sendMessage,
    switchMode,
    abort,
    setLanguage,
    toggleVoice,
    toggleSounds,
    clearUnread,
    startSegment,
  };
}

export function buildAttachment(file: File): ChatAttachment {
  return {
    id: randId('att'),
    kind: file.type.startsWith('image/') ? 'image' : 'document',
    name: file.name,
    size: file.size,
    previewUrl:
      file.type.startsWith('image/') && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : undefined,
  };
}
