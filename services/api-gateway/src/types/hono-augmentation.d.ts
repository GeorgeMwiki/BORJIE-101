/**
 * Hono ContextVariableMap augmentation — consolidates every `c.set/c.get` key
 * used across the gateway so route/middleware files don't need per-file
 * overrides (or `@ts-nocheck` blankets).
 *
 * Keep keys loose (`unknown` / broad types). Strict typing is enforced at the
 * service-registry level where the instances are actually constructed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    services: unknown;
    repos: unknown;

    // Arrears subsystem
    arrearsEntryLoader: unknown;
    arrearsLedgerPort: unknown;
    arrearsRepo: unknown;
    arrearsService: unknown;

    // Autonomy
    autonomousActionAudit: unknown;
    exceptionInbox: unknown;

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

    // Station master
    stationMasterCoverageRepo: unknown;
    stationMasterRouter: unknown;

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
