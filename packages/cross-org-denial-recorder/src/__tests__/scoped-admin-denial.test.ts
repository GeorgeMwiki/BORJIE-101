/**
 * Wave-5 invariant 2 — cross-scope leak is blocked AND recorded.
 *
 * A delegated admin scoped to org_unit S1 attempts to hit a route
 * targetting org_unit S2 inside the SAME tenant. The api-gateway
 * detects scope mismatch (its responsibility) and fires the recorder.
 * This test verifies the recorder accepts the row with the expected
 * metadata, and the brute-force scanner can pick the pattern out.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregate,
  createInMemorySink,
  createRecorderState,
  DenialReason,
  findBruteForcePatterns,
  recordDenial,
} from '../index.js';

const TENANT = 't-borjie';

describe('cross-scope denial — delegated admin S1 attempting S2', () => {
  it('records a single denial with attempted_org_unit metadata', async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    const r = await recordDenial(
      sink,
      {
        actorUserId: 'user-U',
        actorTenantId: TENANT,
        targetTenantId: TENANT,
        route: '/api/orgs/S2/parcels',
        httpMethod: 'GET',
        reason: DenialReason.PERMISSION_DENIED,
        metadata: {
          attempted_org_unit: 'S2',
          granted_org_units: ['S1', 'S1-child'],
        },
      },
      { state, nowMs: () => 1_700_000_000_000 },
    );
    expect(r.admitted).toBe(true);
    expect(sink.size()).toBe(1);
    const row = sink.rows()[0]!;
    expect(row.actorUserId).toBe('user-U');
    expect(row.reason).toBe('PERMISSION_DENIED');
    expect(row.metadata?.attempted_org_unit).toBe('S2');
    expect(row.metadata?.granted_org_units).toEqual(['S1', 'S1-child']);
  });

  it('brute-force pattern fires when a scoped admin pokes many routes', async () => {
    const sink = createInMemorySink();
    const state = createRecorderState();
    const now = (() => {
      let t = 1_700_000_000_000;
      return () => {
        t += 2_000; // bump well past the 1s rate-limit window
        return t;
      };
    })();
    for (let i = 0; i < 12; i += 1) {
      await recordDenial(
        sink,
        {
          actorUserId: 'user-U',
          actorTenantId: TENANT,
          targetTenantId: TENANT,
          route: `/api/orgs/S2/resource-${i}`,
          httpMethod: 'GET',
          reason: DenialReason.PERMISSION_DENIED,
          metadata: { attempted_org_unit: 'S2' },
        },
        { state, nowMs: now },
      );
    }
    expect(sink.size()).toBe(12);

    const stats = aggregate(sink.rows(), 60_000);
    expect(stats.total).toBe(12);
    expect(stats.byActor['user-U']).toBe(12);

    const findings = findBruteForcePatterns(sink.rows(), {
      minAttempts: 10,
      minDistinctRoutes: 5,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]?.actorUserId).toBe('user-U');
    expect(findings[0]?.targetTenantId).toBe(TENANT);
    expect(findings[0]?.distinctRoutes).toBeGreaterThanOrEqual(5);
  });
});
