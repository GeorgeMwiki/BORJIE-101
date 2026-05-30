"use client";

/**
 * 15. prompt-suggestions — typed quick-replies.
 *
 * Clicking a suggestion dispatches the `prompt` as the next user
 * message. Dispatch is two-pronged so the host app can pick whichever
 * it already wires up:
 *
 *   1. A DOM CustomEvent on `window` named "genui:prompt-suggestion"
 *      with `{ prompt, label, kind }` in `detail`.
 *   2. An optional `onSelect` callback if rendered via a wrapper.
 *
 * Anti-pattern guards:
 *   - LLM emits values only — never click handlers
 *   - safeParse before render
 */

import type { AgUiUiPartByKind, PromptSuggestion } from "../types";
import { Frame, GenUiError } from "./Frame";
import { PromptSuggestionsPartSchema } from "../schemas";

export type PromptSuggestionsProps = AgUiUiPartByKind<"prompt-suggestions">;

const KIND_CLASS: Record<PromptSuggestion["kind"], string> = {
  primary: "border-blue-500 bg-blue-500/10 text-blue-700",
  secondary: "border-border bg-surface text-foreground",
  destructive: "border-red-500 bg-red-500/10 text-red-700",
};

function dispatchSuggestion(s: PromptSuggestion): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("genui:prompt-suggestion", {
        detail: { prompt: s.prompt, label: s.label, kind: s.kind },
      }),
    );
  } catch {
    // ignore — host app may use a different wiring
  }
}

export function PromptSuggestions(props: PromptSuggestionsProps): JSX.Element {
  const parsed = PromptSuggestionsPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="prompt-suggestions"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame
      kind="prompt-suggestions"
      {...(props.title ? { title: props.title } : {})}
    >
      <div className="flex flex-wrap gap-2">
        {props.suggestions.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => dispatchSuggestion(s)}
            className={`rounded-full border px-3 py-1 text-xs ${KIND_CLASS[s.kind]}`}
            data-genui-suggestion-kind={s.kind}
          >
            {s.icon ? <span className="mr-1">{s.icon}</span> : null}
            {s.label}
          </button>
        ))}
      </div>
    </Frame>
  );
}
