import * as React from 'react';

/**
 * BorjieLogo — the canonical Borjie brand mark + wordmark system.
 *
 * Motif: a custom-drawn capital "B" whose two bowls are formed by
 * stacked horizontal mining-strata bands. Reads as a letter B at first
 * glance, mining cross-section on second look. Chosen over geometric
 * mountain / concentric ore-ring / faceted gem alternatives because it
 * is the strongest brand differentiator AND survives 16px favicon
 * rendering with a clear silhouette.
 *
 * Construction grid: 64 x 64 with all anchor points on whole or half
 * units so the SVG stays crisp from 14px favicon to 2048px billboard.
 *
 * Layering (back to front):
 *   1. Optional dark navy backdrop tile (for transparent surfaces)
 *   2. Radial warm-gold ambient bloom centred under the glyph
 *   3. Spine of the B — burnished gold gradient vertical bar
 *   4. Upper bowl band  — narrower stratum (gold-light gradient)
 *   5. Mid divider band — thin warm-amber line (geological seam)
 *   6. Lower bowl band  — wider stratum (gold-deep gradient)
 *   7. Top-edge specular highlight (the "lamp is on" sheen)
 *   8. Hairline outline on the lower bowl tail (grounding)
 *
 * Variants:
 *   - 'mark'              mark only
 *   - 'wordmark'          "Borjie" wordmark only (no mark)
 *   - 'lockup-horizontal' mark left of wordmark
 *   - 'lockup-stacked'    mark above wordmark, centred
 *
 * Tones:
 *   - 'full'       full gradient gold (default — hero, app icons)
 *   - 'knockout'   white-on-transparent (for over-photo and ads)
 *   - 'mono-gold'  single signal-gold (#E5B26B), no gradient
 *   - 'mono-navy'  single ink near-black (#17100A)
 *   - 'mono-cream' single warm off-white (#F5EBD8)
 *
 * The wordmark sets "Borjie" in Fraunces display medium with a -0.018em
 * tracking value and a subtle warm-gold dot accent between "Bor" and
 * "jie" — the brand glyph the existing system already established.
 *
 * All paths and colours are deterministic: no Math.random, no Date,
 * no env reads. Server-rendered SVGs identical to client renders.
 */

export type BorjieLogoVariant =
  | 'mark'
  | 'wordmark'
  | 'lockup-horizontal'
  | 'lockup-stacked';

export type BorjieLogoTone =
  | 'full'
  | 'knockout'
  | 'mono-gold'
  | 'mono-navy'
  | 'mono-cream';

export interface BorjieLogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Which composition to render. Default 'mark'. */
  readonly variant?: BorjieLogoVariant;
  /** Outer mark size in CSS px. Default 32. Wordmark sizes itself off
   *  this value so a single prop scales the whole lockup. */
  readonly size?: number;
  /** Colour scheme. Default 'full'. */
  readonly tone?: BorjieLogoTone;
  /** Override displayed wordmark text. Defaults to 'Borjie'. */
  readonly label?: string;
  /** Accessible title — falls back to the canonical brand name. */
  readonly title?: string;
}

/**
 * Resolve the colour tokens consumed by the SVG mark for a given tone.
 * Centralised so the lockup wordmark colour stays in lock-step with
 * the mark fill across every tone variant.
 */
function resolveTone(tone: BorjieLogoTone): {
  readonly useGradient: boolean;
  readonly spine: string;
  readonly upperBand: string;
  readonly midSeam: string;
  readonly lowerBand: string;
  readonly highlight: string;
  readonly wordmarkColor: string;
} {
  switch (tone) {
    case 'knockout':
      return {
        useGradient: false,
        spine: '#FFFFFF',
        upperBand: '#FFFFFF',
        midSeam: '#FFFFFF',
        lowerBand: '#FFFFFF',
        highlight: '#FFFFFF',
        wordmarkColor: '#FFFFFF',
      };
    case 'mono-gold':
      return {
        useGradient: false,
        spine: '#E5B26B',
        upperBand: '#E5B26B',
        midSeam: '#E5B26B',
        lowerBand: '#E5B26B',
        highlight: '#E5B26B',
        wordmarkColor: '#E5B26B',
      };
    case 'mono-navy':
      return {
        useGradient: false,
        spine: '#17100A',
        upperBand: '#17100A',
        midSeam: '#17100A',
        lowerBand: '#17100A',
        highlight: '#17100A',
        wordmarkColor: '#17100A',
      };
    case 'mono-cream':
      return {
        useGradient: false,
        spine: '#F5EBD8',
        upperBand: '#F5EBD8',
        midSeam: '#F5EBD8',
        lowerBand: '#F5EBD8',
        highlight: '#F5EBD8',
        wordmarkColor: '#F5EBD8',
      };
    case 'full':
    default:
      return {
        useGradient: true,
        spine: 'url(#__borjie_spine__)',
        upperBand: 'url(#__borjie_upper__)',
        midSeam: '#E5B26B',
        lowerBand: 'url(#__borjie_lower__)',
        highlight: 'url(#__borjie_hi__)',
        wordmarkColor: '#F5EBD8',
      };
  }
}

/**
 * Core SVG mark — the B-with-strata glyph. All gradient ids are
 * suffixed with a `useId` salt so multiple marks can co-exist on a
 * page without DOM-id collisions.
 */
function BorjieMarkSvg({
  size,
  tone,
  title,
}: {
  readonly size: number;
  readonly tone: BorjieLogoTone;
  readonly title: string;
}): JSX.Element {
  const uid = React.useId().replace(/:/g, '');
  const palette = resolveTone(tone);

  const spineId = `borjie-spine-${uid}`;
  const upperId = `borjie-upper-${uid}`;
  const lowerId = `borjie-lower-${uid}`;
  const hiId = `borjie-hi-${uid}`;
  const bloomId = `borjie-bloom-${uid}`;

  const spine = palette.useGradient ? `url(#${spineId})` : palette.spine;
  const upper = palette.useGradient ? `url(#${upperId})` : palette.upperBand;
  const lower = palette.useGradient ? `url(#${lowerId})` : palette.lowerBand;
  const seam = palette.midSeam;
  const highlight = palette.useGradient ? `url(#${hiId})` : palette.highlight;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <title>{title}</title>
      {palette.useGradient ? (
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
      ) : null}

      {palette.useGradient ? (
        <circle cx="32" cy="32" r="20" fill={`url(#${bloomId})`} />
      ) : null}

      {/* Spine of the B — left vertical bar, full-height with rounded
          terminals. Width 8u so it stays solid at favicon scale. */}
      <rect x="14" y="12" width="8" height="40" rx="2" fill={spine} />

      {/* Upper bowl band — narrower geological stratum, sits in the
          top half of the B. Width tapers slightly at the tail. */}
      <path
        d="M22 14 H38 a8 8 0 0 1 8 8 v3 a8 8 0 0 1 -8 8 H22 z"
        fill={upper}
      />

      {/* Mid divider seam — the geological band line separating the
          two strata. Single hairline, warm amber. */}
      <rect x="22" y="32" width="20" height="1" fill={seam} opacity="0.9" />

      {/* Lower bowl band — wider stratum, deeper gradient. The "ore
          body" of the mark. */}
      <path
        d="M22 35 H40 a10 10 0 0 1 10 10 v0 a10 10 0 0 1 -10 10 H22 z"
        fill={lower}
      />

      {/* Inset strata lines inside the lower bowl — three faint
          horizontal hairlines that reinforce the cross-section read.
          Visible only on the gradient tone; the mono tones get a
          cleaner glyph for legibility at small sizes. */}
      {palette.useGradient ? (
        <g stroke="#FFE2B4" strokeWidth="0.5" opacity="0.35">
          <line x1="24" y1="40" x2="44" y2="40" />
          <line x1="24" y1="45" x2="46" y2="45" />
          <line x1="24" y1="50" x2="44" y2="50" />
        </g>
      ) : null}

      {/* Top-edge specular highlight — the "lit" sheen at the top of
          the spine. Only on full-colour. */}
      {palette.useGradient ? (
        <rect x="14.4" y="12.4" width="7.2" height="6" rx="1.6" fill={highlight} />
      ) : null}

      {/* Lower bowl tail outline — hairline ground line so the bowl
          curve reads as solid object rather than gradient blob. */}
      {palette.useGradient ? (
        <path
          d="M22 35 H40 a10 10 0 0 1 10 10 v0 a10 10 0 0 1 -10 10 H22"
          fill="none"
          stroke="#7A4F1E"
          strokeWidth="0.6"
          opacity="0.55"
        />
      ) : null}
    </svg>
  );
}

/**
 * Wordmark "Borjie" — Fraunces display medium with the canonical
 * warm-gold mid-dot accent between "Bor" and "jie". Set in the
 * wordmark's own colour rather than inheriting so tone='knockout' on
 * dark photo backdrops still renders correctly without a parent
 * `color` cascade.
 */
function BorjieWordmarkText({
  size,
  tone,
  label,
}: {
  readonly size: number;
  readonly tone: BorjieLogoTone;
  readonly label: string;
}): JSX.Element {
  const palette = resolveTone(tone);
  const fontPx = Math.round(size * 0.72);
  const trimmed = label.trim();
  const isCanonical = trimmed === 'Borjie';
  const dotSize = Math.max(2, Math.round(fontPx * 0.1));

  return (
    <span
      style={{
        fontFamily:
          "'Fraunces', 'GT Alpina', 'Source Serif 4', Georgia, serif",
        fontWeight: 600,
        fontSize: `${fontPx}px`,
        letterSpacing: '-0.018em',
        lineHeight: 1,
        color: palette.wordmarkColor,
        display: 'inline-flex',
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
      }}
    >
      {isCanonical ? (
        <>
          <span>Bor</span>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: dotSize,
              height: dotSize,
              borderRadius: '50%',
              backgroundColor:
                tone === 'full' || tone === 'mono-cream'
                  ? '#E5B26B'
                  : palette.wordmarkColor,
              margin: `0 ${Math.max(1, Math.round(fontPx * 0.04))}px`,
              transform: `translateY(-${Math.max(1, Math.round(fontPx * 0.18))}px)`,
            }}
          />
          <span>jie</span>
        </>
      ) : (
        trimmed
      )}
    </span>
  );
}

/**
 * Public component. Switches between mark-only, wordmark-only, and
 * mark+wordmark lockups while honouring the same size/tone props.
 */
export function BorjieLogo({
  variant = 'mark',
  size = 32,
  tone = 'full',
  label = 'Borjie',
  title = 'Borjie',
  style,
  ...rest
}: BorjieLogoProps): JSX.Element {
  if (variant === 'mark') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          ...style,
        }}
        aria-label={title}
        {...rest}
      >
        <BorjieMarkSvg size={size} tone={tone} title={title} />
      </span>
    );
  }

  if (variant === 'wordmark') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          ...style,
        }}
        aria-label={title}
        {...rest}
      >
        <BorjieWordmarkText size={size} tone={tone} label={label} />
      </span>
    );
  }

  if (variant === 'lockup-stacked') {
    return (
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: Math.round(size * 0.32),
          ...style,
        }}
        aria-label={title}
        {...rest}
      >
        <BorjieMarkSvg size={Math.round(size * 1.35)} tone={tone} title={title} />
        <BorjieWordmarkText size={size} tone={tone} label={label} />
      </span>
    );
  }

  // lockup-horizontal
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.28),
        ...style,
      }}
      aria-label={title}
      {...rest}
    >
      <BorjieMarkSvg size={size} tone={tone} title={title} />
      <BorjieWordmarkText size={size} tone={tone} label={label} />
    </span>
  );
}

export default BorjieLogo;
