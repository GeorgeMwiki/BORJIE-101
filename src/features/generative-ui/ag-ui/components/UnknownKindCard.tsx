"use client";

/**
 * UnknownKindCard — graceful degrade for unrecognised UiPart kinds.
 *
 * Mirrors the chat-ui block-system renderer's unknown-kind handling
 * (`packages/chat-ui/src/generative-ui/AdaptiveRenderer.tsx:~159`). When
 * the brain emits a `kind` this client does not yet know — e.g. a new
 * `kanban` / `dashboard-grid` / `heatmap` primitive added in a later
 * release — the renderer shows the kind name + a "preview not yet
 * available" message + the raw JSON in a collapsible block. Apps that
 * haven't upgraded `src/features/generative-ui/ag-ui` stay running.
 */

import { useState } from "react";

export interface UnknownKindCardProps {
  readonly kind: string;
  readonly payload: unknown;
}

export function UnknownKindCard({
  kind,
  payload,
}: UnknownKindCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  let json = "";
  try {
    json = JSON.stringify(payload, null, 2);
  } catch {
    json = "(payload not serializable)";
  }
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-surface-sunken p-3 my-2 text-xs"
      data-genui-unknown-kind={kind}
    >
      <div className="font-medium text-foreground">
        Unknown UiPart kind:{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-foreground">
          {kind}
        </code>
      </div>
      <div className="mt-1 text-muted-foreground">
        Preview not yet available in this client build. Update{" "}
        <code>@/features/generative-ui/ag-ui</code> to render this primitive.
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 rounded border border-border bg-surface px-2 py-0.5 text-[11px]"
      >
        {open ? "Hide raw payload" : "Show raw payload"}
      </button>
      {open ? (
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-border bg-surface p-2 text-[11px] text-foreground">
          {json}
        </pre>
      ) : null}
    </div>
  );
}
