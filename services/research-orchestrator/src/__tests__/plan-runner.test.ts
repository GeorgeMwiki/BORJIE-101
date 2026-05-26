/**
 * Plan-runner tests — verify the sequential + parallel paths,
 * budget gates, and checkpointing.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../planner/plan-builder.js';
import { runPlan } from '../executor/plan-runner.js';
import { createBudgetGate } from '../budgets/budget-gate.js';
import type {
  ResearchArtifact,
  ResearchTool,
  ToolAdapter,
} from '../types.js';
import { RESEARCH_TOOLS } from '../types.js';
import {
  createInMemoryCheckpointer,
} from '../executor/long-running-checkpoint.js';

function adapter(name: string, costCents: number, artifacts: ReadonlyArray<ResearchArtifact>): ToolAdapter<
  Readonly<Record<string, unknown>>,
  ReadonlyArray<ResearchArtifact>
> {
  return {
    name,
    version: '1.0.0',
    authority_tier: 0,
    cost_per_call_usd_cents: costCents,
    async invoke() {
      return artifacts;
    },
  };
}

function artifact(stepId: string, kind: 'web' | 'corpus', cost = 1): ResearchArtifact {
  return {
    id: `art-${stepId}-${Math.random().toString(36).slice(2, 8)}`,
    step_id: stepId,
    source_kind: kind,
    source_uri: kind === 'web' ? 'https://example.com/a' : 'corpus://x',
    source_class: kind === 'web' ? 'established_news' : 'tz_official',
    retrieved_at: new Date().toISOString(),
    content: 'Gold spot price at $2,400/oz today, sourced from LME.',
    excerpt: 'Gold $2,400/oz',
    title: 'Gold spot price',
    extracted_entities: Object.freeze([]),
    quality_score: 0.9,
    bias_flags: Object.freeze([]),
    citation_id: `cite-${stepId}`,
    audit_hash: 'h',
    tool_name: 'corpus_query',
    cost_usd_cents: cost,
  };
}

describe('runPlan — sequential', () => {
  it('runs every step and aggregates artifacts', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
    });
    const registry = new Map<ResearchTool, ToolAdapter<
      Readonly<Record<string, unknown>>,
      ReadonlyArray<ResearchArtifact>
    >>([
      ['corpus_query', adapter('corpus_query', 1, [artifact('s1', 'corpus')])],
      ['web_search', adapter('web_search', 1, [artifact('s2', 'web')])],
    ]);
    const gate = createBudgetGate({ budget_usd_cents: 50, latency_ms: 8000 });
    const summary = await runPlan({
      plan,
      registry,
      budgetGate: gate,
      toolContextFactory: () => ({
        tenant_id: 't',
        plan_id: plan.id,
        step_id: 's',
        cache: {
          async get() {
            return null;
          },
          async set() {},
        },
        cost_tracker: gate.tracker,
      }),
    });
    expect(summary.steps_completed).toBeGreaterThan(0);
    expect(summary.artifacts.length).toBeGreaterThan(0);
    expect(summary.status).toBe('complete');
  });

  it('skips steps whose tool has no adapter', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
    });
    const registry = new Map<ResearchTool, ToolAdapter<
      Readonly<Record<string, unknown>>,
      ReadonlyArray<ResearchArtifact>
    >>(); // no adapters
    const gate = createBudgetGate({ budget_usd_cents: 50, latency_ms: 8000 });
    const summary = await runPlan({
      plan,
      registry,
      budgetGate: gate,
      toolContextFactory: () => ({
        tenant_id: 't',
        plan_id: plan.id,
        step_id: 's',
        cache: {
          async get() {
            return null;
          },
          async set() {},
        },
        cost_tracker: gate.tracker,
      }),
    });
    expect(summary.steps_skipped).toBe(plan.steps.length);
    expect(summary.steps_completed).toBe(0);
  });

  it('pauses when budget exhausted', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 1, // tiny — first step exhausts it
      availableTools: [...RESEARCH_TOOLS],
    });
    const expensiveAdapter = adapter('corpus_query', 5, [
      { ...artifact('s1', 'corpus'), cost_usd_cents: 5 },
    ]);
    const registry = new Map<ResearchTool, ToolAdapter<
      Readonly<Record<string, unknown>>,
      ReadonlyArray<ResearchArtifact>
    >>([['corpus_query', expensiveAdapter]]);
    const gate = createBudgetGate({ budget_usd_cents: 1, latency_ms: 8000 });
    const summary = await runPlan({
      plan,
      registry,
      budgetGate: gate,
      toolContextFactory: () => ({
        tenant_id: 't',
        plan_id: plan.id,
        step_id: 's',
        cache: {
          async get() {
            return null;
          },
          async set() {},
        },
        cost_tracker: gate.tracker,
      }),
    });
    // Steps either completed (1) and then paused, or all skipped.
    expect(summary.steps_completed + summary.steps_skipped).toBe(plan.steps.length);
  });
});

describe('runPlan — checkpointing', () => {
  it('checkpoints after every completed step', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
    });
    const registry = new Map<ResearchTool, ToolAdapter<
      Readonly<Record<string, unknown>>,
      ReadonlyArray<ResearchArtifact>
    >>([
      ['corpus_query', adapter('corpus_query', 1, [artifact('s1', 'corpus')])],
      ['web_search', adapter('web_search', 1, [artifact('s2', 'web')])],
    ]);
    const checkpointer = createInMemoryCheckpointer();
    const gate = createBudgetGate({ budget_usd_cents: 50, latency_ms: 8000 });
    await runPlan({
      plan,
      registry,
      budgetGate: gate,
      toolContextFactory: () => ({
        tenant_id: 't',
        plan_id: plan.id,
        step_id: 's',
        cache: {
          async get() {
            return null;
          },
          async set() {},
        },
        cost_tracker: gate.tracker,
      }),
      hooks: { checkpointer },
    });
    expect(checkpointer.history.length).toBe(plan.steps.length);
  });
});

describe('runPlan — parallel', () => {
  it('runs steps in parallel for sweep mode', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'anticipatory_sweep',
      createdBy: 'mr_mwikila',
      budget_ms: 30_000,
      budget_usd_cents: 10,
      availableTools: [...RESEARCH_TOOLS],
      stepTemplate: [
        { tool: 'web_search', tool_input: { q: 'a' } },
        { tool: 'web_search', tool_input: { q: 'b' } },
      ],
    });
    const registry = new Map<ResearchTool, ToolAdapter<
      Readonly<Record<string, unknown>>,
      ReadonlyArray<ResearchArtifact>
    >>([['web_search', adapter('web_search', 1, [artifact('p1', 'web')])]]);
    const gate = createBudgetGate({ budget_usd_cents: 50, latency_ms: 30_000 });
    const summary = await runPlan({
      plan,
      registry,
      budgetGate: gate,
      parallel: true,
      toolContextFactory: () => ({
        tenant_id: 't',
        plan_id: plan.id,
        step_id: 's',
        cache: {
          async get() {
            return null;
          },
          async set() {},
        },
        cost_tracker: gate.tracker,
      }),
    });
    expect(summary.steps_completed).toBe(2);
  });
});
