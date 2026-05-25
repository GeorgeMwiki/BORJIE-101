/**
 * Long-running task orchestrator — saga-style multi-step tool chains.
 *
 * LITFIN ref: src/core/sagas/* — each step has a forward action +
 * compensation; failures trigger reverse-order compensation.
 *
 * Stateless: callers persist the `SagaInstance` between events so the
 * orchestrator can resume after restart.
 */

export interface SagaStep<TCtx> {
  readonly id: string;
  readonly forward: (ctx: TCtx) => Promise<TCtx>;
  readonly compensate?: (ctx: TCtx) => Promise<TCtx>;
}

export interface SagaInstance<TCtx> {
  readonly definitionId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'compensating' | 'compensated' | 'failed';
  readonly currentStep: number;
  readonly executed: readonly string[];
  readonly compensated: readonly string[];
  readonly ctx: TCtx;
  readonly error: string | null;
}

export const initSaga = <TCtx>(
  definitionId: string,
  initialCtx: TCtx,
): SagaInstance<TCtx> => ({
  definitionId,
  status: 'pending',
  currentStep: 0,
  executed: [],
  compensated: [],
  ctx: initialCtx,
  error: null,
});

export type StepRunResult<TCtx> =
  | { readonly ok: true; readonly instance: SagaInstance<TCtx> }
  | { readonly ok: false; readonly instance: SagaInstance<TCtx>; readonly reason: string };

/**
 * Run the next forward step. If it throws, compensation begins on the
 * next call. Caller controls when to invoke this (e.g. from a worker).
 */
export const stepForward = async <TCtx>(
  instance: SagaInstance<TCtx>,
  steps: readonly SagaStep<TCtx>[],
): Promise<StepRunResult<TCtx>> => {
  if (instance.status === 'completed') return { ok: true, instance };
  if (instance.status === 'compensated' || instance.status === 'failed') {
    return { ok: false, instance, reason: 'terminal-status' };
  }
  if (instance.status === 'compensating') {
    return { ok: false, instance, reason: 'compensating' };
  }
  const step = steps[instance.currentStep];
  if (step === undefined) {
    return {
      ok: true,
      instance: { ...instance, status: 'completed' },
    };
  }
  try {
    const nextCtx = await step.forward(instance.ctx);
    const next: SagaInstance<TCtx> = {
      ...instance,
      status: 'running',
      currentStep: instance.currentStep + 1,
      executed: [...instance.executed, step.id],
      ctx: nextCtx,
    };
    if (next.currentStep >= steps.length) {
      return { ok: true, instance: { ...next, status: 'completed' } };
    }
    return { ok: true, instance: next };
  } catch (e) {
    return {
      ok: false,
      reason: `step-${step.id}-failed:${(e as Error).message}`,
      instance: {
        ...instance,
        status: 'compensating',
        error: (e as Error).message,
      },
    };
  }
};

/**
 * Run the next compensation in reverse order. Calls compensate for
 * each previously-executed step until exhausted.
 */
export const compensateOnce = async <TCtx>(
  instance: SagaInstance<TCtx>,
  steps: readonly SagaStep<TCtx>[],
): Promise<StepRunResult<TCtx>> => {
  if (instance.status !== 'compensating') {
    return { ok: false, instance, reason: 'not-compensating' };
  }
  const toCompensate = instance.executed.filter((id) => !instance.compensated.includes(id));
  if (toCompensate.length === 0) {
    return { ok: true, instance: { ...instance, status: 'compensated' } };
  }
  const id = toCompensate[toCompensate.length - 1];
  const step = steps.find((s) => s.id === id);
  if (step === undefined || step.compensate === undefined) {
    return {
      ok: true,
      instance: {
        ...instance,
        compensated: id !== undefined ? [...instance.compensated, id] : instance.compensated,
      },
    };
  }
  try {
    const nextCtx = await step.compensate(instance.ctx);
    return {
      ok: true,
      instance: {
        ...instance,
        compensated: [...instance.compensated, step.id],
        ctx: nextCtx,
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: `compensation-${step.id}-failed:${(e as Error).message}`,
      instance: { ...instance, status: 'failed', error: (e as Error).message },
    };
  }
};
