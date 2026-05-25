/**
 * Durable execution — wrap any async runner so its progress is
 * checkpointed and resumable. Aligns with Inngest 3, Temporal, and
 * Trigger.dev v3 conventions.
 *
 * Two storage backends out of the box:
 *
 *   - `createInMemoryDurableStore` — for tests + dev
 *   - the caller injects an Inngest- or DB-backed store in prod
 *
 * `wrapAsDurable` provides the high-level facade: it takes a
 * pure `runner(checkpointFn, signal)` and threads the checkpoint into
 * it. The runner is expected to call `checkpointFn(partial)` at
 * meaningful step boundaries.
 */

export interface DurableCheckpoint<T> {
  readonly runId: string;
  readonly step: number;
  readonly at: string;
  readonly partial: T;
  readonly terminal: boolean;
}

export interface DurableStore<T> {
  save(checkpoint: DurableCheckpoint<T>): Promise<void>;
  list(runId: string): Promise<ReadonlyArray<DurableCheckpoint<T>>>;
  latest(runId: string): Promise<DurableCheckpoint<T> | null>;
  /** Optional: discard checkpoints for a completed run. */
  evict?(runId: string): Promise<void>;
}

export function createInMemoryDurableStore<T>(): DurableStore<T> {
  const store = new Map<string, DurableCheckpoint<T>[]>();
  return {
    async save(c) {
      const list = store.get(c.runId) ?? [];
      list.push(c);
      store.set(c.runId, list);
    },
    async list(runId) {
      return [...(store.get(runId) ?? [])];
    },
    async latest(runId) {
      return store.get(runId)?.at(-1) ?? null;
    },
    async evict(runId) {
      store.delete(runId);
    },
  };
}

export interface InngestLikePort {
  /** Mirror of Inngest's `step.run` — returns the cached or fresh value. */
  step<T>(stepId: string, fn: () => Promise<T>): Promise<T>;
}

export type DurableRunner<T, R> = (deps: {
  checkpoint: (partial: T, opts?: { terminal?: boolean }) => Promise<void>;
  signal?: AbortSignal;
}) => Promise<R>;

export interface WrapAsDurableInput<T, R> {
  readonly runner: DurableRunner<T, R>;
  readonly store: DurableStore<T>;
  readonly runId?: string;
  readonly inngest?: InngestLikePort;
}

export interface DurableHandle<R> {
  readonly runId: string;
  readonly promise: Promise<R>;
}

export function wrapAsDurable<T, R>(input: WrapAsDurableInput<T, R>): DurableHandle<R> {
  const runId = input.runId ?? `durable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let step = 0;
  const inngest = input.inngest;

  const checkpoint = async (partial: T, opts?: { terminal?: boolean }) => {
    step += 1;
    const ckpt: DurableCheckpoint<T> = {
      runId,
      step,
      at: new Date().toISOString(),
      partial,
      terminal: opts?.terminal === true,
    };
    if (inngest) {
      await inngest.step(`save-${step}`, () => input.store.save(ckpt));
    } else {
      await input.store.save(ckpt);
    }
  };

  const promise = input.runner({ checkpoint });
  return { runId, promise };
}

/**
 * Replay the partial state from the most recent checkpoint. Callers
 * pass the partial into a new runner invocation to resume.
 */
export async function replayFromCheckpoint<T>(
  runId: string,
  store: DurableStore<T>,
): Promise<DurableCheckpoint<T> | null> {
  return store.latest(runId);
}

/** List every checkpoint for forensic / audit replay. */
export async function listCheckpoints<T>(
  runId: string,
  store: DurableStore<T>,
): Promise<ReadonlyArray<DurableCheckpoint<T>>> {
  return store.list(runId);
}
