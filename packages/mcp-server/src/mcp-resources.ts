/**
 * MCP Resources — tenant-scoped read-only data surfaces.
 *
 * Resources are URIs of the form `borjie://...`. Each static resource
 * always returns data filtered to the caller's `tenantId`. Template
 * resources (e.g. `borjie://tenant/{tenantProfileId}`) inject path
 * variables before the repository call.
 *
 * The actual data-fetching is delegated to resolver callbacks injected
 * at wire-up time by the api-gateway composition root. This keeps the
 * package importable from any context.
 */

import type {
  McpAuthContext,
  McpStaticResource,
  McpTemplateResource,
} from './types.js';

// ============================================================================
// Resource Catalog
// ============================================================================

export const BORJIE_STATIC_RESOURCES: ReadonlyArray<McpStaticResource> =
  Object.freeze([
    Object.freeze({
      uri: 'borjie://portfolio/overview',
      name: 'Portfolio Overview',
      description:
        'Real-time snapshot of the caller tenant portfolio: property/unit counts, occupancy %, active cases, arrears totals, revenue MTD.',
      mimeType: 'application/json',
      category: 'portfolio' as const,
    }),
    Object.freeze({
      uri: 'borjie://compliance/active-plugins',
      name: 'Active Compliance Plugins',
      description:
        'List of compliance-plugin packages currently applied to the caller tenant (country config, letter templates, GDPR posture).',
      mimeType: 'application/json',
      category: 'compliance' as const,
    }),
    Object.freeze({
      uri: 'borjie://analytics/monthly-kpis',
      name: 'Monthly KPIs',
      description:
        'Occupancy, arrears aging, maintenance SLA hit-rate, AI spend — aggregated for the current month.',
      mimeType: 'application/json',
      category: 'analytics' as const,
    }),
    Object.freeze({
      uri: 'borjie://maintenance/taxonomy',
      name: 'Maintenance Taxonomy',
      description:
        'Active problem/category taxonomy for this tenant, including severities and default SLAs.',
      mimeType: 'application/json',
      category: 'maintenance' as const,
    }),
    Object.freeze({
      uri: 'borjie://warehouse/inventory',
      name: 'Warehouse Inventory',
      description:
        'Current stock levels across all warehouses owned by the caller tenant.',
      mimeType: 'application/json',
      category: 'warehouse' as const,
    }),
  ]);

export const BORJIE_RESOURCE_TEMPLATES: ReadonlyArray<McpTemplateResource> =
  Object.freeze([
    Object.freeze({
      uriTemplate: 'borjie://tenant/{tenantProfileId}',
      name: 'Tenant Profile',
      description:
        'Full occupant (lease-holder) profile including lease history, arrears, risk score.',
      mimeType: 'application/json',
    }),
    Object.freeze({
      uriTemplate: 'borjie://property/{propertyId}',
      name: 'Property Detail',
      description:
        'Full property record including units, active leases, current cases, and valuation history.',
      mimeType: 'application/json',
    }),
    Object.freeze({
      uriTemplate: 'borjie://unit/{unitId}',
      name: 'Unit Detail',
      description:
        'Unit record with occupancy timeline and maintenance history.',
      mimeType: 'application/json',
    }),
    Object.freeze({
      uriTemplate: 'borjie://case/{caseId}',
      name: 'Maintenance Case',
      description:
        'Full maintenance case with timeline, assigned vendor, and SLA status.',
      mimeType: 'application/json',
    }),
    Object.freeze({
      uriTemplate: 'borjie://graph/entity/{entityId}',
      name: 'Graph Entity',
      description:
        'Canonical Property Graph node for an entity, with its immediate relationships.',
      mimeType: 'application/json',
    }),
  ]);

// ============================================================================
// Resolver port — wired at composition time
// ============================================================================

export interface ResourceResolvers {
  readonly portfolioOverview: (
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly activeCompliancePlugins: (
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly monthlyKpis: (
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly maintenanceTaxonomy: (
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly warehouseInventory: (
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly tenantProfile: (
    tenantProfileId: string,
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly propertyDetail: (
    propertyId: string,
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly unitDetail: (
    unitId: string,
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly caseDetail: (
    caseId: string,
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
  readonly graphEntity: (
    entityId: string,
    context: McpAuthContext,
  ) => Promise<Record<string, unknown>>;
}

// ============================================================================
// Resolve
// ============================================================================

const PATH_TRAVERSAL_RE = /[.][.]|[/\\]/;

function guardVariable(value: string, name: string): void {
  if (!value || value.length > 200 || PATH_TRAVERSAL_RE.test(value)) {
    throw new Error(`Invalid resource variable for ${name}`);
  }
}

function tenantScoped<T extends Record<string, unknown>>(
  context: McpAuthContext,
  payload: T,
): T & { readonly tenantId: string; readonly fetchedAt: string } {
  return {
    ...payload,
    tenantId: context.tenantId,
    fetchedAt: new Date().toISOString(),
  };
}

export async function resolveStaticResource(
  uri: string,
  context: McpAuthContext,
  resolvers: ResourceResolvers,
): Promise<string> {
  switch (uri) {
    case 'borjie://portfolio/overview':
      return JSON.stringify(
        tenantScoped(context, await resolvers.portfolioOverview(context)),
      );
    case 'borjie://compliance/active-plugins':
      return JSON.stringify(
        tenantScoped(
          context,
          await resolvers.activeCompliancePlugins(context),
        ),
      );
    case 'borjie://analytics/monthly-kpis':
      return JSON.stringify(
        tenantScoped(context, await resolvers.monthlyKpis(context)),
      );
    case 'borjie://maintenance/taxonomy':
      return JSON.stringify(
        tenantScoped(context, await resolvers.maintenanceTaxonomy(context)),
      );
    case 'borjie://warehouse/inventory':
      return JSON.stringify(
        tenantScoped(context, await resolvers.warehouseInventory(context)),
      );
    default:
      throw new Error(`Unknown static resource: ${uri}`);
  }
}

export async function resolveTemplateResource(
  uri: string,
  variables: Record<string, string>,
  context: McpAuthContext,
  resolvers: ResourceResolvers,
): Promise<string> {
  if (!uri.startsWith('borjie://')) {
    throw new Error('Invalid resource URI — must start with borjie://');
  }

  if (variables.tenantProfileId) {
    guardVariable(variables.tenantProfileId, 'tenantProfileId');
    return JSON.stringify(
      tenantScoped(
        context,
        await resolvers.tenantProfile(variables.tenantProfileId, context),
      ),
    );
  }
  if (variables.propertyId) {
    guardVariable(variables.propertyId, 'propertyId');
    return JSON.stringify(
      tenantScoped(
        context,
        await resolvers.propertyDetail(variables.propertyId, context),
      ),
    );
  }
  if (variables.unitId) {
    guardVariable(variables.unitId, 'unitId');
    return JSON.stringify(
      tenantScoped(
        context,
        await resolvers.unitDetail(variables.unitId, context),
      ),
    );
  }
  if (variables.caseId) {
    guardVariable(variables.caseId, 'caseId');
    return JSON.stringify(
      tenantScoped(
        context,
        await resolvers.caseDetail(variables.caseId, context),
      ),
    );
  }
  if (variables.entityId) {
    guardVariable(variables.entityId, 'entityId');
    return JSON.stringify(
      tenantScoped(
        context,
        await resolvers.graphEntity(variables.entityId, context),
      ),
    );
  }
  throw new Error(`Cannot resolve resource template: ${uri}`);
}
