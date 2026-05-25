/**
 * SandboxRuntime — factory + in-memory implementation.
 *
 * For tests + the deterministic happy path we use the in-memory
 * implementation. For production we hand off to a schema-clone
 * adapter that lives outside this package (adapter is unwired here
 * so the engine stays dependency-free).
 */

import type { Sandbox } from '../types.js';
import { planSchemaClone, type SchemaClonePlan } from './schema-clone.js';
import { checkHost, checkTableWrite } from './isolation-policy.js';

let counter = 0;
function nextRunId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

class InMemorySandbox implements Sandbox {
  readonly runId: string;
  readonly createdAt: number;
  readonly mode = 'in-memory' as const;
  private store: ReadonlyMap<string, unknown> = new Map();
  private disposed = false;

  constructor(runId: string, createdAt: number) {
    this.runId = runId;
    this.createdAt = createdAt;
  }

  async read<T>(key: string): Promise<T | undefined> {
    if (this.disposed) throw new Error('Sandbox is disposed');
    return this.store.get(key) as T | undefined;
  }

  async write<T>(key: string, value: T): Promise<void> {
    if (this.disposed) throw new Error('Sandbox is disposed');
    const check = checkTableWrite(key.split(':')[0] ?? '');
    if (!check.allowed) {
      throw new Error(check.reason);
    }
    const next = new Map(this.store);
    next.set(key, value);
    this.store = next;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.store = new Map();
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

export interface CreateSandboxOptions {
  readonly mode?: 'in-memory' | 'schema-clone';
  readonly ttlMs?: number;
}

export interface CreateSandboxResult {
  readonly sandbox: Sandbox;
  readonly plan?: SchemaClonePlan;
}

export async function createSandbox(
  opts: CreateSandboxOptions = {},
): Promise<CreateSandboxResult> {
  const mode = opts.mode ?? 'in-memory';
  const runId = nextRunId();
  const createdAt = Date.now();

  if (mode === 'in-memory') {
    return { sandbox: new InMemorySandbox(runId, createdAt) };
  }

  // schema-clone path: we plan, but defer execution to the adapter.
  const plan = planSchemaClone({ runId, ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}) });
  return {
    sandbox: new InMemorySandbox(runId, createdAt),
    plan,
  };
}

// Re-export the host-check helper so callers can sanity-check
// outbound URLs they intend to use inside a scenario.
export { checkHost };
