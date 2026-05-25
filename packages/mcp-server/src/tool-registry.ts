/**
 * Tool Registry — canonical list of tools exposed via MCP.
 *
 * Each definition captures: name, description, JSON-schema inputs, required
 * scopes, minimum tier, and the pure-cost estimate per call. Handlers are
 * wired in by the composition root (api-gateway) — this module is only the
 * declarative schema.
 */

import type { McpToolDefinition, McpScope } from './types.js';

// Helper so arrays of literal scopes inference works under `strict`.
const scopes = <T extends readonly McpScope[]>(...s: T): readonly McpScope[] =>
  Object.freeze([...s]);

export const BORJIE_TOOLS: ReadonlyArray<McpToolDefinition> = Object.freeze(
  [
    Object.freeze({
      name: 'query_property_graph',
      description:
        'Query the Canonical Property Graph (Neo4j) for entities and relationships scoped to the caller tenant. Supports node-match, relationship-walk, and natural-language queries.',
      inputSchema: Object.freeze({
        query: Object.freeze({
          type: 'string' as const,
          description:
            'Either a Cypher query with $tenantId bound automatically, or a plain-English question.',
        }),
        mode: Object.freeze({
          type: 'string' as const,
          description: 'Query mode.',
          enum: Object.freeze(['cypher', 'natural']),
        }),
        limit: Object.freeze({
          type: 'number' as const,
          description: 'Maximum result rows (default 50, max 500).',
        }),
      }),
      requiredInputs: Object.freeze(['query']),
      requiredScopes: scopes('read:graph'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 500, // $0.0005
    }),

    Object.freeze({
      name: 'get_tenant_risk_profile',
      description:
        'Return the Risk Report for a lease-holder including payment history, arrears aging, churn risk, and a narrative summary. Read-only.',
      inputSchema: Object.freeze({
        tenantProfileId: Object.freeze({
          type: 'string' as const,
          description: 'ID of the tenant profile (lease-holder, not org).',
        }),
      }),
      requiredInputs: Object.freeze(['tenantProfileId']),
      requiredScopes: scopes('read:tenants'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 1_000,
    }),

    Object.freeze({
      name: 'list_maintenance_cases',
      description:
        'List maintenance cases for the caller tenant with optional status, severity, and assignee filters. Paginated.',
      inputSchema: Object.freeze({
        status: Object.freeze({
          type: 'string' as const,
          description: 'Case status filter.',
          enum: Object.freeze([
            'open',
            'assigned',
            'in_progress',
            'resolved',
            'closed',
          ]),
        }),
        severity: Object.freeze({
          type: 'string' as const,
          description: 'Severity filter.',
          enum: Object.freeze(['low', 'medium', 'high', 'critical']),
        }),
        assigneeId: Object.freeze({
          type: 'string' as const,
          description: 'Vendor or internal assignee ID.',
        }),
        limit: Object.freeze({
          type: 'number' as const,
          description: 'Page size (default 25, max 200).',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:cases'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 500,
    }),

    Object.freeze({
      name: 'create_maintenance_case',
      description:
        'Create a new maintenance case for a unit belonging to the caller tenant. Requires write scope and Pro tier.',
      inputSchema: Object.freeze({
        unitId: Object.freeze({
          type: 'string' as const,
          description: 'Unit the case relates to.',
        }),
        problemCode: Object.freeze({
          type: 'string' as const,
          description:
            'Problem code from the active maintenance taxonomy (see `get_maintenance_taxonomy`).',
        }),
        description: Object.freeze({
          type: 'string' as const,
          description: 'Free-text description of the issue.',
        }),
        severity: Object.freeze({
          type: 'string' as const,
          description: 'Severity.',
          enum: Object.freeze(['low', 'medium', 'high', 'critical']),
        }),
      }),
      requiredInputs: Object.freeze(['unitId', 'problemCode', 'description']),
      requiredScopes: scopes('write:cases'),
      minimumTier: 'pro',
      estimatedCostUsdMicro: 2_000,
    }),

    Object.freeze({
      name: 'generate_letter',
      description:
        'Generate a tenant-scoped letter (notice, demand, receipt, renewal) using the active compliance-plugin template catalog. Returns PDF + HTML bodies.',
      inputSchema: Object.freeze({
        templateId: Object.freeze({
          type: 'string' as const,
          description: 'Template identifier.',
        }),
        tenantProfileId: Object.freeze({
          type: 'string' as const,
          description: 'Recipient tenant profile ID.',
        }),
        context: Object.freeze({
          type: 'object' as const,
          description: 'Template variables (amount, date, etc.).',
        }),
      }),
      requiredInputs: Object.freeze(['templateId', 'tenantProfileId']),
      requiredScopes: scopes('write:letters'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 5_000,
    }),

    Object.freeze({
      name: 'query_arrears_projection',
      description:
        'Project the arrears curve for a tenant or unit over the next N months using the payments-ledger + paytime-prediction model.',
      inputSchema: Object.freeze({
        tenantProfileId: Object.freeze({
          type: 'string' as const,
          description: 'Lease-holder ID (one of tenantProfileId or unitId).',
        }),
        unitId: Object.freeze({
          type: 'string' as const,
          description: 'Unit ID (one of tenantProfileId or unitId).',
        }),
        months: Object.freeze({
          type: 'number' as const,
          description: 'Projection horizon (default 6, max 24).',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:payments'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 1_500,
    }),

    Object.freeze({
      name: 'list_occupancy_timeline',
      description:
        'Return the occupancy timeline events for a unit or property — move-ins, move-outs, vacancies, lease changes.',
      inputSchema: Object.freeze({
        unitId: Object.freeze({
          type: 'string' as const,
          description: 'Unit ID (required unless propertyId is given).',
        }),
        propertyId: Object.freeze({
          type: 'string' as const,
          description:
            'Property ID (returns events across every unit in the property).',
        }),
        fromDate: Object.freeze({
          type: 'string' as const,
          description: 'ISO date — earliest event to return.',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:occupancy'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 500,
    }),

    Object.freeze({
      name: 'query_ai_cost_summary',
      description:
        'Summarise AI spend for the caller tenant over the current month, grouped by model/provider/operation.',
      inputSchema: Object.freeze({
        periodDays: Object.freeze({
          type: 'number' as const,
          description:
            'Look-back window in days (default 30, max 90). Ignored when month-to-date is requested.',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:ai-costs'),
      minimumTier: 'pro',
      estimatedCostUsdMicro: 200,
    }),

    Object.freeze({
      name: 'list_compliance_plugins',
      description:
        'List compliance-plugin packages (country configs) installed and active for the caller tenant.',
      inputSchema: Object.freeze({}),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:compliance'),
      minimumTier: 'enterprise',
      estimatedCostUsdMicro: 100,
    }),

    Object.freeze({
      name: 'get_maintenance_taxonomy',
      description:
        'Return the active maintenance-problem taxonomy — categories, problems, default SLAs, severities.',
      inputSchema: Object.freeze({
        categoryId: Object.freeze({
          type: 'string' as const,
          description: 'Optionally scope to a single category.',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:taxonomy'),
      minimumTier: 'standard',
      estimatedCostUsdMicro: 100,
    }),

    Object.freeze({
      name: 'get_warehouse_inventory',
      description:
        'Return current stock levels and recent movements for a warehouse owned by the caller tenant.',
      inputSchema: Object.freeze({
        warehouseId: Object.freeze({
          type: 'string' as const,
          description: 'Warehouse ID.',
        }),
        lowStockOnly: Object.freeze({
          type: 'boolean' as const,
          description: 'If true, returns only items below reorder threshold.',
        }),
      }),
      requiredInputs: Object.freeze([]),
      requiredScopes: scopes('read:warehouse'),
      minimumTier: 'pro',
      estimatedCostUsdMicro: 500,
    }),

    Object.freeze({
      name: 'run_skill',
      description:
        'Universal dispatch tool — call any registered skill by name. Useful when the caller already knows the BORJIE skill catalog.',
      inputSchema: Object.freeze({
        skillName: Object.freeze({
          type: 'string' as const,
          description: 'Skill to invoke.',
        }),
        input: Object.freeze({
          type: 'object' as const,
          description: 'Input payload forwarded to the skill.',
        }),
      }),
      requiredInputs: Object.freeze(['skillName']),
      requiredScopes: scopes('execute:skills'),
      minimumTier: 'enterprise',
      estimatedCostUsdMicro: 1_000,
    }),
  ],
);

export function findToolDefinition(
  name: string,
): McpToolDefinition | undefined {
  return BORJIE_TOOLS.find((t) => t.name === name);
}
