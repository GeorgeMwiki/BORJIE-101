/**
 * Scope routing helpers.
 *
 * The `compileSkillFromNL` entry point accepts a `scope` argument and decides
 * whether tenantId is required, which tool blocklist applies, and how the
 * resulting skill is listed (per-tenant vs platform-wide).
 *
 * This module owns those policy decisions as pure functions so the chat
 * surface and tests can reason about them without invoking the full
 * compile pipeline.
 */

import type { SkillScope } from '../types.js';

export interface ScopePolicy {
  readonly tenantIdRequired: boolean;
  /**
   * When true, an internal-admin skill with no tenantId is broadcast to every
   * tenant ("platform-wide"). Owner-customer skills are always per-tenant.
   */
  readonly platformWideAllowed: boolean;
  /**
   * Human label used in chat — e.g. "your skill" vs "the platform skill".
   */
  readonly chatNoun: string;
}

const POLICIES: Readonly<Record<SkillScope, ScopePolicy>> = Object.freeze({
  'owner-customer': Object.freeze({
    tenantIdRequired: true,
    platformWideAllowed: false,
    chatNoun: 'your skill',
  }),
  'internal-admin': Object.freeze({
    tenantIdRequired: false,
    platformWideAllowed: true,
    chatNoun: 'the platform skill',
  }),
});

export function policyFor(scope: SkillScope): ScopePolicy {
  return POLICIES[scope];
}

/**
 * Validate a (scope, tenantId) pair against the scope policy. Returns null
 * when ok, or a string error message when invalid.
 */
export function validateScopeArgs(
  scope: SkillScope,
  tenantId: string | null,
): string | null {
  const policy = policyFor(scope);
  if (policy.tenantIdRequired && !tenantId) {
    return `scope "${scope}" requires a tenantId`;
  }
  if (!policy.platformWideAllowed && tenantId === null) {
    return `scope "${scope}" cannot be platform-wide`;
  }
  return null;
}

/**
 * Is this skill platform-wide? True only for internal-admin entries with
 * `tenantId === null`.
 */
export function isPlatformWide(args: {
  readonly scope: SkillScope;
  readonly tenantId: string | null;
}): boolean {
  return args.scope === 'internal-admin' && args.tenantId === null;
}
