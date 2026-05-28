/**
 * BorjieMark — the brand-mark roundel used in the floating FAB, panel
 * header, and assistant bubbles.
 *
 * Mirrors the canonical `BorjieLogo` mark from
 * `@borjie/design-system` but is inlined here because chat-ui ships as
 * an island bundle and intentionally keeps zero workspace deps beyond
 * api-sdk + genui. The path data, gradient stops, and proportions are
 * identical to BorjieLogo so the brand reads the same in the chat
 * widget as in the marketing nav, footer, and admin sidebars.
 *
 * Motif: a capital "B" whose two bowls are formed by stacked
 * horizontal mining-strata bands. Reads as a letter B at first
 * glance, mining cross-section on second look.
 *
 * Sizes the widget needs: 28px in the FAB, 20px in the panel header,
 * 16px in the assistant bubble. The SVG scales from a 64x64 design
 * grid so every size renders crisply.
 */
import { useId, type CSSProperties } from 'react';

/** Brand-gradient stops, matched to the warm-gold ramp used by the
 *  canonical `BorjieLogo` in `@borjie/design-system`. Exposed so other
 *  surfaces (loading skeletons, native canvases) can echo the same
 *  gradient without re-declaring the palette. */
export const BORJIE_GOLD_GRADIENT = {
  from: '#FFE2B4',
  via: '#F2C27E',
  to: '#A26A2A',
} as const;

export const BORJIE_GOLD_DEEP = '#17100A';

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
  const uid = useId().replace(/:/g, '');
  const spineId = `borjie-spine-${uid}`;
  const upperId = `borjie-upper-${uid}`;
  const lowerId = `borjie-lower-${uid}`;
  const hiId = `borjie-hi-${uid}`;
  const bloomId = `borjie-bloom-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel ?? undefined}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id={spineId} x1="32" y1="8" x2="32" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFE2B4" />
          <stop offset="40%" stopColor="#F2C27E" />
          <stop offset="100%" stopColor="#A26A2A" />
        </linearGradient>
        <linearGradient id={upperId} x1="32" y1="14" x2="32" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF1CF" />
          <stop offset="100%" stopColor="#E5B26B" />
        </linearGradient>
        <linearGradient id={lowerId} x1="32" y1="34" x2="32" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F2C27E" />
          <stop offset="100%" stopColor="#7A4F1E" />
        </linearGradient>
        <linearGradient id={hiId} x1="32" y1="10" x2="32" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF8E6" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FFF8E6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={bloomId} cx="32" cy="32" r="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F7CC85" stopOpacity="0.32" />
          <stop offset="65%" stopColor="#E5B26B" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#E5B26B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="20" fill={`url(#${bloomId})`} />
      <rect x="14" y="12" width="8" height="40" rx="2" fill={`url(#${spineId})`} />
      <path
        d="M22 14 H38 a8 8 0 0 1 8 8 v3 a8 8 0 0 1 -8 8 H22 z"
        fill={`url(#${upperId})`}
      />
      <rect x="22" y="32" width="20" height="1" fill="#E5B26B" opacity="0.9" />
      <path
        d="M22 35 H40 a10 10 0 0 1 10 10 v0 a10 10 0 0 1 -10 10 H22 z"
        fill={`url(#${lowerId})`}
      />
      <g stroke="#FFE2B4" strokeWidth="0.5" opacity="0.35">
        <line x1="24" y1="40" x2="44" y2="40" />
        <line x1="24" y1="45" x2="46" y2="45" />
        <line x1="24" y1="50" x2="44" y2="50" />
      </g>
      <rect x="14.4" y="12.4" width="7.2" height="6" rx="1.6" fill={`url(#${hiId})`} />
      <path
        d="M22 35 H40 a10 10 0 0 1 10 10 v0 a10 10 0 0 1 -10 10 H22"
        fill="none"
        stroke="#7A4F1E"
        strokeWidth="0.6"
        opacity="0.55"
      />
    </svg>
  );
}
