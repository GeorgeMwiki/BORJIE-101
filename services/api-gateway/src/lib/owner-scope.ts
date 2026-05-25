/**
 * Owner Scope Helper
 *
 * Centralises the property-scoped aggregation pattern used by every BFF
 * endpoint that needs to return owner-portal data filtered to the rows
 * the caller actually has access to.
 *
 * Before this helper the pattern was duplicated in each route as:
 *
 *   1. fetch `properties.findMany(tenantId, limit=1000)`
 *   2. filter properties in JS by `auth.propertyAccess`
 *   3. fetch `units.findMany(tenantId, limit=1000)` + filter by propertyIds
 *   4. fetch `leases.findMany(tenantId, limit=1000)` + filter by propertyIds
 *   5. fetch `customers.findMany(tenantId, limit=1000)` + filter by
 *      customerIds derived from those leases
 *   6. fetch `invoices.findMany(tenantId, limit=1000)` + JS filter
 *   7. fetch `payments.findMany(tenantId, limit=1000)` + JS filter
 *
 * That pattern (i) materialised every tenant row before filtering, (ii)
 * leaked cross-property rows over the wire whenever the JS filter was
 * dropped, and (iii) silently truncated at 1000 for large tenants.
 *
 * The new helper resolves the caller's property scope ONCE, then issues
 * `findByPropertyIds` queries against each repository so the DB does the
 * filtering in a single WHERE clause. Tenant + soft-delete filters remain
 * inside each repo method — this helper never bypasses them.
 */
import type { PaginationParams } from '@borjie/domain-models';

const DEFAULT_PAGE: PaginationParams = { limit: 1000, offset: 0 };

export interface OwnerAuthContext {
  readonly tenantId: string;
  readonly propertyAccess?: readonly string[] | undefined;
}

/**
 * Resolve the property ids the caller can see. When `auth.propertyAccess`
 * includes the wildcard `*`, returns every property in the tenant.
 * Otherwise intersects the tenant's property list with the caller's
 * explicit access set.
 *
 * Returns the array of property rows (whatever shape the property repo
 * yields) so downstream enrichment can still look up names / addresses.
 */
export async function resolveOwnerPropertyIds(
  auth: OwnerAuthContext,
  repos: any,
  pagination: PaginationParams = DEFAULT_PAGE,
): Promise<{ properties: any[]; propertyIds: string[] }> {
  const allProperties = await repos.properties.findMany(auth.tenantId, pagination);
  const hasWildcard = auth.propertyAccess?.includes('*');
  const accessList = auth.propertyAccess ?? [];
  const properties = hasWildcard
    ? allProperties.items
    : allProperties.items.filter((property: any) =>
        accessList.includes(property.id),
      );
  const propertyIds = properties.map((property: any) => property.id);
  return { properties, propertyIds };
}

export interface OwnerScope {
  readonly properties: any[];
  readonly units: any[];
  readonly leases: any[];
  readonly customers: any[];
  readonly invoices: any[];
  readonly payments: any[];
  readonly workOrders: any[];
  readonly vendors: any[];
}

/**
 * One-shot aggregator for owner-portal endpoints.
 *
 * Each `findByPropertyIds` (or `findByCustomer` style) call runs in
 * parallel; tenant + soft-delete enforcement lives inside each repo. The
 * helper is the boundary the route does NOT have to re-enforce.
 *
 * When the caller has no property access, returns empty arrays without
 * issuing any further queries.
 */
export async function getOwnerScope(
  auth: OwnerAuthContext,
  repos: any,
  pagination: PaginationParams = DEFAULT_PAGE,
): Promise<OwnerScope> {
  const { properties, propertyIds } = await resolveOwnerPropertyIds(
    auth,
    repos,
    pagination,
  );

  if (propertyIds.length === 0) {
    return {
      properties,
      units: [],
      leases: [],
      customers: [],
      invoices: [],
      payments: [],
      workOrders: [],
      vendors: [],
    };
  }

  const [
    unitsResult,
    leasesResult,
    customersResult,
    invoicesResult,
    paymentsResult,
    workOrdersResult,
  ] = await Promise.all([
    repos.units.findByPropertyIds(propertyIds, auth.tenantId, pagination),
    repos.leases.findByPropertyIds(propertyIds, auth.tenantId, pagination),
    repos.customers.findByPropertyIds(propertyIds, auth.tenantId, pagination),
    repos.invoices.findByPropertyIds(propertyIds, auth.tenantId, pagination.limit, pagination.offset),
    repos.payments.findByPropertyIds(propertyIds, auth.tenantId, pagination.limit, pagination.offset),
    // Work orders still go through the legacy `findMany + JS filter`
    // path — the work-orders repo doesn't yet expose a
    // `findByPropertyIds` method; this is the smallest behaviour
    // change that closes the multi-tenant leak on leases / invoices /
    // payments / customers. TODO: extend work-orders repo next.
    repos.workOrders.findMany(auth.tenantId, pagination.limit, pagination.offset),
  ]);

  const units = unitsResult.items ?? [];
  const leases = leasesResult.items ?? [];
  const customers = customersResult.items ?? [];
  const invoices = invoicesResult.items ?? [];
  const payments = paymentsResult.items ?? [];

  // Work orders: still in-memory filter until the repo gains a
  // findByPropertyIds method. Note this is the LAST of the heavy joins.
  const propertyIdSet = new Set(propertyIds);
  const workOrders = (workOrdersResult.items ?? []).filter(
    (workOrder: any) => propertyIdSet.has(workOrder.propertyId),
  );

  const vendorIds = Array.from(
    new Set(workOrders.map((workOrder: any) => workOrder.vendorId).filter(Boolean)),
  );
  const vendors =
    vendorIds.length === 0
      ? []
      : await repos.vendors.findByIds(vendorIds, auth.tenantId);

  return { properties, units, leases, customers, invoices, payments, workOrders, vendors };
}
