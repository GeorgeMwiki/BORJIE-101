'use client';

import { AlertTriangle, MessageSquare, PlugZap } from 'lucide-react';

export type AskEmptyKind = 'unconfigured' | 'unauthenticated' | 'fresh' | 'error';

interface AskEmptyStateProps {
  readonly kind: AskEmptyKind;
  readonly detail?: string | null;
}

/**
 * Empty / error states for the ask-Borjie surface.
 *
 * - `unconfigured`     — NEXT_PUBLIC_API_GATEWAY_URL is missing.
 * - `unauthenticated`  — gateway returned 401 — sign in.
 * - `fresh`            — gateway reachable, no messages yet.
 * - `error`            — any other gateway error surfaced live.
 *
 * Every kind is verbose enough that the user can act without guessing:
 * the env-var name, the sign-in link, or the failure detail (truncated)
 * is shown directly on the screen.
 */
export function AskEmptyState({ kind, detail }: AskEmptyStateProps) {
  if (kind === 'unconfigured') {
    return (
      <div
        data-testid="brain-not-configured"
        className="mx-auto my-12 max-w-xl rounded-lg border border-warning/40 bg-warning-subtle/10 p-6 text-sm text-foreground"
      >
        <div className="flex items-center gap-2 text-warning">
          <PlugZap className="h-5 w-5" aria-hidden="true" />
          <h2 className="font-display text-lg">Connect to Borjie backend</h2>
        </div>
        <p className="mt-3 text-neutral-300">
          The owner cockpit is not pointed at a Borjie api-gateway yet.
          Set the
          <code className="mx-1 rounded bg-surface px-1 py-0.5 text-xs">
            NEXT_PUBLIC_API_GATEWAY_URL
          </code>
          environment variable to the gateway base URL (e.g.
          <code className="mx-1 rounded bg-surface px-1 py-0.5 text-xs">
            https://api.borjie.app
          </code>
          ) and reload to start chatting with the Brain.
        </p>
      </div>
    );
  }
  if (kind === 'unauthenticated') {
    return (
      <div
        data-testid="brain-needs-signin"
        className="mx-auto my-12 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-foreground"
      >
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <h2 className="font-display text-lg">Sign in required</h2>
        </div>
        <p className="mt-3 text-neutral-300">
          Borjie Brain needs an authenticated Supabase session. Sign in
          again from the top-right to refresh your token, then come back
          to this page.
        </p>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div
        data-testid="brain-unreachable"
        className="mx-auto my-12 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-foreground"
      >
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <h2 className="font-display text-lg">Brain unreachable</h2>
        </div>
        <p className="mt-3 text-neutral-300">
          The gateway returned an error. Try again, or contact your
          Borjie operator if it persists.
        </p>
        {detail ? (
          <pre
            className="mt-3 max-h-24 overflow-auto rounded border border-border bg-surface/60 p-2 text-xs text-neutral-400"
            data-testid="brain-unreachable-detail"
          >
            {detail.slice(0, 600)}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div
      data-testid="brain-fresh-intro"
      className="mx-auto my-12 max-w-xl rounded-lg border border-border bg-surface/40 p-6 text-sm text-neutral-300"
    >
      <div className="flex items-center gap-2 text-warning">
        <MessageSquare className="h-5 w-5" aria-hidden="true" />
        <h2 className="font-display text-lg text-foreground">
          Ask Borjie Brain
        </h2>
      </div>
      <p className="mt-3">
        Ask anything about your mining portfolio. Replies cite the
        corpus chunk they came from (mineral code · section · score) so
        you can trace the answer back to source. Swahili and English are
        both fine.
      </p>
    </div>
  );
}
