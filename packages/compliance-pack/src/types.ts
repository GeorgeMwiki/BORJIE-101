/**
 * @borjie/compliance-pack — public types.
 *
 * Pure type module — no runtime. All shapes are `readonly` end-to-end
 * so consumers cannot mutate control catalogs, DSAR manifests, or
 * encryption envelopes after they are produced. The wider compliance
 * pack is designed around five invariants enforced at the type
 * boundary:
 *
 *   1. Every control belongs to a known `ComplianceFramework` and
 *      lists which platform features satisfy it. Auditors can ask
 *      "what satisfies CC6.1?" and get a deterministic answer.
 *   2. Every DSAR request carries a `Jurisdiction` so the response
 *      SLA is computed from the law, not the operator.
 *   3. Every erasure-cascade rule binds a strategy
 *      (`hard_delete | anonymize | pseudonymize | tombstone |
 *      legal_hold`) to a table. Legal-hold ALWAYS wins over any
 *      competing rule on the same table.
 *   4. Every envelope-encryption ciphertext binds an
 *      `EncryptionContext` (tenant + field + resource). A ciphertext
 *      from tenant A CANNOT be decrypted under context for tenant B.
 *   5. Every breach event carries a `Jurisdiction[]` of affected
 *      tenants so the per-jurisdiction notification SLA is computed
 *      from law, not operator.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Jurisdictions + framework codes
// ─────────────────────────────────────────────────────────────────────

/**
 * Two-letter jurisdiction codes the compliance pack understands.
 *
 * `EU` is the GDPR umbrella, `GLOBAL` is the catch-all for controls
 * that apply regardless of jurisdiction (e.g. SOC2 / ISO27001 which
 * are audit standards, not laws).
 */
export const JURISDICTIONS = [
  'GLOBAL',
  'EU',
  'UK',
  'US-CA',
  'ZA',
  'TZ',
  'KE',
  'UG',
  'RW',
  'NG',
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JurisdictionSchema = z.enum(JURISDICTIONS);

/**
 * The 10 compliance frameworks modeled by this package. Each has its
 * own control catalog under `src/frameworks/<code>-controls.ts`.
 */
export const COMPLIANCE_FRAMEWORKS = [
  'soc2',
  'iso27001',
  'gdpr',
  'ccpa',
  'popia',
  'tz-dpa',
  'ke-dpa',
  'ug-dpa',
  'rw-dpa',
  'ng-ndpr',
] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

export const ComplianceFrameworkSchema = z.enum(COMPLIANCE_FRAMEWORKS);

/**
 * Stable control identifier within a framework, e.g. `'CC6.1'` for
 * SOC2 or `'Art.17'` for GDPR. Opaque string at the type level so we
 * can carry framework-specific schemes without union explosion.
 */
export type ControlId = string;

// ─────────────────────────────────────────────────────────────────────
// Control catalog
// ─────────────────────────────────────────────────────────────────────

/**
 * One control / requirement in a framework, paired with the platform
 * features that satisfy it.
 *
 * `satisfiedBy` is a list of feature ids — strings like
 * `'packages/authz-policy'` or `'sovereign_action_ledger'`. Auditors
 * call `featuresSatisfyingControl(controlId)` and get the union of
 * features across every framework that maps that id.
 */
export interface ControlSpec {
  readonly id: ControlId;
  readonly name: string;
  readonly description: string;
  readonly jurisdiction: Jurisdiction;
  readonly satisfiedBy: ReadonlyArray<string>;
}

export const ControlSpecSchema: z.ZodType<ControlSpec> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  jurisdiction: JurisdictionSchema,
  satisfiedBy: z.array(z.string()).readonly(),
});

/**
 * One framework's complete control catalog.
 */
export interface ControlCatalog {
  readonly frameworkId: ComplianceFramework;
  readonly displayName: string;
  readonly version: string;
  readonly jurisdiction: Jurisdiction;
  readonly controls: ReadonlyArray<ControlSpec>;
}

export const ControlCatalogSchema: z.ZodType<ControlCatalog> = z.object({
  frameworkId: ComplianceFrameworkSchema,
  displayName: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: JurisdictionSchema,
  controls: z.array(ControlSpecSchema).readonly(),
});

/**
 * One control-to-feature edge. The compliance engine produces these
 * by traversing every catalog at startup; they support inverted
 * queries like "which controls does `field_encryption_audit` satisfy?".
 */
export interface ControlMapping {
  readonly frameworkId: ComplianceFramework;
  readonly controlId: ControlId;
  readonly featureId: string;
}

// ─────────────────────────────────────────────────────────────────────
// DSAR (data-subject access request) — the regulator-facing pipeline
// ─────────────────────────────────────────────────────────────────────

export const DSAR_KINDS = [
  'access',
  'erasure',
  'portability',
  'rectification',
  'opt_out',
  'limit_use',
] as const;
export type DSARKind = (typeof DSAR_KINDS)[number];

export const DSAR_CHANNELS = [
  'web_form',
  'email',
  'phone',
  'postal',
  'authorised_agent',
] as const;
export type DSARChannel = (typeof DSAR_CHANNELS)[number];

export const DSAR_STATES = [
  'received',
  'identity_verified',
  'in_progress',
  'fulfilled',
  'partially_fulfilled',
  'refused',
] as const;
export type DSARState = (typeof DSAR_STATES)[number];

/**
 * Subject-id is opaque at this layer — could be a user uuid, an email
 * hash, or a Kenya national id. The collector resolves the canonical
 * form per data source.
 */
export interface DSARRequest {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: DSARKind;
  readonly jurisdiction: Jurisdiction;
  readonly channel: DSARChannel;
  readonly receivedAt: string;
  readonly slaDueAt: string;
  readonly state: DSARState;
}

export const DSARRequestSchema: z.ZodType<DSARRequest> = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  kind: z.enum(DSAR_KINDS),
  jurisdiction: JurisdictionSchema,
  channel: z.enum(DSAR_CHANNELS),
  receivedAt: z.string(),
  slaDueAt: z.string(),
  state: z.enum(DSAR_STATES),
});

/**
 * One row of a DSAR collection — what was found in one table for the
 * subject. `pii` field set is enumerated so the response packaging
 * step can redact / pseudonymize per per-field policy.
 */
export interface DSARRecord {
  readonly table: string;
  readonly primaryKey: string;
  readonly columns: Readonly<Record<string, unknown>>;
  readonly piiFields: ReadonlyArray<string>;
}

/**
 * The packaged DSAR response — what gets delivered to the subject.
 * `format` controls serialization at the edge; the manifest is the
 * same.
 */
export interface DSARResponse {
  readonly requestId: string;
  readonly subjectId: string;
  readonly kind: DSARKind;
  readonly producedAt: string;
  readonly format: 'json' | 'csv';
  readonly records: ReadonlyArray<DSARRecord>;
  readonly summary: {
    readonly tablesScanned: number;
    readonly recordsFound: number;
    readonly piiFieldsFound: number;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Erasure cascade — with legal-hold priority
// ─────────────────────────────────────────────────────────────────────

export const ERASURE_STRATEGIES = [
  'hard_delete',
  'anonymize',
  'pseudonymize',
  'tombstone',
  'legal_hold',
] as const;
export type ErasureStrategy = (typeof ERASURE_STRATEGIES)[number];

/**
 * One rule in the erasure cascade. The cascade engine sorts rules by
 * priority: `legal_hold` always wins; otherwise rules are applied in
 * declaration order. A table with NO rule is left untouched (failing
 * closed: untouched data is safer than accidentally erased data).
 */
export interface ErasureRule {
  readonly table: string;
  readonly strategy: ErasureStrategy;
  readonly piiColumns: ReadonlyArray<string>;
  readonly retentionReason?: string | undefined;
  readonly retentionUntil?: string | undefined;
}

export const ErasureRuleSchema: z.ZodType<ErasureRule> = z.object({
  table: z.string().min(1),
  strategy: z.enum(ERASURE_STRATEGIES),
  piiColumns: z.array(z.string()).readonly(),
  retentionReason: z.string().optional(),
  retentionUntil: z.string().optional(),
});

/**
 * The cascade specification — an ordered list of rules. Tables not
 * named here are NOT touched by the cascade engine.
 */
export interface ErasureCascadeSpec {
  readonly tenantId: string;
  readonly rules: ReadonlyArray<ErasureRule>;
}

/**
 * One row in the erasure manifest — what the cascade engine plans (or
 * did) to do to one specific row. The manifest is produced before
 * execution so it can be audited / replayed.
 */
export interface ErasureAction {
  readonly table: string;
  readonly primaryKey: string;
  readonly strategy: ErasureStrategy;
  readonly columnsAffected: ReadonlyArray<string>;
  readonly heldBecause?: string;
}

export interface ErasureReport {
  readonly cascadeId: string;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly producedAt: string;
  readonly actions: ReadonlyArray<ErasureAction>;
  readonly summary: {
    readonly hardDeleted: number;
    readonly anonymized: number;
    readonly pseudonymized: number;
    readonly tombstoned: number;
    readonly legalHold: number;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Envelope encryption — with cross-tenant context binding
// ─────────────────────────────────────────────────────────────────────

/**
 * Additional authenticated data (AAD) bound to a ciphertext. The
 * decrypt operation REQUIRES the same context — a ciphertext for
 * tenant A cannot be decrypted under context `{tenantId: 'B', ...}`.
 *
 * Modelled as a discrete shape (not a free-form record) so static
 * analysis catches misuse — passing a raw string or an arbitrary
 * object is a type error.
 */
export interface EncryptionContext {
  readonly tenantId: string;
  readonly field: string;
  readonly resource: string;
}

export const EncryptionContextSchema: z.ZodType<EncryptionContext> = z.object({
  tenantId: z.string().min(1),
  field: z.string().min(1),
  resource: z.string().min(1),
});

/**
 * One envelope — a ciphertext + the wrapped DEK that decrypts it.
 * `keyId` identifies the KEK so callers can rotate keys without
 * re-encrypting the data eagerly.
 */
export interface EncryptionEnvelope {
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly keyId: string;
  readonly contextDigest: string;
  readonly algorithm: 'AES-256-GCM';
  readonly createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Residency policy
// ─────────────────────────────────────────────────────────────────────

export const RESIDENCY_REGIONS = [
  'eu-west-1',
  'eu-central-1',
  'us-east-1',
  'us-west-2',
  'af-south-1',
  'ap-south-1',
  'me-south-1',
] as const;
export type ResidencyRegion = (typeof RESIDENCY_REGIONS)[number];

export const ResidencyRegionSchema = z.enum(RESIDENCY_REGIONS);

export interface ResidencyPolicy {
  readonly tenantId: string;
  readonly region: ResidencyRegion;
  readonly allowFailover: boolean;
  readonly failoverRegions?: ReadonlyArray<ResidencyRegion>;
  readonly tableOverrides?: Readonly<Record<string, 'global' | 'pinned'>>;
}

export const ResidencyDecisions = [
  'allow',
  'deny',
  'allowed_with_replication',
] as const;
export type ResidencyDecision = (typeof ResidencyDecisions)[number];

// ─────────────────────────────────────────────────────────────────────
// Breach notification
// ─────────────────────────────────────────────────────────────────────

export const BREACH_SEVERITIES = [
  'informational',
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];

export interface BreachEvent {
  readonly id: string;
  readonly severity: BreachSeverity;
  readonly scope: string;
  readonly detectedAt: string;
  readonly affectedJurisdictions: ReadonlyArray<Jurisdiction>;
  readonly affectedTenantIds: ReadonlyArray<string>;
  readonly piiInScope: ReadonlyArray<string>;
  readonly subjectsAffectedCount: number;
}

export interface BreachNotificationSpec {
  readonly jurisdiction: Jurisdiction;
  readonly regulator: string | null;
  readonly notifyRegulatorWithinHours: number | null;
  readonly notifySubjectsWithinHours: number | null;
  readonly subjectNotificationThreshold:
    | 'always'
    | 'high_risk_only'
    | 'never_required';
}

export interface NotificationPlanEntry {
  readonly jurisdiction: Jurisdiction;
  readonly regulator: string | null;
  readonly regulatorDeadline: string | null;
  readonly subjectDeadline: string | null;
  readonly mustNotifySubjects: boolean;
}

export interface NotificationPlan {
  readonly breachId: string;
  readonly producedAt: string;
  readonly entries: ReadonlyArray<NotificationPlanEntry>;
}

// ─────────────────────────────────────────────────────────────────────
// Errors — typed so callers can switch on them
// ─────────────────────────────────────────────────────────────────────

export class EncryptionContextMismatchError extends Error {
  public override readonly name = 'EncryptionContextMismatchError';
  constructor(message: string) {
    super(message);
  }
}

export class DSARSubjectNotFoundError extends Error {
  public override readonly name = 'DSARSubjectNotFoundError';
  constructor(message: string) {
    super(message);
  }
}

export class LegalHoldError extends Error {
  public override readonly name = 'LegalHoldError';
  constructor(message: string) {
    super(message);
  }
}

export class ResidencyViolationError extends Error {
  public override readonly name = 'ResidencyViolationError';
  constructor(message: string) {
    super(message);
  }
}
