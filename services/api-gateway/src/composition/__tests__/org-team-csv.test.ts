/**
 * org-team-csv — pure RFC-4180 parse + staff column-mapping (migration 0280).
 *
 * No DB, no IO — exercises the parser + validator the bulk-ingest path feeds
 * into OrgTeamRepository.bulkIngestStaff.
 */
import { describe, expect, it } from 'vitest';

import { parseCsv, parseStaffCsv, BULK_MAX_ROWS } from '../org-team-csv';

describe('parseCsv (RFC-4180)', () => {
  it('parses quoted fields with embedded commas + doubled quotes', () => {
    const rows = parseCsv('a,b\n"x,y","he said ""hi"""');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });

  it('skips wholly-empty trailing rows', () => {
    const rows = parseCsv('a\nb\n\n');
    expect(rows).toEqual([['a'], ['b']]);
  });
});

describe('parseStaffCsv', () => {
  it('rejects a header-only CSV as EMPTY', () => {
    const res = parseStaffCsv('name,role');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY');
  });

  it('rejects when required columns are missing', () => {
    const res = parseStaffCsv('full_name,department\nAsha,ops');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MISSING_REQUIRED_COLUMNS');
  });

  it('parses good rows + collects rejected rows pre-insert', () => {
    const csv = [
      'name,role,hire_date,whatsapp,manager_name',
      'Asha,pit_foreman,2026-01-02,+255700000000,',
      ',geologist,,,', // empty name → rejected
      'Juma,safety_officer,not-a-date,,', // bad date → rejected
      'Neema,site_supervisor,,,Asha',
    ].join('\n');
    const res = parseStaffCsv(csv);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totalDataRows).toBe(4);
      expect(res.parsedRows).toHaveLength(2);
      expect(res.parsedRows[0]!.fullName).toBe('Asha');
      expect(res.parsedRows[0]!.metadata.whatsapp).toBe('+255700000000');
      expect(res.parsedRows[1]!.managerName).toBe('Asha');
      expect(res.preInsertOutcomes).toHaveLength(2);
      expect(res.preInsertOutcomes.every((o) => o.status === 'rejected')).toBe(
        true,
      );
    }
  });

  it('rejects a CSV over the row cap', () => {
    const lines = ['name,role'];
    for (let i = 0; i < BULK_MAX_ROWS + 1; i++) {
      lines.push(`Person${i},pit_foreman`);
    }
    const res = parseStaffCsv(lines.join('\n'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('TOO_MANY_ROWS');
  });

  it('returns ALL_REJECTED when every data row is invalid', () => {
    const res = parseStaffCsv('name,role\n,\n,');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('ALL_REJECTED');
      expect(res.outcomes).toHaveLength(2);
    }
  });
});
