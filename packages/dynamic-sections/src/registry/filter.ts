/**
 * Pure-function section filter. Combines scope filtering + predicate
 * evaluation + stable sort. Same separation-of-concerns rationale as
 * `evaluate.ts` — keeping React out of the core makes it easy to
 * unit-test, reuse server-side, and reason about.
 */

import type { Section, SectionContext } from '../contracts/section.js';
import { evaluatePredicate } from './evaluate.js';

/**
 * Filter a raw section list down to those visible for the supplied
 * context, then sort by `sort_order` (ascending, ties broken by
 * `key`).
 */
export function filterSections(
  sections: readonly Section[],
  context: SectionContext,
): readonly Section[] {
  const scoped = sections.filter((s) => {
    if (!s.scopes || s.scopes.length === 0) return true;
    return s.scopes.includes(context.scope);
  });
  const visible = scoped.filter((s) =>
    evaluatePredicate(s.visibility_predicate, context),
  );
  return [...visible].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.key.localeCompare(b.key);
  });
}
