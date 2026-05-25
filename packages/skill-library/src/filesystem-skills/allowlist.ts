/**
 * Session-scoped skill allowlist enforcement.
 *
 * The CLAUDE Code pattern (R1 §E.2): the `skills` option on `query()` is a
 * CONTEXT FILTER, not a sandbox — unlisted skills are hidden from the
 * model but their files remain on disk and reachable via Read/Bash.
 *
 * We surface that distinction explicitly: `applyAllowlist` returns a
 * filtered list for the model + an `excluded` list for telemetry. Tests
 * verify the contract: unlisted skills are excluded from the model view.
 */

import type { DiscoveredSkill } from './types.js';

export interface AllowlistResult {
  /** Skills surfaced to the model (allowlisted). */
  readonly allowed: ReadonlyArray<DiscoveredSkill>;
  /** Skills excluded (on disk but not visible). */
  readonly excluded: ReadonlyArray<DiscoveredSkill>;
}

/**
 * Filter discovered skills by a session-scoped allowlist.
 *
 *   • `null` or `undefined` allowlist → "all skills allowed" (no filter).
 *   • Empty array → "no skills" (full deny).
 *   • Non-empty array → only listed names are allowed.
 *
 * Names are compared exactly (case-sensitive — skill names are slugs).
 */
export function applyAllowlist(
  skills: ReadonlyArray<DiscoveredSkill>,
  allowlist: ReadonlyArray<string> | null | undefined
): AllowlistResult {
  if (allowlist === null || allowlist === undefined) {
    return { allowed: skills, excluded: [] };
  }
  const allowSet = new Set(allowlist);
  const allowed: Array<DiscoveredSkill> = [];
  const excluded: Array<DiscoveredSkill> = [];
  for (const skill of skills) {
    if (allowSet.has(skill.manifest.name)) {
      allowed.push(skill);
    } else {
      excluded.push(skill);
    }
  }
  return { allowed, excluded };
}

/**
 * Tenant-scope rule: a jurisdiction-aware skill can only run inside a
 * tenant scope (never platform-only) because jurisdiction must be supplied
 * by the tenant. Platform discoveries of jurisdiction-aware skills are
 * excluded with a reason — they ARE on disk and inspectable; they're not
 * surfaced to model contexts that lack tenant binding.
 */
export function filterJurisdictionMisuse(
  skills: ReadonlyArray<DiscoveredSkill>
): { readonly safe: ReadonlyArray<DiscoveredSkill>; readonly excluded_for_jurisdiction: ReadonlyArray<DiscoveredSkill> } {
  const safe: Array<DiscoveredSkill> = [];
  const excluded: Array<DiscoveredSkill> = [];
  for (const s of skills) {
    if (s.manifest.jurisdiction_aware && s.scope.kind === 'platform') {
      excluded.push(s);
    } else {
      safe.push(s);
    }
  }
  return { safe, excluded_for_jurisdiction: excluded };
}
