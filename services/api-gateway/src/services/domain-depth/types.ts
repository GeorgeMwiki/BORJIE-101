/**
 * Domain-depth catalog — typed shapes.
 *
 * The MD's home tab depth pass: each of the 14 owner-os domains has a
 * canonical sub-area list (compliance has 18; the others vary 5-14).
 * Every sub-area has a resolver function that returns a typed status
 * tuple suitable for an inline_dashboard or panel matrix.
 *
 * Source of truth: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md`. Any change
 * here MUST be mirrored in the manifest doc. The audit-trail test
 * asserts every catalog entry appears in the manifest.
 */

/** Stable owner-os domain ids the catalog covers. */
export type DomainId =
  | 'compliance'
  | 'finance'
  | 'operations'
  | 'hr'
  | 'marketing'
  | 'risk'
  | 'treasury'
  | 'geology'
  | 'marketplace'
  | 'licences'
  | 'holdings'
  | 'subsidiaries'
  | 'succession'
  | 'asset-register';

/** Cadence the obligation recurs on. */
export type SubAreaCadence =
  | 'annual'
  | 'quarterly'
  | 'monthly'
  | 'weekly'
  | 'daily'
  | 'event-driven'
  | 'per-shift'
  | 'per-event'
  | 'per-transaction'
  | 'per-parcel'
  | 'per-shipment'
  | 'real-time'
  | 'rolling'
  | 'multi-year';

/** Status tone surfaced to the FE. */
export type SubAreaStatusTone = 'green' | 'amber' | 'red' | 'unknown';

/** Bilingual label — sw is primary, en is secondary, both mandatory. */
export interface BilingualLabel {
  readonly en: string;
  readonly sw: string;
}

/**
 * A single sub-area an MD must track inside a domain.
 *
 * `regulator` is omitted when the sub-area is purely internal
 * management (e.g. fuel consumption rate).
 *
 * `dataResolverKey` references a function in
 * `resolvers.ts`. When a real data source has not landed yet the
 * resolver returns `{ status: 'unknown', note: 'awaiting data source' }`
 * so the FE renders an "Awaiting data" pill and the brain references
 * "no signal yet on X".
 */
export interface SubAreaDescriptor {
  readonly id: string;
  readonly label: BilingualLabel;
  readonly regulator?: string;
  readonly cadence: SubAreaCadence;
  readonly riskIfMissed: BilingualLabel;
  readonly dataResolverKey: string;
}

/**
 * A domain bundle — 14 such bundles assembled in the catalog index.
 */
export interface DomainDescriptor {
  readonly id: DomainId;
  readonly label: BilingualLabel;
  readonly headline: BilingualLabel;
  readonly subAreas: ReadonlyArray<SubAreaDescriptor>;
}

/**
 * Runtime status returned by a resolver for a given tenant + scope.
 *
 * The resolver never throws. Failure paths return `{ status: 'unknown' }`.
 */
export interface SubAreaStatus {
  readonly status: SubAreaStatusTone;
  readonly dueAt?: string;
  readonly lastFiledAt?: string;
  readonly refNumber?: string;
  readonly evidenceDocId?: string;
  readonly note?: string;
}

/** Scope passed to every resolver. */
export interface SubAreaScope {
  readonly tenantId: string;
  readonly siteId?: string;
  readonly dateRange?: {
    readonly from: string;
    readonly to: string;
  };
}

/** Per-sub-area resolver function signature. */
export type SubAreaResolver = (
  scope: SubAreaScope,
) => Promise<SubAreaStatus>;
