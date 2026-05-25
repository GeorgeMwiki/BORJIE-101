/**
 * Animation conventions — Motion presets.
 *
 * LITFIN ref: src/core/animations/* — single source of truth for
 * timings + easing so the whole product feels coherent. These are
 * returned as plain objects so callers can splat them into framer-
 * motion / motion-one / GSAP equivalents.
 */

export const TIMING = {
  /** Micro-interactions: hover, focus, ripple. */
  micro: 120,
  /** Standard: tooltip, popover, button feedback. */
  small: 180,
  /** Standard: modal open/close, drawer slide. */
  medium: 240,
  /** Large layout shifts: route transitions. */
  large: 320,
  /** Cinematic: hero animations. */
  hero: 520,
} as const;

export const EASING = {
  /** Quick attack, slow release — natural for entry. */
  emphasizedDecel: [0.05, 0.7, 0.1, 1] as const,
  /** Slow attack, quick release — natural for exit. */
  emphasizedAccel: [0.3, 0, 0.8, 0.15] as const,
  /** Symmetric standard ease. */
  standard: [0.4, 0, 0.2, 1] as const,
  linear: [0, 0, 1, 1] as const,
} as const;

export interface MotionPreset {
  readonly initial: Readonly<Record<string, number>>;
  readonly animate: Readonly<Record<string, number>>;
  readonly exit: Readonly<Record<string, number>>;
  readonly transition: {
    readonly duration: number;
    readonly ease: readonly [number, number, number, number];
  };
}

export const PRESETS = {
  tableRowEnter: {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
    transition: { duration: TIMING.small / 1000, ease: EASING.emphasizedDecel },
  } satisfies MotionPreset,
  modalIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
    transition: { duration: TIMING.medium / 1000, ease: EASING.standard },
  } satisfies MotionPreset,
  drawerSlideRight: {
    initial: { opacity: 1, x: 320 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 1, x: 320 },
    transition: { duration: TIMING.medium / 1000, ease: EASING.emphasizedDecel },
  } satisfies MotionPreset,
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: TIMING.small / 1000, ease: EASING.standard },
  } satisfies MotionPreset,
} as const;

/** Honour the user's "prefers-reduced-motion" preference. */
export const reducedMotion = (preset: MotionPreset): MotionPreset => ({
  initial: preset.animate,
  animate: preset.animate,
  exit: preset.animate,
  transition: { duration: 0, ease: EASING.linear },
});
