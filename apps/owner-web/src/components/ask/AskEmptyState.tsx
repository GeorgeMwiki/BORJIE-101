'use client';

import { AlertTriangle, MessageSquare, PlugZap, Sparkles } from 'lucide-react';

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
 * LitFin-pattern shell: hairline border, tinted bg (10% alpha) +
 * inset ring (20% alpha), tinted-icon plate, display heading, muted
 * body. Variants tint by intent (warning, destructive, signal) rather
 * than slamming a solid panel.
 */
export function AskEmptyState({ kind, detail }: AskEmptyStateProps) {
  if (kind === 'unconfigured') {
    return (
      <StatePanel
        testId="brain-not-configured"
        tone="warning"
        icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
        title="Connect to Borjie backend"
      >
        <p className="text-neutral-300">
          The owner cockpit is not pointed at a Borjie api-gateway yet.
          Set the
          <code className="mx-1 rounded bg-surface px-1 py-0.5 font-mono text-xs">
            NEXT_PUBLIC_API_GATEWAY_URL
          </code>
          environment variable to the gateway base URL (e.g.
          <code className="mx-1 rounded bg-surface px-1 py-0.5 font-mono text-xs">
            https://api.borjie.app
          </code>
          ) and reload to start chatting with the Brain.
        </p>
      </StatePanel>
    );
  }
  if (kind === 'unauthenticated') {
    return (
      <StatePanel
        testId="brain-needs-signin"
        tone="destructive"
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        title="Sign in required"
      >
        <p className="text-neutral-300">
          Borjie Brain needs an authenticated Supabase session. Sign in
          again from the top-right to refresh your token, then come
          back to this page.
        </p>
      </StatePanel>
    );
  }
  if (kind === 'error') {
    return (
      <StatePanel
        testId="brain-unreachable"
        tone="destructive"
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        title="Brain unreachable"
      >
        <p className="text-neutral-300">
          The gateway returned an error. Try again, or contact your
          Borjie operator if it persists.
        </p>
        {detail ? (
          <pre
            className="mt-3 max-h-24 overflow-auto rounded border border-border bg-surface/60 p-2 font-mono text-xs text-neutral-400"
            data-testid="brain-unreachable-detail"
          >
            {detail.slice(0, 600)}
          </pre>
        ) : null}
      </StatePanel>
    );
  }
  return (
    <StatePanel
      testId="brain-fresh-intro"
      tone="signal"
      icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
      title="Ask Borjie Brain"
      titleClassName="text-foreground"
      iconClassName="text-signal-500"
    >
      <p className="text-neutral-300">
        Ask anything about your mining portfolio. Replies cite the
        corpus chunk they came from (mineral code · section · score)
        so you can trace the answer back to source. Swahili and
        English are both fine.
      </p>
      <ul className="mt-3 space-y-1.5 text-xs text-neutral-400">
        <li>· "Show me sites running below the gold target this week."</li>
        <li>· "Which licences expire within 30 days?"</li>
        <li>· "What did the auditor flag yesterday?"</li>
      </ul>
    </StatePanel>
  );
}

type StateTone = 'warning' | 'destructive' | 'signal';

interface StatePanelProps {
  readonly testId: string;
  readonly tone: StateTone;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly titleClassName?: string;
  readonly iconClassName?: string;
  readonly children: React.ReactNode;
}

const toneStyles: Record<
  StateTone,
  { wrapper: string; iconPlate: string; iconColor: string; title: string }
> = {
  warning: {
    wrapper: 'border-warning/30 bg-warning/10 ring-1 ring-inset ring-warning/20',
    iconPlate: 'bg-warning/10',
    iconColor: 'text-warning',
    title: 'text-warning',
  },
  destructive: {
    wrapper: 'border-destructive/30 bg-destructive/10 ring-1 ring-inset ring-destructive/20',
    iconPlate: 'bg-destructive/10',
    iconColor: 'text-destructive',
    title: 'text-destructive',
  },
  signal: {
    wrapper: 'border-border bg-surface/40',
    iconPlate: 'bg-signal-500/10',
    iconColor: 'text-signal-500',
    title: 'text-foreground',
  },
};

function StatePanel({
  testId,
  tone,
  icon,
  title,
  titleClassName,
  iconClassName,
  children,
}: StatePanelProps) {
  const s = toneStyles[tone];
  return (
    <div
      data-testid={testId}
      className={`mx-auto my-12 max-w-xl rounded-2xl border p-6 text-sm text-foreground ${s.wrapper}`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.iconPlate} ${iconClassName ?? s.iconColor}`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <h2
            className={`font-display text-lg font-medium tracking-tight ${titleClassName ?? s.title}`}
          >
            {title}
          </h2>
          <div className="mt-2 text-sm leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
