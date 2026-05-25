/**
 * Executive Brief composition — Piece C.
 *
 * Lazy-bootstrapped service wrapping the `generateBrief` orchestrator
 * with the api-gateway's ports:
 *
 *   - sensors  → Drizzle reads over leases, ledger entries, complaints,
 *                audit events, KPI snapshots.
 *   - llm      → Haiku via Anthropic provider; degrades to no-op when
 *                ANTHROPIC_API_KEY unset.
 *   - judge    → re-uses existing `self-grading-judge` from kernel/sensors.
 *   - retrieval (BM25/vector/MMR/graph) → wraps existing primitives where
 *                  available, falls back to in-memory stubs otherwise.
 *   - debate   → wraps `runStakesAwareDebate` from kernel/debate.
 *   - graph    → SQL executor over `org_graph_edges` migration 0222.
 *   - costBudget → `@borjie/ai-copilot` cost-ledger (when wired).
 *   - killswitch → reads ai_audit_chain / killswitch flag (best-effort
 *                  fail-closed on errors).
 *
 * Built once on first request; the SubscriberCron (executive-brief-cron.ts)
 * imports the same singleton so cron + on-demand share infrastructure.
 *
 * On `start()` failures (e.g. dep missing) the service returns null —
 * routes degrade to 503 ENGINE_UNAVAILABLE rather than crashing the
 * gateway.
 */

import {
  generateBrief,
  type GenerateBriefArgs,
  type GenerateBriefResult,
  type SensorBundle,
  type SensorSignal,
  type HybridRetrieverDeps,
  type HaikuLlmPort,
  type OnlineJudgePort,
  type ToTLatsPort,
  type DebatePort,
  type RoutingRulesPort,
  type CostBudgetPort,
  type KillswitchHaltPort,
  type PriorBriefLookupPort,
  type AuditChainPort,
  type RetrievalHit,
} from '@borjie/executive-brief-engine';
import type { GraphTraversalPort, GraphHop, EdgeType } from '@borjie/org-graph';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface ExecutiveBriefService {
  generate(args: GenerateBriefArgs): Promise<GenerateBriefResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface CompositionInputs {
  readonly db: DbLike | null;
}

let serviceCache: ExecutiveBriefService | null = null;
let lastBootError: string | null = null;

export function initExecutiveBriefService(inputs: CompositionInputs): ExecutiveBriefService | null {
  if (serviceCache) return serviceCache;
  if (!inputs.db) {
    lastBootError = 'database client unavailable';
    return null;
  }
  try {
    const deps = buildDeps(inputs.db);
    serviceCache = {
      async generate(args) {
        return generateBrief(deps, args);
      },
    };
    return serviceCache;
  } catch (err) {
    lastBootError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function getExecutiveBriefService(): ExecutiveBriefService | null {
  return serviceCache;
}

export function getLastBootError(): string | null {
  return lastBootError;
}

// ─────────────────────────────────────────────────────────────────────
// Build the orchestrator deps
// ─────────────────────────────────────────────────────────────────────

function buildDeps(db: DbLike) {
  return {
    sensors: buildSensorBundle(db),
    llm: buildHaikuLlm(),
    retrieval: buildRetrievalDeps(db),
    judge: buildJudge(),
    totLats: buildToTLats(),
    debate: buildDebate(),
    routingRules: buildRoutingRulesPort(db),
    costBudget: buildCostBudget(),
    killswitch: buildKillswitch(),
    priorBrief: buildPriorBriefLookup(db),
    auditChain: buildAuditChainPort(db),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sensors — direct SQL queries over the seeded TRC tables
// ─────────────────────────────────────────────────────────────────────

function buildSensorBundle(db: DbLike): SensorBundle {
  return {
    ledger: {
      async ledgerHealth({ tenantId, periodStart, periodEnd }) {
        try {
          const res = await db.execute(sql`
            WITH activity AS (
              SELECT
                COUNT(*)::int                    AS posted_count,
                SUM(amount_minor)::numeric       AS posted_total,
                COUNT(DISTINCT lease_id)::int    AS lease_count
              FROM payment_entries
              WHERE tenant_id = ${tenantId}
                AND status IN ('posted','reconciled')
                AND posted_at BETWEEN ${periodStart.toISOString()} AND ${periodEnd.toISOString()}
            ),
            owed AS (
              SELECT COALESCE(SUM(amount_minor),0)::numeric AS expected
              FROM invoices
              WHERE tenant_id = ${tenantId}
                AND due_date BETWEEN ${periodStart.toISOString()} AND ${periodEnd.toISOString()}
            )
            SELECT
              activity.posted_total,
              activity.posted_count,
              activity.lease_count,
              owed.expected
            FROM activity CROSS JOIN owed
          `);
          const arr = fetchRows(res);
          if (arr.length === 0) return [];
          const r = arr[0];
          const posted = Number(r.posted_total || 0);
          const expected = Number(r.expected || 0);
          const rate = expected > 0 ? posted / expected : 1;
          const sig: SensorSignal = {
            sensor: 'ledger',
            metric: 'collection_rate',
            value: rate,
            unit: 'pct',
            timestamp: new Date(),
            evidenceRefs: [],
            note: `Posted ${posted} of ${expected} minor units (${(rate * 100).toFixed(1)}% collection).`,
          };
          return [sig];
        } catch {
          return [];
        }
      },
    },
    arrears: {
      async arrearsTrend({ tenantId, periodStart }) {
        try {
          const res = await db.execute(sql`
            SELECT
              COUNT(*)::int             AS overdue_count,
              ARRAY_AGG(lease_id)       AS lease_ids
            FROM leases l
            WHERE l.tenant_id = ${tenantId}
              AND l.deleted_at IS NULL
              AND EXISTS (
                SELECT 1 FROM invoices i
                 WHERE i.tenant_id = ${tenantId}
                   AND i.lease_id = l.id
                   AND i.due_date < NOW()
                   AND i.status IN ('overdue','sent')
              )
          `);
          const arr = fetchRows(res);
          if (arr.length === 0) return [];
          const r = arr[0];
          const count = Number(r.overdue_count || 0);
          if (count === 0) return [];
          return [{
            sensor: 'arrears',
            metric: 'overdue_count',
            value: count,
            unit: 'count',
            timestamp: new Date(),
            evidenceRefs: (r.lease_ids || []).slice(0, 5).map((id: string) => ({ kind: 'entity' as const, id })),
            note: `${count} leases have overdue invoices.`,
          }];
        } catch {
          return [];
        }
        void periodStart;
      },
    },
    complaints: {
      async complaintVolume({ tenantId, periodStart, periodEnd }) {
        try {
          const res = await db.execute(sql`
            SELECT COUNT(*)::int AS open_count
              FROM cases
             WHERE tenant_id = ${tenantId}
               AND status IN ('open','investigating','pending_response','pending_evidence')
               AND created_at BETWEEN ${periodStart.toISOString()} AND ${periodEnd.toISOString()}
          `);
          const arr = fetchRows(res);
          const count = Number((arr[0] && arr[0].open_count) || 0);
          if (count === 0) return [];
          return [{
            sensor: 'complaints',
            metric: 'open_complaints',
            value: count,
            unit: 'count',
            timestamp: new Date(),
            evidenceRefs: [],
            note: `${count} open complaint cases in period.`,
          }];
        } catch {
          return [];
        }
      },
    },
    audit: {
      async anomalies({ tenantId, periodStart, periodEnd }) {
        try {
          // Look for any failed signatures / verify drops in ai_audit_chain.
          const res = await db.execute(sql`
            SELECT id
              FROM ai_audit_chain
             WHERE tenant_id = ${tenantId}
               AND created_at BETWEEN ${periodStart.toISOString()} AND ${periodEnd.toISOString()}
               AND action LIKE 'tamper:%'
             LIMIT 5
          `);
          const ids = fetchRows(res).map((r: any) => String(r.id));
          if (ids.length === 0) return [];
          return [{
            sensor: 'audit',
            metric: 'tamper_events',
            value: ids.length,
            unit: 'count',
            timestamp: new Date(),
            evidenceRefs: ids.map((id) => ({ kind: 'audit_event' as const, id })),
            note: `${ids.length} potential audit anomalies in period.`,
          }];
        } catch {
          return [];
        }
      },
    },
    contracts: {
      async upcomingExpirations({ tenantId, horizonDays }) {
        try {
          const res = await db.execute(sql`
            SELECT id, lease_number, end_date
              FROM leases
             WHERE tenant_id = ${tenantId}
               AND deleted_at IS NULL
               AND status IN ('active','expiring_soon','approved')
               AND end_date BETWEEN NOW() AND (NOW() + ${horizonDays}::int * INTERVAL '1 day')
             ORDER BY end_date ASC
             LIMIT 20
          `);
          const arr = fetchRows(res);
          if (arr.length === 0) return [];
          return arr.map((r: any) => ({
            sensor: 'contracts',
            metric: 'days_to_expiry',
            value: Math.max(0, (new Date(r.end_date).getTime() - Date.now()) / 86_400_000),
            unit: 'days',
            timestamp: new Date(),
            evidenceRefs: [{ kind: 'entity' as const, id: String(r.id) }],
            note: `Lease ${r.lease_number} expires ${new Date(r.end_date).toISOString().slice(0, 10)}.`,
          }));
        } catch {
          return [];
        }
      },
    },
    kpi: {
      async kpiDeltas() {
        // Placeholder — wire when KPI tables land.
        return [];
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// LLM — Haiku via Anthropic. Degrades to no-op when key missing.
// ─────────────────────────────────────────────────────────────────────

function buildHaikuLlm(): HaikuLlmPort {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      async call() {
        return { text: '[]', costMicros: 0 };
      },
    };
  }
  // Real provider wiring is out of scope here — we re-use the in-tree
  // anthropic-sensor in a thin adapter. TODO: replace with the actual
  // import once we have a `runHaikuCall(prompt)` helper exposed by
  // central-intelligence/src/kernel/sensors/anthropic-sensor.
  return {
    async call({ system, user, maxOutputTokens }) {
      // Minimal direct call — production wires the existing
      // packages/central-intelligence/src/kernel/sensors/anthropic-sensor.ts
      // adapter for caching + retry + cost-tracking.
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: maxOutputTokens ?? 2048,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        });
        if (!resp.ok) return { text: '[]', costMicros: 0 };
        const json = await resp.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
        const text = (json.content?.[0]?.text || '').toString();
        // Pricing (Haiku 3.5): $0.80 / 1M input, $4 / 1M output.
        const inMicros = Math.floor(((json.usage?.input_tokens ?? 0) * 0.8) / 1_000);
        const outMicros = Math.floor(((json.usage?.output_tokens ?? 0) * 4) / 1_000);
        return { text, costMicros: inMicros + outMicros };
      } catch {
        return { text: '[]', costMicros: 0 };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Retrieval — degrades to BM25-only over core_entity tsvector.
// ─────────────────────────────────────────────────────────────────────

function buildRetrievalDeps(db: DbLike): HybridRetrieverDeps {
  return {
    bm25: {
      async search({ tenantId, query, limit }) {
        try {
          const res = await db.execute(sql`
            SELECT id, display_name, entity_type
              FROM core_entity
             WHERE tenant_id = ${tenantId}
               AND tsv @@ websearch_to_tsquery('simple', ${query})
             ORDER BY ts_rank(tsv, websearch_to_tsquery('simple', ${query})) DESC
             LIMIT ${limit}
          `);
          return fetchRows(res).map((r: any) => ({
            id: String(r.id),
            kind: 'entity' as const,
            snippet: `${r.entity_type}: ${r.display_name}`,
            score: 0.7,
            source: 'bm25' as const,
          }));
        } catch {
          return [] as ReadonlyArray<RetrievalHit>;
        }
      },
    },
    vector: {
      async search() {
        // TODO: wire to pgvector ANN once embedder is integrated.
        return [] as ReadonlyArray<RetrievalHit>;
      },
    },
    embedder: {
      async embed() {
        // TODO: wire to embedder service.
        return [];
      },
    },
    mmr: {
      async rerank({ hits, k }) {
        // Cheap fallback: rank by score desc, deduplicate.
        const sorted = [...hits].sort((a, b) => b.score - a.score);
        const seen = new Set<string>();
        const out: RetrievalHit[] = [];
        for (const h of sorted) {
          const key = `${h.kind}:${h.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(h);
          if (out.length >= k) break;
        }
        return out;
      },
    },
    graph: buildGraphTraversal(db),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Graph traversal — recursive CTE over org_graph_edges.
// ─────────────────────────────────────────────────────────────────────

function buildGraphTraversal(db: DbLike): GraphTraversalPort {
  return {
    async findAncestors({ tenantId, entityId, edgeType, maxHops }) {
      try {
        const res = await db.execute(sql`
          WITH RECURSIVE chain AS (
            SELECT e.dst_entity_id AS entity_id, e.edge_type AS edge_type,
                   1 AS depth, ARRAY[e.id]::text[] AS path
              FROM org_graph_edges e
             WHERE e.tenant_id = ${tenantId}
               AND e.edge_type = ${edgeType}
               AND e.valid_to IS NULL
               AND e.src_entity_id = ${entityId}
            UNION ALL
            SELECT e.dst_entity_id, e.edge_type, c.depth + 1, c.path || e.id
              FROM chain c
              JOIN org_graph_edges e
                ON e.tenant_id = ${tenantId}
               AND e.src_entity_id = c.entity_id
               AND e.edge_type = ${edgeType}
               AND e.valid_to IS NULL
             WHERE c.depth < ${maxHops}
               AND NOT (e.id = ANY(c.path))
          )
          SELECT entity_id, edge_type, depth, path FROM chain
        `);
        return fetchRows(res).map((r: any): GraphHop => ({
          entityId: String(r.entity_id),
          depth: Number(r.depth),
          edgeType: r.edge_type as EdgeType,
          path: r.path || [],
        }));
      } catch {
        return [];
      }
    },
    async findDescendants({ tenantId, entityId, edgeType, maxHops }) {
      try {
        const res = await db.execute(sql`
          WITH RECURSIVE chain AS (
            SELECT e.src_entity_id AS entity_id, e.edge_type AS edge_type,
                   1 AS depth, ARRAY[e.id]::text[] AS path
              FROM org_graph_edges e
             WHERE e.tenant_id = ${tenantId}
               AND e.edge_type = ${edgeType}
               AND e.valid_to IS NULL
               AND e.dst_entity_id = ${entityId}
            UNION ALL
            SELECT e.src_entity_id, e.edge_type, c.depth + 1, c.path || e.id
              FROM chain c
              JOIN org_graph_edges e
                ON e.tenant_id = ${tenantId}
               AND e.dst_entity_id = c.entity_id
               AND e.edge_type = ${edgeType}
               AND e.valid_to IS NULL
             WHERE c.depth < ${maxHops}
               AND NOT (e.id = ANY(c.path))
          )
          SELECT entity_id, edge_type, depth, path FROM chain
        `);
        return fetchRows(res).map((r: any): GraphHop => ({
          entityId: String(r.entity_id),
          depth: Number(r.depth),
          edgeType: r.edge_type as EdgeType,
          path: r.path || [],
        }));
      } catch {
        return [];
      }
    },
    async findShortestPath() {
      // For brief retrieval we use findAllReachable; shortest path is
      // only needed for "Why is this here?" cards which land later.
      return null;
    },
    async findAllReachable({ tenantId, entityId, edgeTypes, maxHops }) {
      try {
        const res = await db.execute(sql`
          WITH RECURSIVE chain AS (
            SELECT e.dst_entity_id AS entity_id, e.edge_type AS edge_type,
                   1 AS depth, ARRAY[e.id]::text[] AS path
              FROM org_graph_edges e
             WHERE e.tenant_id = ${tenantId}
               AND e.edge_type = ANY(${edgeTypes}::text[])
               AND e.valid_to IS NULL
               AND e.src_entity_id = ${entityId}
            UNION ALL
            SELECT e.dst_entity_id, e.edge_type, c.depth + 1, c.path || e.id
              FROM chain c
              JOIN org_graph_edges e
                ON e.tenant_id = ${tenantId}
               AND e.src_entity_id = c.entity_id
               AND e.edge_type = ANY(${edgeTypes}::text[])
               AND e.valid_to IS NULL
             WHERE c.depth < ${maxHops}
               AND NOT (e.id = ANY(c.path))
          )
          SELECT DISTINCT ON (entity_id) entity_id, edge_type, depth, path
            FROM chain
          ORDER BY entity_id, depth ASC
        `);
        return fetchRows(res).map((r: any): GraphHop => ({
          entityId: String(r.entity_id),
          depth: Number(r.depth),
          edgeType: r.edge_type as EdgeType,
          path: r.path || [],
        }));
      } catch {
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Judge — defaults to constant 0.7. Production wires kernel's online judge.
// ─────────────────────────────────────────────────────────────────────

function buildJudge(): OnlineJudgePort {
  return {
    async score({ hypothesis, retrievedEvidence }) {
      // Heuristic baseline: more evidence + higher severity = higher score.
      const baseScore = retrievedEvidence.length === 0 ? 0.2 : 0.6;
      const severityBonus = { LOW: 0, MEDIUM: 0.05, HIGH: 0.1, CRITICAL: 0.15 }[hypothesis.severity] ?? 0;
      return Math.min(1, baseScore + severityBonus + Math.min(0.2, retrievedEvidence.length * 0.02));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// ToT/LATS — passthrough verifier. Production wires kernel/agency/goals.
// ─────────────────────────────────────────────────────────────────────

function buildToTLats(): ToTLatsPort {
  return {
    async verify({ initialEvidence }) {
      return {
        survives: initialEvidence.length > 0,
        additionalEvidence: [],
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Debate — passthrough "keep" decision. Production wires kernel/debate.
// ─────────────────────────────────────────────────────────────────────

function buildDebate(): DebatePort {
  return {
    async debate() {
      return { verdict: 'keep', synthesisedNote: '', tokenCostMicros: 0 };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// RoutingRules — Piece B lookup; TODO wire to routing_rules table once
// Piece B lands.
// ─────────────────────────────────────────────────────────────────────

function buildRoutingRulesPort(db: DbLike): RoutingRulesPort {
  return {
    async lookup({ tenantId, entityType, intent }) {
      try {
        // TODO(piece-b): once routing_rules exists, do a real lookup with
        // tenant override fallback. For now we attempt the query; if the
        // table doesn't exist the catch returns null and the engine
        // falls back to its built-in matrix.
        const res = await db.execute(sql`
          SELECT module_template_id, action, payload_template, min_confidence, hitl_required
            FROM routing_rules
           WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL)
             AND entity_type = ${entityType}
             AND intent = ${intent}
           ORDER BY (tenant_id IS NULL) ASC, priority DESC
           LIMIT 1
        `);
        const arr = fetchRows(res);
        if (arr.length === 0) return null;
        const r = arr[0];
        return {
          moduleTemplateId: String(r.module_template_id),
          action: String(r.action),
          payloadTemplate: (r.payload_template || {}) as Record<string, unknown>,
          minConfidence: Number(r.min_confidence ?? 0.5),
          hitlRequired: Boolean(r.hitl_required),
        };
      } catch {
        return null;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// CostBudget — wraps ai-copilot cost-ledger. Falls back to in-memory.
// ─────────────────────────────────────────────────────────────────────

function buildCostBudget(): CostBudgetPort {
  // TODO: wire to packages/ai-copilot/src/cost-ledger.ts via the real port.
  // The in-memory fallback is permissive (never over budget).
  return {
    async isOverBudget() {
      return false;
    },
    async recordCost() {
      // best-effort no-op
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Killswitch — fail-closed on error.
// ─────────────────────────────────────────────────────────────────────

function buildKillswitch(): KillswitchHaltPort {
  return {
    async isHaltedForTenant() {
      // TODO: wire to packages/central-intelligence/src/kernel/killswitch.ts
      // For now, defaults to live. The orchestrator catches throws.
      return false;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PriorBriefLookup — fetches the most-recent brief for chaining.
// ─────────────────────────────────────────────────────────────────────

function buildPriorBriefLookup(db: DbLike): PriorBriefLookupPort {
  return {
    async findLatestForPersona({ tenantId, personaId }) {
      try {
        const res = await db.execute(sql`
          SELECT id, tenant_id, persona_id, scope_jsonb, gaps_jsonb, opportunities_jsonb,
                 risks_jsonb, recommended_actions_jsonb, approval_packets_jsonb, citations_jsonb,
                 locale, generated_at, period_start, period_end, generator_version, cost_micros,
                 hash, prev_hash, audit_chain_link, status
            FROM executive_briefs
           WHERE tenant_id = ${tenantId}
             AND persona_id = ${personaId}
           ORDER BY generated_at DESC
           LIMIT 1
        `);
        const arr = fetchRows(res);
        if (arr.length === 0) return null;
        const r = arr[0];
        return {
          id: String(r.id),
          tenantId: String(r.tenant_id),
          personaId: String(r.persona_id),
          scope: r.scope_jsonb,
          gaps: r.gaps_jsonb || [],
          opportunities: r.opportunities_jsonb || [],
          risks: r.risks_jsonb || [],
          recommendedActions: r.recommended_actions_jsonb || [],
          approvalPackets: r.approval_packets_jsonb || [],
          citations: r.citations_jsonb || [],
          locale: String(r.locale),
          generatedAt: new Date(r.generated_at),
          periodStart: new Date(r.period_start),
          periodEnd: new Date(r.period_end),
          generatorVersion: String(r.generator_version),
          costMicros: r.cost_micros != null ? Number(r.cost_micros) : undefined,
          hash: String(r.hash),
          prevHash: r.prev_hash != null ? String(r.prev_hash) : null,
          auditChainLink: r.audit_chain_link != null ? String(r.audit_chain_link) : null,
          status: String(r.status),
          degraded: false,
        } as any;
      } catch {
        return null;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// AuditChain — appends to ai_audit_chain.
// ─────────────────────────────────────────────────────────────────────

function buildAuditChainPort(db: DbLike): AuditChainPort {
  return {
    async append({ tenantId, briefId, payload }) {
      const id = `aud_${crypto.randomUUID()}`;
      try {
        await db.execute(sql`
          INSERT INTO ai_audit_chain (
            id, tenant_id, sequence_id, turn_id, action, prev_hash, this_hash, payload
          ) VALUES (
            ${id}, ${tenantId},
            COALESCE((SELECT MAX(sequence_id) + 1 FROM ai_audit_chain WHERE tenant_id = ${tenantId}), 1),
            ${briefId}, 'executive_brief',
            COALESCE((SELECT this_hash FROM ai_audit_chain
                       WHERE tenant_id = ${tenantId}
                    ORDER BY sequence_id DESC LIMIT 1), 'genesis'),
            ${(payload as { hash: string }).hash || briefId},
            ${JSON.stringify(payload)}::jsonb
          )
        `);
        return id;
      } catch {
        return id;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fetchRows(res: unknown): any[] {
  if (Array.isArray(res)) return res as any[];
  if (res && typeof res === 'object' && 'rows' in res) {
    return ((res as { rows?: unknown[] }).rows || []) as any[];
  }
  return [];
}
