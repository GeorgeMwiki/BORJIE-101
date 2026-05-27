/**
 * LITFIN-port domain composition helper (Batch 2).
 *
 * Wires 5 domain-shaped packages onto `ServiceRegistry`:
 *
 *   - `@borjie/mcp-cost-persistence` (PO-37): per-MCP cost +
 *     health probe scheduling — pure kernels + injectable sinks.
 *     Exposed as DI namespace (no I/O at construction time).
 *   - `@borjie/fairness-eval`: counterfactual fairness eval
 *     with Fair Housing Act + TZ/KE attribute registries. Exposed
 *     as DI namespace; consumers (eval workers, governance audit)
 *     instantiate `createFairnessEval({ brain, jurisdiction })`
 *     when needed (brain port only resolvable per-tenant at runtime).
 *   - `@borjie/analytics`: Cube semantic + Vega-Lite v6 +
 *     AI chart authoring. `createAnalytics` is wired with no brain
 *     or realtime port today (both follow-ups); the parsers /
 *     dashboards / chart-builder pure functions remain reachable
 *     via the namespace export.
 *   - `@borjie/knowledge-graph`: real-estate ontology +
 *     GraphRAG + viz spec builders. In-memory store + mock
 *     embedder for now; production swap is a Neo4j adapter +
 *     OpenAI text embedder (both ports already exposed).
 *   - `@borjie/compliance-pack`: 10-framework controls + DSAR
 *     automation + erasure cascade + envelope encryption +
 *     residency policy + breach notification. The `engine` slot
 *     stays null because collectors + residency policy are per-
 *     tenant; consumers call `createComplianceEngine` themselves
 *     with the tenant-scoped deps. Pure-function surfaces
 *     (control catalogs, cascade builder, residency checker,
 *     breach helpers) remain reachable via the namespace export.
 */

import * as McpCostPersistenceNs from '@borjie/mcp-cost-persistence';
import * as FairnessEvalNs from '@borjie/fairness-eval';
import * as AnalyticsNs from '@borjie/analytics';
import * as KnowledgeGraphNs from '@borjie/knowledge-graph';
import * as CompliancePackNs from '@borjie/compliance-pack';
import {
  createAnalytics,
  type AnalyticsInstance,
} from '@borjie/analytics';
import {
  createKnowledgeGraph,
  createInMemoryStore,
  createMockGraphEmbedder,
  realEstateOntology,
} from '@borjie/knowledge-graph';
type KnowledgeGraphInstance = ReturnType<typeof createKnowledgeGraph>;

export interface LitfinDomainBundle {
  /** PO-37 — MCP cost + health probe namespace. Stateful state machines
   *  are instantiated per-server via the namespace's factories. */
  readonly mcpCostPersistence: typeof McpCostPersistenceNs;
  /** Counterfactual fairness namespace. `createFairnessEval` is invoked
   *  per-tenant by the eval workers (brain port resolves at runtime). */
  readonly fairnessEval: typeof FairnessEvalNs;
  /** Analytics namespace (semantic layer + parsers + Vega-Lite +
   *  dashboards + AI chart author). */
  readonly analytics: typeof AnalyticsNs;
  /** Knowledge-graph namespace (ontology + store adapters + GraphRAG +
   *  viz spec builders). */
  readonly knowledgeGraph: typeof KnowledgeGraphNs;
  /** Compliance-pack namespace (10 framework catalogs + DSAR + erasure
   *  cascade + encryption + residency + breach notifications). */
  readonly compliancePack: typeof CompliancePackNs;

  /**
   * Pre-wired analytics instance (no brain / realtime / storage ports
   * — those are per-tenant follow-ups). The pure-function surfaces
   * (parsers, chart builders, dashboards) remain reachable via the
   * `analytics` namespace.
   */
  readonly analyticsInstance: AnalyticsInstance;

  /**
   * Pre-wired in-memory knowledge graph (real-estate ontology, mock
   * embedder). Suitable for dev / unit tests + the GraphRAG path on
   * single-tenant fixtures. Production swap: Neo4j adapter + OpenAI
   * embedder via `createKnowledgeGraph({ store, embedder, brain })`.
   */
  readonly knowledgeGraphInstance: KnowledgeGraphInstance;
}

/**
 * Build the LITFIN domain bundle.
 *
 * Same shape in degraded and live modes — every member is either a
 * pure-function namespace or an in-memory facade. Postgres / Neo4j /
 * KMS adapters are swapped in by follow-up wirings (a new wiring
 * helper per concrete adapter — see e.g. `cross-org-denial-recorder-
 * wiring.ts` for the established pattern).
 */
export function createLitfinDomainBundle(): LitfinDomainBundle {
  return Object.freeze({
    mcpCostPersistence: McpCostPersistenceNs,
    fairnessEval: FairnessEvalNs,
    analytics: AnalyticsNs,
    knowledgeGraph: KnowledgeGraphNs,
    compliancePack: CompliancePackNs,
    analyticsInstance: createAnalytics(),
    knowledgeGraphInstance: createKnowledgeGraph({
      store: createInMemoryStore(),
      embedder: createMockGraphEmbedder({ dimension: 64 }),
      ontology: realEstateOntology,
    }),
  });
}
