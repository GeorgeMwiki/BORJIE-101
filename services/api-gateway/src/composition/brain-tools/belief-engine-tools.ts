/**
 * Belief-engine brain tool — Wave-3 closure of the DARK
 * `@borjie/belief-engine` organ (MASTER_WIRING_CLOSURE_PLAN.md).
 *
 * Before this wiring `reviseBelief` was exported, `buildBeliefSink` existed
 * at `kernel/learning-loop-port.ts`, and `@borjie/belief-engine` was a
 * declared dep of central-intelligence — but NO composition-root caller
 * read or wrote the belief store. The `brain_beliefs` /
 * `belief_review_queue` tables (migration 0274) sat dark. This module
 * makes the organ's READ side REACHABLE as a persona-aware brain tool:
 *
 *   - `mwikila.belief.query`
 *        Reads the durable `brain_beliefs` store (the brain's revisable
 *        world-model: ore grades, royalty rates, recovery curves, regional
 *        logistics facts) by subject key or by domain, tenant-scoped via
 *        RLS. Returns the belief value, confidence, revision count, and the
 *        evidence chain (the BeliefSource list that justifies it). Use when
 *        the brain needs to recall "what do we currently believe about X"
 *        before answering. READ-only, LOW stakes.
 *
 * WRITE DISCIPLINE (CLAUDE.md hard rule + closure plan): this tool NEVER
 * writes a belief. `reviseBelief` (the 0.25-gated convince-loop, via
 * `buildBeliefSink`) remains the SOLE authorized writer; it is driven by
 * the kernel learning loop + the `belief_review_queue` HITL operator route,
 * NOT by a chat tool. A belief that is in the 0.05–0.25 split band is
 * queued for human review rather than auto-written. Surfacing the READ
 * side here is purely additive and propose-only.
 *
 * HARD-RULE compliance (closure plan):
 *   - Env flag: `BORJIE_BELIEF_QUERY_ENABLED` (default OFF — opt-in).
 *   - Budget bound: `BORJIE_BELIEF_BUDGET_MS` (default 1500ms) via the
 *     shared guard. A slow query can NEVER stall a brain turn.
 *   - Fail-safe: any error / no-DB resolves to a typed skip; never throws.
 *   - Evidence-required (CLAUDE.md): every returned belief carries its
 *     `BeliefSource` chain as evidence ids; a belief with an empty source
 *     chain is still returned but flagged `low_evidence` so the brain does
 *     not over-trust it.
 *   - Sensor/propose-only: no sovereign rail, no actuation, no write.
 *
 * @module services/api-gateway/src/composition/brain-tools/belief-engine-tools
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '@borjie/database';

import { getDb } from '../db-client.js';
import type { PersonaToolDescriptor } from './types.js';
import {
  organFlagDefaultOff,
  resolveBudgetMs,
  runOrganWithBudget,
} from './organ-budget-guard.js';

export const BELIEF_QUERY_FLAG = 'BORJIE_BELIEF_QUERY_ENABLED';
export const BELIEF_BUDGET_MS_KEY = 'BORJIE_BELIEF_BUDGET_MS';
const DEFAULT_BELIEF_BUDGET_MS = 1_500;

const OWNER_ADMIN_MANAGER: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T2_admin_strategist', 'T3_module_manager'];

// Mirrors `BeliefDomain` from @borjie/belief-engine (kept local so this
// tool does not need a runtime import of the belief-engine barrel for a
// pure read — the domain set is a stable enum).
const BELIEF_DOMAINS = [
  'regulatory',
  'sector-economics',
  'regional-economics',
  'market-prices',
  'estate-pattern',
  'process',
  'general',
] as const;

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const BeliefQueryInput = z
  .object({
    /** Exact canonical subject key (e.g. 'mwanza-gold-ore-grade'). */
    subject: z.string().min(1).max(160).optional(),
    /** Or list the most-recently-revised beliefs in a domain. */
    domain: z.enum(BELIEF_DOMAINS).optional(),
    /** Max rows for a domain list. */
    limit: z.number().int().positive().max(50).default(10),
  })
  .refine((v) => v.subject !== undefined || v.domain !== undefined, {
    message: 'belief.query requires either subject or domain',
  });

const BeliefRecordSchema = z.object({
  subject: z.string(),
  domain: z.string(),
  description: z.string(),
  value: z.record(z.unknown()),
  confidence: z.number(),
  revisionCount: z.number(),
  revisedAt: z.string(),
  sourceCount: z.number(),
  /** True when the belief has no evidence chain — brain must not over-trust. */
  lowEvidence: z.boolean(),
});

const BeliefQueryOutput = z.object({
  status: z.enum(['ok', 'skipped', 'not_found']),
  beliefs: z.array(BeliefRecordSchema),
  /** Evidence chain (CLAUDE.md): belief-source refs across the returned set. */
  evidenceIds: z.array(z.string()),
  note: z.string().optional(),
});

interface BeliefRow {
  readonly subject: string;
  readonly domain: string;
  readonly description: string;
  readonly value_jsonb: unknown;
  readonly confidence: string | number | null;
  readonly revision_count: string | number | null;
  readonly revised_at: string | Date | null;
  readonly sources_jsonb: unknown;
}

function rowsOf(raw: unknown): ReadonlyArray<BeliefRow> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<BeliefRow>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<BeliefRow>;
  }
  return [];
}

function sourceRefs(sources: unknown, subject: string): ReadonlyArray<string> {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((s, i) => {
    if (s && typeof s === 'object') {
      const kind = 'kind' in s ? String((s as { kind: unknown }).kind) : 'source';
      return [`belief-source:${subject}:${kind}:${i}`];
    }
    return [];
  });
}

// ─────────────────────────────────────────────────────────────────────
// mwikila.belief.query
// ─────────────────────────────────────────────────────────────────────

export const beliefQueryTool: PersonaToolDescriptor<
  typeof BeliefQueryInput,
  typeof BeliefQueryOutput
> = {
  id: 'mwikila.belief.query',
  name: 'Belief — recall the brain world-model',
  description:
    "Read Mr. Mwikila's durable, revisable world-model (the brain_beliefs " +
    'store): what the brain currently believes about ore grades, royalty / ' +
    'WHT rates, recovery curves, commodity prices, regional logistics, and ' +
    'estate patterns — each with a confidence, a revision count, and the ' +
    'evidence chain that justifies it. Query by exact subject key or list a ' +
    'domain. Use BEFORE answering a factual question so the reply reflects ' +
    'the consolidated belief rather than a fresh guess, and so the brain can ' +
    'say how confident it is and on what evidence. READ-only, LOW stakes, ' +
    'propose-only — it NEVER writes a belief (reviseBelief is the sole ' +
    'writer, driven by the learning loop + human review queue).',
  personaSlugs: OWNER_ADMIN_MANAGER,
  inputSchema: BeliefQueryInput,
  outputSchema: BeliefQueryOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const env = process.env;
    const db = getDb();
    const outcome = await runOrganWithBudget(
      {
        enabled: organFlagDefaultOff(env, BELIEF_QUERY_FLAG),
        budgetMs: resolveBudgetMs(
          env,
          BELIEF_BUDGET_MS_KEY,
          DEFAULT_BELIEF_BUDGET_MS,
        ),
      },
      async () => {
        if (!db) throw new Error('database not configured');
        // Tenant-pinned read so RLS fires (brain tools run outside the
        // request databaseMiddleware). Platform-wide beliefs (tenant_id
        // NULL) are visible to every tenant per the belief-engine RLS idiom.
        return withTenantContext(
          db as unknown as Parameters<typeof withTenantContext>[0],
          ctx.tenantId,
          async (tx) => {
            const txDb = tx as unknown as {
              execute(q: unknown): Promise<unknown>;
            };
            const raw = input.subject
              ? await txDb.execute(sql`
                  SELECT subject, domain, description, value_jsonb,
                         confidence, revision_count, revised_at, sources_jsonb
                    FROM brain_beliefs
                   WHERE subject = ${input.subject}
                   ORDER BY revised_at DESC
                   LIMIT 5
                `)
              : await txDb.execute(sql`
                  SELECT subject, domain, description, value_jsonb,
                         confidence, revision_count, revised_at, sources_jsonb
                    FROM brain_beliefs
                   WHERE domain = ${input.domain}
                   ORDER BY revised_at DESC
                   LIMIT ${input.limit}
                `);
            return rowsOf(raw);
          },
        );
      },
    );

    if (!outcome.ok) {
      const note =
        outcome.reason === 'disabled'
          ? 'belief-query organ disabled (set BORJIE_BELIEF_QUERY_ENABLED=1)'
          : outcome.reason === 'budget-exceeded'
            ? `belief query exceeded budget (${outcome.elapsedMs}ms)`
            : (outcome.detail ?? 'belief query failed');
      return { status: 'skipped', beliefs: [], evidenceIds: [], note };
    }

    const rows = outcome.value;
    if (rows.length === 0) {
      return {
        status: 'not_found' as const,
        beliefs: [],
        evidenceIds: [],
        note: input.subject
          ? `no belief recorded for subject "${input.subject}"`
          : `no beliefs recorded in domain "${input.domain}"`,
      };
    }

    const evidenceIds: string[] = [];
    const beliefs = rows.map((r) => {
      const refs = sourceRefs(r.sources_jsonb, r.subject);
      evidenceIds.push(...refs);
      return {
        subject: r.subject,
        domain: r.domain,
        description: r.description,
        value: (r.value_jsonb as Record<string, unknown>) ?? {},
        confidence: Number(r.confidence ?? 0),
        revisionCount: Number(r.revision_count ?? 0),
        revisedAt:
          r.revised_at instanceof Date
            ? r.revised_at.toISOString()
            : String(r.revised_at ?? ''),
        sourceCount: refs.length,
        lowEvidence: refs.length === 0,
      };
    });

    return { status: 'ok' as const, beliefs, evidenceIds };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalogue export
// ─────────────────────────────────────────────────────────────────────

export const BELIEF_ENGINE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  beliefQueryTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
