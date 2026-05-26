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
 * Minimum row shape every owner-portal entity satisfies — every record
 * carries a stable id used for cross-collection joins. Concrete row
 * types live in `routes/db-row-types.ts`; this helper is intentionally
 * structural so a heterogeneous list of repos can share the same
 * pagination-aware contract without re-stating each table's columns.
 */
export interface OwnerEntityRow {
  readonly id: string;
  readonly propertyId?: string | null;
  readonly vendorId?: string | null;
}

interface PaginatedRows<T> {
  readonly items: readonly T[];
  readonly total?: number;
}

/**
 * Repo surface this helper depends on. Each method is intentionally
 * structural — the production `repos` container exposes richer types,
 * but pinning the helper to just the entry points it consumes keeps the
 * coupling explicit and removes the `any` escape hatch.
 */
export interface OwnerScopeRepos {
  readonly properties: {
    findMany(
      tenantId: string,
      pagination?: PaginationParams,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly units: {
    findByPropertyIds(
      propertyIds: readonly string[],
      tenantId: string,
      pagination?: PaginationParams,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly leases: {
    findByPropertyIds(
      propertyIds: readonly string[],
      tenantId: string,
      pagination?: PaginationParams,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly customers: {
    findByPropertyIds(
      propertyIds: readonly string[],
      tenantId: string,
      pagination?: PaginationParams,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly invoices: {
    findByPropertyIds(
      propertyIds: readonly string[],
      tenantId: string,
      limit: number,
      offset: number,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly payments: {
    findByPropertyIds(
      propertyIds: readonly string[],
      tenantId: string,
      limit: number,
      offset: number,
    ): Promise<PaginatedRows<OwnerEntityRow>>;
  };
  readonly workOrders: {
    findBySiteIds(
      siteIds: readonly string[],
      tenantId: string,
    ): Promise<readonly OwnerEntityRow[] | PaginatedRows<OwnerEntityRow>>;
  };
  readonly vendors: {
    findByIds(
      ids: readonly string[],
      tenantId: string,
    ): Promise<readonly OwnerEntityRow[]>;
  };
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
  repos: OwnerScopeRepos,
  pagination: PaginationParams = DEFAULT_PAGE,
): Promise<{ properties: readonly OwnerEntityRow[]; propertyIds: string[] }> {
  const allProperties = await repos.properties.findMany(auth.tenantId, pagination);
  const hasWildcard = auth.propertyAccess?.includes('*');
  const accessList = auth.propertyAccess ?? [];
  const properties = hasWildcard
    ? allProperties.items
    : allProperties.items.filter((property) =>
        accessList.includes(property.id),
      );
  const propertyIds = properties.map((property) => property.id);
  return { properties, propertyIds };
}

export interface OwnerScope {
  readonly properties: readonly OwnerEntityRow[];
  readonly units: readonly OwnerEntityRow[];
  readonly leases: readonly OwnerEntityRow[];
  readonly customers: readonly OwnerEntityRow[];
  readonly invoices: readonly OwnerEntityRow[];
  readonly payments: readonly OwnerEntityRow[];
  readonly workOrders: readonly OwnerEntityRow[];
  readonly vendors: readonly OwnerEntityRow[];
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
  repos: OwnerScopeRepos,
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
    // Closes TODO(#43): work-orders repo now exposes `findBySiteIds`
    // (mining-domain rename of the old `findByPropertyIds`). The DB does
    // the filtering in a single WHERE clause — no `findMany + JS .filter`
    // leak, no silent 1000-row truncation. In this transitional pre-fork
    // state the caller still passes `propertyIds` because upstream
    // owner-resolution still emits property identifiers; the work-orders
    // method accepts them as opaque site/property ids.
    repos.workOrders.findBySiteIds(propertyIds, auth.tenantId),
  ]);

  const units = unitsResult.items ?? [];
  const leases = leasesResult.items ?? [];
  const customers = customersResult.items ?? [];
  const invoices = invoicesResult.items ?? [];
  const payments = paymentsResult.items ?? [];

  // Work orders now filtered at the DB layer via `findBySiteIds` — the
  // result shape is `WorkOrder[]` directly (not a paginated wrapper) so
  // we use it as-is. Falls back to an empty array when the repo returns
  // undefined (e.g. mock stubs that haven't implemented the method yet).
  const workOrders: readonly OwnerEntityRow[] = Array.isArray(workOrdersResult)
    ? workOrdersResult
    : ((workOrdersResult as PaginatedRows<OwnerEntityRow> | undefined)?.items ?? []);

  const vendorIds = Array.from(
    new Set(
      workOrders
        .map((workOrder) => workOrder.vendorId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const vendors =
    vendorIds.length === 0
      ? []
      : await repos.vendors.findByIds(vendorIds, auth.tenantId);

  return { properties, units, leases, customers, invoices, payments, workOrders, vendors };
}
