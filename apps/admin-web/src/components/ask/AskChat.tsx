'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Sparkles, RotateCcw } from 'lucide-react';

import { readSseStream, type SseEvent } from '@/lib/sse';
import { getCsrfHeaders } from '@/lib/csrf';
import {
  DEFAULT_SLICE,
  SliceSelector,
  formatSliceHint,
  type SliceState,
} from '@/components/ask/SliceSelector';

/**
 * AskChat — the industry-observer conversation surface.
 *
 * Copy is in observer/plural voice only. Chat bubbles lean institutional:
 * Fraunces for the hero / assistant openers, Geist for the body. Every
 * assistant claim is grounded in DP-aggregated platform data, so the
 * placeholder text quietly reminds the operator the slice is auditable.
 *
 * The transport is `fetch()` + `ReadableStream` (EventSource cannot POST).
 * All state updates are immutable — messages and artifacts are replaced,
 * never mutated in place.
 */

interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: number;
  readonly streaming?: boolean;
}

interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly payload: unknown;
}

type Failure =
  | { readonly kind: 'none' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'budget-exhausted'; readonly resetLabel?: string }
  | { readonly kind: 'unexpected'; readonly status: number };

interface AskChatProps {
  readonly threadId: string | null;
  readonly initialMessages?: ReadonlyArray<ChatMessage>;
  readonly initialArtifacts?: ReadonlyArray<Artifact>;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
}

async function extractFailure(res: Response): Promise<Failure> {
  if (res.status === 401) {
    return { kind: 'forbidden' };
  }
  if (res.status === 503) {
    return { kind: 'offline' };
  }
  if (res.status === 403) {
    try {
      const body = (await res.json()) as {
        readonly code?: string;
        readonly resetLabel?: string;
      };
      if (body.code === 'PLATFORM_BUDGET_EXHAUSTED') {
        return { kind: 'budget-exhausted', resetLabel: body.resetLabel };
      }
    } catch {
      /* fall through */
    }
    return { kind: 'forbidden' };
  }
  return { kind: 'unexpected', status: res.status };
}

export function AskChat({
  threadId: initialThreadId,
  initialMessages = [],
  initialArtifacts = [],
}: AskChatProps) {
  const router = useRouter();
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>(initialMessages);
  const [artifacts, setArtifacts] = useState<ReadonlyArray<Artifact>>(initialArtifacts);
  const [input, setInput] = useState('');
  const [slice, setSlice] = useState<SliceState>(DEFAULT_SLICE);
  const [extendedThinking, setExtendedThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure>({ kind: 'none' });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  const canSend = useMemo(
    () => input.trim().length > 0 && !sending,
    [input, sending],
  );

  const dispatchEvent = useCallback(
    (streamingId: string, event: SseEvent) => {
      if (event.event === 'assistant.delta') {
        try {
          const { text } = JSON.parse(event.data) as { text?: string };
          if (typeof text === 'string' && text.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingId ? { ...m, text: m.text + text } : m,
              ),
            );
          }
        } catch (error) {
          console.error('assistant.delta parse failed:', error);
        }
        return;
      }
      if (event.event === 'assistant.complete') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId ? { ...m, streaming: false } : m,
          ),
        );
        return;
      }
      if (event.event === 'artifact') {
        try {
          const artifact = JSON.parse(event.data) as Artifact;
          setArtifacts((prev) => [...prev, artifact]);
        } catch (error) {
          console.error('artifact parse failed:', error);
        }
        return;
      }
      if (event.event === 'error') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId
              ? {
                  ...m,
                  text:
                    m.text +
                    '\n\n[Stream error — the industry voice dropped. Retry.]',
                  streaming: false,
                }
              : m,
          ),
        );
      }
    },
    [],
  );

  const send = useCallback(async () => {
    if (!canSend) return;
    const trimmed = input.trim();
    const hint = formatSliceHint(slice);
    const body = `${trimmed}\n\n${hint}`;

    setSending(true);
    setFailure({ kind: 'none' });

    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      text: body,
      createdAt: Date.now(),
    };
    const streamingId = newId();
    const assistantPlaceholder: ChatMessage = {
      id: streamingId,
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      streaming: true,
    };
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput('');

    let activeThreadId = threadId;

    try {
      if (!activeThreadId) {
        const createRes = await fetch('/api/platform/intelligence/thread', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
          body: JSON.stringify({
            scope: 'platform',
            persona: 'industry-observer',
          }),
        });
        if (!createRes.ok) {
          setFailure(await extractFailure(createRes));
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          return;
        }
        const created = (await createRes.json()) as { readonly id?: string };
        if (!created.id) {
          setFailure({ kind: 'unexpected', status: 200 });
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          return;
        }
        activeThreadId = created.id;
        setThreadId(activeThreadId);
        router.replace(`/ask/${activeThreadId}`);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(
        `/api/platform/intelligence/thread/${activeThreadId}/message`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
          body: JSON.stringify({
            scope: 'platform',
            persona: 'industry-observer',
            message: body,
            extendedThinking,
            slice,
          }),
        },
      );

      if (!resp.ok || !resp.body) {
        setFailure(await extractFailure(resp));
        setMessages((prev) => prev.filter((m) => m.id !== streamingId));
        return;
      }

      await readSseStream(
        resp.body,
        (event) => dispatchEvent(streamingId, event),
        controller.signal,
      );
    } catch (error) {
      console.error('Industry stream failed:', error);
      setFailure({ kind: 'offline' });
      setMessages((prev) => prev.filter((m) => m.id !== streamingId));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [canSend, dispatchEvent, extendedThinking, input, router, slice, threadId]);

  const retry = useCallback(() => {
    setFailure({ kind: 'none' });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8 py-10"
      >
        {messages.length === 0 ? <EmptyState /> : null}

        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {failure.kind === 'offline' ? (
            <FailureBanner
              title="The industry voice is offline."
              body="The intelligence service returned 503. No mock response will be rendered."
              action={{ label: 'Retry', onClick: retry }}
            />
          ) : null}

          {failure.kind === 'forbidden' ? (
            <FailureBanner
              title="This conversation is platform-only."
              body="You need PLATFORM_ADMIN to query the industry observer."
            />
          ) : null}

          {failure.kind === 'budget-exhausted' ? (
            <FailureBanner
              title="We've spent this month's privacy budget."
              body={
                failure.resetLabel
                  ? `Next reset: ${failure.resetLabel}.`
                  : 'The DP-accountant will publish the next reset window shortly.'
              }
            />
          ) : null}

          {failure.kind === 'unexpected' ? (
            <FailureBanner
              title="Unexpected response from the industry voice."
              body={`Upstream returned ${failure.status}. No answer rendered — this is deliberate.`}
              action={{ label: 'Retry', onClick: retry }}
            />
          ) : null}
        </div>
      </div>

      <Composer
        input={input}
        setInput={setInput}
        slice={slice}
        setSlice={setSlice}
        extendedThinking={extendedThinking}
        setExtendedThinking={setExtendedThinking}
        canSend={canSend}
        sending={sending}
        onSend={send}
        artifactCount={artifacts.length}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl text-center py-20">
      <h2 className="font-display text-4xl text-foreground mb-4 leading-tight">
        The network has not spoken with you today.
      </h2>
      <p className="text-sm text-neutral-400 leading-relaxed">
        Ask across every tenant at once. Try:{' '}
        <span className="text-foreground">
          &ldquo;Where is vendor reopen rate degrading?&rdquo;
        </span>{' '}
        or{' '}
        <span className="text-foreground">
          &ldquo;Which jurisdictions are drifting toward tighter compliance?&rdquo;
        </span>
      </p>
      <p className="mt-4 text-xs text-neutral-500">
        Privacy is preserved — you will never see a single tenant&rsquo;s name.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { readonly message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-2xl rounded-lg border border-signal-500/20 bg-surface px-5 py-4">
        <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-signal-500">
          <Sparkles className="h-3 w-3" />
          Industry observer
        </div>
        <div className="font-display text-base text-foreground whitespace-pre-wrap leading-relaxed">
          {message.text || (message.streaming ? 'Listening across the network…' : '')}
        </div>
      </div>
    </div>
  );
}

function FailureBanner({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-subtle/20 px-5 py-4">
      <div className="text-sm font-medium text-warning mb-1">{title}</div>
      <div className="text-xs text-neutral-400">{body}</div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 text-xs text-foreground hover:border-signal-500/40"
        >
          <RotateCcw className="h-3 w-3" />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  readonly input: string;
  readonly setInput: (v: string) => void;
  readonly slice: SliceState;
  readonly setSlice: (s: SliceState) => void;
  readonly extendedThinking: boolean;
  readonly setExtendedThinking: (v: boolean) => void;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly artifactCount: number;
}

function Composer({
  input,
  setInput,
  slice,
  setSlice,
  extendedThinking,
  setExtendedThinking,
  canSend,
  sending,
  onSend,
  artifactCount,
}: ComposerProps) {
  return (
    <div className="border-t border-border bg-surface-sunken px-6 py-4">
      <div className="mx-auto max-w-3xl space-y-3">
        <SliceSelector slice={slice} onChange={setSlice} disabled={sending} />

        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Ask the network about aggregate patterns…"
            rows={2}
            disabled={sending}
            className="flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:border-signal-500/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-sm text-signal-500 hover:bg-signal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
            Ask
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-neutral-500">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={extendedThinking}
              onChange={(e) => setExtendedThinking(e.target.checked)}
              disabled={sending}
              className="rounded border-border bg-surface"
            />
            Extended thinking
          </label>
          <span>
            {artifactCount > 0
              ? `${artifactCount} artifact${artifactCount === 1 ? '' : 's'} in this thread`
              : 'No artifacts yet in this thread'}
          </span>
        </div>
      </div>
    </div>
  );
}
