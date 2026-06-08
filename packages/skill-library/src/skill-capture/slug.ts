/**
 * Slug derivation for captured skills.
 *
 * Turns a describer's NL name into a stable, collision-resistant skill
 * slug matching `SKILL_SLUG_RE` (`/^[a-z][a-z0-9_-]{0,63}$/`). Pure +
 * deterministic — the same name always yields the same base slug; the
 * library's register() guards collisions, and the capture loop appends a
 * short deterministic suffix on collision.
 *
 * @module @borjie/skill-library/skill-capture/slug
 */

import { SKILL_SLUG_RE } from './types.js';

/**
 * Normalise an arbitrary string to a slug. Lowercase, non-alphanumerics
 * collapse to single hyphens, leading non-letters trimmed, length-capped
 * at 64. Returns `'skill'` as a safe fallback when nothing survives.
 */
export function toSkillSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+/g, '-')
    .replace(/-+$/, '')
    .slice(0, 64);
  if (base.length === 0 || !SKILL_SLUG_RE.test(base)) {
    return 'skill';
  }
  return base;
}

/**
 * Append a numeric suffix that keeps the slug within the slug pattern +
 * 64-char cap. Used by the capture loop to resolve a registration
 * collision deterministically (`pay-royalty` → `pay-royalty-2`).
 */
export function suffixSlug(base: string, n: number): string {
  const suffix = `-${n}`;
  const room = 64 - suffix.length;
  const head = base.slice(0, Math.max(1, room)).replace(/-+$/, '');
  const candidate = `${head}${suffix}`;
  return SKILL_SLUG_RE.test(candidate) ? candidate : `skill${suffix}`;
}
