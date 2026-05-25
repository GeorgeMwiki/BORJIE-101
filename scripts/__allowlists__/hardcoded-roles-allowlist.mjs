/**
 * Hardcoded-roles allow-list (Piece P).
 *
 * Role-name comparisons (`role === 'admin'`, `role === 'manager'`, etc.)
 * baked into route handlers break the role-policy seam: roles must be
 * resolved through the `authz-policy` package or `awareness-scopes`
 * kernel layer, not string-matched in business logic.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Tier checks T1-T5 (those are the canonical 5-tier model).
 *   - Files in the kernel identity / awareness layer.
 *   - Zod schema declarations that enumerate the role-name union.
 *   - Test / fixture / mock files.
 *
 * Explicit allow-list:
 *   The handful of files that legitimately ARE the role registry / per-
 *   role-prompt routing seam. Every entry carries an ≥ 8-character
 *   justification.
 */

export const HARDCODED_ROLES_ALLOWLIST = new Map([
  // ─── Kernel identity / awareness scopes (the role seam itself) ────
  [
    'packages/central-intelligence/src/kernel/awareness-scopes.ts',
    'awareness-scopes IS the role-to-scope resolver; literal role names are the lookup keys, not business logic.',
  ],
  [
    'packages/database/src/services/kernel-grounding.service.ts',
    'kernel-grounding routes between tenant/owner/manager queries; this IS the role-routing dispatch table.',
  ],
  [
    'packages/database/src/services/platform/users.platform.service.ts',
    'platform users service distinguishes between owner / non-owner provisioning paths during signup.',
  ],
  // ─── Pricing / marketing copy keyed by role ───────────────────────
  [
    'packages/marketing-brain/src/pricing-advisor.ts',
    'pricing-advisor surfaces tier-recommendation copy keyed by user role; copy IS the deliverable.',
  ],

  // ─── Domain-model role-name unions (Zod / type-only declarations) ─
  [
    'packages/domain-models/src/common/enums.ts',
    'Role enum object {ADMIN, OWNER, MANAGER, TENANT, ...} IS the canonical Role enumeration.',
  ],
  [
    'packages/authz-policy/src/system-roles.ts',
    'authz-policy system-roles module IS the role registry — role-name literals here are the canonical declarations.',
  ],
  [
    'apps/estate-manager-app/src/app/ask/[threadId]/page.tsx',
    'Chat-turn role discriminator (user|agent) is a message-shape tag, not a user-permission role policy.',
  ],

  // ─── Per-role copilot / advisor routing seams (added 2026-05-25) ──
  [
    'packages/portal-genui/src/intent/detector.ts',
    'portal-genui intent detector dispatches owner-vs-tenant copilot copy; the role IS the routing key.',
  ],
  [
    'packages/role-aware-advisor/src/data-access-guard.ts',
    'role-aware-advisor data-access-guard IS the per-role data-scope policy table — role literals are lookup keys.',
  ],
  [
    'packages/role-aware-advisor/src/starting-points.ts',
    'role-aware-advisor starting-points IS the per-role onboarding suggestion registry; literals are lookup keys.',
  ],
  [
    'packages/user-context-store/src/data-port.ts',
    'user-context-store data-port routes by owner/tenant role to build the user context payload (dispatch seam).',
  ],
  [
    'packages/user-context-store/src/signals/open-items.ts',
    'open-items signal computes per-role pending-action lists; role literals are the per-role branch selectors.',
  ],
  [
    'services/api-gateway/src/composition/user-context-data-port-adapter.ts',
    'composition root adapter picks owner-vs-tenant data port at wire-time; role string IS the composition key.',
  ],
]);
