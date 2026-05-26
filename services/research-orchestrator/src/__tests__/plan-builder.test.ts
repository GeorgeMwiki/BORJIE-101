/**
 * Plan-builder tests — verify the rule-based + LLM-driven paths.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  BUILT_IN_TEMPLATES,
  type LlmPlanRequest,
  type StepTemplate,
} from '../planner/plan-builder.js';
import { validatePlan } from '../planner/plan-validator.js';
import { RESEARCH_TOOLS } from '../types.js';

describe('buildPlan — rule-based', () => {
  it('builds a reactive_query plan with the default 2-step template', async () => {
    const plan = await buildPlan({
      tenantId: 'tenant-1',
      query: 'What is the current gold spot price?',
      mode: 'reactive_query',
      createdBy: 'owner_explicit',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
    });
    expect(plan.tenant_id).toBe('tenant-1');
    expect(plan.mode).toBe('reactive_query');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.seq).toBe(0);
    expect(plan.status).toBe('planned');
    expect(plan.result_id).toBeNull();
  });

  it('builds a daily_briefing plan with the spec step set', async () => {
    const stepTemplate = BUILT_IN_TEMPLATES.daily_briefing({
      minerals: ['gold'],
      regulators: ['tumemadini', 'nemc'],
      fxPairs: ['USD/TZS'],
    });
    const plan = await buildPlan({
      tenantId: 'tenant-1',
      query: 'morning briefing',
      mode: 'daily_briefing',
      createdBy: 'worker_cron',
      budget_ms: 900_000,
      budget_usd_cents: 200,
      availableTools: [...RESEARCH_TOOLS],
      stepTemplate,
    });
    // 1 mineral + 2 regulators + 1 fx + 1 news_scan = 5
    expect(plan.steps.length).toBe(5);
    const tools = plan.steps.map((s) => s.tool);
    expect(tools).toContain('commodity_price');
    expect(tools).toContain('regulatory_diff');
    expect(tools).toContain('fx_rate');
    expect(tools).toContain('news_scan');
  });
});

describe('buildPlan — LLM path', () => {
  it('uses the LLM output when llmPlan is supplied', async () => {
    const fakeLlm = async (
      _req: LlmPlanRequest,
    ): Promise<ReadonlyArray<StepTemplate>> => [
      { tool: 'corpus_query', tool_input: { query: 'gold' } },
    ];
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
      llmPlan: fakeLlm,
    });
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]?.tool).toBe('corpus_query');
  });

  it('falls back to rule-based when the LLM throws', async () => {
    const fakeLlm = async (): Promise<ReadonlyArray<StepTemplate>> => {
      throw new Error('LLM provider blew up');
    };
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
      llmPlan: fakeLlm,
    });
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('filters disallowed tools out of the LLM output', async () => {
    const fakeLlm = async (): Promise<ReadonlyArray<StepTemplate>> => [
      { tool: 'corpus_query', tool_input: { query: 'x' } },
      { tool: 'web_search', tool_input: { query: 'x' } },
    ];
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: ['corpus_query'],
      llmPlan: fakeLlm,
    });
    expect(plan.steps.map((s) => s.tool)).toEqual(['corpus_query']);
  });
});

describe('validatePlan', () => {
  it('rejects a plan with zero steps', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [],
      stepTemplate: [],
    });
    const r = validatePlan({
      plan,
      mode_budget: { latency_ms: 8000, cost_usd_cents: 5 },
      available_tools: [...RESEARCH_TOOLS],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.includes('zero steps'))).toBe(true);
  });

  it('rejects a plan whose budget exceeds the mode ceiling', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 9999,
      availableTools: [...RESEARCH_TOOLS],
    });
    const r = validatePlan({
      plan,
      mode_budget: { latency_ms: 8000, cost_usd_cents: 5 },
      available_tools: [...RESEARCH_TOOLS],
    });
    expect(r.ok).toBe(false);
  });

  it('passes a well-formed plan', async () => {
    const plan = await buildPlan({
      tenantId: 't',
      query: 'Q',
      mode: 'reactive_query',
      createdBy: 'mr_mwikila',
      budget_ms: 8000,
      budget_usd_cents: 5,
      availableTools: [...RESEARCH_TOOLS],
    });
    const r = validatePlan({
      plan,
      mode_budget: { latency_ms: 8000, cost_usd_cents: 5 },
      available_tools: [...RESEARCH_TOOLS],
    });
    expect(r.ok).toBe(true);
  });
});
