/**
 * Graph kernel tools — Neo4j-backed knowledge-graph queries the
 * agent-loop can invoke on a user's behalf. Mirrors LITFIN's
 * portfolio-concentration / connected-parties / fraud-detection
 * pattern, scoped to property management on the Borjie CPG.
 *
 * Four tools, all tenant-scoped:
 *
 *   - graph.portfolioConcentration   Owner HHI + top concentration
 *   - graph.connectedParties         Multi-hop related-party graph
 *   - graph.leaseNetwork             Active-lease network for a property
 *   - graph.vacancyClusters          Properties with elevated vacancy
 *
 * Tenant isolation is enforced INSIDE the Cypher query — every MATCH
 * gates on `_tenantId = $tenantId`. We never trust the LLM to pass
 * the right tenantId; the tool reads it from `ctx` and substitutes
 * it as a query parameter.
 *
 * The GraphQueryService dependency is duck-typed locally so this
 * module does not compile-time-depend on @borjie/graph-sync.
 * The production composition root binds a concrete client at runtime
 * (same pattern as kernel/sources/dp-cohort-source.ts).
 *
 * Errors NEVER throw out of `invoke`; they collapse to a structured
 * `{ kind: 'error', message }` outcome the agent loop can render
 * back to the model so it can self-correct.
 */

import type {
  Citation,
  ScopeContext,
  Tool,
  ToolInput,
  ToolOutcome,
} from '../../types.js';

// ─────────────────────────────────────────────────────────────────────
// Duck-typed Neo4j client surface — we only need the read-query path.
// Mirrors @borjie/graph-sync Neo4jClient.readQuery shape.
// ─────────────────────────────────────────────────────────────────────

export interface GraphReadClient {
  readQuery<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<ReadonlyArray<T>>;
}

export interface GraphToolDeps {
  readonly client: GraphReadClient;
  readonly clock?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Output shapes (exported for callers / artifact renderers)
// ─────────────────────────────────────────────────────────────────────

export type ConcentrationFlag = 'low' | 'moderate' | 'high';

export interface PortfolioConcentrationOutput {
  readonly ownerId: string;
  readonly hhi: number;
  readonly topConcentration: ReadonlyArray<{
    readonly propertyId: string;
    readonly sharePct: number;
  }>;
  readonly flag: ConcentrationFlag;
}

export interface ConnectedPartiesOutput {
  readonly rootId: string;
  readonly rootKind: string;
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly relation: string;
    readonly hops: number;
  }>;
}

export interface LeaseNetworkOutput {
  readonly propertyId: string;
  readonly activeLeases: number;
  readonly tenantCount: number;
  readonly meanRent: number;
  readonly currency: string;
  readonly termMonthsP50: number;
  readonly termMonthsP90: number;
}

export interface VacancyClustersOutput {
  readonly clusters: ReadonlyArray<{
    readonly propertyId: string;
    readonly blockId: string | null;
    readonly vacantUnitCount: number;
    readonly totalUnitCount: number;
    readonly vacancyRate: number;
    readonly daysSinceFirstVacancy: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

export interface PortfolioConcentrationInput {
  readonly ownerId?: string | null;
  readonly topN?: number;
}

export interface ConnectedPartiesInput {
  readonly rootId: string;
  readonly maxHops?: number;
  readonly limit?: number;
}

export interface LeaseNetworkInput {
  readonly propertyId: string;
}

export interface VacancyClustersInput {
  readonly minVacancyPct?: number;
  readonly minDaysVacant?: number;
  readonly limit?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'object' && val !== null && 'low' in val) {
    const n = (val as { low: number }).low;
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function toStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

function nowIso(clock?: () => Date): string {
  const d = clock ? clock() : new Date();
  return d.toISOString();
}

function assertTenant(ctx: ScopeContext): { ok: true; tenantId: string } | { ok: false; message: string } {
  if (ctx.kind !== 'tenant') {
    return { ok: false, message: 'graph kernel tool invoked from non-tenant scope' };
  }
  if (!ctx.tenantId) {
    return { ok: false, message: 'graph kernel tool: tenantId missing from scope' };
  }
  return { ok: true, tenantId: ctx.tenantId };
}

function flagFor(hhi: number): ConcentrationFlag {
  // HHI banding aligned with the LITFIN portfolio-concentration heuristic:
  //   <0.15 = low / well-diversified
  //   0.15–0.25 = moderate
  //   >0.25 = high / concentrated
  if (hhi >= 0.25) return 'high';
  if (hhi >= 0.15) return 'moderate';
  return 'low';
}

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  const frac = pos - lo;
  return (sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac;
}

function buildCitation(
  id: string,
  target: Citation['target'],
  label: string,
  confidence = 0.9,
): Citation {
  return { id, target, label, confidence };
}

function errorOutcome(message: string, retryable = false): ToolOutcome<never> {
  return { kind: 'error', message, retryable };
}

// ─────────────────────────────────────────────────────────────────────
// Cypher queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Portfolio concentration HHI.
 *
 * Uses (Property)-[:OWNED_BY]->(User) edges from the CPG schema. The
 * "owner" is a User node (the schema models corporate / staff owners
 * via the User label). Property "value" is approximated as
 * sum-of-active-monthly-rent across its units (the CPG does not
 * carry a Valuation node yet — see report).
 */
const PORTFOLIO_CONCENTRATION_CYPHER = `
  MATCH (p:Property {_tenantId: $tenantId})-[:OWNED_BY]->(o:User {_tenantId: $tenantId})
  WHERE $ownerId IS NULL OR o._id = $ownerId
  OPTIONAL MATCH (p)-[:HAS_UNIT*1..3]->(u:Unit {_tenantId: $tenantId})
  OPTIONAL MATCH (u)<-[:APPLIES_TO]-(l:Lease {_tenantId: $tenantId})
  WHERE l.status = 'active'
  WITH o, p,
       sum(coalesce(toFloat(l.monthlyRent), 0.0)) AS propertyValue
  WITH o, collect({propertyId: p._id, value: propertyValue}) AS props
  WITH o, props,
       reduce(s = 0.0, x IN props | s + x.value) AS totalValue
  RETURN
    o._id AS ownerId,
    totalValue,
    [x IN props | {propertyId: x.propertyId, value: x.value}] AS properties
  ORDER BY ownerId
`;

/**
 * Connected parties — multi-hop neighbourhood around a starting node.
 *
 * Uses APOC-free variable-length pattern matching. Bounded both by
 * `maxHops` (default 2) and a `limit` cap to avoid explosive fan-out.
 * Tenant isolation is enforced on EVERY hop, not just the root, by
 * gating each variable-length pattern on `_tenantId`.
 */
const CONNECTED_PARTIES_CYPHER = `
  MATCH (root {_tenantId: $tenantId, _id: $rootId})
  OPTIONAL MATCH path = (root)-[*1..3]-(n)
  WHERE n._tenantId = $tenantId
    AND length(path) <= $maxHops
    AND ALL(rel IN relationships(path) WHERE
      coalesce(startNode(rel)._tenantId, $tenantId) = $tenantId
      AND coalesce(endNode(rel)._tenantId, $tenantId) = $tenantId)
  WITH root, n, length(path) AS hops, last(relationships(path)) AS lastRel
  WHERE n._id IS NOT NULL AND n._id <> root._id
  WITH root,
       collect(DISTINCT {
         id: n._id,
         kind: head(labels(n)),
         relation: type(lastRel),
         hops: hops
       })[0..$limit] AS connected
  RETURN
    root._id AS rootId,
    head(labels(root)) AS rootKind,
    connected
`;

/**
 * Lease network for a property.
 *
 * Walks Property→Unit→Lease. "Active" means lease.status = 'active'.
 * Term in months is computed from startDate/endDate when both are set.
 */
const LEASE_NETWORK_CYPHER = `
  MATCH (p:Property {_tenantId: $tenantId, _id: $propertyId})
  OPTIONAL MATCH (p)-[:HAS_UNIT*1..3]->(u:Unit {_tenantId: $tenantId})
  OPTIONAL MATCH (u)<-[:APPLIES_TO]-(l:Lease {_tenantId: $tenantId})
  WHERE l.status = 'active'
  OPTIONAL MATCH (tp:TenantProfile {_tenantId: $tenantId})-[:HAS_LEASE]->(l)
  WITH p,
       collect(DISTINCT l) AS leases,
       collect(DISTINCT tp) AS tenants
  WITH p, leases, tenants,
       [x IN leases WHERE x.monthlyRent IS NOT NULL | toFloat(x.monthlyRent)] AS rents,
       [x IN leases WHERE x.startDate IS NOT NULL AND x.endDate IS NOT NULL |
         duration.between(date(x.startDate), date(x.endDate)).months
       ] AS terms,
       [x IN leases WHERE x.currency IS NOT NULL | x.currency] AS currencies
  RETURN
    p._id AS propertyId,
    size(leases) AS activeLeases,
    size(tenants) AS tenantCount,
    CASE WHEN size(rents) > 0
      THEN reduce(s = 0.0, r IN rents | s + r) / size(rents)
      ELSE 0.0 END AS meanRent,
    CASE WHEN size(currencies) > 0 THEN head(currencies) ELSE 'KES' END AS currency,
    terms AS termMonths
`;

/**
 * Vacancy clusters — properties with elevated vacancy.
 *
 * Identifies (Property|Block) anchors where vacant units exceed
 * `minVacancyPct` and the oldest unit has been vacant for at least
 * `minDaysVacant`. The CPG models vacancy via Unit.status = 'vacant'
 * with an optional Unit.vacantSince timestamp.
 */
const VACANCY_CLUSTERS_CYPHER = `
  MATCH (p:Property {_tenantId: $tenantId})
  OPTIONAL MATCH (p)-[:HAS_UNIT*1..3]->(u:Unit {_tenantId: $tenantId})
  WITH p,
       collect(u) AS units
  WITH p,
       size(units) AS totalUnits,
       [x IN units WHERE x.status = 'vacant'] AS vacantList
  WITH p, totalUnits, size(vacantList) AS vacantUnits,
       [x IN vacantList WHERE x.vacantSince IS NOT NULL | x.vacantSince] AS vacantTs
  WITH p, totalUnits, vacantUnits, vacantTs,
       CASE WHEN totalUnits > 0
         THEN toFloat(vacantUnits) / toFloat(totalUnits)
         ELSE 0.0 END AS vacancyRate
  WHERE totalUnits > 0
    AND vacancyRate >= $minVacancyPct
  WITH p, totalUnits, vacantUnits, vacancyRate,
       CASE WHEN size(vacantTs) > 0
         THEN reduce(earliest = head(vacantTs), t IN vacantTs |
           CASE WHEN t < earliest THEN t ELSE earliest END)
         ELSE null END AS firstVacant
  WITH p, totalUnits, vacantUnits, vacancyRate, firstVacant,
       CASE WHEN firstVacant IS NOT NULL
         THEN duration.between(datetime(firstVacant), datetime($asOf)).days
         ELSE 0 END AS daysSinceFirstVacancy
  WHERE daysSinceFirstVacancy >= $minDaysVacant
  RETURN
    p._id AS propertyId,
    null AS blockId,
    vacantUnits AS vacantUnitCount,
    totalUnits AS totalUnitCount,
    vacancyRate,
    daysSinceFirstVacancy
  ORDER BY vacancyRate DESC, daysSinceFirstVacancy DESC
  LIMIT $limit
`;

// ─────────────────────────────────────────────────────────────────────
// Tool 1 — graph.portfolioConcentration
// ─────────────────────────────────────────────────────────────────────

export function createPortfolioConcentrationTool(
  deps: GraphToolDeps,
): Tool<PortfolioConcentrationInput, PortfolioConcentrationOutput> {
  return {
    name: 'graph.portfolioConcentration',
    description:
      'Compute the Herfindahl-Hirschman concentration index (HHI) of an owner\'s ' +
      'property portfolio. Returns the HHI, the top-N most-concentrated properties, ' +
      'and a low/moderate/high flag. Useful for risk officers and head-of-estates ' +
      'reviewing exposure to single-property failure.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        ownerId: {
          type: ['string', 'null'],
          description:
            'Optional owner (User) id to scope to. When null/omitted, returns ' +
            'concentration for every owner the tenant has visibility on.',
        },
        topN: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 5,
          description: 'How many top-concentration properties to return.',
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant'],
    async invoke(args: ToolInput<PortfolioConcentrationInput>): Promise<ToolOutcome<PortfolioConcentrationOutput>> {
      const startedAt = Date.now();
      const tenantCheck = assertTenant(args.ctx);
      if (!tenantCheck.ok) return errorOutcome(tenantCheck.message);

      const ownerId = args.input.ownerId ?? null;
      const topN = Math.min(Math.max(args.input.topN ?? 5, 1), 50);

      try {
        const records = await deps.client.readQuery<Record<string, unknown>>(
          PORTFOLIO_CONCENTRATION_CYPHER,
          { tenantId: tenantCheck.tenantId, ownerId },
        );

        if (records.length === 0) {
          // Empty portfolio — return zero-shaped result, NOT an error.
          const output: PortfolioConcentrationOutput = {
            ownerId: ownerId ?? '',
            hhi: 0,
            topConcentration: [],
            flag: 'low',
          };
          return {
            kind: 'ok',
            ok: true,
            output,
            latencyMs: Date.now() - startedAt,
            citations: [
              buildCitation(
                'graph.portfolioConcentration:empty',
                { kind: 'graph_node', nodeLabel: 'Owner', nodeId: ownerId ?? '*' },
                'Portfolio concentration (no properties)',
              ),
            ],
            artifact: null,
          };
        }

        const first = records[0]!;
        const resolvedOwnerId = toStr(first.ownerId, ownerId ?? '');
        const totalValue = toNum(first.totalValue);
        const properties = ((first.properties as Array<Record<string, unknown>>) ?? [])
          .map((p) => ({
            propertyId: toStr(p.propertyId),
            value: toNum(p.value),
          }))
          .filter((p) => p.propertyId);

        let hhi = 0;
        const shares = properties.map((p) => {
          const share = totalValue > 0 ? p.value / totalValue : 0;
          hhi += share * share;
          return { propertyId: p.propertyId, sharePct: Math.round(share * 1000) / 10 };
        });

        shares.sort((a, b) => b.sharePct - a.sharePct);
        const topConcentration = shares.slice(0, topN);

        const output: PortfolioConcentrationOutput = {
          ownerId: resolvedOwnerId,
          hhi: Math.round(hhi * 1000) / 1000,
          topConcentration,
          flag: flagFor(hhi),
        };

        const citations: Citation[] = [
          buildCitation(
            `graph.portfolioConcentration:${resolvedOwnerId}`,
            { kind: 'graph_node', nodeLabel: 'Owner', nodeId: resolvedOwnerId },
            `Portfolio HHI for owner ${resolvedOwnerId}`,
          ),
          ...topConcentration.slice(0, 3).map((c) =>
            buildCitation(
              `graph.portfolioConcentration:property:${c.propertyId}`,
              { kind: 'graph_node', nodeLabel: 'Property', nodeId: c.propertyId },
              `Property ${c.propertyId} (${c.sharePct}% of portfolio)`,
              0.85,
            ),
          ),
        ];

        return {
          kind: 'ok',
          ok: true,
          output,
          latencyMs: Date.now() - startedAt,
          citations,
          artifact: null,
        };
      } catch (err) {
        return errorOutcome(
          `graph.portfolioConcentration failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 2 — graph.connectedParties
// ─────────────────────────────────────────────────────────────────────

export function createConnectedPartiesTool(
  deps: GraphToolDeps,
): Tool<ConnectedPartiesInput, ConnectedPartiesOutput> {
  return {
    name: 'graph.connectedParties',
    description:
      'Return the multi-hop neighbourhood graph of related parties around a ' +
      'starting node id (typically a TenantProfile, Customer, User/owner, or ' +
      'Vendor). Useful for KYC, fraud screening, conflict-of-interest checks, ' +
      'and disclosure reviews.',
    inputJsonSchema: {
      type: 'object',
      required: ['rootId'],
      properties: {
        rootId: {
          type: 'string',
          minLength: 1,
          description: 'The CPG node _id of the starting party.',
        },
        maxHops: {
          type: 'integer',
          minimum: 1,
          maximum: 3,
          default: 2,
          description: 'Maximum hops to traverse outward (capped at 3).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          default: 50,
          description: 'Maximum related-party nodes to return.',
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant'],
    async invoke(args: ToolInput<ConnectedPartiesInput>): Promise<ToolOutcome<ConnectedPartiesOutput>> {
      const startedAt = Date.now();
      const tenantCheck = assertTenant(args.ctx);
      if (!tenantCheck.ok) return errorOutcome(tenantCheck.message);

      const rootId = args.input.rootId;
      if (!rootId) {
        return errorOutcome('graph.connectedParties: rootId is required');
      }
      const maxHops = Math.min(Math.max(args.input.maxHops ?? 2, 1), 3);
      const limit = Math.min(Math.max(args.input.limit ?? 50, 1), 200);

      try {
        const records = await deps.client.readQuery<Record<string, unknown>>(
          CONNECTED_PARTIES_CYPHER,
          { tenantId: tenantCheck.tenantId, rootId, maxHops, limit },
        );

        if (records.length === 0) {
          const output: ConnectedPartiesOutput = {
            rootId,
            rootKind: 'Unknown',
            nodes: [],
          };
          return {
            kind: 'ok',
            ok: true,
            output,
            latencyMs: Date.now() - startedAt,
            citations: [
              buildCitation(
                `graph.connectedParties:${rootId}`,
                { kind: 'graph_node', nodeLabel: 'Unknown', nodeId: rootId },
                `Connected parties for ${rootId} (no matches)`,
                0.5,
              ),
            ],
            artifact: null,
          };
        }

        const first = records[0]!;
        const rootKind = toStr(first.rootKind, 'Unknown');
        const connected = ((first.connected as Array<Record<string, unknown>>) ?? [])
          .filter((n) => n && n.id != null)
          .map((n) => ({
            id: toStr(n.id),
            kind: toStr(n.kind, 'Unknown'),
            relation: toStr(n.relation, 'RELATED'),
            hops: toNum(n.hops),
          }));

        const output: ConnectedPartiesOutput = {
          rootId: toStr(first.rootId, rootId),
          rootKind,
          nodes: connected,
        };

        const citations: Citation[] = [
          buildCitation(
            `graph.connectedParties:${rootId}`,
            { kind: 'graph_node', nodeLabel: rootKind, nodeId: rootId },
            `${rootKind} ${rootId} (${connected.length} connected)`,
          ),
          ...connected.slice(0, 3).map((n) =>
            buildCitation(
              `graph.connectedParties:edge:${rootId}->${n.id}`,
              {
                kind: 'graph_edge',
                fromId: rootId,
                edgeType: n.relation,
                toId: n.id,
              },
              `${rootKind}→${n.kind} via ${n.relation} (${n.hops} hop${n.hops === 1 ? '' : 's'})`,
              0.8,
            ),
          ),
        ];

        return {
          kind: 'ok',
          ok: true,
          output,
          latencyMs: Date.now() - startedAt,
          citations,
          artifact: null,
        };
      } catch (err) {
        return errorOutcome(
          `graph.connectedParties failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 3 — graph.leaseNetwork
// ─────────────────────────────────────────────────────────────────────

export function createLeaseNetworkTool(
  deps: GraphToolDeps,
): Tool<LeaseNetworkInput, LeaseNetworkOutput> {
  return {
    name: 'graph.leaseNetwork',
    description:
      'For a given property, return the network of currently-active leases ' +
      'with tenant-resident counts, mean rent, and lease-term distribution ' +
      '(median + 90th percentile term in months). Useful for revenue ' +
      'concentration and lease-roll-off analysis.',
    inputJsonSchema: {
      type: 'object',
      required: ['propertyId'],
      properties: {
        propertyId: {
          type: 'string',
          minLength: 1,
          description: 'CPG Property._id.',
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant'],
    async invoke(args: ToolInput<LeaseNetworkInput>): Promise<ToolOutcome<LeaseNetworkOutput>> {
      const startedAt = Date.now();
      const tenantCheck = assertTenant(args.ctx);
      if (!tenantCheck.ok) return errorOutcome(tenantCheck.message);

      const propertyId = args.input.propertyId;
      if (!propertyId) {
        return errorOutcome('graph.leaseNetwork: propertyId is required');
      }

      try {
        const records = await deps.client.readQuery<Record<string, unknown>>(
          LEASE_NETWORK_CYPHER,
          { tenantId: tenantCheck.tenantId, propertyId },
        );

        if (records.length === 0) {
          const output: LeaseNetworkOutput = {
            propertyId,
            activeLeases: 0,
            tenantCount: 0,
            meanRent: 0,
            currency: 'KES',
            termMonthsP50: 0,
            termMonthsP90: 0,
          };
          return {
            kind: 'ok',
            ok: true,
            output,
            latencyMs: Date.now() - startedAt,
            citations: [
              buildCitation(
                `graph.leaseNetwork:${propertyId}`,
                { kind: 'graph_node', nodeLabel: 'Property', nodeId: propertyId },
                `Lease network for property ${propertyId} (none active)`,
                0.5,
              ),
            ],
            artifact: null,
          };
        }

        const r = records[0]!;
        const termMonths = ((r.termMonths as Array<unknown>) ?? [])
          .map(toNum)
          .filter((n) => n >= 0)
          .sort((a, b) => a - b);

        const output: LeaseNetworkOutput = {
          propertyId: toStr(r.propertyId, propertyId),
          activeLeases: toNum(r.activeLeases),
          tenantCount: toNum(r.tenantCount),
          meanRent: Math.round(toNum(r.meanRent) * 100) / 100,
          currency: toStr(r.currency, 'KES'),
          termMonthsP50: Math.round(quantile(termMonths, 0.5) * 10) / 10,
          termMonthsP90: Math.round(quantile(termMonths, 0.9) * 10) / 10,
        };

        const citations: Citation[] = [
          buildCitation(
            `graph.leaseNetwork:${propertyId}`,
            { kind: 'graph_node', nodeLabel: 'Property', nodeId: propertyId },
            `Property ${propertyId}: ${output.activeLeases} active lease(s)`,
          ),
        ];

        return {
          kind: 'ok',
          ok: true,
          output,
          latencyMs: Date.now() - startedAt,
          citations,
          artifact: null,
        };
      } catch (err) {
        return errorOutcome(
          `graph.leaseNetwork failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool 4 — graph.vacancyClusters
// ─────────────────────────────────────────────────────────────────────

export function createVacancyClustersTool(
  deps: GraphToolDeps,
): Tool<VacancyClustersInput, VacancyClustersOutput> {
  return {
    name: 'graph.vacancyClusters',
    description:
      'Find blocks/properties with elevated vacancy — by default, more than ' +
      '20% of units empty for at least 30 days. Returns a ranked list. ' +
      'Useful for identifying leasing-pipeline failures and revenue leak.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        minVacancyPct: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.2,
          description: 'Minimum vacancy share (0–1) to include the cluster.',
        },
        minDaysVacant: {
          type: 'integer',
          minimum: 0,
          maximum: 3650,
          default: 30,
          description: 'Minimum days since first vacancy in the cluster.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 25,
          description: 'Maximum clusters to return.',
        },
      },
      additionalProperties: false,
    },
    scopes: ['tenant'],
    async invoke(args: ToolInput<VacancyClustersInput>): Promise<ToolOutcome<VacancyClustersOutput>> {
      const startedAt = Date.now();
      const tenantCheck = assertTenant(args.ctx);
      if (!tenantCheck.ok) return errorOutcome(tenantCheck.message);

      const minVacancyPct = Math.min(Math.max(args.input.minVacancyPct ?? 0.2, 0), 1);
      const minDaysVacant = Math.min(Math.max(args.input.minDaysVacant ?? 30, 0), 3650);
      const limit = Math.min(Math.max(args.input.limit ?? 25, 1), 100);

      try {
        const records = await deps.client.readQuery<Record<string, unknown>>(
          VACANCY_CLUSTERS_CYPHER,
          {
            tenantId: tenantCheck.tenantId,
            minVacancyPct,
            minDaysVacant,
            limit,
            asOf: nowIso(deps.clock),
          },
        );

        const clusters = (records ?? [])
          .filter((r) => r && r.propertyId != null)
          .map((r) => ({
            propertyId: toStr(r.propertyId),
            blockId: r.blockId == null ? null : toStr(r.blockId),
            vacantUnitCount: toNum(r.vacantUnitCount),
            totalUnitCount: toNum(r.totalUnitCount),
            vacancyRate: Math.round(toNum(r.vacancyRate) * 1000) / 1000,
            daysSinceFirstVacancy: toNum(r.daysSinceFirstVacancy),
          }));

        const output: VacancyClustersOutput = { clusters };

        const citations: Citation[] = clusters.length === 0
          ? [
              buildCitation(
                'graph.vacancyClusters:empty',
                {
                  kind: 'platform_aggregate',
                  statistic: 'vacancy_clusters',
                  sliceFingerprint: `tenant:${tenantCheck.tenantId}:thr:${minVacancyPct}:${minDaysVacant}d`,
                },
                'No vacancy clusters at current thresholds',
                0.6,
              ),
            ]
          : clusters.slice(0, 3).map((c) =>
              buildCitation(
                `graph.vacancyClusters:property:${c.propertyId}`,
                { kind: 'graph_node', nodeLabel: 'Property', nodeId: c.propertyId },
                `Property ${c.propertyId} — ${Math.round(c.vacancyRate * 100)}% vacant for ${c.daysSinceFirstVacancy}d`,
                0.85,
              ),
            );

        return {
          kind: 'ok',
          ok: true,
          output,
          latencyMs: Date.now() - startedAt,
          citations,
          artifact: null,
        };
      } catch (err) {
        return errorOutcome(
          `graph.vacancyClusters failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bundle — convenience factory binding all four tools to one client.
// ─────────────────────────────────────────────────────────────────────

export interface GraphKernelToolBundle {
  readonly portfolioConcentration: Tool<PortfolioConcentrationInput, PortfolioConcentrationOutput>;
  readonly connectedParties: Tool<ConnectedPartiesInput, ConnectedPartiesOutput>;
  readonly leaseNetwork: Tool<LeaseNetworkInput, LeaseNetworkOutput>;
  readonly vacancyClusters: Tool<VacancyClustersInput, VacancyClustersOutput>;
  readonly all: ReadonlyArray<Tool>;
}

export function createGraphKernelTools(graphService: GraphReadClient): GraphKernelToolBundle {
  const deps: GraphToolDeps = { client: graphService };
  const portfolioConcentration = createPortfolioConcentrationTool(deps);
  const connectedParties = createConnectedPartiesTool(deps);
  const leaseNetwork = createLeaseNetworkTool(deps);
  const vacancyClusters = createVacancyClustersTool(deps);

  return {
    portfolioConcentration,
    connectedParties,
    leaseNetwork,
    vacancyClusters,
    all: Object.freeze([
      portfolioConcentration,
      connectedParties,
      leaseNetwork,
      vacancyClusters,
    ] as ReadonlyArray<Tool>),
  };
}
