/**
 * Anscombe's quartet (1973) — four (x, y) pairs with identical means,
 * variances, and Pearson r despite radically different shapes. Used to
 * verify that none of our descriptive statistics are accidentally
 * fooled by shape.
 *
 * Reference: Anscombe, F. J. (1973). *Graphs in Statistical Analysis.*
 * The American Statistician 27(1):17-21.
 * URL: <https://doi.org/10.1080/00031305.1973.10478966>.
 * Date checked: 2026-05-27.
 */

export const ANSCOMBE_X1 = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5] as const;
export const ANSCOMBE_Y1 = [
  8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68,
] as const;

export const ANSCOMBE_X2 = ANSCOMBE_X1;
export const ANSCOMBE_Y2 = [
  9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74,
] as const;

export const ANSCOMBE_X3 = ANSCOMBE_X1;
export const ANSCOMBE_Y3 = [
  7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73,
] as const;

export const ANSCOMBE_X4 = [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8] as const;
export const ANSCOMBE_Y4 = [
  6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89,
] as const;
