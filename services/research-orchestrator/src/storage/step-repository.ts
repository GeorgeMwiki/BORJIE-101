/**
 * Step repository — CRUD over the `research_steps` table.
 *
 * Migration 0018 §2. Carries id, plan_id, seq, tool, tool_input,
 * status, started_at, finished_at, cost_usd_cents, duration_ms, error.
 *
 * @module research-orchestrator/storage/step-repository
 */

import type { ResearchStep } from '../types.js';
import type { SqlLike } from './plan-repository.js';

export interface StepRepository {
  createBatch(steps: ReadonlyArray<ResearchStep>): Promise<void>;
  markStarted(step_id: string, started_at_iso: string): Promise<void>;
  markFinished(args: {
    readonly step_id: string;
    readonly finished_at_iso: string;
    readonly status: ResearchStep['status'];
    readonly cost_usd_cents: number;
    readonly duration_ms: number;
    readonly error?: string;
  }): Promise<void>;
  listByPlan(plan_id: string): Promise<ReadonlyArray<ResearchStep>>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryStepRepository(): StepRepository {
  const byPlan = new Map<string, Array<ResearchStep>>();
  return {
    async createBatch(steps) {
      for (const s of steps) {
        const list = byPlan.get(s.plan_id);
        if (list) list.push(s);
        else byPlan.set(s.plan_id, [s]);
      }
    },
    async markStarted(step_id) {
      for (const list of byPlan.values()) {
        const idx = list.findIndex((s) => s.id === step_id);
        if (idx >= 0) {
          const target = list[idx];
          if (!target) continue;
          list[idx] = { ...target, status: 'running' };
        }
      }
    },
    async markFinished(args) {
      for (const list of byPlan.values()) {
        const idx = list.findIndex((s) => s.id === args.step_id);
        if (idx >= 0) {
          const target = list[idx];
          if (!target) continue;
          list[idx] = {
            ...target,
            status: args.status,
            cost_usd_cents: args.cost_usd_cents,
            duration_ms: args.duration_ms,
          };
        }
      }
    },
    async listByPlan(plan_id) {
      return Object.freeze([...(byPlan.get(plan_id) ?? [])]);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation
// ---------------------------------------------------------------------------

export function createSqlStepRepository(sql: SqlLike): StepRepository {
  return {
    async createBatch(steps) {
      for (const step of steps) {
        // Sequential rather than UNNEST so the tagged-template surface
        // stays portable across postgres / drizzle / pg.
        await sql`
          INSERT INTO research_steps (
            id, plan_id, seq, tool, tool_input, status
          )
          VALUES (
            ${step.id}, ${step.plan_id}, ${step.seq}, ${step.tool},
            ${JSON.stringify(step.tool_input)}::jsonb, ${step.status}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
    },
    async markStarted(step_id, started_at_iso) {
      await sql`
        UPDATE research_steps
        SET status = 'running', started_at = ${started_at_iso}::timestamptz
        WHERE id = ${step_id}
      `;
    },
    async markFinished(args) {
      const errPart = args.error ?? null;
      await sql`
        UPDATE research_steps
        SET status = ${args.status},
            finished_at = ${args.finished_at_iso}::timestamptz,
            cost_usd_cents = ${args.cost_usd_cents},
            duration_ms = ${args.duration_ms},
            error = ${errPart}
        WHERE id = ${args.step_id}
      `;
    },
    async listByPlan(plan_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, plan_id, seq, tool, tool_input, status,
               cost_usd_cents, duration_ms
        FROM research_steps
        WHERE plan_id = ${plan_id}
        ORDER BY seq ASC
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      return Object.freeze(
        rows.map<ResearchStep>((row) => ({
          id: String(row['id']),
          plan_id: String(row['plan_id']),
          seq: Number(row['seq']),
          tool: row['tool'] as ResearchStep['tool'],
          tool_input: (row['tool_input'] as Record<string, unknown>) ?? {},
          status: row['status'] as ResearchStep['status'],
          artifact_ids: Object.freeze([]) as ReadonlyArray<string>,
          cost_usd_cents: row['cost_usd_cents'] === null ? null : Number(row['cost_usd_cents']),
          duration_ms: row['duration_ms'] === null ? null : Number(row['duration_ms']),
        })),
      );
    },
  };
}
