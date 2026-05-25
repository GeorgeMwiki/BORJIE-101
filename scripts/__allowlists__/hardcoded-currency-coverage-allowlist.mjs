/**
 * Hardcoded-currency-coverage allow-list.
 *
 * Production files that legitimately reference a literal ISO-4217 currency
 * code (`'KES'`, `'TZS'`, `'USD'`, `'EUR'`, `'NGN'`, `'UGX'`, `'GHS'`,
 * `'ZAR'`, `'RWF'`, `'XAF'`, `'XOF'`, `'GBP'`). Test files
 * (`__tests__/`, `*.test.ts`, `*.spec.ts`, `__fixtures__/`) and the
 * jurisdictional registry are auto-allowlisted at the scanner level.
 *
 * The platform's vision is "currency follows the user". Business logic
 * must resolve currency via the `currency_preferences` chain
 * (user → tenant → platform-default) and FX conversion via
 * `normaliseTo(target, sums)`. A literal `'KES'` baked into a route
 * handler defeats that chain.
 *
 * Legitimate categories tracked here:
 *   1. Currency-registry / PII pattern modules — the single source of
 *      truth for "which 3-letter codes is the platform aware of".
 *   2. Domain-model Zod schemas with `currency: data.currency ?? 'USD'`
 *      parse-helper fallbacks (PR #95 H13 establishes USD as the
 *      ultimate-fallback when nothing upstream provided one).
 *   3. FX-rates / currency-conversion service internals — necessarily
 *      reference codes literally because the codes are the domain.
 *   4. Seed / fixture / sandbox bootstrap data.
 *   5. Tracked-gap entries pending migration to `currency_preferences`.
 *
 * Adding a new currency literal to production code → register here with
 * a justification ≥ 8 characters explaining why business logic needs it.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const HARDCODED_CURRENCY_ALLOWLIST = new Map([
  // ─── Currency-registry / PII pattern modules ───────────────────────
  [
    'packages/ai-copilot/src/security/currency-patterns.ts',
    'SUPPORTED_CURRENCY_CODES is the single source of truth for PII-scrubber currency-code recognition.',
  ],
  [
    'packages/domain-models/src/common/enums.ts',
    'Currency enum object {KES,TZS,UGX,...} mirrors the CurrencyCode type alias used across the model layer.',
  ],
  [
    'packages/domain-models/src/common/types.ts',
    'CurrencyCodeSchema lists supported ISO-4217 codes as a Zod union; this is the schema-level enumeration.',
  ],

  // ─── Domain-model Zod schema parse-helper fallbacks (PR #95 H13) ──
  [
    'packages/domain-models/src/financial/arrears-case.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/financial/invoice.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/financial/receipt.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/financial/transaction.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/intelligence/intervention-log.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.costCurrency is absent.',
  ],
  [
    'packages/domain-models/src/legal/case.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/legal/notice.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/maintenance/vendor-assignment.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.rateCurrency is absent.',
  ],
  [
    'packages/domain-models/src/operations/asset.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],
  [
    'packages/domain-models/src/payment/payment-plan.ts',
    'Zod schema parse-helper applies USD as ultimate fallback when data.currency is absent.',
  ],

  // ─── Money / value-object class defaults ──────────────────────────
  [
    'packages/domain-models/src/common/money.ts',
    'Money value-object constructor + static factories default to USD when caller omits explicit currency.',
  ],

  // ─── Compliance-plugin per-country plugin entries (registry) ──────
  [
    'packages/compliance-plugins/src/plugins/kenya.ts',
    'Kenya country plugin declares its own KES currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/tanzania.ts',
    'Tanzania country plugin declares its own TZS currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/uganda.ts',
    'Uganda country plugin declares its own UGX currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/nigeria.ts',
    'Nigeria country plugin declares its own NGN currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/south-africa.ts',
    'South Africa country plugin declares its own ZAR currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/united-states.ts',
    'United States country plugin declares its own USD currency rail; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/ports/payment-rail.port.ts',
    'Payment-rail port default USD scaffold used by per-country plugins that have not yet wired real rails.',
  ],
  [
    'packages/compliance-plugins/src/registry.ts',
    'Compliance-plugin registry default USD scaffold currency for the no-country-resolved fallback.',
  ],

  // ─── Platform-wide constants & schema-level defaults ──────────────
  [
    'packages/config/src/constants.ts',
    'DEFAULT_FALLBACK_CURRENCY = USD is the platform-default tip of the currency_preferences resolution chain.',
  ],
  [
    'packages/design-system/src/lib/utils.ts',
    'formatCurrency utility defaults to USD when caller omits explicit currency arg; UI-only helper.',
  ],

  // ─── FX & currency-conversion service internals ────────────────────
  [
    'packages/database/src/services/currency-preferences.service.ts',
    'Currency-preferences service exposes USD ultimate-fallback constant for the resolution chain.',
  ],
  [
    'packages/database/src/services/currency-rates.service.ts',
    'Currency-rates service normaliseTo() default target USD; FX engine internals legitimately literal.',
  ],
  [
    'packages/database/src/schemas/currency-rates.schema.ts',
    'Drizzle schema column comment lists ISO-4217 examples for the code column.',
  ],
  [
    'packages/database/src/schemas/tenant-finance.schema.ts',
    'Schema documentation comment references former KES literal; current value is currency_preferences row.',
  ],
  [
    'packages/database/src/schemas/negotiation.schema.ts',
    'Schema documentation comment references former KES literal; current value is currency_preferences row.',
  ],

  // ─── Seed / bootstrap / sandbox data ───────────────────────────────
  [
    'packages/database/src/seeds/demo-org-seed.ts',
    'Demo-tenant seed file bootstraps initial currency_preferences rows per country.',
  ],
  [
    'packages/marketing-brain/src/sandbox/sandbox-estate-generator.ts',
    'Sandbox estate generator seeds demo tenant per-country currency_preferences.',
  ],
  [
    'packages/marketing-brain/src/sandbox/sandbox-scenarios.ts',
    'Sandbox marketing-brain scenarios reference legacy KES/TZS/UGX type-union for demo data.',
  ],
  [
    'packages/marketing-brain/src/demo-data-generator.ts',
    'Demo-data generator seeds initial currency mapping per country for sandbox runs.',
  ],

  // ─── Mpesa / regional connector schemas ────────────────────────────
  [
    'packages/connectors/src/adapters/mpesa-adapter.ts',
    'M-Pesa adapter Zod schema declares z.literal(TZS).or(z.literal(KES)) for the rail.',
  ],

  // ─── Central-intelligence kernel: tracked-gap fallbacks ────────────
  [
    'packages/central-intelligence/src/kernel/tools/graph-tools.ts',
    'Graph-tools fallback when Neo4j node has no currency property; tracked-gap pending resolution-chain wiring.',
  ],
  [
    'packages/central-intelligence/src/kernel/sub-mds/kra-filing-assistant/tools/draft-filing.ts',
    'KRA-filing-assistant fallback to KES when batch line has no currency; KRA is Kenya-only by definition.',
  ],
  [
    'packages/central-intelligence/src/kernel/tool-spec/owner-tools/owner.financial_summary.ts',
    'Owner financial-summary fallback to KES for legacy tools; tracked-gap pending currency_preferences wiring.',
  ],
  [
    'packages/central-intelligence/src/kernel/vp-personas/vp-finance/report.ts',
    'VP-finance persona report numericUnit defaults to KES for demo persona; tracked-gap until persona-config lands.',
  ],

  // ─── AI-copilot / chat-UI scoped fallbacks ─────────────────────────
  [
    'packages/ai-copilot/src/ai-native/policy-simulator/index.ts',
    'Policy-simulator falls back to USD when simulated lease set has no currencyCode declared upstream.',
  ],
  [
    'packages/ai-copilot/src/governance/ai-governance.ts',
    'AI-governance default-spend-cap struct uses USD as the platform-default currency for unit-tested limits.',
  ],
  [
    'packages/ai-copilot/src/skills/estate/property-valuation.ts',
    'Property-valuation Zod schema default USD when caller does not specify the comp-listing currency.',
  ],
  [
    'packages/chat-ui/src/generative-ui/block-generator.ts',
    'Generative-UI block-generator default USD when LLM-emitted block omits explicit currency.',
  ],

  // ─── GenUI render-time fallbacks ───────────────────────────────────
  [
    'packages/genui/src/components/Heatmap.tsx',
    'Heatmap formatter fallback to USD when LLM-emitted block omits a currency for the numeric axis.',
  ],

  // ─── Market-intelligence adapter response normalisation ────────────
  [
    'packages/market-intelligence/src/adapters/airbnb.ts',
    'Airbnb listing-normaliser fallback to USD when upstream listing omits a currency field.',
  ],
  [
    'packages/market-intelligence/src/adapters/zillow.ts',
    'Zillow listing-normaliser fallback to USD when upstream listing omits a currency field.',
  ],
  [
    'services/api-gateway/src/adapters/market-rate/airbnb-adapter.ts',
    'Airbnb market-rate adapter sets ?currency=USD on outbound query when caller omits a target currency.',
  ],

  // ─── api-gateway composition / route fallbacks (tracked gaps) ──────
  [
    'services/api-gateway/src/composition/agency-port-bindings.ts',
    'Agency-port-bindings fallback to USD when unit row has no currency; tracked-gap pending currency_preferences.',
  ],
  [
    'services/api-gateway/src/composition/move-out-repository.ts',
    'Move-out-repository fallback to KES for deposit-reconciliation; tracked-gap pending currency_preferences wire.',
  ],
  [
    'services/api-gateway/src/middleware/tenant-context.middleware.ts',
    'Tenant-context middleware default USD for the bootstrap context object; tracked-gap pending tenant FX hydration.',
  ],
  [
    'services/api-gateway/src/routes/bff/owner-portal.ts',
    'Owner-portal BFF fallback to USD for legacy response shape; tracked-gap pending currency_preferences chain.',
  ],
  [
    'services/api-gateway/src/routes/db-mappers.ts',
    'DB-mappers default to USD when row.currency is NULL; tracked-gap pending NOT-NULL migration on legacy tables.',
  ],
  [
    'services/api-gateway/src/routes/invoices.ts',
    'Invoices route default to USD when body.currency omitted; tracked-gap pending Zod schema enforcement.',
  ],
  [
    'services/api-gateway/src/routes/payments.ts',
    'Payments route default to USD when invoice has no currency; tracked-gap pending currency_preferences wire.',
  ],
  [
    'services/api-gateway/src/routes/work-orders.hono.ts',
    'Work-orders route default to USD when body.currency omitted; tracked-gap pending Zod schema enforcement.',
  ],

  // ─── Payout / payment-rail adapter rail-currency gates ─────────────
  [
    'services/api-gateway/src/services/payouts/providers/composite.ts',
    'Composite-payouts gate rejects non-KES disbursements; KES is the payout rails Kenya-only contract.',
  ],
  [
    'services/api-gateway/src/services/payouts/providers/mpesa-b2c-adapter.ts',
    'M-Pesa B2C adapter pins KES because M-Pesa-Kenya rail is denominated in KES by Safaricom contract.',
  ],
  [
    'services/mcp-server-opay/src/adapter-real.ts',
    'OPay adapter pins NGN because OPay-Nigeria rail is denominated in NGN by OPay contract.',
  ],
  [
    'services/payments-ledger/src/providers/stripe-provider.ts',
    'Stripe-provider default-currency mapping per Stripe API contract; rail-specific.',
  ],
  [
    'services/payments-ledger/src/server.ts',
    'Payments-ledger server default USD for the smoke-test bootstrap context; tracked-gap pending currency wire.',
  ],
  [
    'services/payments/src/providers/airtel-money/payment.ts',
    'Airtel-Money adapter pins TZS because Airtel-Money-Tanzania rail is denominated in TZS by Airtel contract.',
  ],
  [
    'services/payments/src/providers/gepg/gepg-client.ts',
    'GePG adapter pins TZS because GePG (Tanzania Govt e-Payment Gateway) is denominated in TZS.',
  ],
  [
    'services/payments/src/providers/mpesa/b2c.ts',
    'M-Pesa B2C provider pins TZS because M-Pesa-Tanzania rail is denominated in TZS by Vodacom contract.',
  ],
  [
    'services/payments/src/providers/mpesa/stk-push.ts',
    'M-Pesa STK-push provider pins TZS because M-Pesa-Tanzania rail is denominated in TZS by Vodacom contract.',
  ],
  [
    'services/payments/src/providers/tanzania-payment-factory.ts',
    'Tanzania-payment factory pins TZS because every Tanzania rail in the factory is denominated in TZS.',
  ],
  [
    'services/payments/src/providers/tigopesa/payment.ts',
    'Tigopesa adapter pins TZS because Tigopesa-Tanzania rail is denominated in TZS by Tigo contract.',
  ],

  // ─── Domain-services tracked-gap fallbacks ─────────────────────────
  [
    'services/domain-services/src/approvals/approval-service.ts',
    'Approval-service default USD when approval-context omits a currency; tracked-gap pending context wire.',
  ],
  [
    'services/domain-services/src/approvals/default-policies.ts',
    'Default-policies default USD for the seed-policy currency-threshold; bootstrap data only.',
  ],
  [
    'services/domain-services/src/payment/index.ts',
    'Payment domain-service default USD when caller omits explicit currency; tracked-gap pending Zod enforcement.',
  ],
  [
    'services/domain-services/src/property/index.ts',
    'Property domain-service default USD when property row omits a currency; tracked-gap pending data migration.',
  ],
  [
    'services/domain-services/src/report/index.ts',
    'Report domain-service default USD when report-context omits a currency; tracked-gap pending tenant FX.',
  ],

  // ─── Reports / compliance export rail-currency ─────────────────────
  [
    'services/reports/src/compliance/compliance-export-service.ts',
    'Compliance-export-service uses jurisdiction currency mapping; KE→KES, TZ→TZS for tax-authority exports.',
  ],
  [
    'services/reports/src/compliance/ke-kra-formatter.ts',
    'KRA formatter pins KES because Kenya Revenue Authority filings are denominated in KES by law.',
  ],

  // ─── Frontend-app UI fallbacks & user-facing currency selectors ────
  [
    'apps/admin-platform-portal/src/app/platform/overview/KpiTiles.tsx',
    'Admin KPI-tiles display USD as the platform-default when no tenant override is set; UI render-time fallback.',
  ],
  [
    'apps/admin-platform-portal/src/lib/api.ts',
    'Admin api helper defaults to USD when currency param omitted; UI fetch helper, not business logic.',
  ],
  [
    'apps/customer-app/src/app/settings/page.tsx',
    'Customer settings currency-picker enumerates KES/USD as the user-selectable currency options.',
  ],
  [
    'apps/customer-app/src/lib/hooks/useCurrencyPreference.ts',
    'Customer-app FALLBACK_CURRENCY = USD constant is the platform-default tip of the resolution chain.',
  ],
  [
    'apps/estate-manager-app/src/app/customers/[id]/page.tsx',
    'Estate-manager page reads NEXT_PUBLIC_TENANT_CURRENCY env var with USD fallback; tracked-gap pending tenant FX.',
  ],
  [
    'apps/estate-manager-app/src/app/utilities/bills/page.tsx',
    'Estate-manager utilities-bills page reads NEXT_PUBLIC_TENANT_CURRENCY with USD fallback; tracked-gap.',
  ],
  [
    'apps/estate-manager-app/src/screens/payments/PaymentsList.tsx',
    'Estate-manager payments-list screen reads NEXT_PUBLIC_TENANT_CURRENCY with USD fallback; tracked-gap.',
  ],
  [
    'apps/estate-manager-app/src/screens/work-orders/WorkOrderDetail.tsx',
    'Estate-manager work-order-detail reads NEXT_PUBLIC_TENANT_CURRENCY with USD fallback; tracked-gap.',
  ],
  [
    'apps/owner-portal/src/lib/api.ts',
    'Owner-portal api helper defaults to USD when currency param omitted; UI fetch helper, not business logic.',
  ],
  [
    'apps/owner-portal/src/pages/ConfigurationPage.tsx',
    'Owner-portal configuration page currency-picker enumerates KES/TZS/USD as user-selectable options.',
  ],
  [
    'apps/owner-portal/src/pages/SettingsPage.tsx',
    'Owner-portal settings page currency-picker enumerates KES/TZS/USD as user-selectable options.',
  ],

  // ─── Currency-registry / domain-data modules ───────────────────────
  [
    'packages/central-intelligence/src/kernel/tools/render-blocks/currency-codes.ts',
    'render-blocks currency-codes.ts IS the ISO-4217 currency-code registry consumed by kernel UI render-block formatter; this module is the single source of truth for which codes the UI may format.',
  ],
  // NOTE: drizzle-ledger-entry.repository.ts and drizzle-payment-intent.repository.ts
  // previously defaulted row.currency to 'KES' as an unreachable fallback (column
  // is NOT NULL in schema). The fallback was replaced with a fail-loud invariant
  // check in Wave 12 (no allowlist entry needed — those files now contain no
  // literal 'KES').

  // ─── TRC (Tanzania Regulatory Council) seeds ──────────────────────
  [
    'packages/database/src/seeds/trc-elastic-config.ts',
    'TRC elastic-config seed bootstraps TZS for Tanzania demo tenant; TZS is Tanzania-only by jurisdiction (seed data).',
  ],
  [
    'packages/database/src/seeds/trc-test-org-seed.ts',
    'TRC test-org seed bootstraps TZS currency for the Tanzania demo tenant; sandbox seed data only.',
  ],

  // ─── ai-copilot eval baseline currency-mapping ────────────────────
  [
    'packages/ai-copilot/src/eval/hallucination-guard.ts',
    'Hallucination-guard eval baseline enumerates per-jurisdiction currency mapping (TZS/KES/UGX) for test scenarios.',
  ],

  // ─── carbon-market-book domain default ────────────────────────────
  [
    'packages/database/src/services/carbon-market-book-service.ts',
    'Carbon-market-book DEFAULT_CURRENCY=USD; voluntary carbon markets are USD-denominated by industry convention.',
  ],

  // ─── document-analysis entity-extractor fallback ──────────────────
  [
    'packages/document-analysis/src/extract/entity-extractor.ts',
    'Document entity-extractor falls back to KES when regex-extracted currency is missing; Kenya-first OCR default.',
  ],

  // ─── openclaw-operating-model: agent-as-a-service invoice ─────────
  [
    'packages/openclaw-operating-model/src/agent-as-a-service/invoice.ts',
    'OpenClaw agent-as-a-service invoice default USD; agent-marketplace billing is USD-denominated by platform convention.',
  ],

  // ─── outcomes-package: DEFAULT_CURRENCY constants + metric fallbacks
  [
    'packages/outcomes/src/catalog.ts',
    'Outcomes catalog DEFAULT_CURRENCY=USD constant is the platform-default for outcomes-metering when tenant FX is missing.',
  ],
  [
    'packages/outcomes/src/rent-collected-metric.ts',
    'Rent-collected metric falls back to USD when unit row has no currency; tracked-gap pending currency_preferences wire.',
  ],
  [
    'packages/outcomes/src/ticket-resolved-metric.ts',
    'Ticket-resolved metric falls back to USD when unit row has no currency; tracked-gap pending currency_preferences wire.',
  ],
  [
    'packages/outcomes/src/vacancy-filled-metric.ts',
    'Vacancy-filled metric falls back to USD when unit row has no currency; tracked-gap pending currency_preferences wire.',
  ],

  // ─── procurement-coordination: approvals + requisitions defaults ──
  [
    'packages/procurement-coordination/src/approvals/approval-engine.ts',
    'Procurement approval-engine default-policy thresholds use USD as the seed currency; tracked-gap pending tenant FX.',
  ],
  [
    'packages/procurement-coordination/src/requisitions/requisitions.ts',
    'Procurement requisitions default USD when items[0] has no currency; tracked-gap pending currency_preferences wire.',
  ],

  // ─── user-context-store: profile-loader fallbacks ─────────────────
  [
    'packages/user-context-store/src/profile/owner-profile.ts',
    'Owner-profile loader falls back to KES when row.default_currency is null; Kenya-first profile default.',
  ],
  [
    'packages/user-context-store/src/profile/tenant-profile.ts',
    'Tenant-profile loader falls back to KES when row.currency is null; Kenya-first profile default (tracked-gap).',
  ],

  // ─── api-gateway: marketplace in-memory data-port + lease-expiry ──
  [
    'services/api-gateway/src/routes/marketplace/in-memory-data-port.ts',
    'Marketplace in-memory data-port is demo/stub data (KES default for Kenya-first demo); sandbox/bootstrap data only.',
  ],
  [
    'services/api-gateway/src/workers/lease-expiry-alert-cron.ts',
    'Lease-expiry alert worker falls back to TZS when r.rent_currency is null; tracked-gap pending NOT-NULL migration.',
  ],

  // ─── outcomes-metering: brain-event consumer + billing-store ──────
  [
    'services/outcomes-metering/src/consumers/brain-event-consumer.ts',
    'Brain-event consumer falls back to USD when payload omits currency; tracked-gap pending event schema enforcement.',
  ],
  [
    'services/outcomes-metering/src/store/billing-store.ts',
    'Billing-store dominant-currency default USD when no events collected; tracked-gap pending tenant-default FX.',
  ],

  // ─── admin-platform-portal acquisition-advisor demo data ──────────
  [
    'apps/admin-platform-portal/src/app/advisor/acquisition/AcquisitionAdvisorClient.tsx',
    'Admin acquisition-advisor demo client uses USD as the platform-default currency for sample-acquisition deal inputs.',
  ],
]);
