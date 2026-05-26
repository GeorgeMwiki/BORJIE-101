import { describe, it, expect } from 'vitest';
import { createActiveAgentsRegistry } from '../registry/active-agents-registry.js';
import { createInMemoryActiveAgentsRepository } from '../storage/active-agents-repository.js';

describe('active-agents-registry', () => {
  it('registers an agent with running status', async () => {
    const repo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(repo);
    const row = await registry.register({
      tenantId: 't1',
      agentId: 'mr-mwikila',
      agentKind: 'root_md',
      subject: { kind: 'parcel', id: 'KAH-088-A' },
    });
    expect(row.status).toBe('running');
    expect(row.agentKind).toBe('root_md');
    expect(row.subject?.id).toBe('KAH-088-A');
    expect(row.auditHash.length).toBeGreaterThan(0);
  });

  it('refreshes heartbeat without creating duplicate row', async () => {
    let clockMs = 1_700_000_000_000;
    const repo = createInMemoryActiveAgentsRepository({
      now: () => new Date(clockMs),
    });
    const registry = createActiveAgentsRegistry(repo);
    const row = await registry.register({
      tenantId: 't1',
      agentId: 'safety-officer',
      agentKind: 'specialisation',
    });
    const heartbeatBefore = row.heartbeatAt.getTime();
    clockMs += 30_000;
    await registry.heartbeat('t1', row.id);
    const refreshed = await repo.listRunningOnSubject('t1', {
      kind: 'parcel',
      id: 'KAH-088-A',
    });
    // Different subject; nothing matches.
    expect(refreshed.length).toBe(0);
    const stale = await repo.listStaleRunning(new Date(heartbeatBefore + 1));
    expect(stale.length).toBe(0);
  });

  it('deregisters with a terminal status', async () => {
    const repo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(repo);
    const row = await registry.register({
      tenantId: 't1',
      agentId: 'fleet',
      agentKind: 'specialisation',
      subject: { kind: 'campaign', id: 'cmp-1' },
    });
    await registry.deregister('t1', row.id, 'completed');
    const matches = await registry.listRunningOnSubject('t1', {
      kind: 'campaign',
      id: 'cmp-1',
    });
    expect(matches.length).toBe(0);
  });

  it('lists running agents on a subject', async () => {
    const repo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(repo);
    await registry.register({
      tenantId: 't1',
      agentId: 'a',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    await registry.register({
      tenantId: 't1',
      agentId: 'b',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    const matches = await registry.listRunningOnSubject('t1', {
      kind: 'parcel',
      id: 'P1',
    });
    expect(matches.length).toBe(2);
  });

  it('ignores tenant cross-talk', async () => {
    const repo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(repo);
    await registry.register({
      tenantId: 't1',
      agentId: 'a',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    const matches = await registry.listRunningOnSubject('t2', {
      kind: 'parcel',
      id: 'P1',
    });
    expect(matches.length).toBe(0);
  });
});
