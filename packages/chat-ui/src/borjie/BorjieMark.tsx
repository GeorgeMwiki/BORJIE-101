/**
 * BorjieMark — the brand-mark roundel used in the floating FAB, panel
 * header, and assistant bubbles.
 *
 * Mirrors LitFin's `LitfinMark` pattern: a single circular SVG that
 * scales cleanly across the three sizes the widget needs (28px in the
 * FAB, 20px in the header, 16px in the assistant bubble). The fill is
 * a gold-gradient circle with a bold serif "B" centered on top so it
 * reads as a single brand glyph at every size.
 *
 * Colours are sourced from the Borjie warm-gold ramp (#FFC857 family),
 * defined in `packages/design-system/src/styles/globals.css`. The mark
 * never introduces new tokens — it just consumes the same hex values
 * the rest of the marketing surface uses.
 *
 * No new colour tokens, no Tailwind dependency (chat-ui ships as an
 * island bundle), and no external icon library. Pure SVG so the mark
 * loads as part of the React tree with zero additional network cost.
 */
import { type CSSProperties } from 'react';

/** Brand-gradient stops, matched to the OKLCH warm-gold ramp in the
 *  design-system. Exposed so other surfaces (loading skeletons) can
 *  echo the same gradient without re-declaring the palette. */
export const BORJIE_GOLD_GRADIENT = {
  from: '#FFC857', // signal-500 (hero gold)
  via: '#F5B23E', // signal-400 (hover)
  to: '#C9A66B', // signal-300-ish (settle)
} as const;

export const BORJIE_GOLD_DEEP = '#17100A'; // primary-foreground on gold

interface BorjieMarkProps {
  /** Outer diameter in px. Default 24. */
  readonly size?: number;
  /** Optional CSS overrides. Use sparingly — the mark is meant to be
   *  identical across the three surfaces. */
  readonly style?: CSSProperties;
  /** Optional `aria-label`. When null/undefined the mark is
   *  presentational (aria-hidden). */
  readonly ariaLabel?: string | null;
}

export function BorjieMark({
  size = 24,
  style,
  ariaLabel = null,
}: BorjieMarkProps): JSX.Element {
  const gradientId = `borjie-mark-grad-${size}`;
  const stroke = Math.max(1, Math.round(size * 0.04));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel ?? undefined}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={BORJIE_GOLD_GRADIENT.from} />
          <stop offset="55%" stopColor={BORJIE_GOLD_GRADIENT.via} />
          <stop offset="100%" stopColor={BORJIE_GOLD_GRADIENT.to} />
        </linearGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r={16 - stroke / 2}
        fill={`url(#${gradientId})`}
        stroke="rgba(23, 16, 10, 0.18)"
        strokeWidth={stroke}
      />
      {/* Letter "B" — Fraunces-ish serif weight, sits optically centred
          (visual centre is ~0.5px below geometric centre because of the
          asymmetric counter). We approximate without depending on
          @font-face to keep the mark identical across hosts. */}
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="'Fraunces', 'GT Alpina', 'Source Serif 4', Georgia, serif"
        fontSize="20"
        fontWeight="700"
        fill={BORJIE_GOLD_DEEP}
        style={{ letterSpacing: '-0.02em' }}
      >
        B
      </text>
    </svg>
  );
}
