import * as React from 'react';

/**
 * Borjie — Logomark ("The Glowing BN").
 *
 * An architectural squared frame (the vault / the house) holding a
 * monogram "BN" in display serif. The mark reads as:
 *   1. A vault door — trust, custody, institutional gravity
 *   2. A house — estate, property, hearth
 *   3. A seal — the head-of-house's signature on decisions
 *   4. The BN monogram — ownable typographic mark, always centred
 *
 * Construction grid is 64×64, all construction points land on whole
 * units so the mark stays crisp from 14px favicon to 2048px billboard.
 *
 * Layering (back → front):
 *   - Optional dark backdrop tile (for transparent surfaces / photos)
 *   - Radial amber ambient bloom, soft-blurred, centred on the glyph
 *   - Outer squared frame with rounded corners, gradient-lit
 *   - Inner recessed chamber — double hairline (dark shadow + amber
 *     line) gives the door depth / the "inside the vault" read
 *   - Monogram "BN" in Fraunces display, rendered as gradient-filled
 *     text with a warm inner-glow underneath so it reads as burnished
 *     metal, not flat type
 *   - Top-edge specular on the outer frame (the "lamp is on")
 *   - Corner notches at four outer corners (reads object, not sticker)
 *
 * Two fidelity modes:
 *   - variant="flat"    single-colour monochrome, no text. Uses a
 *                       purely architectural BN-as-geometry fallback
 *                       for surfaces that can't render webfonts
 *                       (favicon, print, embossing).
 *   - variant="premium" (default) full gradient, glow, specular
 *                       monogram. For hero, app icon, marketing.
 */

export type LogomarkVariant = 'flat' | 'premium';

export interface LogomarkProps extends React.SVGProps<SVGSVGElement> {
  readonly size?: number | string;
  readonly title?: string;
  readonly variant?: LogomarkVariant;
  /** Premium only. Renders the dark backdrop tile when true. */
  readonly withBackdrop?: boolean;
}

export const Logomark = React.forwardRef<SVGSVGElement, LogomarkProps>(
  function Logomark(
    {
      size = 24,
      title = 'Borjie',
      variant = 'premium',
      withBackdrop = false,
      ...rest
    },
    ref,
  ) {
    const uid = React.useId();
    const gradId = `bn-frame-${uid}`;
    const monoGradId = `bn-mono-${uid}`;
    const innerGradId = `bn-inner-${uid}`;
    const highlightId = `bn-highlight-${uid}`;
    const glowId = `bn-glow-${uid}`;
    const backdropId = `bn-backdrop-${uid}`;
    const softId = `bn-soft-${uid}`;
    const monoGlowId = `bn-monoglow-${uid}`;

    if (variant === 'flat') {
      // Geometric BN for print/favicon/embossed: the letter shapes
      // drawn as single-weight strokes so they survive rasterization
      // below 20px and embroidery/etching.
      return (
        <svg
          ref={ref}
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={title}
          {...rest}
        >
          <title>{title}</title>
          <rect x="10" y="10" width="44" height="44" rx="7" stroke="currentColor" strokeWidth="3.6" strokeLinejoin="round" />
          {/* B — two stacked bowls on a common spine */}
          <path
            d="M20 22v20 M20 22h5.5a3.5 3.5 0 010 7H20 M20 32h6a3.5 3.5 0 010 7H20"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          {/* N — left stem, diagonal, right stem */}
          <path
            d="M34 42V22 L44 42 V22"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    }

    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={title}
        {...rest}
      >
        <title>{title}</title>
        <defs>
          {/* Frame amber gradient — tri-stop burnished brass */}
          <linearGradient id={gradId} x1="32" y1="8" x2="32" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#FFE2B4" />
            <stop offset="35%"  stopColor="#F2C27E" />
            <stop offset="68%"  stopColor="#CC884A" />
            <stop offset="100%" stopColor="#7A4F1E" />
          </linearGradient>

          {/* Monogram gradient — hotter, brighter, so BN reads as lit */}
          <linearGradient id={monoGradId} x1="32" y1="20" x2="32" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#FFF6E0" />
            <stop offset="40%"  stopColor="#F7CC85" />
            <stop offset="100%" stopColor="#D0873C" />
          </linearGradient>

          {/* Inner chamber gradient — muted, cooler for recessed read */}
          <linearGradient id={innerGradId} x1="32" y1="17" x2="32" y2="47" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#F2C27E" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#7A4F1E" stopOpacity="0.7" />
          </linearGradient>

          {/* Top-edge specular — "lamp on" */}
          <linearGradient id={highlightId} x1="32" y1="10" x2="32" y2="26" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#FFF8E6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFF8E6" stopOpacity="0" />
          </linearGradient>

          {/* Ambient bloom behind the monogram */}
          <radialGradient id={glowId} cx="32" cy="32" r="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#F7CC85" stopOpacity="0.65" />
            <stop offset="55%"  stopColor="#E5B26B" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#E5B26B" stopOpacity="0" />
          </radialGradient>

          {/* Inner halo hugging the letters */}
          <radialGradient id={monoGlowId} cx="32" cy="32" r="12" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#FFF3D8" stopOpacity="0.5" />
            <stop offset="70%"  stopColor="#FFF3D8" stopOpacity="0" />
          </radialGradient>

          {/* Backdrop */}
          <linearGradient id={backdropId} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#1F160E" />
            <stop offset="100%" stopColor="#0E0906" />
          </linearGradient>

          <filter id={softId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {withBackdrop && (
          <>
            <rect width="64" height="64" rx="12" fill={`url(#${backdropId})`} />
            <rect width="64" height="64" rx="12" fill="none" stroke="#2A1E10" strokeWidth="0.5" />
          </>
        )}

        {/* Ambient bloom */}
        <g filter={`url(#${softId})`} opacity="0.95">
          <circle cx="32" cy="32" r="16" fill={`url(#${glowId})`} />
        </g>

        {/* Inner recessed chamber */}
        <rect x="17.5" y="17.5" width="29" height="29" rx="3.5" fill="none" stroke="#1A0F06" strokeWidth="1.2" opacity="0.55" />
        <rect x="17.5" y="17.5" width="29" height="29" rx="3.5" fill="none" stroke={`url(#${innerGradId})`} strokeWidth="0.9" opacity="0.9" />

        {/* Inner halo cuddling the monogram */}
        <circle cx="32" cy="32" r="11" fill={`url(#${monoGlowId})`} />

        {/* BN monogram — custom-drawn letterforms at optical size. Serif-
            adjacent: flat-right B bowls, wedge N terminals. Rendered as
            filled shapes so the gradient reads smoothly at all sizes.
            Centre of the 64×64 canvas; glyphs fit inside the 30-unit
            inner chamber with 4-unit breathing room. */}
        <g fill={`url(#${monoGradId})`}>
          {/* B — spine + two closed bowls, flat-right (Fraunces-ish) */}
          <path d="
            M22.2 22
            h4.1
            q4.8 0 4.8 4.2
            q0 3.0 -2.6 3.8
            q3.1 0.7 3.1 4.3
            q0 4.5 -5.0 4.5
            h-4.4
            z
            M24.5 24.1
            v5.7
            h1.8
            q2.6 0 2.6 -2.9
            q0 -2.8 -2.6 -2.8
            z
            M24.5 31.8
            v5.9
            h2.1
            q2.8 0 2.8 -3.0
            q0 -2.9 -2.8 -2.9
            z
          " />
          {/* N — left stem, diagonal, right stem (wedge serifs) */}
          <path d="
            M34.4 22
            h2.3
            l5.3 10.8
            v-10.8
            h2.3
            v16
            h-2.3
            l-5.3 -10.8
            v10.8
            h-2.3
            z
          " />
        </g>

        {/* Outer frame */}
        <rect x="10" y="10" width="44" height="44" rx="7" fill="none" stroke={`url(#${gradId})`} strokeWidth="4.3" strokeLinejoin="round" />

        {/* Top-edge specular highlight */}
        <path d="M17 10h30a7 7 0 017 7" fill="none" stroke={`url(#${highlightId})`} strokeWidth="4.3" strokeLinecap="round" opacity="0.95" />

        {/* Corner notches — architectural grounding */}
        <g stroke="#FFE2B4" strokeWidth="0.9" strokeLinecap="round" opacity="0.45">
          <path d="M13 10.5v2" /><path d="M10.5 13h2" />
          <path d="M51 10.5v2" /><path d="M51.5 13h2" />
          <path d="M13 51.5v2" /><path d="M10.5 51h2" />
          <path d="M51 51.5v2" /><path d="M51.5 51h2" />
        </g>
      </svg>
    );
  },
);
