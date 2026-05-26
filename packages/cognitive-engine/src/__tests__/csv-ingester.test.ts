import { describe, expect, it, vi } from 'vitest';
import { ingestCsv, type IngestCsvDeps } from '../ingest/csv-ingester.js';
import type {
  TabularParserPort,
  IngestStoragePort,
  ClockPort,
} from '../types.js';

function makeDeps(): IngestCsvDeps {
  const parser: TabularParserPort = {
    parseExcel: vi.fn(),
    parseCsv: vi.fn(async () => ({
      columns: ['Site', 'Production_oz', 'Reported_at'],
      rows: [
        ['Geita-3', '12500', '2026-04-01'],
        ['Buzwagi', '9800', '2026-04-01'],
        ['North Mara', '15300', '2026-04-01'],
      ],
    })),
  };
  const storage: IngestStoragePort = {
    put: vi.fn(async () => ({ storage_key: 'tenants/t1/cognitive-ingest/s1/att2.csv' })),
  };
  const clock: ClockPort = { now: () => new Date('2026-05-26T12:00:00Z') };
  return { parser, storage, clock };
}

describe('ingestCsv', () => {
  it('returns kind=csv and 3 rows', async () => {
    const r = await ingestCsv(
      {
        attachment_id: 'att2',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: ['production'],
      },
      makeDeps(),
    );
    expect(r.kind).toBe('csv');
    expect(r.parsed_rows_count).toBe(3);
  });

  it('infers numeric column for Production_oz', async () => {
    const r = await ingestCsv(
      {
        attachment_id: 'att2',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: [],
      },
      makeDeps(),
    );
    const col = r.parsed_columns.find((c) => c.name === 'Production_oz');
    expect(col?.inferred_type === 'integer' || col?.inferred_type === 'number').toBe(
      true,
    );
  });

  it('records zero PII redactions for non-PII columns', async () => {
    const r = await ingestCsv(
      {
        attachment_id: 'att2',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: [],
      },
      makeDeps(),
    );
    expect(r.pii_redactions.length).toBe(0);
  });
});
