/**
 * `@borjie/user-context-store` — public types.
 *
 * Cohesive, role-aware type surface. Mirrors the DataPort contract P7
 * is defining in `@borjie/role-aware-advisor`: when P7 lands the
 * final version we reconcile by re-exporting from there. Until then,
 * we own the definitive shape so consumers can import without a circular
 * workspace edge.
 *
 * NOTE: All currency amounts are in MINOR UNITS (TZS cents, KES cents).
 * Use packages/domain-models money helpers to format for display.
 */

// ---------------------------------------------------------------------------
// Role enum — must match the application-wide role taxonomy
// ---------------------------------------------------------------------------

/**
 * Roles that consume the advisor. Aligned with the application's RBAC
 * vocabulary; new roles must be added to both this enum and P7's guard.
 */
export type Role =
  | 'tenant'
  | 'owner'
  | 'pm'
  | 'estate_mgr'
  | 'admin'
  | 'prospect';

// ---------------------------------------------------------------------------
// DataPort contract (mirrors P7's interface in role-aware-advisor)
// ---------------------------------------------------------------------------

/**
 * Citation kind taxonomy. Lets the UI render the right "view source"
 * affordance per snippet. Free-form `string` to stay tolerant of new
 * sources P7 adds later; the well-known values document our coverage.
 */
export type CitationKind =
  | 'lease'
  | 'invoice'
  | 'payment'
  | 'maintenance'
  | 'unit'
  | 'property'
  | 'utility_bill'
  | 'document'
  | 'communication'
  | 'profile'
  | 'signal'
  | 'trigger'
  | 'lead'
  | (string & {});

export interface Citation {
  /** What kind of record this snippet derives from. */
  kind: CitationKind;
  /** Stable database id of the record. */
  id: string;
  /** Optional column / field if the snippet is a single attribute. */
  field?: string;
}

/**
 * A typed evidence unit fed into the advisor's prompt. P7's grading
 * layer attaches `confidence` weights when blending; we set a sensible
 * default based on freshness + source authority.
 */
export interface Snippet {
  /** Human-readable label of the source (e.g. "lease #LSE-0042"). */
  source: string;
  /** The actual content the LLM should read. Already PII-minimized. */
  content: string;
  /** Pointer back to the underlying record. */
  citation: Citation;
  /**
   * Float in [0, 1]. Reflects how confident the data layer is that
   * this snippet answers the (intent, question) pair. Recency, source
   * authority, and direct relevance all bump confidence.
   */
  confidence: number;
  /** ISO-8601 timestamp of when the source record was last updated. */
  timestamp?: string;
}

/**
 * What P7 calls. We satisfy this in `data-port.ts`.
 */
export interface DataPort {
  fetchSnippets(args: {
    role: Role;
    tenantId: string;
    userId: string;
    intent: string;
    question: string;
  }): Promise<Snippet[]>;
}

// ---------------------------------------------------------------------------
// Profile dossiers — one per role
// ---------------------------------------------------------------------------

/** Anything we know about a user identity-wise — common to every role. */
export interface IdentityFacts {
  userId: string;
  tenantId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  status?: string;
  timezone?: string;
  locale?: string;
  lastLoginAt?: string;
  lastActivityAt?: string;
  preferences?: Record<string, unknown>;
}

/** Unit-level facts: floor, type, capacity, status. */
export interface UnitFacts {
  unitId: string;
  unitNumber: string;
  floor?: number;
  type?: string;
  bedrooms?: number;
  bathrooms?: number;
  sizeSqm?: number;
  status?: string;
  rentAmount?: number;
  currency?: string;
}

/** Property-level facts: type, address, EUI, HVAC. */
export interface PropertyFacts {
  propertyId: string;
  propertyCode: string;
  name: string;
  type?: string;
  city?: string;
  country?: string;
  yearBuilt?: number;
  totalUnits?: number;
  /** Energy Use Intensity — kWh per sqm per year. From utilities aggregate. */
  euiKwhPerSqmYr?: number;
  hvacType?: string;
}

/** Lease snapshot — current OR historical. */
export interface LeaseSnapshot {
  leaseId: string;
  leaseNumber: string;
  status: string;
  startDate?: string;
  endDate?: string;
  rentAmount?: number;
  rentCurrency?: string;
  rentFrequency?: string;
  renewalStatus?: string;
}

/** Per-month payment aggregate over the last 24 months. */
export interface PaymentMonth {
  month: string; // YYYY-MM
  totalCharged: number;
  totalPaid: number;
  balance: number;
  daysLate?: number;
  currency: string;
}

/** Maintenance request — open or recently closed. */
export interface MaintenanceItem {
  workOrderId: string;
  workOrderNumber: string;
  category: string;
  priority: string;
  status: string;
  submittedAt: string;
  closedAt?: string;
  description?: string;
}

/** Recent communication touchpoint (sent/received). */
export interface CommunicationTouchpoint {
  channel: string;
  direction: 'inbound' | 'outbound';
  category?: string;
  timestamp: string;
  preview?: string;
}

/** Household composition (occupants beyond the lease signer). */
export interface HouseholdComposition {
  adults: number;
  children: number;
  pets: number;
  notes?: string;
}

/** Tenant-role full dossier. */
export interface TenantProfile {
  identity: IdentityFacts;
  unit?: UnitFacts;
  property?: PropertyFacts;
  currentLease?: LeaseSnapshot;
  leaseHistory?: ReadonlyArray<LeaseSnapshot>;
  paymentHistory24m?: ReadonlyArray<PaymentMonth>;
  openMaintenance?: ReadonlyArray<MaintenanceItem>;
  closedMaintenance12m?: ReadonlyArray<MaintenanceItem>;
  communications90d?: ReadonlyArray<CommunicationTouchpoint>;
  household?: HouseholdComposition;
  preferences?: Record<string, unknown>;
}

/** Per-property financial position (NOI, mortgage, cap rate). */
export interface OwnerPropertyFinancials {
  propertyId: string;
  propertyName: string;
  noiAnnualized?: number;
  capRatePct?: number;
  mortgageOutstanding?: number;
  insuranceExpiresAt?: string;
  taxPosition?: number;
  occupancyPct?: number;
  capex12mTotal?: number;
  tenantChurnPct?: number;
  currency: string;
}

/** Owner-role full dossier. */
export interface OwnerProfile {
  identity: IdentityFacts;
  properties: ReadonlyArray<OwnerPropertyFinancials>;
  occupancyTrend?: ReadonlyArray<{ month: string; occupancyPct: number }>;
  totalPortfolioNoi?: number;
  totalMortgage?: number;
  preferences?: Record<string, unknown>;
}

/** PM-role full dossier. */
export interface PMProfile {
  identity: IdentityFacts;
  managedProperties: ReadonlyArray<{ propertyId: string; name: string }>;
  staffUnderMgmt?: ReadonlyArray<{ userId: string; name: string; role?: string }>;
  kpis?: {
    avgResponseTimeMinutes?: number;
    occupancyPct?: number;
    escalationsLast30d?: number;
    workOrdersClosedLast30d?: number;
    slaBreachesLast30d?: number;
  };
  vendors?: ReadonlyArray<{ vendorId: string; companyName: string; status?: string }>;
  preferences?: Record<string, unknown>;
}

/** Estate-manager dossier — campus-level. */
export interface EstateMgrProfile {
  identity: IdentityFacts;
  buildings: ReadonlyArray<{ buildingId: string; name: string; unitCount?: number }>;
  residentsCount?: number;
  servicesActive?: ReadonlyArray<string>;
  energyConsumptionKwh12m?: number;
  waterConsumptionM3_12m?: number;
  capexPipeline?: ReadonlyArray<{ id: string; description: string; estimatedAmount: number; currency: string }>;
  preferences?: Record<string, unknown>;
}

/** Admin dossier — org-wide rollups + risk dashboard. */
export interface AdminProfile {
  identity: IdentityFacts;
  totalUsers?: number;
  totalProperties?: number;
  totalUnits?: number;
  totalActiveLeases?: number;
  billingPosition?: { tier: string; mrr?: number; currency?: string };
  featureUsage30d?: Record<string, number>;
  riskFlags?: ReadonlyArray<{ kind: string; severity: 'low' | 'medium' | 'high'; summary: string }>;
  preferences?: Record<string, unknown>;
}

/** Prospect dossier — pre-lease lead quality. */
export interface ProspectProfile {
  identity: IdentityFacts;
  searches?: ReadonlyArray<{ query: string; timestamp: string }>;
  propertiesViewed?: ReadonlyArray<{ propertyId: string; viewedAt: string }>;
  savedListings?: ReadonlyArray<{ propertyId: string; savedAt: string }>;
  leadQuality?: { score: number; band: 'cold' | 'warm' | 'hot'; primaryPain?: string };
  preferences?: Record<string, unknown>;
}

/** Union of all role-specific dossiers. */
export type AnyProfile =
  | TenantProfile
  | OwnerProfile
  | PMProfile
  | EstateMgrProfile
  | AdminProfile
  | ProspectProfile;

// ---------------------------------------------------------------------------
// Behavioral signals
// ---------------------------------------------------------------------------

/** Lightweight activity summary over an N-day window. */
export interface RecentActivity {
  windowDays: number;
  loginCount: number;
  pagesViewed: number;
  featuresTouched: ReadonlyArray<string>;
  lastInteractionAt?: string;
  searchQueries: ReadonlyArray<{ query: string; timestamp: string }>;
}

/** Things the user has to act on now. */
export interface OpenItems {
  openMaintenanceCount: number;
  unpaidInvoiceCount: number;
  unpaidBalance: number;
  expiringDocuments: ReadonlyArray<{ kind: string; expiresAt: string }>;
  leaseDecisionsDue: ReadonlyArray<{ leaseId: string; decision: string; dueBy: string }>;
  pendingSignOffs: ReadonlyArray<{ kind: string; id: string }>;
}

/** Where the user is in their lifecycle. */
export type LifecycleStage =
  | 'onboarding'
  | 'active'
  | 'at_risk'
  | 'churned'
  | 'reactivating';

/** Hints we infer from recent behavior about what the user is about to do. */
export interface IntentSignal {
  kind: string;
  confidence: number;
  evidence: string;
}

/** Composite of every signal we surface. */
export interface BehavioralSignals {
  recentActivity: RecentActivity;
  openItems: OpenItems;
  lifecycleStage: LifecycleStage;
  intentSignals: ReadonlyArray<IntentSignal>;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Proactive nudge candidate; computed deterministically from profile+signals. */
export interface Trigger {
  /** Stable, deterministic id — `triggerKey` for the worker's idempotency. */
  id: string;
  /** Human-readable kind, e.g. "lease.renewal_window_open". */
  kind: string;
  /** 1 (informational) to 5 (urgent action required). */
  urgency: 1 | 2 | 3 | 4 | 5;
  /** One-sentence summary fit for a notification subject. */
  summary: string;
  /** What the user should do next. */
  suggestedAction: string;
  /** Pre-filled chat prompt to deep-link into the advisor. */
  suggestedPromptForChat: string;
  /** Concrete evidence references (record ids) the trigger fired off. */
  triggeringEvidence: ReadonlyArray<{ kind: string; id: string; field?: string }>;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * Consent decision returned by the privacy gate. `implicit` means the
 * lawful basis is legitimate interest (advisory grounded in user-owned
 * records) and no explicit opt-in was recorded.
 */
export type ConsentDecision = 'granted' | 'implicit' | 'revoked';

/**
 * Audience marker for PII-minimization. When `audience` !== `data_subject`,
 * the minimizer strips names and contact info from snippets.
 */
export type Audience =
  | 'data_subject' // the user is asking about themselves
  | 'owner'        // owner is asking about their tenants
  | 'pm'           // PM is asking about portfolio
  | 'admin'        // admin is asking about org
  | 'estate_mgr';  // estate manager is asking about residents

// ---------------------------------------------------------------------------
// Search ports
// ---------------------------------------------------------------------------

/**
 * Embedder port — pure abstraction over text → vector. Production uses
 * OpenAI text-embedding-3-small; tests use a deterministic mock keyed
 * off SHA-256 of the input for reproducibility.
 */
export interface Embedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
  /** Embedding dimensionality (so we can sanity-check). */
  dimension: number;
}

/** A single corpus item indexed for semantic search. */
export interface CorpusItem {
  id: string;
  tenantId: string;
  /** Which user(s) can see this. `*` means everyone in the tenant with the role. */
  visibleToUserIds: ReadonlyArray<string> | '*';
  /** Which role(s) can see this. */
  visibleToRoles: ReadonlyArray<Role>;
  source: string;
  citation: Citation;
  content: string;
  embedding?: ReadonlyArray<number>;
  /** ISO-8601 of when the underlying source updated. */
  timestamp?: string;
}

/** Result of a scoped semantic search — content + similarity score. */
export interface SearchHit {
  item: CorpusItem;
  similarity: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Audit port — records every DataPort.fetchSnippets call so we can
 * answer "what data flowed into which advisor invocation".
 *
 * The wired implementation writes to `kernel_action_audit` /
 * `ai_audit_chain`; tests use an in-memory sink.
 */
export interface ContextAuditPort {
  recordFetch(record: {
    tenantId: string;
    userId: string;
    role: Role;
    intent: string;
    question: string;
    snippetCount: number;
    citations: ReadonlyArray<Citation>;
    consent: ConsentDecision;
    timestamp: string;
  }): Promise<void> | void;
}
