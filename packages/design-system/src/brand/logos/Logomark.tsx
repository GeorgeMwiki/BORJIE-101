import * as React from 'react';
import { BorjieLogo, type BorjieLogoTone } from '../BorjieLogo';

/**
 * Borjie — Logomark (legacy alias for the mark-only variant of
 * `BorjieLogo`).
 *
 * Existing callers across `apps/admin-web`, `apps/owner-web`, and the
 * legacy chat-ui used `<Logomark size={28} variant="premium" />` to
 * render the brand glyph. The new canonical component is `BorjieLogo`
 * (B-with-mining-strata motif). This shim adapts the legacy `variant`
 * ('flat' / 'premium') prop to the new `tone` system so no caller had
 * to change at the same time we shipped the new design.
 *
 * Pass `tone` directly to opt-in to the full tone palette.
 */

export type LogomarkVariant = 'flat' | 'premium';

export interface LogomarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly size?: number;
  readonly title?: string;
  readonly variant?: LogomarkVariant;
  readonly withBackdrop?: boolean;
  readonly tone?: BorjieLogoTone;
}

function resolveLegacyTone(
  variant: LogomarkVariant,
  explicit: BorjieLogoTone | undefined,
): BorjieLogoTone {
  if (explicit !== undefined) return explicit;
  if (variant === 'flat') return 'mono-gold';
  return 'full';
}

export const Logomark = React.forwardRef<HTMLSpanElement, LogomarkProps>(
  function Logomark(
    {
      size = 24,
      title = 'Borjie',
      variant = 'premium',
      // `withBackdrop` is honoured by callers visually wrapping the mark in
      // their own surface (sidebar header, app icon tile). The new
      // BorjieLogo renders its own warm bloom so an additional dark tile
      // would double up. We accept the prop for API parity but ignore it.
      withBackdrop: _withBackdrop = false,
      tone,
      style,
      ...rest
    },
    ref,
  ) {
    const resolvedTone = resolveLegacyTone(variant, tone);
    return (
      <span
        ref={ref}
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
        {...rest}
      >
        <BorjieLogo
          variant="mark"
          size={typeof size === 'number' ? size : 24}
          tone={resolvedTone}
          title={title}
        />
      </span>
    );
  },
);
