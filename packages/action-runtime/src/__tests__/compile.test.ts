import { describe, expect, test } from 'vitest';
import { compile } from '../compile.js';
import { ActionPlanSchema } from '../types.js';

describe('action-runtime compile', () => {
  test('generates ids + toolCallRefs + default preconditions', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      moduleId: 'estate',
      intent: 'execute_arrears_recovery',
      steps: [
        {
          kind: 'DRAFT_LETTER',
          payload: { templateSlug: 'arrears', variables: {} },
        },
        {
          kind: 'POST_LEDGER',
          payload: {
            lines: [
              {
                accountId: 'a',
                direction: 'DEBIT',
                amountMinorUnits: 1,
                currency: 'TZS',
                description: 'x',
              },
              {
                accountId: 'b',
                direction: 'CREDIT',
                amountMinorUnits: 1,
                currency: 'TZS',
                description: 'x',
              },
            ],
          },
        },
      ],
    });
    expect(plan.id).toMatch(/^ap_/);
    expect(plan.steps[0]?.id).toMatch(/^as_/);
    expect(plan.steps[0]?.toolCallRef).toContain(plan.id ?? '');
    // Preconditions stitched in.
    expect(plan.steps[0]?.preconditions.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.preconditions.find((p) => p.kind === 'kill_switch_open')).toBeDefined();
    // POST_LEDGER gets autonomy_cap_within_limit added.
    expect(plan.steps[1]?.preconditions.find((p) => p.kind === 'autonomy_cap_within_limit')).toBeDefined();
  });

  test('default budget = sum of per-kind costs', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'simple',
      steps: [
        { kind: 'DRAFT_LETTER', payload: { templateSlug: 'x', variables: {} } },
        { kind: 'POST_LEDGER', payload: { lines: [] } },
      ],
    });
    // DRAFT_LETTER 50_000 + POST_LEDGER 5_000.
    expect(plan.budgetMicros).toBe(50_000 + 5_000);
  });

  test('honours explicit budgetMicros override', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'simple',
      budgetMicros: 999_999,
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'a@b.c', message: 'hi' } }],
    });
    expect(plan.budgetMicros).toBe(999_999);
  });

  test('default compensation only for compensable kinds', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'simple',
      steps: [
        { kind: 'POST_LEDGER', payload: { lines: [] } },
        { kind: 'VERIFY', payload: {} },
      ],
    });
    expect(plan.steps[0]?.compensation).toBeDefined();
    expect(plan.steps[1]?.compensation).toBeUndefined();
  });

  test('hitlCheckpoint defaults true for ROUTE_APPROVAL', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'simple',
      steps: [
        {
          kind: 'ROUTE_APPROVAL',
          payload: {
            actionType: 'x',
            requiredRoleGroup: 'y',
            quorum: 1,
          },
        },
      ],
    });
    expect(plan.steps[0]?.hitlCheckpoint).toBe(true);
  });

  test('throws on empty step list', () => {
    expect(() =>
      compile({
        tenantId: 'trc',
        personaId: 'p1',
        intent: 'empty',
        steps: [],
      }),
    ).toThrow();
  });

  test('output validates against ActionPlanSchema', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'schema_check',
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'a@b.c', message: 'hi' } }],
    });
    expect(() => ActionPlanSchema.parse(plan)).not.toThrow();
  });

  test('cross-piece source provenance preserved', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'with_source',
      source: {
        captureId: 'cap_1',
        briefId: 'brief_1',
        documentId: 'doc_1',
      },
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'a@b.c', message: 'hi' } }],
    });
    expect(plan.source).toEqual({ captureId: 'cap_1', briefId: 'brief_1', documentId: 'doc_1' });
  });

  test('expiresAt defaults to 72h from now', () => {
    const plan = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'expiry',
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'a@b.c', message: 'hi' } }],
    });
    const expiresMs = new Date(plan.expiresAt!).getTime();
    const expectedMs = Date.now() + 72 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThan(expectedMs - 5000);
    expect(expiresMs).toBeLessThan(expectedMs + 5000);
  });

  test('toolCallRef varies with payload', () => {
    const planA = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'a',
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'a@x.c', message: 'hi' } }],
    });
    const planB = compile({
      tenantId: 'trc',
      personaId: 'p1',
      intent: 'a',
      steps: [{ kind: 'NOTIFY', payload: { channel: 'email', recipient: 'b@x.c', message: 'hi' } }],
    });
    expect(planA.steps[0]?.toolCallRef).not.toBe(planB.steps[0]?.toolCallRef);
  });
});
