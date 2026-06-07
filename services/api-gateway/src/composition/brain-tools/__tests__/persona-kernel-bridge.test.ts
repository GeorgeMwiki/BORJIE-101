/**
 * persona-kernel-bridge tests — prove the FULL-POWERS parity wire is REAL:
 * a persona `ToolHandler` (the proven mwikila.* / memory / data-analysis
 * catalog) executes end-to-end through the kernel `BrainToolRegistry` the
 * orchestrator main-loop dispatches against, carrying the per-scope
 * `ToolExecutionContext` (tenant + actor) and propagating evidence ids.
 *
 * This is the gate for "no half solutions": without these the orchestrator
 * would only see the seed PM tools (which throw "not yet wired").
 */

import { describe, it, expect } from 'vitest';
import { createBrainToolRegistry } from '@borjie/central-intelligence';
import type {
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@borjie/ai-copilot';
import {
  personaHandlerToBrainToolSpec,
  registerPersonaToolsOnRegistry,
  buildPersonaToolContext,
  personaSlugForScope,
} from '../persona-kernel-bridge';

function fakeHandler(
  name: string,
  result: ToolExecutionResult,
  spy?: (params: Record<string, unknown>, ctx: ToolExecutionContext) => void,
): ToolHandler {
  return {
    name,
    description: `description for ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(params, ctx) {
      spy?.(params, ctx);
      return result;
    },
  };
}

describe('persona-kernel-bridge', () => {
  it('adapts a persona handler so its executor runs handler.execute with the scope ctx and projects evidence', async () => {
    let seenParams: unknown;
    let seenCtx: ToolExecutionContext | undefined;
    const handler = fakeHandler(
      'mwikila.test.do',
      { ok: true, data: { evidence_ids: ['e1'], n: 42 }, evidenceSummary: 'sum' },
      (params, ctx) => {
        seenParams = params;
        seenCtx = ctx;
      },
    );
    const ctx = buildPersonaToolContext(
      { tenantId: 't1', userId: 'u1', role: 'owner' },
      'thread-1',
    );
    const spec = personaHandlerToBrainToolSpec(handler, ctx);

    expect(spec.name).toBe('mwikila.test.do');
    const out = await spec.executor({ foo: 'bar' });

    // The handler ran with the LLM args + the per-scope tenant context.
    expect(seenParams).toEqual({ foo: 'bar' });
    expect(seenCtx?.tenant.tenantId).toBe('t1');
    // Evidence ids + summary propagate so the orchestrator's citation
    // harvester can satisfy the evidence-required rule.
    expect(out).toMatchObject({
      evidence_ids: ['e1'],
      n: 42,
      _evidenceSummary: 'sum',
    });
  });

  it('surfaces a failed persona tool as an executor throw (kernel maps to tool_error)', async () => {
    const handler = fakeHandler('mwikila.test.fail', {
      ok: false,
      error: 'DENIED_BY_POLICY',
    });
    const ctx = buildPersonaToolContext(
      { tenantId: 't1', userId: 'u1', role: 'owner' },
      'thr',
    );
    const spec = personaHandlerToBrainToolSpec(handler, ctx);
    await expect(spec.executor({})).rejects.toThrow('DENIED_BY_POLICY');
  });

  it('registers the persona catalog onto the kernel registry and runTool executes a REAL handler through it', async () => {
    const registry = createBrainToolRegistry();
    let executed = false;
    const handlers: ToolHandler[] = [
      fakeHandler(
        'mwikila.a',
        { ok: true, data: { value: 'A', evidence_ids: ['ea'] } },
        () => {
          executed = true;
        },
      ),
      fakeHandler('mwikila.b', { ok: true, data: { value: 'B' } }),
    ];

    const count = registerPersonaToolsOnRegistry({
      registry,
      handlers,
      scope: { tenantId: 't1', userId: 'u1', role: 'owner' },
      threadId: 'thr',
    });

    expect(count).toBe(2);
    expect(registry.get('mwikila.a')).not.toBeNull();
    expect(registry.list().length).toBeGreaterThanOrEqual(2);

    // The orchestrator dispatches via registry.runTool — prove a REAL persona
    // handler executes through that exact path (not a seed "not yet wired").
    const outcome = await registry.runTool('mwikila.a', { x: 1 });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(executed).toBe(true);
      expect(outcome.output).toMatchObject({ value: 'A', evidence_ids: ['ea'] });
    }
  });

  it('derives tenant + RBAC actor role + persona slug from the scope', () => {
    const ctx = buildPersonaToolContext(
      { tenantId: 't9', userId: 'u9', role: 'manager' },
      'thr',
    );
    expect(ctx.tenant.tenantId).toBe('t9');
    expect((ctx.actor as { role?: string }).role).toBe('MANAGER');
    expect(
      personaSlugForScope({ tenantId: 't9', userId: 'u9', role: 'manager' }),
    ).toBe('T3_module_manager');
    // Platform fallback when scope is unauthenticated.
    const anon = buildPersonaToolContext(
      { tenantId: null, userId: null },
      'thr',
    );
    expect(typeof anon.tenant.tenantId).toBe('string');
    expect(anon.tenant.tenantId.length).toBeGreaterThan(0);
  });
});
