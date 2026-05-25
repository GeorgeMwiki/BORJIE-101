/**
 * Residency policy tests — every row of the decision matrix.
 */

import { describe, expect, it } from 'vitest';

import {
  checkResidency,
  defineResidencyPolicy,
  enforceResidency,
} from '../residency/index.js';
import { ResidencyViolationError, type ResidencyPolicy } from '../types.js';

describe('residency: checkResidency', () => {
  it('allow — same region', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: false,
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'users', region: 'eu-west-1', action: 'read' },
      }),
    ).toBe('allow');
  });

  it('deny — different region, no failover', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: false,
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'users', region: 'us-east-1', action: 'read' },
      }),
    ).toBe('deny');
  });

  it('allowed_with_replication — failover enabled + region listed', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: true,
      failoverRegions: ['eu-central-1'],
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'users', region: 'eu-central-1', action: 'write' },
      }),
    ).toBe('allowed_with_replication');
  });

  it('deny — failover enabled but region NOT in failoverRegions', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: true,
      failoverRegions: ['eu-central-1'],
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'users', region: 'us-east-1', action: 'read' },
      }),
    ).toBe('deny');
  });

  it('per-table override (global) bypasses residency entirely', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: false,
      tableOverrides: { country_metadata: 'global' },
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'country_metadata', region: 'us-east-1', action: 'read' },
      }),
    ).toBe('allow');
  });

  it('per-table override (pinned) is the default behaviour', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: false,
      tableOverrides: { users: 'pinned' },
    };
    expect(
      checkResidency({
        policy,
        operation: { table: 'users', region: 'us-east-1', action: 'read' },
      }),
    ).toBe('deny');
  });
});

describe('residency: enforceResidency', () => {
  it('throws ResidencyViolationError on deny', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: false,
    };
    expect(() =>
      enforceResidency({
        policy,
        operation: { table: 'users', region: 'us-east-1', action: 'read' },
      }),
    ).toThrow(ResidencyViolationError);
  });

  it('does not throw on allow / allowed_with_replication', () => {
    const policy: ResidencyPolicy = {
      tenantId: 't_1',
      region: 'eu-west-1',
      allowFailover: true,
      failoverRegions: ['eu-central-1'],
    };
    expect(() =>
      enforceResidency({
        policy,
        operation: { table: 'users', region: 'eu-west-1', action: 'read' },
      }),
    ).not.toThrow();
    expect(() =>
      enforceResidency({
        policy,
        operation: { table: 'users', region: 'eu-central-1', action: 'write' },
      }),
    ).not.toThrow();
  });
});

describe('residency: defineResidencyPolicy', () => {
  it('returns a checker bound to the tenant', () => {
    const checker = defineResidencyPolicy({
      tenantId: 't_42',
      region: 'af-south-1',
      allowFailover: false,
    });
    expect(checker.tenantId).toBe('t_42');
    expect(
      checker.check({ table: 'users', region: 'af-south-1', action: 'read' }),
    ).toBe('allow');
    expect(
      checker.check({ table: 'users', region: 'eu-west-1', action: 'read' }),
    ).toBe('deny');
    expect(() =>
      checker.enforce({ table: 'users', region: 'eu-west-1', action: 'read' }),
    ).toThrow(ResidencyViolationError);
  });
});
