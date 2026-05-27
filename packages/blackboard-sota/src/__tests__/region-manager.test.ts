/**
 * Region manager — open + transition lattice tests.
 *
 * Wave BLACKBOARD-CORE. Verifies:
 *   - open creates a row with status='open' and a non-empty audit hash
 *   - the open → active → closed transition lattice is enforced
 *   - illegal transitions throw InvalidRegionTransitionError
 *   - close stamps closedAt
 *   - missing region throws RegionNotFoundError
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.3.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryRegionsRepository,
  createRegionManager,
  InvalidRegionTransitionError,
  RegionNotFoundError,
} from '../index.js';

describe('region-manager — open + lifecycle', () => {
  it('open creates a region with status=open and an audit_hash', async () => {
    const repo = createInMemoryRegionsRepository();
    const mgr = createRegionManager({ repository: repo });
    const region = await mgr.open({
      tenantId: 't1',
      id: 'incident-investigation:KAH-088',
      regionKind: 'incident-investigation',
    });
    expect(region.status).toBe('open');
    expect(region.auditHash.length).toBeGreaterThan(0);
    expect(region.closedAt).toBeNull();
  });

  it('open → active → closed transitions succeed and stamp closedAt', async () => {
    const repo = createInMemoryRegionsRepository();
    const mgr = createRegionManager({ repository: repo });
    await mgr.open({
      tenantId: 't1',
      id: 'r1',
      regionKind: 'royalty-filing-prep',
    });
    const active = await mgr.transition({
      tenantId: 't1',
      id: 'r1',
      next: 'active',
    });
    expect(active.status).toBe('active');
    expect(active.closedAt).toBeNull();
    const closed = await mgr.close({ tenantId: 't1', id: 'r1' });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).not.toBeNull();
  });

  it('rejects active → open (terminal lattice violation)', async () => {
    const repo = createInMemoryRegionsRepository();
    const mgr = createRegionManager({ repository: repo });
    await mgr.open({
      tenantId: 't1',
      id: 'r2',
      regionKind: 'buyer-deal-room',
    });
    await mgr.transition({ tenantId: 't1', id: 'r2', next: 'active' });
    await expect(
      mgr.transition({ tenantId: 't1', id: 'r2', next: 'open' }),
    ).rejects.toBeInstanceOf(InvalidRegionTransitionError);
  });

  it('rejects closed → anywhere (closed is terminal)', async () => {
    const repo = createInMemoryRegionsRepository();
    const mgr = createRegionManager({ repository: repo });
    await mgr.open({
      tenantId: 't1',
      id: 'r3',
      regionKind: 'deep-research-session',
    });
    await mgr.close({ tenantId: 't1', id: 'r3' });
    await expect(
      mgr.transition({ tenantId: 't1', id: 'r3', next: 'active' }),
    ).rejects.toBeInstanceOf(InvalidRegionTransitionError);
  });

  it('transition on unknown region throws RegionNotFoundError', async () => {
    const repo = createInMemoryRegionsRepository();
    const mgr = createRegionManager({ repository: repo });
    await expect(
      mgr.transition({ tenantId: 't1', id: 'nope', next: 'active' }),
    ).rejects.toBeInstanceOf(RegionNotFoundError);
  });
});
