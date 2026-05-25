import { describe, expect, it } from 'vitest';
import {
  composeConstitutionWithOverlay,
  preflightCheck,
} from '../constitutional-preflight/index.js';
import { makeFakeConstitution, makeFakeWorkflowEngine } from './test-helpers.js';
import type { ConstitutionPort } from '../types.js';

describe('constitutional-preflight / preflightCheck', () => {
  it('allows when constitution returns allow', async () => {
    const check = await preflightCheck({
      agentId: 'agent-a',
      tenantId: 't-1',
      action: 'send rent reminder',
      actionTags: ['notification.rent'],
      jurisdiction: 'TZ',
      context: {},
      constitution: makeFakeConstitution({ decision: 'allow' }),
    });
    expect(check.decision).toBe('allow');
    expect(check.escalatedRunId).toBeUndefined();
  });

  it('blocks when constitution returns block', async () => {
    const check = await preflightCheck({
      agentId: 'agent-a',
      tenantId: 't-1',
      action: 'serve eviction notice without notice period',
      actionTags: ['eviction'],
      jurisdiction: 'TZ',
      context: {},
      constitution: makeFakeConstitution({
        decision: 'block',
        firedClauses: [
          {
            id: 'C01-EVICTION-NOTICE',
            severity: 'refuse',
            jurisdictions: ['TZ'],
            appliesTo: ['eviction'],
          },
        ],
        rationale: 'eviction notice missing statutory period',
      }),
    });
    expect(check.decision).toBe('block');
    expect(check.firedClauses).toContain('C01-EVICTION-NOTICE');
    expect(check.escalatedRunId).toBeUndefined();
  });

  it('escalates and opens workflow run when workflow engine wired', async () => {
    const wfe = makeFakeWorkflowEngine();
    const check = await preflightCheck({
      agentId: 'agent-a',
      tenantId: 't-1',
      action: 'approve PO over threshold',
      actionTags: ['po.approval'],
      jurisdiction: 'TZ',
      context: {},
      constitution: makeFakeConstitution({
        decision: 'escalate',
        rationale: 'PO requires four-eyes review',
      }),
      workflowEngine: wfe,
    });
    expect(check.decision).toBe('escalate');
    expect(check.escalatedRunId).toBe('run-1');
  });

  it('coerces escalate to block when no workflow engine wired', async () => {
    const check = await preflightCheck({
      agentId: 'agent-a',
      tenantId: 't-1',
      action: 'something risky',
      actionTags: ['lease.new'],
      jurisdiction: 'TZ',
      context: {},
      constitution: makeFakeConstitution({ decision: 'escalate' }),
    });
    expect(check.decision).toBe('block');
  });

  it('records applied jurisdiction', async () => {
    const check = await preflightCheck({
      agentId: 'agent-a',
      tenantId: 't-1',
      action: 'x',
      actionTags: [],
      jurisdiction: 'KE',
      context: {},
      constitution: makeFakeConstitution({ decision: 'allow' }),
    });
    expect(check.appliedJurisdiction).toBe('KE');
  });
});

describe('constitutional-preflight / composeConstitutionWithOverlay', () => {
  function constitutionReturning(decision: 'allow' | 'block' | 'escalate', clauseId = 'X'): ConstitutionPort {
    return {
      async evaluate() {
        return {
          decision,
          firedClauses: [
            {
              id: clauseId,
              severity: decision === 'block' ? 'refuse' : 'warn',
              jurisdictions: ['TZ'] as const,
              appliesTo: [] as ReadonlyArray<string>,
            },
          ],
          rationale: `${clauseId} fired with ${decision}`,
        };
      },
    };
  }

  it('takes the stricter decision when overlay is stricter', async () => {
    const composed = composeConstitutionWithOverlay(
      constitutionReturning('allow', 'BASE'),
      constitutionReturning('block', 'OVL'),
    );
    const result = await composed.evaluate({
      action: 'a',
      actionTags: [],
      jurisdiction: 'TZ',
      context: {},
    });
    expect(result.decision).toBe('block');
    expect(result.firedClauses.map((c) => c.id)).toEqual(['BASE', 'OVL']);
  });

  it('takes the stricter decision when base is stricter', async () => {
    const composed = composeConstitutionWithOverlay(
      constitutionReturning('block', 'BASE'),
      constitutionReturning('allow', 'OVL'),
    );
    const result = await composed.evaluate({
      action: 'a',
      actionTags: [],
      jurisdiction: 'TZ',
      context: {},
    });
    expect(result.decision).toBe('block');
  });

  it('escalate beats allow', async () => {
    const composed = composeConstitutionWithOverlay(
      constitutionReturning('allow', 'BASE'),
      constitutionReturning('escalate', 'OVL'),
    );
    const result = await composed.evaluate({
      action: 'a',
      actionTags: [],
      jurisdiction: 'TZ',
      context: {},
    });
    expect(result.decision).toBe('escalate');
  });

  it('deduplicates fired clauses by id', async () => {
    const composed = composeConstitutionWithOverlay(
      constitutionReturning('block', 'DUP'),
      constitutionReturning('block', 'DUP'),
    );
    const result = await composed.evaluate({
      action: 'a',
      actionTags: [],
      jurisdiction: 'TZ',
      context: {},
    });
    expect(result.firedClauses.length).toBe(1);
  });
});
