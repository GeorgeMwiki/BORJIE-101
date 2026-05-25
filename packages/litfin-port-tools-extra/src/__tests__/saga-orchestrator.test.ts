import { describe, expect, it } from 'vitest';
import {
  compensateOnce,
  initSaga,
  stepForward,
  type SagaStep,
} from '../saga-orchestrator.js';

interface Ctx {
  readonly ledger: readonly string[];
}

const append = (ctx: Ctx, s: string): Ctx => ({ ledger: [...ctx.ledger, s] });

const okSteps: readonly SagaStep<Ctx>[] = [
  { id: 's1', forward: async (c) => append(c, '+s1'), compensate: async (c) => append(c, '-s1') },
  { id: 's2', forward: async (c) => append(c, '+s2'), compensate: async (c) => append(c, '-s2') },
];

const failingSteps: readonly SagaStep<Ctx>[] = [
  { id: 's1', forward: async (c) => append(c, '+s1'), compensate: async (c) => append(c, '-s1') },
  {
    id: 's2',
    forward: async () => {
      throw new Error('oops');
    },
    compensate: async (c) => append(c, '-s2'),
  },
];

describe('saga-orchestrator', () => {
  it('init creates pending instance', () => {
    const inst = initSaga<Ctx>('def-1', { ledger: [] });
    expect(inst.status).toBe('pending');
    expect(inst.currentStep).toBe(0);
  });

  it('runs all steps to completion', async () => {
    let inst = initSaga<Ctx>('def-1', { ledger: [] });
    for (let i = 0; i < 5 && inst.status !== 'completed'; i++) {
      const out = await stepForward(inst, okSteps);
      expect(out.ok).toBe(true);
      if (out.ok) inst = out.instance;
    }
    expect(inst.status).toBe('completed');
    expect(inst.ctx.ledger).toEqual(['+s1', '+s2']);
  });

  it('transitions to compensating on step failure', async () => {
    let inst = initSaga<Ctx>('def-2', { ledger: [] });
    const out1 = await stepForward(inst, failingSteps);
    expect(out1.ok).toBe(true);
    if (out1.ok) inst = out1.instance;
    const out2 = await stepForward(inst, failingSteps);
    expect(out2.ok).toBe(false);
    if (!out2.ok) {
      inst = out2.instance;
      expect(out2.reason).toContain('s2-failed');
    }
    expect(inst.status).toBe('compensating');
  });

  it('compensateOnce undoes one step at a time, reverse order', async () => {
    let inst = initSaga<Ctx>('def-3', { ledger: [] });
    let out = await stepForward(inst, okSteps);
    if (out.ok) inst = out.instance;
    out = await stepForward(inst, okSteps);
    if (out.ok) inst = out.instance;
    // simulate forcing compensation
    inst = { ...inst, status: 'compensating' };
    const c1 = await compensateOnce(inst, okSteps);
    if (c1.ok) inst = c1.instance;
    expect(inst.ctx.ledger).toContain('-s2');
    const c2 = await compensateOnce(inst, okSteps);
    if (c2.ok) inst = c2.instance;
    expect(inst.ctx.ledger).toContain('-s1');
    const c3 = await compensateOnce(inst, okSteps);
    if (c3.ok) inst = c3.instance;
    expect(inst.status).toBe('compensated');
  });

  it('compensateOnce refuses non-compensating instance', async () => {
    const inst = initSaga<Ctx>('def-4', { ledger: [] });
    const out = await compensateOnce(inst, okSteps);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not-compensating');
  });

  it('stepForward refuses terminal status', async () => {
    const inst = { ...initSaga<Ctx>('d', { ledger: [] }), status: 'failed' as const };
    const out = await stepForward(inst, okSteps);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('terminal-status');
  });

  it('handles a step with no compensation gracefully', async () => {
    const stepsNoComp: readonly SagaStep<Ctx>[] = [
      { id: 's1', forward: async (c) => append(c, '+s1') },
    ];
    let inst = initSaga<Ctx>('d', { ledger: [] });
    const fw = await stepForward(inst, stepsNoComp);
    if (fw.ok) inst = fw.instance;
    inst = { ...inst, status: 'compensating' };
    const cm = await compensateOnce(inst, stepsNoComp);
    expect(cm.ok).toBe(true);
    if (cm.ok) expect(cm.instance.compensated).toContain('s1');
  });

  it('captures error message on instance', async () => {
    let inst = initSaga<Ctx>('d', { ledger: [] });
    const fw = await stepForward(inst, failingSteps);
    if (fw.ok) inst = fw.instance;
    const fail = await stepForward(inst, failingSteps);
    if (!fail.ok) {
      expect(fail.instance.error).toBe('oops');
    }
  });
});
