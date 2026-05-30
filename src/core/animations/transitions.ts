// ---------------------------------------------------------------------------
// CSS Transition Utilities (Tailwind class strings)
// Use these instead of inline transition styles for consistency.
//
// Easings are named in tailwind.config.ts (theme.extend.transitionTimingFunction)
// to avoid class-ambiguity warnings the JIT engine raises against arbitrary
// inline cubic-bezier values. Use the named tokens (ease-material-standard,
// ease-spring-out, ease-smooth-out) defined in the config, not arbitrary
// inline easing values.
// ---------------------------------------------------------------------------

/** Smooth layout changes (position, size, padding, margin) */
export const layoutTransition =
  "transition-all duration-300 ease-material-standard" as const;

/** Color-only transitions (background, text, border) */
export const colorTransition =
  "transition-colors duration-200 ease-material-standard" as const;

/** Opacity fades */
export const opacityTransition =
  "transition-opacity duration-200 ease-material-standard" as const;

/** Transform animations (scale, rotate, translate) with spring-like easing */
export const transformTransition =
  "transition-transform duration-200 ease-spring-out" as const;

/** Fast catch-all for micro-interactions (hover, focus) */
export const allFast =
  "transition-all duration-150 ease-material-standard" as const;

// ---- Convenience map -------------------------------------------------------

export const CSS_TRANSITIONS = {
  layout: layoutTransition,
  color: colorTransition,
  opacity: opacityTransition,
  transform: transformTransition,
  fast: allFast,
} as const;
