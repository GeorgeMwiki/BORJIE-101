import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

interface StubBadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-neutral-300 border-border',
  success: 'bg-success/10 text-success border-success/30',
  warn: 'bg-warning/10 text-warning border-warning/40',
  danger: 'bg-danger/10 text-danger border-danger/40',
  info: 'bg-signal-500/10 text-signal-500 border-signal-500/30',
};

export function StubBadge({ tone = 'neutral', children }: StubBadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption-lg font-medium uppercase tracking-wider ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
