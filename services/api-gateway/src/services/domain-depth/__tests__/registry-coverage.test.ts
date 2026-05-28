/**
 * Domain-depth — resolver registry coverage tests.
 *
 * Asserts that the BRAIN-DEPTH wave wired the expected number of
 * sub-area resolvers. The registry merge order is also asserted:
 * sibling-owned explicit keys must override the broad-sweep map.
 */

import { describe, it, expect } from 'vitest';

import { RESOLVER_REGISTRY, resolveSubArea } from '../index';
import { resolvePccb } from '../resolvers/pccb-resolver';
import { resolvePdpa } from '../resolvers/pdpa-resolver';

describe('RESOLVER_REGISTRY', () => {
  it('wires at least 50 sub-area resolver keys', () => {
    expect(Object.keys(RESOLVER_REGISTRY).length).toBeGreaterThanOrEqual(50);
  });

  it('explicit PCCB + PDPA wiring overrides EXTRA_RESOLVERS', () => {
    expect(RESOLVER_REGISTRY['compliance.anti_corruption']).toBe(resolvePccb);
    expect(RESOLVER_REGISTRY['compliance.data_protection']).toBe(resolvePdpa);
  });

  it('returns awaiting-data for unwired sub-areas without throwing', async () => {
    const out = await resolveSubArea(
      'subsidiaries',
      'workforce_payroll',
      { tenantId: 'tenant-a' },
    );
    expect(out.status).toBe('unknown');
  });

  it('routes a wired key through the registry and returns a SubAreaStatus', async () => {
    // No db on the scope → resolver returns unknown but does NOT throw.
    const out = await resolveSubArea(
      'compliance',
      'anti_corruption',
      { tenantId: 'tenant-a' },
    );
    expect(out.status).toBe('unknown');
    expect(typeof out.note).toBe('string');
  });
});
