/**
 * Hono ContextVariableMap augmentation — consolidates every `c.set/c.get` key
 * used across the gateway so route/middleware files don't need per-file
 * overrides (or `@ts-nocheck` blankets).
 *
 * Keep keys loose (`unknown` / broad types). Strict typing is enforced at the
 * service-registry level where the instances are actually constructed.
 *
 * GREEN-API-GW (2026-05-27): expanded to cover every flat `c.set/c.get`
 * key bound by `service-context.middleware.ts` and read by BFF routers.
 * The composition root's `ServiceRegistry` is intentionally NOT re-exported
 * here — routes that need typed access import it directly. The
 * `Record<string, unknown>`-shape on `services` is sufficient for the
 * common `(c.get('services') ?? {}).<slot>` pattern used across BFF
 * routes; per-slot narrowing happens at the call site.
 */

declare module 'hono' {
  interface ContextVariableMap {
    // Request context
    requestId: string;
    actorId: string;
    tenantId: string;
    userId: string;
    user: unknown;
    auth: unknown;
    tenant: unknown;
    countryPlugin: unknown;
    db: unknown;
    /** Composition-root service registry — opaque record at the type
     *  layer so BFF routes can destructure `services?.<slot>?.<method>`
     *  without each route restating the full `ServiceRegistry` shape.
     *  Strict typing is enforced inside the registry itself. The slots
     *  are typed permissively (`unknown` value, indexed access) so
     *  routes can read `services.db`, `services.sublease`, etc. without
     *  hand-stamping types per-slot. Per-slot narrowing happens at the
     *  call site (`if (!db) return ...`). */
    services: { readonly [slot: string]: unknown };
    repos: { readonly [name: string]: unknown };
    useMockData: boolean;

    // Auth + tenant infrastructure
    skipScrub: boolean;
    publicIpHash: string;
    supabaseAuthConfig: unknown;

    // Arrears subsystem
    arrearsEntryLoader: unknown;
    arrearsLedgerPort: unknown;
    arrearsRepo: unknown;
    arrearsService: unknown;

    // Autonomy
    autonomousActionAudit: unknown;
    exceptionInbox: unknown;
    autonomyPolicyService: unknown;

    // Cashback / gamification
    cashbackQueue: unknown;
    gamificationRepo: unknown;
    gamificationService: unknown;

    // Compliance
    complianceExportService: unknown;

    // Financial
    financialProfileService: unknown;

    // GePG
    gepgProvider: unknown;
    gepgRawBody: string;
    gepgSignature: string;

    // Reporting
    interactiveReportService: unknown;
    occupancyTimelineService: unknown;
    riskReportService: unknown;

    // Renewal + approval
    renewalService: unknown;
    approvalDetails: unknown;
    requiresApproval: boolean;
    approvalWorkflowService: unknown;
    moveOutChecklistService: unknown;

    // Cases (Wave 26)
    caseService: unknown;
    caseRepo: unknown;

    // Station master
    stationMasterCoverageRepo: unknown;
    stationMasterRouter: unknown;

    // Wave 12 — AI copilot subsystems
    mcp: unknown;
    agentCertification: unknown;
    classroom: unknown;
    voice: unknown;

    // Wave 26 BFF service shims
    propertyGradingService: unknown;
    creditRatingService: unknown;
    subleaseService: unknown;
    damageDeductionService: unknown;
    conditionalSurveyService: unknown;
    farService: unknown;

    // Persistent stores — bound by service-context.middleware.ts so
    // any route can do `c.get('lessonStore')` etc. and receive the
    // live store (persistent when DATABASE_URL is set, in-memory
    // otherwise). Pre-fix, these reads returned `undefined` and the
    // consumer's fallback path silently dropped writes — see P36
    // wiring-gap audit (Docs/WIRING_GAPS_2026-05-24.md chain 3).
    // `getA2aTaskStore` is the per-tenant factory; routes call it
    // with their auth.tenantId to obtain a tenant-pinned TaskStore.
    lessonStore: unknown;
    wormAuditStore: unknown;
    skillRegistryWriter: unknown;
    aopRegistryStore: unknown;
    getA2aTaskStore: unknown;
  }
}

export {};
