import { describe, it, expect } from 'vitest';
import { normaliseEventLog } from '../src/event-log-loader.js';

describe('normaliseEventLog', () => {
  it('produces a CSV with the canonical XES column names', () => {
    const result = normaliseEventLog({
      tenantId: 't1',
      processId: 'p1',
      events: [
        {
          caseId: 'C-1',
          activity: 'submit',
          timestamp: '2026-05-01T09:00:00Z',
          resource: 'alice',
        },
        {
          caseId: 'C-1',
          activity: 'approve',
          timestamp: '2026-05-01T09:30:00Z',
          resource: 'bob',
        },
      ],
    });

    expect(result.eventCount).toBe(2);
    expect(result.caseCount).toBe(1);
    expect(result.format).toBe('csv');
    const lines = result.payload.split('\n');
    expect(lines[0]).toBe(
      'case:concept:name,concept:name,time:timestamp,org:resource',
    );
    expect(lines[1]).toBe('C-1,submit,2026-05-01T09:00:00Z,alice');
    expect(lines[2]).toBe('C-1,approve,2026-05-01T09:30:00Z,bob');
  });

  it('promotes attribute keys into CSV columns', () => {
    const result = normaliseEventLog({
      tenantId: 't1',
      processId: 'p1',
      events: [
        {
          caseId: 'C-1',
          activity: 'submit',
          timestamp: '2026-05-01T09:00:00Z',
          attributes: { region: 'east', urgent: true },
        },
        {
          caseId: 'C-2',
          activity: 'submit',
          timestamp: '2026-05-01T10:00:00Z',
          attributes: { region: 'west' },
        },
      ],
    });

    const header = result.payload.split('\n')[0]!;
    expect(header).toContain('region');
    expect(header).toContain('urgent');
    expect(result.caseCount).toBe(2);
  });

  it('escapes commas and quotes in CSV fields', () => {
    const result = normaliseEventLog({
      tenantId: 't1',
      processId: 'p1',
      events: [
        {
          caseId: 'C,1',
          activity: 'submit "draft"',
          timestamp: '2026-05-01T09:00:00Z',
        },
      ],
    });
    const row = result.payload.split('\n')[1]!;
    expect(row).toContain('"C,1"');
    expect(row).toContain('"submit ""draft"""');
  });

  it('rejects events missing caseId / activity / timestamp', () => {
    expect(() =>
      normaliseEventLog({
        tenantId: 't1',
        processId: 'p1',
        events: [
          {
            caseId: '',
            activity: 'submit',
            timestamp: '2026-05-01T09:00:00Z',
          },
        ],
      }),
    ).toThrow(/caseId/);
  });

  it('rejects invalid ISO timestamps', () => {
    expect(() =>
      normaliseEventLog({
        tenantId: 't1',
        processId: 'p1',
        events: [
          {
            caseId: 'C-1',
            activity: 'submit',
            timestamp: 'tomorrow',
          },
        ],
      }),
    ).toThrow(/timestamp/);
  });
});
