import { describe, it, expect } from 'vitest';
import { parcelEditPolicy } from '../policies/parcel-edit-policy.js';
import { makeReq } from './fixtures.js';

describe('parcelEditPolicy', () => {
  it('preChecks reports missing parcelId', () => {
    const issues = parcelEditPolicy.preChecks(makeReq('parcel_edit', {}));
    expect(issues.some((i) => i.code === 'parcel.id.missing')).toBe(true);
  });

  it('preChecks reports blank new name', () => {
    const issues = parcelEditPolicy.preChecks(
      makeReq('parcel_edit', { parcelId: 'p1', newName: '   ' }),
    );
    expect(issues.some((i) => i.code === 'parcel.name.empty')).toBe(true);
  });

  it('preChecks reports no-op rename (warning)', () => {
    const issues = parcelEditPolicy.preChecks(
      makeReq('parcel_edit', { parcelId: 'p1', currentName: 'A', newName: 'A' }),
    );
    expect(issues.some((i) => i.code === 'parcel.name.noop' && i.severity === 'warning')).toBe(true);
  });

  it('preChecks rejects non-positive area', () => {
    const issues = parcelEditPolicy.preChecks(
      makeReq('parcel_edit', { parcelId: 'p1', newAreaSqm: 0 }),
    );
    expect(issues.some((i) => i.code === 'parcel.area.non_positive')).toBe(true);
  });

  it('redLines triggers on 50%+ area swing', () => {
    const redLines = parcelEditPolicy.redLines(
      makeReq('parcel_edit', {
        parcelId: 'p1',
        currentAreaSqm: 1000,
        newAreaSqm: 2000,
      }),
    );
    expect(
      redLines.some((i) => i.code === 'parcel.area.unexplained_50pct_swing'),
    ).toBe(true);
  });

  it('redLines requires justification when active leases exist', () => {
    const redLines = parcelEditPolicy.redLines(
      makeReq('parcel_edit', {
        parcelId: 'p1',
        activeLeaseIds: ['l1', 'l2'],
      }),
    );
    expect(
      redLines.some((i) => i.code === 'parcel.edit.requires_justification_when_leased'),
    ).toBe(true);
  });

  it('redLines is empty when there are active leases AND a justification', () => {
    const redLines = parcelEditPolicy.redLines(
      makeReq('parcel_edit', {
        parcelId: 'p1',
        activeLeaseIds: ['l1'],
        changeJustification: 'Surveyor confirmed boundary correction.',
      }),
    );
    expect(redLines).toEqual([]);
  });

  it('brainPrompt mentions tenant id and parcel id', () => {
    const prompt = parcelEditPolicy.brainPrompt(
      makeReq('parcel_edit', {
        parcelId: 'p1',
        newName: 'Plot A',
      }),
    );
    expect(prompt).toContain('tenant_test');
    expect(prompt).toContain('p1');
  });
});
