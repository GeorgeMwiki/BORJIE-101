/**
 * Policy Gate — High-Risk Literal-Only Opt-Out List
 *
 * SECURITY DEFAULT. Action prefixes (or exact verbs) on this list MUST
 * NEVER use reason-based generalisation. Even when a caller omits
 * `skipGeneralization` or passes `false`, `assertTierPolicy` forces
 * literal-only matching for these surfaces.
 *
 * Rationale: token-cosine ≥ 0.7 is a fuzzy match. It is strong enough
 * for read-side capabilities (e.g. `md:list-tenants` → `md:list-leases`)
 * but unacceptable for any action with material blast radius. A
 * disbursement, a payout, a tenant-suspension, a key rotation, a
 * killswitch toggle, or a model pin change must require an exact
 * literal allow-list entry — the brain must never generalise its way
 * into one of these.
 *
 * Adding to this list is a strict tightening (deny narrows). Removing
 * from it requires a four-eye sign-off — see
 * `kernel/four-eye-approval.ts` for the Borjie quorum gate.
 *
 * Two match modes:
 *   - prefix:        ends with ':' — every action starting with the
 *                    prefix is forced literal-only (e.g. `md:transfer-`
 *                    matches `md:transfer-funds` and `md:transfer-deposit`).
 *   - exact verb:    no trailing ':' — only that exact action is
 *                    literal-only (e.g. `md:force-status-change`).
 *
 * @module policy-gate/high-risk-literal-only
 */

export const HIGH_RISK_LITERAL_ONLY_PREFIXES: ReadonlyArray<string> =
  Object.freeze([
    // ─── Platform-sovereign cross-tenant mutations ─────────────────
    'sovereign:',

    // ─── Money movement (the Borjie money path) ────────────────
    // Any payout / disbursement / transfer / settlement / refund must
    // match an exact literal allow-list entry. The reason-based
    // resolver may not infer money-movement from a similar verb name.
    'md:transfer-',
    'md:approve-payout',
    'md:disburse-',
    'md:settle-',
    'md:refund-',
    'md:payout-',
    'md:release-funds',
    'md:adjust-ledger',
    'md:write-off-arrears',

    // ─── Tenancy + lease hard-stops ────────────────────────────────
    // Eviction proposals, lease terminations, and forced-vacancies are
    // not safe to generalise across similar verbs.
    'md:terminate-lease',
    'md:propose-eviction',
    'md:execute-eviction',
    'md:lockout-tenant',

    // ─── Killswitch / kill-switch toggles ──────────────────────────
    'kill_switch:',
    'killswitch:',
    'md:set-killswitch',
    'md:set-kill-switch',

    // ─── Key / secret rotation ─────────────────────────────────────
    'key_rotation:',
    'secret_rotation:',
    'md:rotate-key',
    'md:rotate-secret',

    // ─── Policy + model pin rollouts (production safety surface) ───
    'policy_rollout:',
    'model_pin:',
    'model_version_pin:',
    'md:rollout-policy',
    'md:pin-model-version',

    // ─── Tenant + org suspension levers (hard-stops) ───────────────
    'md:suspend-org',
    'md:suspend-tenant',
    'md:force-logout',
    'md:force-status-change',
    'md:archive-org',

    // ─── Cross-org / cross-tenant disclosure ───────────────────────
    'md:cross-tenant-',
    'md:cross-org-',
  ]);

/**
 * True when `action` falls under one of the high-risk literal-only
 * surfaces. `prefix:` entries match any action starting with the
 * prefix; bare entries match the action exactly.
 *
 * Pure function — no I/O, no allocations beyond the loop variable.
 */
export function isHighRiskLiteralOnly(action: string): boolean {
  for (const entry of HIGH_RISK_LITERAL_ONLY_PREFIXES) {
    if (entry.endsWith(':') || entry.endsWith('-')) {
      if (action.startsWith(entry)) return true;
    } else if (action === entry) {
      return true;
    }
  }
  return false;
}
