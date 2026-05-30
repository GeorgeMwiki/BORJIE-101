"use client";

/**
 * 27. chat-embed — scoped sub-chat embedded inside an admin turn.
 *
 * The brain emits an initial transcript + a `scope` (the routing key
 * the host portal uses to forward messages back to the kernel). The
 * component lets the user keep typing; on submit it dispatches a
 * `genui:chat-embed-message` CustomEvent the host wires to the chat
 * pipeline.
 */

import { useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ChatEmbedPartSchema } from "../schemas";

export type ChatEmbedProps = AgUiUiPartByKind<"chat-embed">;

interface LocalMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
}

export function ChatEmbed(props: ChatEmbedProps): JSX.Element {
  const parsed = ChatEmbedPartSchema.safeParse(props);
  const [messages, setMessages] = useState<ReadonlyArray<LocalMessage>>(
    () => props.initialMessages ?? [],
  );
  const [draft, setDraft] = useState("");

  if (!parsed.success) {
    return (
      <GenUiError
        kind="chat-embed"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  function send(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const next: LocalMessage = { role: "user", text: trimmed };
    setMessages((m) => [...m, next]);
    setDraft("");
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("genui:chat-embed-message", {
            detail: { scope: props.scope, text: trimmed },
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <Frame kind="chat-embed" {...(props.title ? { title: props.title } : {})}>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        scope: <code>{props.scope}</code>
      </div>
      <div className="max-h-64 overflow-auto rounded border border-border bg-surface-sunken p-2">
        {messages.length === 0 ? (
          <div className="text-xs text-muted-foreground">No messages yet.</div>
        ) : (
          <ul className="m-0 list-none space-y-1 p-0">
            {messages.map((m, i) => (
              <li
                key={i}
                className={
                  m.role === "user"
                    ? "flex justify-end"
                    : m.role === "assistant"
                      ? "flex justify-start"
                      : "flex justify-center text-muted-foreground"
                }
              >
                <span
                  className={
                    m.role === "user"
                      ? "rounded-lg bg-foreground px-2 py-1 text-xs text-background"
                      : "rounded-lg bg-surface px-2 py-1 text-xs text-foreground"
                  }
                >
                  {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          placeholder={props.placeholder ?? "Reply…"}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={send}
          className="rounded border border-foreground bg-foreground px-3 py-1 text-xs text-background"
        >
          Send
        </button>
      </div>
    </Frame>
  );
}
