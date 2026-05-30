// ---------------------------------------------------------------------------
// Framer Motion spring and transition presets
// Centralized animation tokens for consistent motion across the UI.
// ---------------------------------------------------------------------------

// ---- Spring configs --------------------------------------------------------

export interface SpringConfig {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}

export const snappy: SpringConfig = {
  type: "spring",
  stiffness: 500,
  damping: 30,
} as const;

export const smooth: SpringConfig = {
  type: "spring",
  stiffness: 300,
  damping: 25,
} as const;

export const bouncy: SpringConfig = {
  type: "spring",
  stiffness: 400,
  damping: 15,
  mass: 0.8,
} as const;

export const gentle: SpringConfig = {
  type: "spring",
  stiffness: 200,
  damping: 20,
} as const;

// ---- Transition presets ----------------------------------------------------

export interface TransitionPreset {
  readonly initial: Readonly<Record<string, number | string>>;
  readonly animate: Readonly<Record<string, number | string>>;
  readonly transition: Readonly<
    Record<string, number | string | ReadonlyArray<number>>
  >;
}

export const fadeIn: TransitionPreset = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.2 },
} as const;

export const slideUp: TransitionPreset = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
} as const;

export const scaleIn: TransitionPreset = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.2 },
} as const;

export const expandWidth: TransitionPreset = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  transition: { duration: 0.3 },
} as const;

// ---- Convenience map -------------------------------------------------------

export const SPRING_PRESETS = {
  snappy,
  smooth,
  bouncy,
  gentle,
} as const;

export const TRANSITION_PRESETS = {
  fadeIn,
  slideUp,
  scaleIn,
  expandWidth,
} as const;
