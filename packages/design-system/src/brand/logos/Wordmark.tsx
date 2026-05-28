import * as React from 'react';
import { BorjieLogo } from '../BorjieLogo';

/**
 * Borjie — Wordmark lockups (compatibility shim).
 *
 * Three legacy variants used across the marketing site, owner cockpit,
 * and admin console:
 *   - `Wordmark`          horizontal lockup (mark + wordmark)
 *   - `WordmarkStacked`   mark above wordmark
 *   - `WordmarkOnly`      wordmark, no mark
 *
 * Each now forwards to `BorjieLogo` with the matching variant. The
 * compound-label "Bor·jie" mid-dot accent comes from BorjieLogo's
 * canonical text renderer; the legacy "Boss·Nyumba" path is retired.
 */

export type WordmarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface WordmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly size?: WordmarkSize;
  readonly premium?: boolean;
  readonly label?: string;
}

const SIZE_MAP: Record<WordmarkSize, number> = {
  xs: 16,
  sm: 22,
  md: 28,
  lg: 36,
  xl: 56,
};

/** Horizontal lockup — default for nav, headers, footers. */
export function Wordmark({
  size = 'md',
  premium = true,
  label = 'Borjie',
  className,
  ...rest
}: WordmarkProps) {
  return (
    <div
      className={['inline-flex items-center', className ?? ''].join(' ')}
      aria-label="Borjie"
      {...rest}
    >
      <BorjieLogo
        variant="lockup-horizontal"
        size={SIZE_MAP[size]}
        tone={premium ? 'full' : 'mono-cream'}
        label={label}
      />
    </div>
  );
}

/** Stacked lockup — mark above wordmark. App icons, modals, splash. */
export function WordmarkStacked({
  size = 'lg',
  premium = true,
  label = 'Borjie',
  className,
  ...rest
}: WordmarkProps) {
  return (
    <div
      className={['inline-flex flex-col items-center', className ?? ''].join(
        ' ',
      )}
      aria-label="Borjie"
      {...rest}
    >
      <BorjieLogo
        variant="lockup-stacked"
        size={SIZE_MAP[size]}
        tone={premium ? 'full' : 'mono-cream'}
        label={label}
      />
    </div>
  );
}

/** Wordmark without mark — for nav chrome where the mark renders
 *  adjacent (e.g. favicon tab + text nav). */
export function WordmarkOnly({
  size = 'md',
  label = 'Borjie',
  className,
  ...rest
}: Omit<WordmarkProps, 'premium'>) {
  return (
    <span
      className={['inline-flex items-center', className ?? ''].join(' ')}
      aria-label="Borjie"
      {...rest}
    >
      <BorjieLogo
        variant="wordmark"
        size={SIZE_MAP[size]}
        tone="full"
        label={label}
      />
    </span>
  );
}
