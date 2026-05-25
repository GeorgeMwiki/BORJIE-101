/**
 * Disclosure-audit types — every disclosure logged as a J1 entity.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 *
 * Append-only, sovereign-ledger-backed. Searchable for compliance
 * audits ("show me all disclosures last 7d about model name").
 */

import type { CapabilityField, DisclosureTier } from '../tier-taxonomy/types.js';
import type { CloseRefusalCategory } from '../close-pattern/types.js';

/**
 * What gets logged for every disclosure attempt.
 */
export interface DisclosureAuditEvent {
  readonly id: string;
  readonly ts: string;
  readonly principalId: string;
  readonly principalRole: string;
  readonly principalTier: DisclosureTier;
  readonly query: string;
  readonly fieldsReturned: ReadonlyArray<CapabilityField>;
  readonly refusedFields: ReadonlyArray<CapabilityField>;
  readonly refusalCategory?: CloseRefusalCategory;
  readonly canaryLeakDetected: boolean;
  readonly euAct50EmittedSurface?: string;
}

/**
 * Filter args for searching the audit log.
 */
export interface DisclosureAuditQuery {
  readonly principalId?: string;
  readonly principalRole?: string;
  readonly fieldName?: CapabilityField;
  readonly refusalCategory?: CloseRefusalCategory;
  readonly canaryLeakDetected?: boolean;
  /** Inclusive lower bound (UNIX ms). */
  readonly tsFrom?: number;
  /** Exclusive upper bound (UNIX ms). */
  readonly tsTo?: number;
}

/**
 * The shape consumers implement to ship audit entries to J1 / external
 * sovereign-ledger. Implementations are inverted-control — composer
 * accepts a sink, doesn't construct one itself.
 */
export interface DisclosureAuditSink {
  /** Append-only write. */
  log(event: DisclosureAuditEvent): Promise<void> | void;
  /** Optional in-process query for tests / dashboards. */
  query?(filter: DisclosureAuditQuery): Promise<readonly DisclosureAuditEvent[]> | readonly DisclosureAuditEvent[];
}

/**
 * Convenience input to `logDisclosure`.
 */
export interface LogDisclosureInput {
  readonly principalId: string;
  readonly principalRole: string;
  readonly principalTier: DisclosureTier;
  readonly query: string;
  readonly fieldsReturned: ReadonlyArray<CapabilityField>;
  readonly refusedFields: ReadonlyArray<CapabilityField>;
  readonly refusalCategory?: CloseRefusalCategory;
  readonly canaryLeakDetected?: boolean;
  readonly euAct50EmittedSurface?: string;
}
