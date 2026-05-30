"use client";

/**
 * MDChatShell — owner-facing chat surface.
 *
 * The single page the owner uses to operate the business. The owner types
 * in plain language; the MD orchestrator streams a sequence of typed
 * events back over SSE (observations, assessments, proposals, actions,
 * follow-ups, inline data). Each event renders in-place — the owner
 * never has to leave this surface.
 *
 * This component is intentionally framework-light: no chat-library
 * dependency, just `useState` + `fetch` against the SSE route. That
 * keeps it portable across both Kaboni and Borjie and easy to test in
 * isolation.
 *
 * @module features/central-command/md/ui/MDChatShell
 */

import { useCallback, useRef, useState, type FormEvent } from "react";

import type { MdEvent } from "@/features/central-command/md/core/types";

export interface MDChatShellProps {
  readonly orgId: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly endpointUrl?: string;
  readonly greeting?: string;
}

interface ChatTurn {
  readonly id: string;
  readonly role: "owner" | "md";
  readonly text: string;
  readonly events?: ReadonlyArray<MdEvent>;
}

const DEFAULT_ENDPOINT = "/api/central-command/md/chat";

export function MDChatShell({
  orgId,
  ownerId,
  sessionId,
  endpointUrl = DEFAULT_ENDPOINT,
  greeting = "What should we work on today?",
}: MDChatShellProps): JSX.Element {
  const [turns, setTurns] = useState<ReadonlyArray<ChatTurn>>([
    Object.freeze({
      id: "md-greeting",
      role: "md" as const,
      text: greeting,
    }),
  ]);
  const [draft, setDraft] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || pending) return;

      const ownerTurn: ChatTurn = Object.freeze({
        id: `owner-${Date.now()}`,
        role: "owner" as const,
        text,
      });
      setTurns((prev) => [...prev, ownerTurn]);
      setDraft("");
      setPending(true);

      try {
        const correlationId = `corr-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

        const res = await fetch(endpointUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            ownerId,
            sessionId,
            correlationId,
            ownerMessage: text,
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "stream unavailable");
          setTurns((prev) => [
            ...prev,
            Object.freeze({
              id: `md-err-${Date.now()}`,
              role: "md" as const,
              text: `Sorry — I couldn't process that. (${detail.slice(0, 200)})`,
            }),
          ]);
          return;
        }

        const events: MdEvent[] = [];
        let assistantText = "";

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // SSE parse loop. Each event is `data: {json}\n\n`.
        // The terminating `data: [DONE]` signals the end of stream.
        // Anything else is a typed MdEvent.
        // We tolerate partial chunks and re-buffer.
        // eslint-disable-next-line no-constant-condition -- intentional SSE drain loop; exits on `done` from reader
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") break;
            try {
              const event = JSON.parse(payload) as MdEvent;
              events.push(event);
              // `md.assistant_text` is the route-side composed reply; the
              // discriminated union narrows `event.text` cleanly so we no
              // longer need an unchecked cast.
              if (event.kind === "md.assistant_text") {
                assistantText += event.text;
              }
            } catch {
              // Tolerate non-JSON keep-alive frames.
            }
          }
        }

        setTurns((prev) => [
          ...prev,
          Object.freeze({
            id: `md-${Date.now()}`,
            role: "md" as const,
            text: assistantText || "(no response)",
            events: Object.freeze(events),
          }),
        ]);
      } catch (err) {
        setTurns((prev) => [
          ...prev,
          Object.freeze({
            id: `md-err-${Date.now()}`,
            role: "md" as const,
            text: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
          }),
        ]);
      } finally {
        setPending(false);
        inputRef.current?.focus();
      }
    },
    [draft, endpointUrl, orgId, ownerId, pending, sessionId],
  );

  return (
    <div
      className="flex h-full min-h-[600px] flex-col rounded-xl border bg-card text-card-foreground shadow-sm"
      data-testid="md-chat-shell"
    >
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {turns.map((turn) => (
          <article
            key={turn.id}
            data-role={turn.role}
            className={
              turn.role === "owner"
                ? "ml-auto max-w-[80%] rounded-lg bg-primary/10 px-4 py-3 text-sm"
                : "mr-auto max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm"
            }
          >
            <header className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {turn.role === "owner" ? "You" : "MD"}
            </header>
            <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
            {turn.events && turn.events.length > 0 ? (
              <div className="mt-3 space-y-2" data-testid="md-event-stream">
                {turn.events.map((event, idx) => (
                  <MDEventRenderer key={idx} event={event} />
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {pending ? (
          <div
            role="status"
            aria-live="polite"
            className="mr-auto max-w-[60%] rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground"
          >
            <span className="inline-block animate-pulse">MD is thinking…</span>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t p-4"
        data-testid="md-chat-input-form"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask, instruct, or share an update. The MD handles the rest."
          rows={2}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Message to the MD"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind event renderers — each MdEvent kind gets a styled card so the
// owner can scan observations, proposals, follow-ups, style updates and
// queued actions without leaving the chat surface.
// ---------------------------------------------------------------------------

function formatDueAt(ms: number): string {
  const now = Date.now();
  const diffMs = ms - now;
  const day = 86_400_000;
  if (diffMs < 0) return "overdue";
  if (diffMs < day)
    return `due in ${Math.max(1, Math.round(diffMs / 3_600_000))}h`;
  return `due in ${Math.round(diffMs / day)}d`;
}

/**
 * Per-MdEvent renderer. Uses the discriminated union directly (no
 * casts), so a misshapen event triggers a TypeScript error rather
 * than rendering an empty card. H-4 + H-5 fix.
 */
function MDEventRenderer({ event }: { event: MdEvent }): JSX.Element | null {
  switch (event.kind) {
    case "md.observation": {
      const cls =
        event.severity === "urgent"
          ? "border-rose-300 bg-rose-50 text-rose-900"
          : event.severity === "concern"
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : event.severity === "watch"
              ? "border-yellow-200 bg-yellow-50 text-yellow-900"
              : "border-slate-200 bg-slate-50 text-slate-900";
      return (
        <section
          role="note"
          className={`rounded-md border px-3 py-2 text-xs ${cls}`}
          data-testid="md-event-observation"
          data-severity={event.severity}
        >
          <header className="font-semibold uppercase tracking-wider text-[10px]">
            Observation · {event.severity}
          </header>
          <p className="mt-1">{event.summary}</p>
          {event.citations.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-[10px] opacity-80">
              {event.citations.map((c, i) => (
                <li key={i}>
                  <span className="font-mono">{c.field}</span>
                  {c.valueSummary ? ` → ${c.valueSummary}` : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );
    }
    case "md.assessment":
      return (
        <section
          role="note"
          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900"
          data-testid="md-event-assessment"
        >
          <header className="flex items-center justify-between font-semibold uppercase tracking-wider text-[10px]">
            <span>Assessment · {event.framework}</span>
            {typeof event.score === "number" ? (
              <span className="font-mono">
                {event.score.toFixed(0)}
                <span className="opacity-60">/100</span>
              </span>
            ) : null}
          </header>
          <p className="mt-1">{event.summary}</p>
        </section>
      );
    case "md.proposal":
      return (
        <section
          role="article"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
          data-testid="md-event-proposal"
          data-autonomy={event.autonomyLevel}
        >
          <header className="flex items-center justify-between font-semibold uppercase tracking-wider text-[10px]">
            <span>Proposal</span>
            <span className="font-mono opacity-70">{event.autonomyLevel}</span>
          </header>
          <p className="mt-1 font-medium">{event.title}</p>
          <p className="mt-1 opacity-90">{event.rationale}</p>
          {event.requiresApproval ? (
            <p className="mt-2 text-[10px] uppercase tracking-wider opacity-70">
              ⚑ requires approval before execution
            </p>
          ) : null}
        </section>
      );
    case "md.action":
      return (
        <section
          role="status"
          className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-900"
          data-testid="md-event-action"
          data-status={event.status}
        >
          <header className="font-semibold uppercase tracking-wider text-[10px]">
            Action · {event.status}
          </header>
          <p className="mt-1 font-medium">{event.title}</p>
          <p className="mt-1 opacity-90">{event.summary}</p>
          {event.approvalId ? (
            <p className="mt-1 font-mono text-[10px] opacity-70">
              approval: {event.approvalId}
            </p>
          ) : null}
        </section>
      );
    case "md.follow-up": {
      const dueAt = formatDueAt(event.dueAtMs);
      return (
        <section
          role="note"
          className="flex items-center justify-between rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900"
          data-testid="md-event-follow-up"
        >
          <div>
            <header className="font-semibold uppercase tracking-wider text-[10px]">
              Follow-up
            </header>
            <p className="mt-1">{event.title}</p>
            {event.sourceRef ? (
              <p className="mt-0.5 font-mono text-[10px] opacity-70">
                ↳ {event.sourceRef}
              </p>
            ) : null}
          </div>
          <span className="ml-3 rounded-full bg-sky-200 px-2 py-0.5 font-mono text-[10px]">
            {dueAt}
          </span>
        </section>
      );
    }
    case "md.style-update":
      return (
        <p
          role="note"
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-[10px] text-slate-600"
          data-testid="md-event-style-update"
        >
          MD style: {event.posture} · {event.note} ·{" "}
          {(event.confidence * 100).toFixed(0)}%
        </p>
      );
    case "md.assistant_text":
      // H-5 fix: render assistant_text as a discrete bubble inside
      // the event stream rather than silently merging into the turn
      // text. Owner sees exactly what the brain wrote, per frame.
      return (
        <section
          role="note"
          className="rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2 text-xs text-violet-900"
          data-testid="md-event-assistant-text"
        >
          <p className="whitespace-pre-line">{event.text}</p>
          {event.traceId ? (
            <p className="mt-1 font-mono text-[10px] opacity-50">
              trace {event.traceId.slice(0, 8)}
            </p>
          ) : null}
        </section>
      );
    case "md.error":
      return (
        <section
          role="alert"
          className="rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-xs text-rose-900"
          data-testid="md-event-error"
        >
          <header className="font-semibold uppercase tracking-wider text-[10px]">
            MD Error
          </header>
          <p className="mt-1">{event.message}</p>
        </section>
      );
    default: {
      // Compile-time exhaustiveness — adding a new MdEvent variant
      // without updating this switch becomes a TypeScript error.
      const _exhaustive: never = event;
      void _exhaustive;
      return null;
    }
  }
}
