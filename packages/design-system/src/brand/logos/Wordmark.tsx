import * as React from 'react';
import { Logomark } from './Logomark';

/**
 * Borjie — Wordmark lockups.
 *
 * The brand name is set as a single compound word "Borjie" in mixed
 * case (capital B, capital N). The Swahili meaning — "head of the
 * house" / "boss of the house" — is honoured by keeping "Boss" and
 * "Nyumba" visually bonded (no space, no hyphen), with a subtle amber
 * hairline at the internal word-break so readers still parse them as
 * two syllables but see one brand.
 *
 * Three official variants:
 *   - `Wordmark`          horizontal: mark + wordmark (default)
 *   - `WordmarkStacked`   mark above wordmark (app icons, square slots)
 *   - `WordmarkOnly`      wordmark without mark
 *
 * Type: Fraunces display (editorial serif with humanist warmth).
 */

export type WordmarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface WordmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly size?: WordmarkSize;
  /** When true, the logomark renders with the premium gradient + glow
   *  treatment. Default true on every variant except chrome-tight nav. */
  readonly premium?: boolean;
  /** Override the displayed text. Default is the canonical brand name. */
  readonly label?: string;
}

const SIZE_MAP: Record<WordmarkSize, { mark: number; text: string; gap: string }> = {
  xs: { mark: 18, text: 'text-base',  gap: 'gap-1.5' },
  sm: { mark: 24, text: 'text-lg',    gap: 'gap-2' },
  md: { mark: 32, text: 'text-2xl',   gap: 'gap-2.5' },
  lg: { mark: 48, text: 'text-4xl',   gap: 'gap-3' },
  xl: { mark: 72, text: 'text-6xl',   gap: 'gap-4' },
};

/** Horizontal lockup — default for nav, headers, footers. */
export function Wordmark({
  size = 'md',
  premium = true,
  label = 'Borjie',
  className,
  ...rest
}: WordmarkProps) {
  const s = SIZE_MAP[size];
  return (
    <div
      className={[
        'inline-flex items-center',
        s.gap,
        'font-display',
        'font-medium',
        'tracking-tight',
        'leading-none',
        'text-foreground',
        className ?? '',
      ].join(' ')}
      aria-label="Borjie"
      {...rest}
    >
      <Logomark
        size={s.mark}
        variant={premium ? 'premium' : 'flat'}
        className={premium ? undefined : 'text-signal-500'}
        aria-hidden="true"
      />
      <span className={s.text}>{splitCompoundLabel(label)}</span>
    </div>
  );
}

/** Stacked lockup — mark above wordmark, centred. For app icons, modals. */
export function WordmarkStacked({
  size = 'lg',
  premium = true,
  label = 'Borjie',
  className,
  ...rest
}: WordmarkProps) {
  const s = SIZE_MAP[size];
  return (
    <div
      className={[
        'inline-flex flex-col items-center',
        'gap-3',
        'font-display',
        'font-medium',
        'tracking-tight',
        'leading-none',
        'text-foreground',
        className ?? '',
      ].join(' ')}
      aria-label="Borjie"
      {...rest}
    >
      <Logomark
        size={s.mark * 1.35}
        variant={premium ? 'premium' : 'flat'}
        withBackdrop={premium}
        className={premium ? undefined : 'text-signal-500'}
        aria-hidden="true"
      />
      <span className={s.text}>{splitCompoundLabel(label)}</span>
    </div>
  );
}

/** Wordmark without mark — for nav chrome where the logomark appears
 *  adjacent (e.g. favicon tab + text nav). */
export function WordmarkOnly({
  size = 'md',
  label = 'Borjie',
  className,
  ...rest
}: Omit<WordmarkProps, 'premium'>) {
  const s = SIZE_MAP[size];
  return (
    <span
      className={[
        'inline-flex items-center',
        'font-display',
        'font-medium',
        'tracking-tight',
        'leading-none',
        'text-foreground',
        s.text,
        className ?? '',
      ].join(' ')}
      aria-label="Borjie"
      {...rest}
    >
      {splitCompoundLabel(label)}
    </span>
  );
}

/**
 * Render "Borjie" as a single compound word with a subtle amber
 * baseline dot between the two capitalised syllables. Reads "Borjie"
 * but optically flags the internal word-break. If the label isn't the
 * canonical Borjie, renders plain text.
 *
 * The micro-dot dimensions are intentionally specified in *ems* so the
 * glyph scales proportionally with the surrounding type. This is the
 * canonical brand wordmark — these em-units ARE the brand spec, not
 * arbitrary escape hatches, hence the localized rule disable below.
 */
function splitCompoundLabel(label: string): React.ReactNode {
  const trimmed = label.trim();
  const match = trimmed.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
  if (!match) return trimmed;
  return (
    <>
      <span>{match[1]}</span>
      <span
        aria-hidden="true"
        // SCRUB-5f: justified-because this file IS the brand wordmark spec;
        // mx/h/w/translate-y in *ems* scale proportionally with type-size and
        // ARE the canonical token for this glyph metric. Arbitrary-value
        // Tailwind brackets are not used as a layout escape hatch here.
        // eslint-disable-next-line borjie/no-non-token-style
        className="mx-[0.02em] inline-block h-[0.14em] w-[0.14em] translate-y-[-0.04em] rounded-full bg-signal-500/85 align-baseline"
      />
      <span>{match[2]}</span>
    </>
  );
}
