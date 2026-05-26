import { describe, expect, it, vi } from 'vitest';
import {
  ingestExcel,
  type IngestExcelDeps,
} from '../ingest/excel-ingester.js';
import type {
  TabularParserPort,
  IngestStoragePort,
  ClockPort,
} from '../types.js';

function makeDeps(): IngestExcelDeps {
  const parser: TabularParserPort = {
    parseExcel: vi.fn(async () => ({
      columns: ['Email', 'Amount', 'Date'],
      rows: [
        ['alice@example.com', '120.50', '2025-12-01'],
        ['bob@example.com', '88', '2025-12-02'],
      ],
    })),
    parseCsv: vi.fn(async () => ({ columns: [], rows: [] })),
  };
  const storage: IngestStoragePort = {
    put: vi.fn(async () => ({ storage_key: 'tenants/t1/cognitive-ingest/s1/att1.xlsx' })),
  };
  const clock: ClockPort = {
    now: () => new Date('2026-05-26T12:00:00Z'),
  };
  return { parser, storage, clock };
}

describe('ingestExcel', () => {
  it('parses an Excel file + infers column types', async () => {
    const r = await ingestExcel(
      {
        attachment_id: 'att1',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0, 1, 2]),
        intent_keywords: ['amount', 'fx'],
      },
      makeDeps(),
    );
    expect(r.kind).toBe('excel');
    expect(r.parsed_rows_count).toBe(2);
    expect(r.parsed_columns.length).toBe(3);
    const emailCol = r.parsed_columns.find((c) => c.name === 'Email');
    expect(emailCol?.is_pii).toBe(true);
    const amountCol = r.parsed_columns.find((c) => c.name === 'Amount');
    expect(amountCol?.inferred_type === 'number' || amountCol?.inferred_type === 'integer').toBe(
      true,
    );
  });

  it('records email PII redactions per column', async () => {
    const r = await ingestExcel(
      {
        attachment_id: 'att1',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: [],
      },
      makeDeps(),
    );
    expect(r.pii_redactions.some((p) => p.pattern_kind === 'email')).toBe(true);
  });

  it('produces a DataJoinRef tagged as tabular with a 14-day retention by default', async () => {
    const r = await ingestExcel(
      {
        attachment_id: 'att1',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: [],
      },
      makeDeps(),
    );
    expect(r.inferred_data_join_ref.kind).toBe('tabular');
    expect(r.inferred_data_join_ref.tenant_id).toBe('t1');
    expect(r.inferred_data_join_ref.session_id).toBe('s1');
    const retain = new Date(r.inferred_data_join_ref.retention_until_iso);
    const now = new Date('2026-05-26T12:00:00Z');
    const days = (retain.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(days).toBe(14);
  });

  it('stamps an audit hash on the result', async () => {
    const r = await ingestExcel(
      {
        attachment_id: 'att1',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: [],
      },
      makeDeps(),
    );
    expect(r.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scores relevance against intent keywords', async () => {
    const r = await ingestExcel(
      {
        attachment_id: 'att1',
        tenant_id: 't1',
        session_id: 's1',
        bytes: new Uint8Array([0]),
        intent_keywords: ['amount', 'date'],
      },
      makeDeps(),
    );
    expect(r.relevance_to_intent).toBe(1);
  });
});
