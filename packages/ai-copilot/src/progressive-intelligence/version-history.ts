/**
 * Version History — append-only snapshot log of AccumulatedEstateContext.
 *
 * Every accumulator update is a new row. Operators can rewind to any prior
 * version. Never mutates existing snapshots.
 *
 * @module progressive-intelligence/version-history
 */

import type { AccumulatedEstateContext } from './types.js';

export interface ContextSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly version: number;
  readonly context: AccumulatedEstateContext;
  readonly createdAt: string;
}

export interface VersionHistoryRepository {
  append(snapshot: ContextSnapshot): Promise<void>;
  list(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly ContextSnapshot[]>;
  getVersion(
    tenantId: string,
    sessionId: string,
    version: number,
  ): Promise<ContextSnapshot | null>;
}

export class InMemoryVersionHistoryRepository
  implements VersionHistoryRepository
{
  private readonly store = new Map<string, ContextSnapshot[]>();

  private keyFor(tenantId: string, sessionId: string): string {
    return `${tenantId}::${sessionId}`;
  }

  async append(snapshot: ContextSnapshot): Promise<void> {
    if (snapshot.tenantId !== snapshot.context.tenantId) {
      throw new Error(
        'version-history: snapshot.tenantId does not match context.tenantId',
      );
    }
    const key = this.keyFor(snapshot.tenantId, snapshot.sessionId);
    const bucket = this.store.get(key) ?? [];
    this.store.set(key, [...bucket, snapshot]);
  }

  async list(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly ContextSnapshot[]> {
    assertTenant(tenantId);
    return this.store.get(this.keyFor(tenantId, sessionId)) ?? [];
  }

  async getVersion(
    tenantId: string,
    sessionId: string,
    version: number,
  ): Promise<ContextSnapshot | null> {
    const all = await this.list(tenantId, sessionId);
    return all.find((s) => s.version === version) ?? null;
  }
}

export class VersionHistoryService {
  constructor(private readonly repo: VersionHistoryRepository) {}

  async snapshot(context: AccumulatedEstateContext): Promise<ContextSnapshot> {
    assertTenant(context.tenantId);
    const snap: ContextSnapshot = {
      id: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      version: context.version,
      context,
      createdAt: new Date().toISOString(),
    };
    await this.repo.append(snap);
    return snap;
  }

  async list(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly ContextSnapshot[]> {
    return this.repo.list(tenantId, sessionId);
  }

  async rewindTo(
    tenantId: string,
    sessionId: string,
    version: number,
  ): Promise<AccumulatedEstateContext | null> {
    assertTenant(tenantId);
    const snap = await this.repo.getVersion(tenantId, sessionId, version);
    return snap?.context ?? null;
  }
}

function assertTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('version-history: tenantId is required');
  }
}

export function createVersionHistoryService(
  repo: VersionHistoryRepository,
): VersionHistoryService {
  return new VersionHistoryService(repo);
}
