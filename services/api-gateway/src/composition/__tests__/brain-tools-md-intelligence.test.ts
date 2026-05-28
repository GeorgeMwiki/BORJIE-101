/**
 * Persona-aware brain-tool catalog — md-intelligence-tools tests.
 *
 * Covers the four MD-intelligence tools wired by Wave MD-INTELLIGENCE:
 *   - md.correlation_for_question
 *   - md.trace_causes
 *   - md.compare_baselines
 *   - md.emit_insights
 *
 * Verifies:
 *   - All four tools register with the expected ids
 *   - Each tool zod-validates its declared input shape
 *   - All four tools are exposed ONLY to owner strategist (T1)
 *   - Persona gating refuses calls from admin / worker / buyer
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  MD_INTELLIGENCE_TOOLS,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  mdCorrelationForQuestionTool,
  mdTraceCausesTool,
  mdCompareBaselinesTool,
  mdEmitInsightsTool,
} from '../brain-tools/md-intelligence-tools';

function makeHttpClient(): PersonaToolHttpClient {
  return {
    async get<T>(_path: string): Promise<T> {
      return {} as T;
    },
    async post<T>(_path: string, _body: Readonly<Record<string, unknown>>): Promise<T> {
      // Defensive defaults that satisfy every output schema (per tool we
      // need a separate response shape, but each tool only validates its
      // own — and unused fields are ignored).
      return {
        // correlation
        domain: 'finance',
        probedNodes: 0,
        touches: [],
        // trace
        symptomNode: 'compliance.environmental',
        maxDepth: 3,
        chains: [],
        // compare
        metricId: 'production.tonnes',
        tenant: 100,
        historical: null,
        peer: null,
        benchmark: null,
        delta: {
          vsDay30: null,
          vsDay90: null,
          vsYoy: null,
          vsPeerP50: null,
          vsBenchmark: null,
        },
        percentile: null,
        // insights
        groundedDataPoints: 0,
        rejectedForUngrounded: 0,
        insights: [],
      } as unknown as T;
    },
  };
}

function gateFor(slug: string, httpClient: PersonaToolHttpClient): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => slug,
    httpClient,
  };
}

function ctx() {
  return {
    tenant: { tenantId: 't-1' } as never,
    actor: { id: 'u-1' } as never,
    persona: { id: 'p-1', allowedTools: [] } as never,
    threadId: 'th-1',
  } as never;
}

describe('md-intelligence-tools — registration', () => {
  it('exposes exactly four md tools', () => {
    const ids = MD_INTELLIGENCE_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'md.compare_baselines',
      'md.correlation_for_question',
      'md.emit_insights',
      'md.trace_causes',
    ]);
  });

  it('exposes every md tool to owner strategist only', () => {
    for (const tool of MD_INTELLIGENCE_TOOLS) {
      expect(tool.personaSlugs).toEqual(['T1_owner_strategist']);
    }
  });

  it('flags every md tool as read-only LOW stakes', () => {
    for (const tool of MD_INTELLIGENCE_TOOLS) {
      expect(tool.isWrite).toBe(false);
      expect(tool.stakes).toBe('LOW');
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });
});

describe('md-intelligence-tools — zod validation', () => {
  it('accepts well-formed input for md.correlation_for_question', () => {
    const parsed = mdCorrelationForQuestionTool.inputSchema.safeParse({
      domain: 'finance',
      limit: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty domain for md.correlation_for_question', () => {
    const parsed = mdCorrelationForQuestionTool.inputSchema.safeParse({
      domain: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts well-formed input for md.trace_causes', () => {
    const parsed = mdTraceCausesTool.inputSchema.safeParse({
      symptom: 'production.tonnes_under_target',
      maxDepth: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects out-of-range maxDepth for md.trace_causes', () => {
    const parsed = mdTraceCausesTool.inputSchema.safeParse({
      symptom: 'production.tonnes_under_target',
      maxDepth: 10,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts well-formed input for md.compare_baselines', () => {
    const parsed = mdCompareBaselinesTool.inputSchema.safeParse({
      metricId: 'production.tonnes',
      tenantValue: 1234,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-numeric tenantValue for md.compare_baselines', () => {
    const parsed = mdCompareBaselinesTool.inputSchema.safeParse({
      metricId: 'production.tonnes',
      tenantValue: 'lots',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts well-formed input for md.emit_insights', () => {
    const parsed = mdEmitInsightsTool.inputSchema.safeParse({
      domain: 'finance',
      limit: 3,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('md-intelligence-tools — execution', () => {
  it('runs md.correlation_for_question as owner strategist', async () => {
    const handler = toBrainToolHandler(
      mdCorrelationForQuestionTool,
      gateFor('T1_owner_strategist', makeHttpClient()),
    );
    const result = await handler.execute(
      { domain: 'finance', limit: 3 },
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses md tools from admin slug (owner-only)', async () => {
    const handler = toBrainToolHandler(
      mdCorrelationForQuestionTool,
      gateFor('T2_admin_strategist', makeHttpClient()),
    );
    const result = await handler.execute({ domain: 'finance' }, ctx());
    expect(result.ok).toBe(false);
  });

  it('refuses md tools from worker slug', async () => {
    const handler = toBrainToolHandler(
      mdTraceCausesTool,
      gateFor('T4_field_employee', makeHttpClient()),
    );
    const result = await handler.execute(
      { symptom: 'production.tonnes_under_target' },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });
});
