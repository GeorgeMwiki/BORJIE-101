/**
 * Hardcoded-module-list allow-list (Piece P).
 *
 * Tenant-enabled modules (estate, hr, fleet, inventory, maintenance,
 * marketplace, ...) should resolve through the `module_templates`
 * lookup or a per-tenant settings table — not be baked into an inline
 * array.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - Module-template registry files.
 *
 * Explicit allow-list:
 *   The module-template registry definitions themselves. Every entry
 *   carries an ≥ 8-character justification.
 */

export const HARDCODED_MODULE_LIST_ALLOWLIST = new Map([
  // ─── Cross-module signal payloads (signals naming source modules) ──
  // These arrays describe WHICH first-class modules contributed signals
  // to a finding — they are read-only payload labels, NOT a tenant-
  // configurable module-enablement list.
  [
    'packages/ai-copilot/src/intelligence-orchestrator/cross-module-reasoner.ts',
    'sourceModules: [payments, maintenance] labels WHICH modules contributed signals to a finding; payload metadata, not tenant enablement.',
  ],
  [
    'packages/ai-copilot/src/intelligence-orchestrator/intelligent-routing.ts',
    'fetchersToPrime: [payments, maintenance, ...] names cache-prefetchers per intent route; routing-table metadata, not tenant enablement.',
  ],
  [
    'packages/ai-copilot/src/knowledge/case-studies/11-short-cases.ts',
    'tags: [harassment, hr, compliance] are case-study domain tags; knowledge-base labels, not tenant module enablement.',
  ],
  [
    'packages/ai-copilot/src/skills/admin/update-autonomy-policy.ts',
    'Zod-style domain enum [maintenance, finance, ...] declares the policy-scope vocabulary; schema-level enumeration.',
  ],
  [
    'services/api-gateway/src/routes/autonomous-actions-audit.router.ts',
    'Zod enum [finance, leasing, ...] declares the autonomous-actions domain vocabulary; schema-level enumeration.',
  ],
]);
