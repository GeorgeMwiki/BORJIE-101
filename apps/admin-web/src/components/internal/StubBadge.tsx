/**
 * StubBadge — THIN WRAPPER over the design-system `Badge`.
 *
 * The public API (`tone` + `children`) is preserved VERBATIM so all 40+
 * existing call sites keep compiling unchanged. The divergent body (a
 * hand-rolled pill with per-tone Tailwind maps) is gone — tone now maps
 * onto DS `Badge` soft variants, which carry the canonical token colours
 * (`bg-*-subtle text-*`). The pill shape, uppercase tracking, and font
 * weight are layered via `className` so the rendered look stays familiar.
 */
import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '@borjie/design-system';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

interface StubBadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
}

const TONE_VARIANT: Record<Tone, BadgeProps['variant']> = {
  neutral: 'secondary',
  success: 'success-soft',
  warn: 'warning-soft',
  danger: 'error-soft',
  info: 'info-soft',
};

export function StubBadge({ tone = 'neutral', children }: StubBadgeProps): JSX.Element {
  return (
    <Badge
      variant={TONE_VARIANT[tone]}
      size="sm"
      className="uppercase tracking-wider font-medium"
    >
      {children}
    </Badge>
  );
}
