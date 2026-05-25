import { describe, it, expect } from 'vitest';
import { inspectionPolicy } from '../policies/inspection-policy.js';
import { makeReq } from './fixtures.js';

describe('inspectionPolicy', () => {
  it('preChecks reports each missing required section', () => {
    const issues = inspectionPolicy.preChecks(
      makeReq('inspection', { inspectorId: 'i1', sections: [{ key: 'exterior' }] }),
    );
    const missing = issues.filter((i) => i.code === 'inspection.section.missing');
    expect(missing.length).toBe(3); // interior, utilities, safety
  });

  it('preChecks reports missing inspectorId', () => {
    const issues = inspectionPolicy.preChecks(makeReq('inspection', { sections: [] }));
    expect(issues.some((i) => i.code === 'inspection.inspector.missing')).toBe(true);
  });

  it('redLines blocks unauthorised role', () => {
    const redLines = inspectionPolicy.redLines(
      makeReq('inspection', {}, { actorRole: 'tenant' }),
    );
    expect(redLines.some((i) => i.code === 'inspection.role.unauthorised')).toBe(true);
  });

  it('redLines blocks "no issues" with non-empty defects', () => {
    const redLines = inspectionPolicy.redLines(
      makeReq('inspection', {
        noIssuesFound: true,
        defects: [{ description: 'cracked window' }],
      }),
    );
    expect(
      redLines.some((i) => i.code === 'inspection.contradictory_no_issues_claim'),
    ).toBe(true);
  });

  it('redLines empty for valid role + consistent claim', () => {
    const redLines = inspectionPolicy.redLines(
      makeReq('inspection', { noIssuesFound: true, defects: [] }),
    );
    expect(redLines).toEqual([]);
  });
});
