/**
 * task-dispatch-port.test.ts — locks the spine ACT seam:
 *
 *   1. strategyTraceToAssignInput maps a StrategyTrace → AssignTaskInput and
 *      THREADS the commitment's evidenceIds into assetRefs (Evidence-required);
 *   2. dispatch() fires assignTask against a stub WorkforceDeps and returns the
 *      durable task id + the kernel-derived risk fields (riskTier/hitlRequired);
 *   3. a HIGH-risk task description escalates the tier through assignTask's own
 *      kernel (the port returns the escalated fields, not the hint);
 *   4. an empty evidence chain dispatches but logs a warning (observable, never
 *      a silent drop);
 *   5. a bad trace (missing tenantId) is rejected by the zod boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  createTaskDispatchPort,
  strategyTraceToAssignInput,
  type StrategyTrace,
} from '../task-dispatch-port';
import type { PinoLikeLogger } from '../../../utils/pino-shim';
import type {
  Employee,
  WorkforceDeps,
} from '@borjie/workforce-orchestrator';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface LogRecord {
  readonly level: 'info' | 'warn' | 'error';
  readonly meta: Record<string, unknown>;
}

function fakeLogger(): PinoLikeLogger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const push =
    (level: LogRecord['level']) =>
    (meta: object): void => {
      records.push({ level, meta: meta as Record<string, unknown> });
    };
  return {
    records,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

const ACTIVE_EMPLOYEE: Employee = {
  id: 'user_9',
  tenantId: 't1',
  personEntityId: 'user_9',
  titleId: null,
  employeeCode: 'user_9',
  hiredAt: null,
  status: 'active',
  managerEmployeeId: null,
  defaultChannel: 'mobile',
};

/**
 * A stub WorkforceDeps that records what assignTask received. The real
 * assignTask runs against THIS stub (it is a pure dependency-injection target),
 * so the test proves the full map → assignTask → result path without a DB.
 */
function stubWorkforceDeps(opts?: {
  readonly employee?: Employee | null;
  readonly channelDelivers?: boolean;
}): {
  readonly deps: WorkforceDeps;
  readonly inserted: Array<Record<string, unknown>>;
  readonly followups: Array<Record<string, unknown>>;
  readonly sent: Array<Record<string, unknown>>;
} {
  const inserted: Array<Record<string, unknown>> = [];
  const followups: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  let counter = 0;
  const employee = opts?.employee === undefined ? ACTIVE_EMPLOYEE : opts.employee;

  const deps = {
    store: {
      async getEmployee() {
        return employee;
      },
      async insertAssignment(row: Record<string, unknown>) {
        inserted.push(row);
        return row;
      },
      async insertFollowup(row: Record<string, unknown>) {
        followups.push(row);
        return row;
      },
    },
    channel: {
      async send(args: Record<string, unknown>) {
        sent.push(args);
        return { delivered: opts?.channelDelivers ?? true };
      },
    },
    audit: {
      async append() {
        return { chainId: 'chain_x' };
      },
    },
    content: {} as never,
    tickets: {} as never,
    clock: () => new Date('2026-06-11T08:00:00.000Z'),
    uuid: () => `id_${(counter += 1)}`,
  } as unknown as WorkforceDeps;

  return { deps, inserted, followups, sent };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const BASE_TRACE: StrategyTrace = {
  tenantId: 't1',
  assignedByUserId: 'mwikila',
  chosenEmployeeId: 'user_9',
  taskShape: {
    title: 'Inspect pit ramp',
    description: 'Walk the south ramp and flag loose rock before the shift.',
    priority: 'high',
    competenceDomain: 'safety',
  },
  evidenceIds: ['ev_1', 'ev_2'],
  commitmentId: 'commit_1',
};

describe('task-dispatch-port — the spine ACT seam', () => {
  it('maps a StrategyTrace → AssignTaskInput, threading evidenceIds into assetRefs', () => {
    const input = strategyTraceToAssignInput(BASE_TRACE);
    expect(input.tenantId).toBe('t1');
    expect(input.assignedEmployeeId).toBe('user_9');
    expect(input.assignedByUserId).toBe('mwikila');
    expect(input.title).toBe('Inspect pit ramp');
    expect(input.priority).toBe('high');
    // Evidence-required: the commitment's chain rides assetRefs.
    expect(input.assetRefs).toEqual(['ev_1', 'ev_2']);
    expect(input.createdByPersonaId).toBe('mwikila');
  });

  it('dispatch fires assignTask and returns the task id + risk fields', async () => {
    const logger = fakeLogger();
    const { deps, inserted, sent } = stubWorkforceDeps();
    const port = createTaskDispatchPort({ workforceDeps: deps, logger });

    const result = await port.dispatch(BASE_TRACE);

    expect(typeof result.taskId).toBe('string');
    expect(result.riskTier).toBe('LOW');
    expect(result.hitlRequired).toBe(false);
    expect(result.notificationDelivered).toBe(true);

    // assignTask persisted the assignment + fired the kickoff push.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.assignedEmployeeId).toBe('user_9');
    expect(inserted[0]?.assetRefs).toEqual(['ev_1', 'ev_2']);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.template).toBe('workforce.new_assignment');
  });

  it('escalates the risk tier through assignTask kernel (returns escalated, not hint)', async () => {
    const logger = fakeLogger();
    const { deps } = stubWorkforceDeps();
    const port = createTaskDispatchPort({ workforceDeps: deps, logger });

    const result = await port.dispatch({
      ...BASE_TRACE,
      taskShape: {
        ...BASE_TRACE.taskShape,
        // 'compliance breach' is a SOVEREIGN keyword in assignTask's kernel.
        description: 'Document the compliance breach before the regulator audit.',
      },
      riskHint: 'LOW',
    });

    expect(result.riskTier).toBe('SOVEREIGN');
    expect(result.hitlRequired).toBe(true);
  });

  it('dispatches an empty evidence chain but logs a warning (observable)', async () => {
    const logger = fakeLogger();
    const { deps } = stubWorkforceDeps();
    const port = createTaskDispatchPort({ workforceDeps: deps, logger });

    await port.dispatch({ ...BASE_TRACE, evidenceIds: [] });

    expect(
      logger.records.some(
        (r) => r.level === 'warn' && r.meta.organ === 'task-dispatch',
      ),
    ).toBe(true);
  });

  it('rejects a bad trace at the zod boundary (missing tenantId)', async () => {
    const logger = fakeLogger();
    const { deps } = stubWorkforceDeps();
    const port = createTaskDispatchPort({ workforceDeps: deps, logger });

    await expect(
      port.dispatch({ ...BASE_TRACE, tenantId: '' }),
    ).rejects.toThrow();
  });

  it('surfaces assignTask guard when the chosen employee is not found', async () => {
    const logger = fakeLogger();
    const { deps } = stubWorkforceDeps({ employee: null });
    const port = createTaskDispatchPort({ workforceDeps: deps, logger });

    await expect(port.dispatch(BASE_TRACE)).rejects.toThrow(/not found/);
  });
});
