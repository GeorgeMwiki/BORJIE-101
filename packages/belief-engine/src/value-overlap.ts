/**
 * Value comparison — does a new claim's value AGREE with a prior belief?
 *
 * PURE. Used by the convince-loop to decide between the light "strengthen"
 * pass (overlap) and the heavy contradiction pass (no overlap).
 */

import type { BeliefValue } from './types.js';

/** ±10% counts as scalar agreement. */
export const SCALAR_TOLERANCE_PCT = 0.1;

export function valuesOverlap(a: BeliefValue, b: BeliefValue): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'scalar':
      if (typeof a.scalar !== 'number' || typeof b.scalar !== 'number') {
        return false;
      }
      return scalarsAgree(a.scalar, b.scalar);
    case 'range': {
      const aMin = a.rangeMin ?? -Infinity;
      const aMax = a.rangeMax ?? Infinity;
      const bMin = b.rangeMin ?? -Infinity;
      const bMax = b.rangeMax ?? Infinity;
      return aMin <= bMax && bMin <= aMax;
    }
    case 'categorical':
      return (
        (a.categorical ?? '').toLowerCase() ===
        (b.categorical ?? '').toLowerCase()
      );
    case 'boolean':
      return a.boolean === b.boolean;
    case 'text':
      return (
        (a.text ?? '').toLowerCase().trim() ===
        (b.text ?? '').toLowerCase().trim()
      );
    default:
      return false;
  }
}

function scalarsAgree(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return true;
  return Math.abs(a - b) / denom <= SCALAR_TOLERANCE_PCT;
}
