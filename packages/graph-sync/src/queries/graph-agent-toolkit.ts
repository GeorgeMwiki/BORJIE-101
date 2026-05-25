/**
 * Graph Agent Toolkit — AI Agent ↔ CPG Bridge
 *
 * Provides a structured tool interface that the AI copilot can call.
 * Each tool:
 *  1. Has a name, description, and parameter schema (for LLM function calling)
 *  2. Enforces tenant isolation via the authorization context
 *  3. Returns results with evidence paths (for citations/explainability)
 *  4. Logs usage to the governance layer
 *
 * Integration pattern:
 *  - AI Copilot receives a user query
 *  - LLM selects the appropriate graph tool
 *  - Tool executes against Neo4j via GraphQueryService
 *  - Results are returned with evidence paths
 *  - AI Copilot includes evidence in its response
 */

import { z } from 'zod';
import type { GraphQueryService } from './graph-query-service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
}

export interface GraphToolResult {
  toolName: string;
  success: boolean;
  data: unknown;
  evidenceSummary: string;
  executionTimeMs: number;
  error?: string;
}

interface AuthContext {
  tenantId: string;
  userId: string;
  role: string;
  propertyAccess: string[] | ['*'];
}

// ─── Parameter Schemas ───────────────────────────────────────────────────────

const CaseTimelineParams = z.object({
  caseId: z.string().describe('The case ID to generate timeline for'),
});

const TenantRiskParams = z.object({
  customerId: z.string().describe('The customer ID to analyze risk for'),
});

const VendorScorecardParams = z.object({
  vendorId: z.string().describe('The vendor ID to score'),
  windowDays: z.number().optional().default(365).describe('Lookback window in days'),
});

const UnitHealthParams = z.object({
  unitId: z.string().describe('The unit ID to check health for'),
});

const ParcelComplianceParams = z.object({
  parcelId: z.string().describe('The parcel ID to check compliance for'),
});

const PropertyRollupParams = z.object({
  propertyId: z.string().describe('The property ID to generate rollup for'),
});

const EvidencePackParams = z.object({
  caseId: z.string().describe('The case ID to generate evidence pack for'),
});

const PortfolioOverviewParams = z.object({});

const GraphStatsParams = z.object({});

// NEW 22: Unit Occupancy Timeline
const UnitOccupancyTimelineParams = z.object({
  unitId: z.string().describe('The unit ID to build occupancy timeline for'),
  page: z.number().optional().default(1).describe('Page number (1-based)'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Results per page (max 500)'),
});

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const GRAPH_TOOL_DEFINITIONS: GraphToolDefinition[] = [
  {
    name: 'get_case_timeline',
    description: 'Get a complete chronological timeline of everything related to a dispute case. Returns all connected events, notices, payments, work orders, inspections, and documents in time order. Use this when asked about case history, dispute details, or to build evidence.',
    parameters: CaseTimelineParams,
  },
  {
    name: 'get_tenant_risk_drivers',
    description: 'Analyze why a specific tenant/customer is at risk of churn, default, or dispute. Returns risk drivers with severity scores and evidence paths (overdue invoices, unresolved maintenance, active disputes). Use when asked about tenant risk, churn prediction, or relationship health.',
    parameters: TenantRiskParams,
  },
  {
    name: 'get_vendor_scorecard',
    description: 'Get performance metrics for a maintenance vendor including work order completion rate, average completion time, and quality issues. Use when evaluating vendor performance or investigating repeat maintenance problems.',
    parameters: VendorScorecardParams,
  },
  {
    name: 'get_unit_health',
    description: 'Get a comprehensive health report for a specific unit including occupancy status, open maintenance issues, overdue invoices, and inspection history. Returns a composite health score. Use when asked about unit condition or tenant experience.',
    parameters: UnitHealthParams,
  },
  {
    name: 'get_parcel_compliance',
    description: 'Check compliance status of a land parcel including expiring documents, expiring leases, and pending tasks. Returns compliance score and days until expiry. Use for land management, compliance monitoring, and document tracking.',
    parameters: ParcelComplianceParams,
  },
  {
    name: 'get_property_rollup',
    description: 'Get an enterprise-level KPI summary for a property including occupancy rate, active leases, open work orders, overdue invoices, and revenue metrics. Use for property performance analysis and owner reporting.',
    parameters: PropertyRollupParams,
  },
  {
    name: 'generate_evidence_pack',
    description: 'Assemble a court-ready evidence pack for a dispute case. Collects all connected documents, messages, notices, payments, work orders, and inspections in chronological order with connection paths. Use when preparing for legal proceedings or dispute resolution.',
    parameters: EvidencePackParams,
  },
  {
    name: 'get_portfolio_overview',
    description: 'Get a high-level overview of all properties in the portfolio with occupancy rates and unit counts. Use for portfolio-level analysis, owner dashboards, and regional reporting.',
    parameters: PortfolioOverviewParams,
  },
  {
    name: 'get_graph_stats',
    description: 'Get statistics about the knowledge graph for this tenant including node counts per type, relationship count, and last sync time. Use for system health monitoring and data completeness checks.',
    parameters: GraphStatsParams,
  },
  {
    name: 'GET_UNIT_OCCUPANCY_TIMELINE',
    description: 'Get a paginated chronological occupancy timeline for a unit using Neo4j (:Unit)-[:OCCUPIED_BY]->(:Customer) edges. Returns tenants, rents, entry/exit dates, and exit reasons sorted by period. Supports 20+ year histories via pagination. Use for longitudinal unit analysis, tenant-churn investigations, and occupancy reporting.',
    parameters: UnitOccupancyTimelineParams,
  },
];

// ─── Graph Agent Toolkit ─────────────────────────────────────────────────────

export class GraphAgentToolkit {
  constructor(private queryService: GraphQueryService) {}

  /**
   * Get all available tool definitions (for LLM function calling registration)
   */
  getToolDefinitions(): GraphToolDefinition[] {
    return GRAPH_TOOL_DEFINITIONS;
  }

  /**
   * Get tool definitions formatted for OpenAI function calling
   */
  getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return GRAPH_TOOL_DEFINITIONS.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  /**
   * Execute a tool by name with authorization context.
   * This is the main entry point called by the AI copilot.
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
    auth: AuthContext
  ): Promise<GraphToolResult> {
    const startTime = Date.now();

    try {
      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        return {
          toolName,
          success: false,
          data: null,
          evidenceSummary: '',
          executionTimeMs: Date.now() - startTime,
          error: `Unknown tool: ${toolName}`,
        };
      }

      const data = await handler(this.queryService, auth.tenantId, params);
      const evidenceSummary = generateEvidenceSummary(toolName, data);

      return {
        toolName,
        success: true,
        data,
        evidenceSummary,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        toolName,
        success: false,
        data: null,
        evidenceSummary: '',
        executionTimeMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── Tool Handlers ───────────────────────────────────────────────────────────

type ToolHandler = (
  service: GraphQueryService,
  tenantId: string,
  params: Record<string, unknown>
) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_case_timeline: async (service, tenantId, params) => {
    const { caseId } = CaseTimelineParams.parse(params);
    return service.getCaseTimeline(tenantId, caseId);
  },

  get_tenant_risk_drivers: async (service, tenantId, params) => {
    const { customerId } = TenantRiskParams.parse(params);
    return service.getTenantRiskDrivers(tenantId, customerId);
  },

  get_vendor_scorecard: async (service, tenantId, params) => {
    const { vendorId, windowDays } = VendorScorecardParams.parse(params);
    return service.getVendorScorecard(tenantId, vendorId, windowDays);
  },

  get_unit_health: async (service, tenantId, params) => {
    const { unitId } = UnitHealthParams.parse(params);
    return service.getUnitHealth(tenantId, unitId);
  },

  get_parcel_compliance: async (service, tenantId, params) => {
    const { parcelId } = ParcelComplianceParams.parse(params);
    return service.getParcelCompliance(tenantId, parcelId);
  },

  get_property_rollup: async (service, tenantId, params) => {
    const { propertyId } = PropertyRollupParams.parse(params);
    return service.getPropertyRollup(tenantId, propertyId);
  },

  generate_evidence_pack: async (service, tenantId, params) => {
    const { caseId } = EvidencePackParams.parse(params);
    return service.generateEvidencePack(tenantId, caseId);
  },

  get_portfolio_overview: async (service, tenantId) => {
    return service.getPortfolioOverview(tenantId);
  },

  get_graph_stats: async (service, tenantId) => {
    return service.getGraphStats(tenantId);
  },

  GET_UNIT_OCCUPANCY_TIMELINE: async (service, tenantId, params) => {
    const { unitId, page, limit } = UnitOccupancyTimelineParams.parse(params);
    // Delegate to the query service's occupancy-timeline method. If the
    // concrete GraphQueryService does not yet expose this method, throw
    // a recognisable error so the binder can stub-fill.
    const svc = service as unknown as {
      getUnitOccupancyTimeline?: (
        tenantId: string,
        unitId: string,
        page: number,
        limit: number
      ) => Promise<unknown>;
    };
    if (typeof svc.getUnitOccupancyTimeline !== 'function') {
      throw new Error(
        'GraphQueryService.getUnitOccupancyTimeline not implemented — bind via graph-sync infra layer.'
      );
    }
    return svc.getUnitOccupancyTimeline(tenantId, unitId, page, limit);
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable evidence summary for the AI to include in responses
 */
function generateEvidenceSummary(toolName: string, data: unknown): string {
  if (!data) return 'No data returned.';

  switch (toolName) {
    case 'get_case_timeline': {
      const timeline = data as Array<{ nodeLabel: string; title: string }>;
      return `Timeline with ${timeline.length} events: ${timeline.slice(0, 3).map(e => `${e.nodeLabel}: ${e.title}`).join(', ')}${timeline.length > 3 ? '...' : ''}`;
    }
    case 'get_tenant_risk_drivers': {
      const risk = data as { overallRiskLevel: string; drivers: Array<{ factor: string }> };
      return `Risk level: ${risk.overallRiskLevel}. Drivers: ${risk.drivers.map(d => d.factor).join(', ') || 'none'}`;
    }
    case 'get_vendor_scorecard': {
      const vendor = data as { vendorName: string; totalWorkOrders: number; completedWorkOrders: number };
      return `Vendor ${vendor.vendorName}: ${vendor.completedWorkOrders}/${vendor.totalWorkOrders} completed`;
    }
    case 'get_unit_health': {
      const unit = data as { unitName: string; healthScore: number; issues: unknown[] };
      return `Unit ${unit.unitName}: health score ${unit.healthScore}/100, ${unit.issues.length} issue(s)`;
    }
    case 'generate_evidence_pack': {
      const pack = data as { caseNumber: string; totalItems: number };
      return `Evidence pack for case ${pack.caseNumber}: ${pack.totalItems} items assembled`;
    }
    case 'get_portfolio_overview': {
      const properties = data as Array<{ propertyName: string }>;
      return `Portfolio: ${properties.length} properties`;
    }
    default:
      return JSON.stringify(data).substring(0, 200);
  }
}

/**
 * Convert a Zod schema to JSON Schema (simplified for OpenAI function calling)
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      const fieldSchema = zodFieldToJsonSchema(zodField);
      properties[key] = fieldSchema;

      if (!(zodField instanceof z.ZodOptional) && !(zodField instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object', properties: {} };
}

function zodFieldToJsonSchema(field: z.ZodType): Record<string, unknown> {
  if (field instanceof z.ZodString) {
    return { type: 'string', description: field.description };
  }
  if (field instanceof z.ZodNumber) {
    return { type: 'number', description: field.description };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: 'boolean', description: field.description };
  }
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field.removeDefault());
    return { ...inner, default: field._def.defaultValue() };
  }
  return { type: 'string' };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGraphAgentToolkit(queryService: GraphQueryService): GraphAgentToolkit {
  return new GraphAgentToolkit(queryService);
}
