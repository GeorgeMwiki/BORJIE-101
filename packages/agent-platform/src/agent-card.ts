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
      'Multi-tenant mining estate operating system exposing canonical mining-estate graph reads, counterparty risk reports, maintenance case lifecycle, letter generation, outstanding-royalty projection, production timeline, AI-cost summaries, compliance-plugin enumeration, warehouse inventory, and universal skill dispatch via MCP and REST.',
    url: deps.baseUrl,
    version: deps.version ?? '0.1.0',
    provider: Object.freeze({
      organization: 'BORJIE',
      url: deps.baseUrl,
      // Platform-level contact. Resolved in priority order:
      //   1) explicit `deps.contact` (callers wire from app config)
      //   2) `AGENT_PLATFORM_CONTACT` env var
      //   3) RFC-2606 sentinel — only safe in tests; production must
      //      supply a real value or callers throw upstream.
      contact: resolveContact(deps.contact),
    }),
    capabilities: Object.freeze([
      Object.freeze({
        name: 'mining-estate-graph-query',
        description:
          'Query the Canonical Mining Estate Graph for entities, relationships, and computed rollups.',
      }),
      Object.freeze({
        name: 'counterparty-risk-scoring',
        description:
          'Compute or read counterparty risk profiles (outstanding royalties, churn, dispute).',
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
        name: 'outstanding-royalty-projection',
        description:
          'Project the outstanding-royalty curve for a counterparty or asset using the paytime-prediction model.',
      }),
      Object.freeze({
        name: 'production-timeline',
        description:
          'Retrieve mobilisation / closeout / available-capacity events for a unit or asset.',
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

/**
 * Default contact email used only when no caller supplies one and
 * `AGENT_PLATFORM_CONTACT` is unset. Kept under the RFC 2606 reserved
 * `example.com` domain so a misconfigured production deploy fails the
 * "no public personally-routable address" review rather than leaking
 * a real BORJIE mailbox.
 */
const FALLBACK_CONTACT_EMAIL = 'agents@example.com' as const;

function resolveContact(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const fromEnv =
    typeof process !== 'undefined'
      ? process.env?.AGENT_PLATFORM_CONTACT
      : undefined;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return FALLBACK_CONTACT_EMAIL;
}
