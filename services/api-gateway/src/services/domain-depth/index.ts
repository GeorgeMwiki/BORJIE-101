/**
 * Domain-depth catalog — barrel.
 *
 * Wave SOTA-DEPTH. The 14 owner-os domains each have a canonical
 * sub-area list. Aggregated here so the brain tools + panel renderers
 * see one frozen catalog.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md`.
 */

import type {
  DomainDescriptor,
  DomainId,
  SubAreaDescriptor,
  SubAreaScope,
  SubAreaStatus,
  SubAreaResolver,
} from './types';

import { COMPLIANCE_DOMAIN } from './domains/compliance';
import { FINANCE_DOMAIN } from './domains/finance';
import { OPERATIONS_DOMAIN } from './domains/operations';
import { HR_DOMAIN } from './domains/hr';
import { MARKETING_DOMAIN } from './domains/marketing';
import { RISK_DOMAIN } from './domains/risk';
import { TREASURY_DOMAIN } from './domains/treasury';
import { GEOLOGY_DOMAIN } from './domains/geology';
import { MARKETPLACE_DOMAIN } from './domains/marketplace';
import { LICENCES_DOMAIN } from './domains/licences';
import { HOLDINGS_DOMAIN } from './domains/holdings';
import { SUBSIDIARIES_DOMAIN } from './domains/subsidiaries';
import { SUCCESSION_DOMAIN } from './domains/succession';
import { ASSET_REGISTER_DOMAIN } from './domains/asset-register';

export const DOMAIN_DEPTH_CATALOG: ReadonlyArray<DomainDescriptor> =
  Object.freeze([
    COMPLIANCE_DOMAIN,
    FINANCE_DOMAIN,
    OPERATIONS_DOMAIN,
    HR_DOMAIN,
    MARKETING_DOMAIN,
    RISK_DOMAIN,
    TREASURY_DOMAIN,
    GEOLOGY_DOMAIN,
    MARKETPLACE_DOMAIN,
    LICENCES_DOMAIN,
    HOLDINGS_DOMAIN,
    SUBSIDIARIES_DOMAIN,
    SUCCESSION_DOMAIN,
    ASSET_REGISTER_DOMAIN,
  ]);

/** Index by domain id. */
const DOMAIN_BY_ID: ReadonlyMap<DomainId, DomainDescriptor> = new Map(
  DOMAIN_DEPTH_CATALOG.map((d) => [d.id, d]),
);

export function getDomain(id: DomainId): DomainDescriptor | undefined {
  return DOMAIN_BY_ID.get(id);
}

export function getSubArea(
  domainId: DomainId,
  subAreaId: string,
): SubAreaDescriptor | undefined {
  const domain = DOMAIN_BY_ID.get(domainId);
  if (!domain) return undefined;
  return domain.subAreas.find((s) => s.id === subAreaId);
}

/**
 * Cross-domain sub-area count — guard rail asserted by the audit tests:
 * compliance must have >= 15 sub-areas, others >= 5.
 */
export function totalSubAreas(): number {
  return DOMAIN_DEPTH_CATALOG.reduce(
    (sum, d) => sum + d.subAreas.length,
    0,
  );
}

/**
 * Awaiting-data resolver — returned by any domain whose data source
 * has not yet landed. Keeps the brain honest ("no signal yet on X")
 * and never blocks panel rendering.
 */
export const awaitingDataResolver: SubAreaResolver = async () => ({
  status: 'unknown',
  note: 'awaiting data source',
});

/** Resolve the status of a single sub-area, dispatching by key. */
export async function resolveSubArea(
  domainId: DomainId,
  subAreaId: string,
  scope: SubAreaScope,
): Promise<SubAreaStatus> {
  const subArea = getSubArea(domainId, subAreaId);
  if (!subArea) {
    return { status: 'unknown', note: 'unknown sub-area' };
  }
  // Resolvers are not wired here yet — the catalog returns an
  // "awaiting data" tone so the FE renders the matrix without error.
  // When a per-sub-area resolver lands it will be looked up by
  // `dataResolverKey` in a resolver registry.
  return awaitingDataResolver(scope);
}

/** Resolve every sub-area of a domain in one pass. */
export async function resolveDomain(
  domainId: DomainId,
  scope: SubAreaScope,
): Promise<
  ReadonlyArray<{
    readonly subAreaId: string;
    readonly status: SubAreaStatus;
  }>
> {
  const domain = DOMAIN_BY_ID.get(domainId);
  if (!domain) return [];
  return Promise.all(
    domain.subAreas.map(async (sa) => ({
      subAreaId: sa.id,
      status: await resolveSubArea(domainId, sa.id, scope),
    })),
  );
}

export type {
  DomainDescriptor,
  DomainId,
  SubAreaDescriptor,
  SubAreaScope,
  SubAreaStatus,
  SubAreaResolver,
} from './types';
