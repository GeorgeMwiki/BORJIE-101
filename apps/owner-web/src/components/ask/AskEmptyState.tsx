'use client';

import { AlertTriangle, PlugZap, Sparkles } from 'lucide-react';
import { pickByLocale, type Locale } from '@/lib/locale-shared';
import { askEmptyStateStrings as S } from '@/i18n/strings/ask-empty-state';

export type AskEmptyKind = 'unconfigured' | 'unauthenticated' | 'fresh' | 'error';

interface AskEmptyStateProps {
  readonly kind: AskEmptyKind;
  readonly locale: Locale;
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
export function AskEmptyState({ kind, locale, detail }: AskEmptyStateProps) {
  if (kind === 'unconfigured') {
    return (
      <StatePanel
        testId="brain-not-configured"
        tone="warning"
        icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
        title={pickByLocale(locale, S.unconfiguredTitle)}
      >
        <p className="text-neutral-300">
          {pickByLocale(locale, S.unconfiguredBodyBefore)}
          <code className="mx-1 rounded bg-surface px-1 py-0.5 font-mono text-xs">
            NEXT_PUBLIC_API_GATEWAY_URL
          </code>
          {pickByLocale(locale, S.unconfiguredBodyMiddle)}
          <code className="mx-1 rounded bg-surface px-1 py-0.5 font-mono text-xs">
            https://api.borjie.app
          </code>
          {pickByLocale(locale, S.unconfiguredBodyAfter)}
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
        title={pickByLocale(locale, S.unauthenticatedTitle)}
      >
        <p className="text-neutral-300">
          {pickByLocale(locale, S.unauthenticatedBody)}
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
        title={pickByLocale(locale, S.errorTitle)}
      >
        <p className="text-neutral-300">
          {pickByLocale(locale, S.errorBody)}
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
      title={pickByLocale(locale, S.freshTitle)}
      titleClassName="text-foreground"
      iconClassName="text-signal-500"
    >
      <p className="text-neutral-300">
        {pickByLocale(locale, S.freshBody)}
      </p>
      <ul className="mt-3 space-y-1.5 text-xs text-neutral-400">
        <li>{pickByLocale(locale, S.freshExample1)}</li>
        <li>{pickByLocale(locale, S.freshExample2)}</li>
        <li>{pickByLocale(locale, S.freshExample3)}</li>
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
