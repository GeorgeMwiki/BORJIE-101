import { describe, expect, it } from 'vitest';
import {
  createInMemoryTelemetryRepository,
  type TelemetryInsertInput,
} from '../storage/telemetry-repository.js';

function insertInput(overrides: Partial<TelemetryInsertInput> = {}): TelemetryInsertInput {
  return {
    id: 'row-1',
    tenant_id: 'mwadui_coop',
    function_id: 'fx',
    manifest_version: 1,
    generated_recipe_hash: 'hash-a',
    user_id: 'user-1',
    session_id: 'sess-1',
    scope_kind: 'site',
    scope_id: 'mwadui-2',
    user_context_hash: 'ctx-hash',
    generated_at: '2026-05-26T00:00:00Z',
    audit_hash: 'audit-1',
    ...overrides,
  };
}

describe('in-memory telemetry-repository', () => {
  it('inserts and returns the row', async () => {
    const repo = createInMemoryTelemetryRepository();
    const row = await repo.insert(insertInput());
    expect(row.id).toBe('row-1');
    expect(row.closed_at).toBeNull();
    expect(row.was_promoted).toBe(false);
  });

  it('marks the row closed', async () => {
    const repo = createInMemoryTelemetryRepository();
    await repo.insert(insertInput());
    const closed = await repo.markClosed('row-1', '2026-05-26T01:00:00Z');
    expect(closed?.closed_at).toBe('2026-05-26T01:00:00Z');
  });

  it('returns null when closing a missing row', async () => {
    const repo = createInMemoryTelemetryRepository();
    const r = await repo.markClosed('missing', '2026-05-26T00:00:00Z');
    expect(r).toBeNull();
  });

  it('bumps reuse count across rows sharing the hash', async () => {
    const repo = createInMemoryTelemetryRepository();
    await repo.insert(insertInput({ id: 'row-1' }));
    await repo.insert(insertInput({ id: 'row-2' }));
    const max = await repo.bumpReuse('hash-a', 1);
    expect(max).toBeGreaterThan(0);
  });

  it('marks a row promoted', async () => {
    const repo = createInMemoryTelemetryRepository();
    await repo.insert(insertInput());
    const r = await repo.markPromoted('row-1', 'promoted-id');
    expect(r?.was_promoted).toBe(true);
    expect(r?.promotion_recipe_id).toBe('promoted-id');
  });

  it('returns null when promoting a missing row', async () => {
    const repo = createInMemoryTelemetryRepository();
    const r = await repo.markPromoted('missing', 'x');
    expect(r).toBeNull();
  });
});
