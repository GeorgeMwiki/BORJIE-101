"use client";

/**
 * CommandChat — generic React shell consuming the `command-chat` SSE
 * protocol defined in `./protocol.ts`.
 *
 * Closes Carboni Open Item #2 from `Docs/CARBONI-SYNC-COMPLETE.md`:
 *
 *   > Build the `CommandChat.tsx` + components that consume the
 *   > wave-10 SSE protocol. Reference Carboni's
 *   > `src/features/command-chat/CommandChat.tsx` for the contract.
 *
 * Pre-this: the wave-10 brain-side plumbing (`protocol.ts`,
 * `tool-policy.ts`, `parked-calls.ts`, `realtime-notification.ts`)
 * landed in May, but no consumer existed. `MDChatShell` ships its own
 * MdEvent protocol for the central-command surface; this component
 * exists for any OTHER surface that wants the generic command-chat
 * stream (e.g. an officer-facing tool surface, an internal admin
 * console, a developer playground).
 *
 * Design constraints:
 *   - Framework-light: no chat-library dep, just `useState` + `fetch`
 *   - Sink-pattern: every event flows through one switch so adding
 *     a new event kind requires touching exactly one place
 *   - Generative-UI events route to `renderSpec` from the registry
 *     so the host page doesn't have to wire renderers
 *   - Confirm-needed events surface inline; the parent provides the
 *     handler (POST to /confirm/[toolCallId] is owned by the host)
 *
 * @module features/command-chat/CommandChat
 */

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { parseSseEvent, type CommandChatEvent } from "./protocol";
import { renderSpec } from "@/core/brain/generative-ui";

export interface CommandChatProps {
  /** SSE endpoint URL. POST a JSON body `{ message: string, sessionId: string }`. */
  readonly endpointUrl: string;
  /** Stable session id (server uses this to scope parked-calls etc). */
  readonly sessionId: string;
  /** Optional greeting line shown above the input on mount. */
  readonly greeting?: string;
  /**
   * Called when a tool emits `confirm-needed`. The host decides UI
   * (modal, inline button) — we surface the call and the host posts
   * to /confirm/[toolCallId] when the user approves.
   */
  readonly onConfirmNeeded?: (event: ConfirmNeededState) => void;
  /**
   * Called once per finished turn with the `done` event summary.
   * Lets the host log per-turn metrics.
   */
  readonly onTurnComplete?: (summary: TurnSummary) => void;
}

export interface ConfirmNeededState {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly tier: "write" | "destructive" | "sovereign";
  readonly argsPreview: Record<string, unknown>;
  readonly expiresInSec: number;
}

export interface TurnSummary {
  readonly turnsUsed: number;
  readonly toolCallsExecuted: number;
  readonly parked: number;
  readonly traceId?: string;
}

interface MessageState {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly tier: string;
    readonly status: "running" | "ok" | "error" | "awaiting-confirm";
    readonly resultPreview?: string;
  }>;
  readonly generativeUi: ReadonlyArray<{
    readonly toolCallId: string;
    readonly spec: { readonly type: string; readonly [k: string]: unknown };
  }>;
  readonly traceId?: string;
}

// ============================================================================
// Component
// ============================================================================

export function CommandChat({
  endpointUrl,
  sessionId,
  greeting,
  onConfirmNeeded,
  onTurnComplete,
}: CommandChatProps): ReactNode {
  const [messages, setMessages] = useState<ReadonlyArray<MessageState>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      setStreaming(true);
      setError(null);

      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          text,
          toolCalls: [],
          generativeUi: [],
        },
        {
          id: assistantId,
          role: "assistant",
          text: "",
          toolCalls: [],
          generativeUi: [],
        },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Read SSE chunks, parse one event per `\n\n`-separated block.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          let frameEnd = buffer.indexOf("\n\n");
          while (frameEnd !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            const event = parseSseEvent(frame);
            if (event !== null) {
              applyEvent(event, assistantId, setMessages, {
                onConfirmNeeded,
                onTurnComplete,
              });
            }
            frameEnd = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [endpointUrl, sessionId, streaming, onConfirmNeeded, onTurnComplete],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      setInput("");
      void sendMessage(trimmed);
    },
    [input, sendMessage],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <section
      aria-label="Command chat"
      className="flex h-full flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {greeting && messages.length === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {greeting}
        </p>
      ) : null}

      <div
        className="flex-1 space-y-3 overflow-y-auto"
        data-testid="command-chat-thread"
      >
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label htmlFor="command-chat-input" className="sr-only">
          Message
        </label>
        <input
          id="command-chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything..."
          disabled={streaming}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
        />
        {streaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-400"
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}

// ============================================================================
// Per-event apply (pure-ish — mutates via the React setter)
// ============================================================================

interface ApplyContext {
  readonly onConfirmNeeded?: (event: ConfirmNeededState) => void;
  readonly onTurnComplete?: (summary: TurnSummary) => void;
}

function applyEvent(
  event: CommandChatEvent,
  assistantId: string,
  setMessages: (
    fn: (prev: ReadonlyArray<MessageState>) => ReadonlyArray<MessageState>,
  ) => void,
  ctx: ApplyContext,
): void {
  switch (event.event) {
    case "token":
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: m.text + event.data.content }
            : m,
        ),
      );
      break;

    case "tool-call":
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          return {
            ...m,
            toolCalls: [
              ...m.toolCalls,
              {
                id: event.data.toolCallId,
                name: event.data.toolName,
                tier: event.data.tier,
                status: "running",
              },
            ],
          };
        }),
      );
      break;

    case "tool-result":
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === event.data.toolCallId
                ? {
                    ...tc,
                    status: event.data.ok ? "ok" : "error",
                    resultPreview: event.data.ok
                      ? safeStringify(event.data.result).slice(0, 200)
                      : event.data.errorMessage,
                  }
                : tc,
            ),
          };
        }),
      );
      break;

    case "generative-ui":
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                generativeUi: [
                  ...m.generativeUi,
                  {
                    toolCallId: event.data.toolCallId,
                    spec: event.data.spec,
                  },
                ],
              }
            : m,
        ),
      );
      break;

    case "confirm-needed":
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                toolCalls: m.toolCalls.map((tc) =>
                  tc.id === event.data.toolCallId
                    ? { ...tc, status: "awaiting-confirm" }
                    : tc,
                ),
              }
            : m,
        ),
      );
      ctx.onConfirmNeeded?.({
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        tier: event.data.tier,
        argsPreview: event.data.argsPreview,
        expiresInSec: event.data.expiresInSec,
      });
      break;

    case "decision-trace":
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, traceId: event.data.traceId } : m,
        ),
      );
      break;

    case "done":
      ctx.onTurnComplete?.({
        turnsUsed: event.data.turnsUsed,
        toolCallsExecuted: event.data.toolCallsExecuted,
        parked: event.data.parked,
      });
      break;

    case "error":
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: m.text + `\n\n[error] ${event.data.error}` }
            : m,
        ),
      );
      break;

    // MD events + realtime-notification are not surfaced in this
    // generic shell — they're MDChatShell territory. Silently ignore.
    case "realtime-notification":
    case "md.observation":
    case "md.assessment":
    case "md.proposal":
    case "md.action":
    case "md.follow-up":
    case "md.style-update":
      break;
  }
}

function safeStringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function MessageRow({ message }: { message: MessageState }): ReactNode {
  const isUser = message.role === "user";
  return (
    <div
      data-testid={`command-chat-${message.role}-message`}
      className={
        isUser
          ? "rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-900"
          : "rounded-md bg-white px-3 py-2 text-sm text-slate-800"
      }
    >
      {message.text ? (
        <p className="whitespace-pre-wrap">{message.text}</p>
      ) : !isUser && message.toolCalls.length === 0 ? (
        <p className="text-xs italic text-slate-400">Thinking…</p>
      ) : null}

      {message.toolCalls.length > 0 ? (
        <ul
          className="mt-2 space-y-1 text-xs"
          aria-label="Tool calls"
          data-testid="command-chat-tool-calls"
        >
          {message.toolCalls.map((tc) => (
            <li
              key={tc.id}
              className="flex items-center gap-2"
              data-testid={`command-chat-tool-call-${tc.status}`}
            >
              <span className="font-mono text-slate-600">{tc.name}</span>
              <span
                className={
                  tc.status === "ok"
                    ? "rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
                    : tc.status === "error"
                      ? "rounded bg-red-50 px-1.5 py-0.5 text-red-700"
                      : tc.status === "awaiting-confirm"
                        ? "rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                        : "rounded bg-slate-50 px-1.5 py-0.5 text-slate-600"
                }
              >
                {tc.status}
              </span>
              {tc.tier && tc.tier !== "read" ? (
                <span className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-500">
                  {tc.tier}
                </span>
              ) : null}
              {tc.resultPreview ? (
                <span className="truncate text-slate-500">
                  {tc.resultPreview}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {message.generativeUi.length > 0 ? (
        <div
          className="mt-3 space-y-3"
          data-testid="command-chat-generative-ui"
        >
          {message.generativeUi.map((g) => (
            <div key={g.toolCallId}>{renderSpec(g.spec)}</div>
          ))}
        </div>
      ) : null}

      {message.traceId ? (
        <p
          className="mt-2 font-mono text-[10px] text-slate-400"
          data-testid="command-chat-trace-id"
        >
          trace: {message.traceId}
        </p>
      ) : null}
    </div>
  );
}
