/**
 * Hardcoded-bank-coverage allow-list.
 *
 * Production files that legitimately reference a literal payment-rail /
 * tax-authority / KYC-provider name (`'mpesa'`, `'airtel'`, `'kra'`,
 * `'nida'`, `'gepg'`, `'opay'`, `'firs'`, `'nggis'`, etc.). Test files
 * and fixture files are auto-allowlisted at the scanner level.
 *
 * The platform's vision: provider routing must go through
 * `packages/connectors/src/registry.ts` (the connector registry) and
 * concrete provider names belong inside
 * `packages/connectors/src/adapters/`. A literal `'mpesa'` baked into a
 * business path silently couples that path to one provider.
 *
 * Legitimate categories tracked here:
 *   1. Domain-model Zod enums that enumerate the platform's currently-
 *      supported payment-method / provider types — these are the
 *      schema-level enumeration of WHICH providers exist (not which
 *      one to route to).
 *   2. Knowledge / persona / drift / PII catalogues that need provider
 *      names as detection patterns (e.g. detect "mpesa pin" in chat).
 *   3. Route-prefix / OpenAPI mounting tables that pin a Hono sub-router
 *      to its provider-specific URL prefix (`/gepg`, `/mpesa`).
 *   4. Composition / port-binding wires that pass typed adapter handles
 *      (the literal here is the property NAME on a DI container).
 *   5. Frontend UI pages that present a provider-specific flow
 *      (e.g. `apps/customer-app/src/app/payments/mpesa/page.tsx` IS
 *      the M-Pesa flow's UI).
 *
 * Adding a new provider literal in business logic → register here with a
 * justification ≥ 8 characters, OR route through the connector registry.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const HARDCODED_BANK_ALLOWLIST = new Map([
  // ─── Domain-model Zod enums / type unions ─────────────────────────
  [
    'packages/database/src/schemas/payment.schema.ts',
    'Drizzle schema payment-method enum lists supported providers; this IS the schema-level registry.',
  ],
  [
    'packages/domain-models/src/common/enums.ts',
    'Domain-model PaymentMethod enum maps MPESA → mpesa as the schema-level provider enumeration.',
  ],
  [
    'packages/domain-models/src/financial/transaction.ts',
    'Transaction Zod enum lists supported payment providers including mpesa as the canonical token.',
  ],
  [
    'packages/domain-models/src/maintenance/vendor.ts',
    'Vendor preferredPaymentMethod type union lists supported methods; mpesa is the canonical token.',
  ],
  [
    'packages/domain-models/src/payments/payment-method.ts',
    'PaymentMethod discriminated-union lists supported providers; mpesa is the canonical token.',
  ],

  // ─── Knowledge / case-study / persona / detection catalogues ──────
  [
    'packages/ai-copilot/src/knowledge/case-studies/11-short-cases.ts',
    'Knowledge case-study tags reference gepg/kra/mpesa as content discoverability metadata.',
  ],
  [
    'packages/ai-copilot/src/knowledge/platform-seed.ts',
    'Platform-seed playbook tags reference kra/mpesa/gepg as content discoverability metadata.',
  ],
  [
    'packages/ai-copilot/src/knowledge/policy-packs.ts',
    'Policy-pack tags reference kra/tra/ura as jurisdiction-scoped content discoverability metadata.',
  ],
  [
    'packages/ai-copilot/src/personas/sub-persona-types.ts',
    'Sub-persona-types enumerate mpesa/kra as canonical persona-domain identifiers in the persona registry.',
  ],
  [
    'packages/central-intelligence/src/kernel/critics/constitutional-critic.ts',
    'Constitutional-critic inviolable-ip pattern detects mpesa/till/api-key as secret-leak keywords in PII scrub.',
  ],
  [
    'packages/central-intelligence/src/kernel/drift-detector.ts',
    'Drift-detector keyword list includes kra/rera/pdpa as authority-name signals for drift classification.',
  ],
  [
    'packages/central-intelligence/src/kernel/tool-spec/hq-tools/index.ts',
    'HQ-tools type-spec exposes nida property name on the SeedHqBrainToolsDeps DI container.',
  ],

  // ─── api-gateway composition wires / mounted routers ──────────────
  [
    'services/api-gateway/src/composition/hq-tool-port-bindings.ts',
    'HQ-tool port-bindings access SeedHqBrainToolsDeps[nida] property; literal is DI-container key, not routing.',
  ],
  [
    'services/api-gateway/src/composition/hq-tool-registry.ts',
    'HQ-tool registry access SeedHqBrainToolsDeps[nida] property; literal is DI-container key, not routing.',
  ],
  [
    'services/api-gateway/src/health/deep-health.ts',
    'Deep-health probe enumerates per-rail health-check names (gepg, mpesa) for observability dashboard.',
  ],
  [
    'services/api-gateway/src/index.ts',
    'Hono index mounts router subtrees under /gepg, /mpesa URL prefixes; literal is the route prefix, not logic.',
  ],
  [
    'services/api-gateway/src/openapi/export-cli.ts',
    'OpenAPI export-cli enumerates mounted router prefixes (/gepg) for the spec export step.',
  ],
  [
    'services/api-gateway/src/openapi/mounted-routers.ts',
    'Mounted-routers table pins router subtrees to /gepg, /mpesa URL prefixes for the OpenAPI registry.',
  ],
  [
    'services/api-gateway/src/routes/parity-capability-dashboard.router.ts',
    'Parity-capability dashboard enumerates per-rail status rows by canonical slug (mpesa, gepg, kra).',
  ],

  // ─── Document-intelligence + payments-ledger provider modules ─────
  [
    'services/document-intelligence/src/utils/name-matcher.ts',
    'Name-matcher utility enumerates common bank-name aliases (mpesa, airtel-money) for OCR fuzzy match.',
  ],
  [
    'services/payments-ledger/src/providers/mpesa-provider.ts',
    'M-Pesa provider module in payments-ledger is the M-Pesa adapter; literal is the adapter identity.',
  ],
  [
    'services/payments-ledger/src/server.ts',
    'Payments-ledger server enumerates provider names for the boot-time provider-resolution map.',
  ],

  // ─── Frontend-app provider-specific UI pages ──────────────────────
  [
    'apps/admin-platform-portal/src/app/mission-eval/MissionEvalClient.tsx',
    'Mission-eval UI references mpesa/kra as eval-scenario filter tokens; UI tag, not routing decision.',
  ],
  [
    'apps/admin-platform-portal/src/lib/session-replay/pii-mask.ts',
    'PII-mask uses mpesa as a detection keyword for session-replay redaction; observability tool.',
  ],
  [
    'apps/customer-app/src/app/payments/mpesa/page.tsx',
    'Customer-app M-Pesa payment page IS the M-Pesa-specific UI flow; literal is the flow identity.',
  ],
  [
    'apps/customer-app/src/app/payments/pay/page.tsx',
    'Customer-app pay page dispatches by provider slug (mpesa/card) to the matching downstream flow.',
  ],
  [
    'packages/file-ingest/src/proposal/heuristic-map.ts',
    'Heuristic mapping of CSV column headers to entity attributes; "nida" is the KE national-ID schema-attribute label, not a routing decision.',
  ],
  [
    'apps/customer-app/src/components/documents/MoveOutNoticeForm.tsx',
    'Move-out notice form distinguishes refund-method preference (mpesa vs bank_transfer); UI dispatch, not provider routing.',
  ],
  [
    'packages/dynamic-sections/src/lib/adaptive-layout/policies/intent-policy.ts',
    'Adaptive-layout intent-policy compliance bucket contains kra/gepg as substring matchers for section IDs (e.g. detect "kra-filings" section); UI section-ID tokens, not provider routing.',
  ],

  // ─── WZ-CI-GREEN 2026-05-25: new sources flagged after WX/WY merges ─
  [
    'packages/database/src/seeds/trc-elastic-config.ts',
    'TRC elastic-config seed binds Tanzania jurisdiction default payment-provider to gepg — schema-level enumeration of the seeded default, not provider routing.',
  ],
  [
    'packages/document-analysis/src/extract/doc-classifier.ts',
    'Document classifier weight matrix uses gepg/nida as detection keywords for KE/TZ compliance documents — text-detection patterns, not provider routing.',
  ],
  [
    'packages/litfin-port-security-extra/src/webhook-signatures.ts',
    'LITFIN-port webhook-signature verifier dispatches by provider vendor (mpesa/gepg) to the matching HMAC scheme — signature-verification dispatch, not provider routing.',
  ],
  [
    'packages/payments-event-store/src/events.ts',
    'Payments event-store provider field is the schema-level enumeration of supported payment rails (mpesa|stripe|bank-transfer) — domain-model Zod enum, not provider routing.',
  ],
  [
    'packages/tab-need-detector/src/scoring-matrix.ts',
    'Tab-need-detector scoring matrix uses kra/tra as compliance-keyword detection tokens (e.g. detect "kra-filing" tab need); UI-tab-need detection patterns, not provider routing.',
  ],
  [
    'services/api-gateway/src/routes/gepg.router.ts',
    'GePG router IS the GePG-specific sub-router — provider literal in withSecurityEvents action/resource is the route identity, mounted at /gepg prefix.',
  ],
]);
