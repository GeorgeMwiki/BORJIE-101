/**
 * Subgroup discovery — Slice Finder (Chung et al. ICDE 2019).
 *
 * Find slices where the model under-performs. Catches the
 * intersectional case (e.g. women-of-color renting bareland)
 * that aggregate metrics miss.
 */

export { findSlices } from './slice-finder.js';
export { twoSidedBinomialPValue } from './binomial-test.js';
export type { FindSlicesArgs } from './slice-finder.js';
