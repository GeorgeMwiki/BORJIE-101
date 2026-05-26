/**
 * `@borjie/capability-catalogue` — core types (Wave CAPABILITY).
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md`.
 *
 * Every capability is a typed, versioned record. Lifecycle moves under
 * the control of the measurement worker — no in-place edits, only new
 * versions appended to the registry. All shapes are immutable.
 *
 * @module @borjie/capability-catalogue/types
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** atomic = seed leaf, meta = dispatcher, tenant = tenant-authored. */
export const CAPABILITY_KINDS = ['atomic', 'meta', 'tenant'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const LIFECYCLE_STATES = [
  'draft',
  'shadow',
  'live',
  'locked',
  'deprecated',
] as const;
export type Lifecycle = (typeof LIFECYCLE_STATES)[number];

export const PROVENANCE_CLASSES = [
  'seed',
  'spawned',
  'tenant_authored',
] as const;
export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export const COST_CLASSES = ['free', 'tier_1', 'tier_2', 'tier_3'] as const;
export type CostClass = (typeof COST_CLASSES)[number];

export const OBSERVED_OUTCOMES = [
  'confirmed',
  'disconfirmed',
  'partial',
  'unknown',
] as const;
export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export const USER_FOLLOWTHROUGHS = [
  'accepted',
  'modified',
  'rejected',
  'ignored',
] as const;
export type UserFollowthrough = (typeof USER_FOLLOWTHROUGHS)[number];

export const MEASUREMENT_WINDOW_DAYS = [7, 28, 91] as const;
export type MeasurementWindowDays = (typeof MEASUREMENT_WINDOW_DAYS)[number];

/** Sentinel tenant id for platform-wide seed capabilities. */
export const SEED_TENANT_ID = '__seed__';

// ---------------------------------------------------------------------------
// Contract — zod-validated I/O shape + budgets
// ---------------------------------------------------------------------------

/**
 * Per-capability contract. The input + output schemas are stored as
 * opaque values so that the registry can persist any zod schema (or a
 * JSON-Schema-shaped equivalent). Runtime validation happens at
 * dispatch time by reading the original zod object from the
 * registry-loaded record.
 */
export interface CapabilityContract {
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly costClass: CostClass;
  readonly latencyBudgetMs: number;
}

export const CapabilityContractSchema = z.object({
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  costClass: z.enum(COST_CLASSES),
  latencyBudgetMs: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Capability (registry row)
// ---------------------------------------------------------------------------

export interface Capability {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly owner: string;
  readonly lifecycleState: Lifecycle;
  readonly dependencies: ReadonlyArray<string>;
  readonly contract: CapabilityContract;
  readonly provenanceClass: ProvenanceClass;
  readonly createdAt: string;
  readonly auditHash: string;
  readonly prevHash: string | null;
}

export const CapabilitySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(CAPABILITY_KINDS),
  owner: z.string().min(1),
  lifecycleState: z.enum(LIFECYCLE_STATES),
  dependencies: z.array(z.string().uuid()).readonly(),
  contract: CapabilityContractSchema,
  provenanceClass: z.enum(PROVENANCE_CLASSES),
  createdAt: z.string().datetime(),
  auditHash: z.string().min(1),
  prevHash: z.string().nullable(),
});

/** Author-side input — fields the platform or tenant supplies. */
export interface CapabilityAuthorInput {
  readonly tenantId: string;
  readonly name: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly owner: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly contract: CapabilityContract;
  readonly provenanceClass: ProvenanceClass;
}

// ---------------------------------------------------------------------------
// Invocation — one per call
// ---------------------------------------------------------------------------

export interface Invocation {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly invokedAt: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly errorKind: string | null;
  readonly costUsdCents: number;
  readonly auditHash: string;
}

export const InvocationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  capabilityId: z.string().uuid(),
  invokedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  success: z.boolean(),
  errorKind: z.string().nullable(),
  costUsdCents: z.number().int().nonnegative(),
  auditHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Outcome — one per resolved invocation
// ---------------------------------------------------------------------------

export interface Outcome {
  readonly id: string;
  readonly invocationId: string;
  readonly claimedConfidence: number;
  readonly observedOutcome: ObservedOutcome;
  readonly userFollowthrough: UserFollowthrough;
  readonly recordedAt: string;
  readonly auditHash: string;
}

export const OutcomeSchema = z.object({
  id: z.string().uuid(),
  invocationId: z.string().uuid(),
  claimedConfidence: z.number().min(0).max(1),
  observedOutcome: z.enum(OBSERVED_OUTCOMES),
  userFollowthrough: z.enum(USER_FOLLOWTHROUGHS),
  recordedAt: z.string().datetime(),
  auditHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Measurement — one row per (capability, window) per tick
// ---------------------------------------------------------------------------

export interface Measurement {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly windowDays: MeasurementWindowDays;
  readonly measuredAt: string;
  readonly competenceRate: number;
  readonly calibrationError: number;
  readonly utilityRate: number;
  readonly nObservations: number;
  readonly auditHash: string;
}

export const MeasurementSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  capabilityId: z.string().uuid(),
  windowDays: z.union([z.literal(7), z.literal(28), z.literal(91)]),
  measuredAt: z.string().datetime(),
  competenceRate: z.number().min(0).max(1),
  calibrationError: z.number().min(0).max(1),
  utilityRate: z.number().min(0).max(1),
  nObservations: z.number().int().nonnegative(),
  auditHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export type CapabilityCatalogueErrorCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'DUPLICATE_VERSION'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'INVALID_DEPENDENCY'
  | 'ATOMIC_RESERVED_FOR_SEED'
  | 'EMPTY_WINDOW'
  | 'INVALID_INPUT';

export class CapabilityCatalogueError extends Error {
  public readonly code: CapabilityCatalogueErrorCode;

  constructor(message: string, code: CapabilityCatalogueErrorCode) {
    super(message);
    this.name = 'CapabilityCatalogueError';
    this.code = code;
  }
}
