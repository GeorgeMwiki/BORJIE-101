/**
 * Postgres-backed ThreadStoreBackend adapter.
 *
 * Ports the in-memory contract onto any repository that satisfies the minimal
 * shape defined by `BrainThreadRepositoryLike`. This adapter does NOT import
 * `@borjie/database` — it accepts the repository by duck-typed interface
 * so the ai-copilot package stays dependency-direction-pure.
 *
 * Hosts (e.g. the api-gateway or a Next.js route) construct the concrete
 * `BrainThreadRepository` from `@borjie/database` and hand it in here.
 */

import {
  ThreadStoreBackend,
  Thread,
  ThreadEvent,
} from './thread-store.js';

/**
 * Shape the adapter needs. Matches
 * `@borjie/database/repositories/brain-thread.repository.ts`.
 */
export interface BrainThreadRepositoryLike {
  createThread(
    t: Omit<Thread, 'createdAt' | 'updatedAt'>
  ): Promise<Thread>;
  getThread(threadId: string): Promise<Thread | null>;
  listThreads(
    tenantId: string,
    opts?: {
      userId?: string;
      teamId?: string;
      employeeId?: string;
      personaId?: string;
      status?: Thread['status'];
      limit?: number;
    }
  ): Promise<Thread[]>;
  archiveThread(threadId: string): Promise<void>;
  appendEvent(tenantId: string, event: ThreadEvent): Promise<void>;
  listEvents(threadId: string): Promise<ThreadEvent[]>;
}

/**
 * Wraps a BrainThreadRepository as a ThreadStoreBackend.
 */
export class PostgresThreadStoreBackend implements ThreadStoreBackend {
  constructor(
    private readonly repo: BrainThreadRepositoryLike,
    private readonly tenantIdResolver: () => string
  ) {}

  async createThread(
    t: Omit<Thread, 'createdAt' | 'updatedAt'>
  ): Promise<Thread> {
    return this.repo.createThread(t);
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return this.repo.getThread(threadId);
  }

  async listThreads(
    tenantId: string,
    opts: Parameters<BrainThreadRepositoryLike['listThreads']>[1] = {}
  ): Promise<Thread[]> {
    return this.repo.listThreads(tenantId, opts);
  }

  async archiveThread(threadId: string): Promise<void> {
    return this.repo.archiveThread(threadId);
  }

  async appendEvent(event: ThreadEvent): Promise<void> {
    return this.repo.appendEvent(this.tenantIdResolver(), event);
  }

  async listEvents(threadId: string): Promise<ThreadEvent[]> {
    return this.repo.listEvents(threadId);
  }
}
