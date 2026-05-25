/**
 * Agent Card — A2A capability advertisement.
 *
 * Exposes a machine-readable description of what BORJIE's agent
 * surface can do. Served at /.well-known/agent.json in the gateway.
 */

import type {
  AgentCard,
  ResourceSummary,
  ToolSummary,
} from './types.js';

export interface AgentCardDeps {
  readonly baseUrl: string;
  readonly version?: string;
  readonly contact?: string;
  readonly tools: ReadonlyArray<ToolSummary>;
  readonly resources: ReadonlyArray<ResourceSummary>;
}

export function generateAgentCard(deps: AgentCardDeps): AgentCard {
  return Object.freeze({
    name: 'BORJIE Agent Platform',
    description:
      'Multi-tenant property-management SaaS exposing canonical property graph reads, tenant risk reports, maintenance case lifecycle, letter generation, arrears projection, occupancy timeline, AI-cost summaries, compliance-plugin enumeration, warehouse inventory, and universal skill dispatch via MCP and REST.',
    url: deps.baseUrl,
    version: deps.version ?? '0.1.0',
    provider: Object.freeze({
      organization: 'BORJIE',
      url: deps.baseUrl,
      // Platform-level contact. Prefer env override so the domain is not
      // baked into the agent-platform package.
      contact:
        deps.contact ??
        (typeof process !== 'undefined'
          ? process.env?.AGENT_PLATFORM_CONTACT
          : undefined) ??
        'agents@example.com',
    }),
    capabilities: Object.freeze([
      Object.freeze({
        name: 'property-graph-query',
        description:
          'Query the Canonical Property Graph for entities, relationships, and computed rollups.',
      }),
      Object.freeze({
        name: 'tenant-risk-scoring',
        description:
          'Compute or read tenant risk profiles (arrears, churn, dispute).',
      }),
      Object.freeze({
        name: 'maintenance-lifecycle',
        description:
          'Read and create maintenance cases tied to the active taxonomy and SLA.',
      }),
      Object.freeze({
        name: 'letter-generation',
        description:
          'Generate country-compliant letters via the active compliance-plugin template catalog.',
      }),
      Object.freeze({
        name: 'arrears-projection',
        description:
          'Project the arrears curve for a tenant or unit using the paytime-prediction model.',
      }),
      Object.freeze({
        name: 'occupancy-timeline',
        description:
          'Retrieve move-in / move-out / vacancy events for a unit or property.',
      }),
      Object.freeze({
        name: 'ai-cost-accounting',
        description:
          'Query the per-tenant AI-spend ledger with monthly budget awareness.',
      }),
      Object.freeze({
        name: 'compliance-plugins',
        description:
          'Enumerate installed country configuration packages (GDPR, PPA, data residency).',
      }),
      Object.freeze({
        name: 'warehouse-inventory',
        description:
          'Read warehouse stock + movement history for materials and tools.',
      }),
      Object.freeze({
        name: 'universal-skill-dispatch',
        description:
          'Call any registered BORJIE skill by name through a single `run_skill` entrypoint.',
      }),
    ]),
    authentication: Object.freeze({
      schemes: Object.freeze(['api-key', 'bearer', 'hmac-sha256']),
      registrationUrl: `${deps.baseUrl}/api/v1/agent/register`,
    }),
    tools: deps.tools,
    resources: deps.resources,
    rateLimit: Object.freeze({
      defaultRpm: 60,
      maxRpm: 600,
      burstLimit: 20,
    }),
  });
}
