/**
 * A2A v1.0 Task Lifecycle — submit / get / cancel.
 *
 * Maps to the three required RPC methods in the A2A spec:
 *   - `tasks/send`   → `submitTask`
 *   - `tasks/get`    → `getTask`
 *   - `tasks/cancel` → `cancelTask`
 *
 * Status transitions:
 *   submitted -> working -> { completed | failed | canceled }
 *
 * Storage is behind an interface so we can swap the in-memory store for a
 * Postgres/Redis adapter without touching the lifecycle code. (Persistent
 * adapter is the follow-up round per scope.)
 */
import { freezeDeep } from './internal/freeze.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface A2ATaskMessage {
  readonly role: 'user' | 'agent';
  readonly parts: ReadonlyArray<A2ATaskPart>;
}

export interface A2ATaskPart {
  readonly type: 'text' | 'data' | 'file';
  readonly content: string;
  readonly mimeType?: string;
}

export interface A2ATask {
  readonly id: string;
  readonly sessionId: string;
  readonly status: A2ATaskStatus;
  readonly message: A2ATaskMessage;
  readonly artifacts: ReadonlyArray<A2ATaskMessage>;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage port — swap-out for Postgres / Redis later.
// ---------------------------------------------------------------------------

export interface TaskStore {
  put(task: A2ATask): Promise<void>;
  get(id: string): Promise<A2ATask | null>;
  list(sessionId: string): Promise<ReadonlyArray<A2ATask>>;
}

export function createInMemoryTaskStore(): TaskStore {
  const map = new Map<string, A2ATask>();
  return {
    async put(task) {
      map.set(task.id, task);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async list(sessionId) {
      const out: A2ATask[] = [];
      for (const task of map.values()) {
        if (task.sessionId === sessionId) out.push(task);
      }
      return Object.freeze(out);
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

export interface LifecycleDeps {
  readonly store: TaskStore;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SubmitTaskRequest {
  readonly sessionId: string;
  readonly message: A2ATaskMessage;
  readonly taskId?: string;
}

/**
 * Submit a new task. Idempotent on `taskId`: if a task with the supplied id
 * already exists, returns the existing record unchanged.
 */
export async function submitTask(
  req: SubmitTaskRequest,
  deps: LifecycleDeps,
): Promise<A2ATask> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const id = req.taskId ?? (deps.newId ?? defaultNewId)();
  const existing = await deps.store.get(id);
  if (existing) return existing;
  const task: A2ATask = freezeDeep({
    id,
    sessionId: req.sessionId,
    status: 'submitted',
    message: req.message,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  });
  await deps.store.put(task);
  return task;
}

export async function getTask(
  id: string,
  deps: LifecycleDeps,
): Promise<A2ATask | null> {
  return deps.store.get(id);
}

/**
 * Cancel a task. Returns the post-cancel record, or null if it does not
 * exist. Completed / failed tasks are returned unchanged (cancelling a
 * finished task is a no-op, matching the A2A spec).
 */
export async function cancelTask(
  id: string,
  deps: LifecycleDeps,
): Promise<A2ATask | null> {
  const current = await deps.store.get(id);
  if (!current) return null;
  if (
    current.status === 'completed' ||
    current.status === 'failed' ||
    current.status === 'canceled'
  ) {
    return current;
  }
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const canceled: A2ATask = freezeDeep({
    ...current,
    status: 'canceled',
    updatedAt: now,
  });
  await deps.store.put(canceled);
  return canceled;
}

/**
 * Internal helper used by the agent runtime (not part of the public RPC
 * surface) to mark a task as `working` once execution starts. Exposed so
 * higher layers can drive the state machine; not part of the A2A spec but
 * needed for end-to-end orchestration.
 */
export async function markTaskWorking(
  id: string,
  deps: LifecycleDeps,
): Promise<A2ATask | null> {
  const current = await deps.store.get(id);
  if (!current) return null;
  if (current.status !== 'submitted') return current;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const next: A2ATask = freezeDeep({
    ...current,
    status: 'working',
    updatedAt: now,
  });
  await deps.store.put(next);
  return next;
}

/**
 * Mark a task as completed with an optional artifact payload.
 */
export async function completeTask(
  id: string,
  artifact: A2ATaskMessage | null,
  deps: LifecycleDeps,
): Promise<A2ATask | null> {
  const current = await deps.store.get(id);
  if (!current) return null;
  if (current.status === 'canceled' || current.status === 'failed') {
    return current;
  }
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const artifacts = artifact
    ? [...current.artifacts, artifact]
    : current.artifacts;
  const next: A2ATask = freezeDeep({
    ...current,
    status: 'completed',
    artifacts,
    updatedAt: now,
  });
  await deps.store.put(next);
  return next;
}

/**
 * Mark a task as failed with a human-readable error string.
 */
export async function failTask(
  id: string,
  error: string,
  deps: LifecycleDeps,
): Promise<A2ATask | null> {
  const current = await deps.store.get(id);
  if (!current) return null;
  if (current.status === 'canceled') return current;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const next: A2ATask = freezeDeep({
    ...current,
    status: 'failed',
    error,
    updatedAt: now,
  });
  await deps.store.put(next);
  return next;
}

function defaultNewId(): string {
  return crypto.randomUUID();
}
