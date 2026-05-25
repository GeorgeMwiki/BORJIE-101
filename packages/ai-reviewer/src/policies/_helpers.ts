/**
 * Shared helpers for policy implementations.
 *
 * Internal only — not re-exported from `src/index.ts`. Policies stay
 * pure and synchronous; this module only contains tiny utility builders
 * so each policy file can focus on its domain logic.
 */

import type { ValidationIssue, Severity, SuggestedFix } from '../types.js';

/**
 * Build a typed ValidationIssue without losing readonly on the helper
 * boundary. Existing call sites prefer object literals; this helper
 * is for the cases where a builder reads better.
 */
export function issue(
  code: string,
  message: string,
  severity: Severity,
  field?: string,
  suggestedFix?: SuggestedFix,
): ValidationIssue {
  return {
    code,
    message,
    severity,
    ...(field === undefined ? {} : { field }),
    ...(suggestedFix === undefined ? {} : { suggestedFix }),
  };
}

/**
 * Safe number extraction from an unknown payload field. Returns
 * `undefined` if the value is missing, NaN, or not a number — the
 * caller decides how to issue an error.
 */
export function readNumber(
  payload: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<string>,
): number | undefined {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur !== 'number' || Number.isNaN(cur)) return undefined;
  return cur;
}

/**
 * Safe string extraction.
 */
export function readString(
  payload: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<string>,
): string | undefined {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Safe array extraction.
 */
export function readArray(
  payload: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<string>,
): ReadonlyArray<unknown> | undefined {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return Array.isArray(cur) ? cur : undefined;
}

/**
 * Safe boolean extraction.
 */
export function readBoolean(
  payload: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<string>,
): boolean | undefined {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'boolean' ? cur : undefined;
}
