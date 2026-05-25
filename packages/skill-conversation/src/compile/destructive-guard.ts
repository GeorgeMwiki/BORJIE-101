/**
 * Destructive-tool blocklist + four-eye scope check.
 *
 * The AOP compiler's permission-validator already verifies that every
 * destructive-tier tool is preceded by an ask-owner or 4-eye hook. This
 * module adds two additional checks specific to skill-by-conversation:
 *
 *   1. **Owner-customer scope can't use 4-eye-only tools.** If a tool requires
 *      *four-eye approval by policy*, only internal-admin scope may author a
 *      skill that uses it. Owner-customers see a polite rejection.
 *
 *   2. **Internal-admin scope can't pre-approve destructive tools.** Even an
 *      admin must keep the ask-owner hook for tools like
 *      `notice.draft_eviction_notice` because the tenant of record (not the
 *      admin) is the owner. Removing it would break tenant authority.
 *
 * These are scope-policy decisions, *not* per-tenant settings. They live here
 * because they ride the chat handoff boundary.
 */

import type { AOP } from '@borjie/aop-compiler';
import type { SkillScope, ValidationError } from '../types.js';

/**
 * Tools that owner-customer-scoped skills must NOT use. The wire-side
 * registry will enforce this at deploy time as well; we enforce it at
 * compile time so the owner sees a clean chat rejection instead of an
 * opaque execution failure later.
 */
const OWNER_CUSTOMER_FORBIDDEN_TOOLS: ReadonlySet<string> = Object.freeze(
  new Set([
    // Platform-admin-only ops
    'platform.update_autonomy_cap',
    'platform.disable_tenant',
    'platform.update_sub_md_policy',
    'platform.rotate_tenant_secrets',
    // Sovereign actions
    'sovereign.execute',
    'sovereign.rollback',
  ]),
) as ReadonlySet<string>;

/**
 * Tools that internal-admin scope must still gate with an ask-owner hook
 * targeting the tenant. Admins can author the SOP, but the runtime still
 * pauses for the tenant's approval before firing.
 */
const TENANT_AUTHORITY_TOOLS: ReadonlySet<string> = Object.freeze(
  new Set([
    'notice.draft_eviction_notice',
    'lease.terminate',
    'tenant.evict',
    'billing.refund',
    'billing.chargeback',
  ]),
) as ReadonlySet<string>;

function* walk(steps: AOP['steps']): Generator<AOP['steps'][number]> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') yield* walk(step.body);
  }
}

/**
 * Returns the scope-policy errors for an AOP. Pure: same input → same output.
 */
export function validateScopePolicy(
  ast: AOP,
  scope: SkillScope,
): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  // Index hooks by their on_approve target, so we can check tenant-authority
  // guards quickly.
  const guardedByAskOwner = new Set<string>();
  for (const step of walk(ast.steps)) {
    if (step.kind === 'hook' && step.hook === 'ask-owner' && step.on_approve !== undefined) {
      guardedByAskOwner.add(step.on_approve);
    }
  }

  for (const step of walk(ast.steps)) {
    if (step.kind !== 'tool') continue;

    // Owner-customer scope cannot use platform tools.
    if (scope === 'owner-customer' && OWNER_CUSTOMER_FORBIDDEN_TOOLS.has(step.tool)) {
      errors.push({
        code: 'scope-forbidden-tool',
        message: `Tool "${step.tool}" is only available to internal-admin scope (step "${step.id}")`,
        path: ['steps', step.id, 'tool'],
      });
    }

    // Tenant-authority tools always need an ask-owner guard, even for admins.
    if (TENANT_AUTHORITY_TOOLS.has(step.tool) && !guardedByAskOwner.has(step.id)) {
      errors.push({
        code: 'tenant-authority-unguarded',
        message: `Tool "${step.tool}" affects the tenant directly and must be preceded by an ask-owner hook (step "${step.id}")`,
        path: ['steps', step.id, 'tool'],
      });
    }
  }

  return Object.freeze(errors);
}

/**
 * Read-only access for tests + the registry surface.
 */
export const SCOPE_POLICY = Object.freeze({
  ownerCustomerForbidden: Array.from(OWNER_CUSTOMER_FORBIDDEN_TOOLS),
  tenantAuthority: Array.from(TENANT_AUTHORITY_TOOLS),
}) as Readonly<{
  ownerCustomerForbidden: ReadonlyArray<string>;
  tenantAuthority: ReadonlyArray<string>;
}>;
