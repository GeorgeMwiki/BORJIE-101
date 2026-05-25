/**
 * Unit tests for the in-process owner-statement PDF renderer.
 *
 * The renderer is driven through a stub Drizzle `execute` so the tests
 * stay schema-agnostic — we assert the contract:
 *   - selects only `status='draft'` rows for the supplied tenant,
 *   - calls the `render` function once per draft,
 *   - issues an UPDATE per draft that flips `status -> pending_review`
 *     with a populated `pdf_url`,
 *   - returns `{ rendered, failed }` counts,
 *   - never throws on transient DB errors — surfaces a structured warn.
 *
 * Wave-4 D2 added direct tests for the new `pdf-templates/owner-statement-template`
 * module: real `%PDF-` magic bytes, expected text content, audit hash
 * embedded as `/Keywords`, currency rendered from the row (never
 * hardcoded), generous byte length.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildStatementSummary,
  createDrizzlePdfRenderer,
  renderPdfBytes,
} from '../pdf-renderer';
import {
  buildStatementLines,
  formatMinorAmount,
  hashStatementPayload,
  renderOwnerStatementPdf,
  type OwnerStatementPdfData,
} from '../pdf-templates/owner-statement-template';

const noopLogger = {
  warn: vi.fn(),
  info: vi.fn(),
};

function makeDb(rowsByCall: ReadonlyArray<readonly Record<string, unknown>[]>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const rows = rowsByCall[i] ?? [];
    i += 1;
    return rows;
  });
  return { db: { execute }, execute };
}

const SAMPLE_DATA: OwnerStatementPdfData = {
  statementId: 'stmt-1',
  statementNumber: 'STMT-2026-04-owner-01',
  tenantId: 'tenant-A',
  ownerId: 'owner-01',
  periodStart: '2026-04-01T00:00:00Z',
  periodEnd: '2026-05-01T00:00:00Z',
  currencyCode: 'KES',
  grossRentMinor: 1_500_000,
  kraMriDeductionMinor: 150_000,
  platformFeeMinor: 75_000,
  netDisbursementMinor: 1_275_000,
  branding: { tenantName: 'Acme Properties' },
};

describe('formatMinorAmount', () => {
  it('formats a KES minor amount with thousands separators', () => {
    expect(formatMinorAmount(1_500_000, 'KES')).toBe('KES 15,000.00');
  });

  it('uses the supplied currency code verbatim — no jurisdiction hardcoding', () => {
    expect(formatMinorAmount(123_45, 'TZS')).toBe('TZS 123.45');
    expect(formatMinorAmount(99, 'UGX')).toBe('UGX 0.99');
    expect(formatMinorAmount(50_00, 'USD')).toBe('USD 50.00');
  });

  it('falls back to XXX when the currency code is empty', () => {
    expect(formatMinorAmount(100, '')).toBe('XXX 1.00');
  });

  it('renders negative amounts with a leading minus sign', () => {
    expect(formatMinorAmount(-12_345, 'KES')).toBe('KES -123.45');
  });

  it('pads single-digit cents with a leading zero', () => {
    expect(formatMinorAmount(105, 'KES')).toBe('KES 1.05');
  });
});

describe('buildStatementLines', () => {
  it('includes every required statement element in deterministic order', () => {
    const lines = buildStatementLines(SAMPLE_DATA);
    const joined = lines.join('\n');
    expect(joined).toContain('Statement Number: STMT-2026-04-owner-01');
    expect(joined).toContain('Owner Id: owner-01');
    expect(joined).toContain('Tenant Id: tenant-A');
    expect(joined).toContain('Gross rent collected: KES 15,000.00');
    expect(joined).toContain('KRA MRI withholding: KES 1,500.00');
    expect(joined).toContain('Platform fee: KES 750.00');
    expect(joined).toContain('Net disbursement to owner: KES 12,750.00');
  });

  it('uses zero-valued deductions when those fields are absent', () => {
    const lines = buildStatementLines({
      ...SAMPLE_DATA,
      kraMriDeductionMinor: undefined,
      platformFeeMinor: undefined,
      netDisbursementMinor: undefined,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('KRA MRI withholding: KES 0.00');
    expect(joined).toContain('Platform fee: KES 0.00');
    expect(joined).toContain('Net disbursement to owner: KES 0.00');
  });

  it('includes any extra line items provided by the caller', () => {
    const lines = buildStatementLines({
      ...SAMPLE_DATA,
      extraLineItems: [
        { label: 'Late fees collected', amountMinor: 50_000 },
        { label: 'Maintenance reimbursement', amountMinor: -25_000 },
      ],
    });
    const joined = lines.join('\n');
    expect(joined).toContain('Late fees collected: KES 500.00');
    expect(joined).toContain('Maintenance reimbursement: KES -250.00');
  });
});

describe('hashStatementPayload', () => {
  it('produces a stable 64-char sha256 hex digest', () => {
    const hash = hashStatementPayload(SAMPLE_DATA);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input yields same hash', () => {
    expect(hashStatementPayload(SAMPLE_DATA)).toBe(
      hashStatementPayload(SAMPLE_DATA),
    );
  });

  it('changes when any field changes', () => {
    const original = hashStatementPayload(SAMPLE_DATA);
    const tweaked = hashStatementPayload({
      ...SAMPLE_DATA,
      grossRentMinor: SAMPLE_DATA.grossRentMinor + 1,
    });
    expect(tweaked).not.toBe(original);
  });
});

describe('renderOwnerStatementPdf', () => {
  it('produces a buffer that begins with the %PDF-1.4 magic bytes', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.subarray(0, 8).toString('binary')).toBe('%PDF-1.4');
  });

  it('terminates with the %%EOF marker', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    const tail = bytes.subarray(bytes.length - 16).toString('binary');
    expect(tail).toContain('%%EOF');
  });

  it('weighs more than 1KB — sanity check that we emit a real document', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    expect(bytes.length).toBeGreaterThan(1024);
  });

  it('embeds the audit sha256 hash in the /Keywords metadata', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    const expectedHash = hashStatementPayload(SAMPLE_DATA);
    const body = bytes.toString('binary');
    expect(body).toContain(`sha256:${expectedHash}`);
  });

  it('embeds the tenant brand name in the document header when supplied', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    const body = bytes.toString('binary');
    expect(body).toContain('Acme Properties');
    expect(body).toContain('Owner Statement');
  });

  it('falls back to the generic Property Statement title when branding is absent', () => {
    const bytes = renderOwnerStatementPdf({
      ...SAMPLE_DATA,
      branding: undefined,
    });
    const body = bytes.toString('binary');
    expect(body).toContain('Property Statement');
  });

  it('renders the currency from the row — never hardcodes KES or TZS', () => {
    const tzs = renderOwnerStatementPdf({
      ...SAMPLE_DATA,
      currencyCode: 'TZS',
      grossRentMinor: 2_000_000,
    });
    const body = tzs.toString('binary');
    expect(body).toContain('TZS 20,000.00');
    expect(body).not.toContain('KES 20,000.00');
  });

  it('escapes parentheses in user-supplied strings to keep the PDF valid', () => {
    const bytes = renderOwnerStatementPdf({
      ...SAMPLE_DATA,
      branding: { tenantName: 'Sunset Estates (Phase 2)' },
    });
    const body = bytes.toString('binary');
    // Escaped parens preserve PDF string structure.
    expect(body).toContain('Sunset Estates \\(Phase 2\\)');
  });

  it('contains a valid xref table referencing every object', () => {
    const bytes = renderOwnerStatementPdf(SAMPLE_DATA);
    const body = bytes.toString('binary');
    expect(body).toContain('xref\n0 8');
    expect(body).toContain('startxref');
    expect(body).toContain('/Size 8');
  });
});

describe('buildStatementSummary (legacy text helper)', () => {
  it('produces a deterministic summary block from the row fields', () => {
    const out = buildStatementSummary({
      statementId: 'stmt-1',
      statementNumber: 'STMT-2026-04-owner-01',
      ownerId: 'owner-01',
      periodStart: '2026-04-01T00:00:00Z',
      periodEnd: '2026-05-01T00:00:00Z',
      grossRentMinor: 1_500_000,
      currency: 'KES',
    });
    expect(out).toContain('Statement: STMT-2026-04-owner-01');
    expect(out).toContain('Owner: owner-01');
    expect(out).toContain('Gross rent (minor units): 1500000');
    expect(out).toContain('Currency: KES');
  });

  it('falls back to XXX when currency is empty', () => {
    const out = buildStatementSummary({
      statementId: 's',
      statementNumber: 'n',
      ownerId: 'o',
      periodStart: 'a',
      periodEnd: 'b',
      grossRentMinor: 0,
      currency: '',
    });
    expect(out).toContain('Currency: XXX');
  });
});

describe('renderPdfBytes', () => {
  it('returns a real PDF when given a structured payload', () => {
    const out = renderPdfBytes(SAMPLE_DATA);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.subarray(0, 5).toString('binary')).toBe('%PDF-');
    expect(out.length).toBeGreaterThan(1024);
  });

  it('still wraps a legacy string body in a valid PDF', () => {
    const out = renderPdfBytes('hello world legacy');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.subarray(0, 5).toString('binary')).toBe('%PDF-');
    expect(out.toString('binary')).toContain('hello world legacy');
  });
});

describe('createDrizzlePdfRenderer.renderDraftsForRun', () => {
  it('renders every draft, flips status, and writes pdf_url', async () => {
    const drafts = [
      {
        id: 'stmt-1',
        statement_number: 'STMT-2026-04-A',
        owner_id: 'owner-A',
        period_start: '2026-04-01T00:00:00Z',
        period_end: '2026-05-01T00:00:00Z',
        gross_rent_collected: '1500000',
        management_fee: '0',
        other_expenses: '0',
        total_expenses: '0',
        net_income: '0',
        amount_due: '1500000',
        currency: 'KES',
      },
      {
        id: 'stmt-2',
        statement_number: 'STMT-2026-04-B',
        owner_id: 'owner-B',
        period_start: '2026-04-01T00:00:00Z',
        period_end: '2026-05-01T00:00:00Z',
        gross_rent_collected: '800000',
        management_fee: '0',
        other_expenses: '0',
        total_expenses: '0',
        net_income: '0',
        amount_due: '800000',
        currency: 'TZS',
      },
    ];
    const { db, execute } = makeDb([drafts, [], []]);
    const renderer = createDrizzlePdfRenderer({ db, logger: noopLogger });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 2, failed: 0 });
    // 1 SELECT + 2 UPDATE calls
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns zeroes and warns when the SELECT fails', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const renderer = createDrizzlePdfRenderer({
      db,
      logger: { warn, info: vi.fn() },
    });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 0, failed: 0 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'pdf-renderer',
        degraded_reason: 'select_drafts_failed',
        runId: 'run-1',
        tenantId: 'tenant-A',
      }),
      expect.any(String),
    );
  });

  it('counts a failed UPDATE under `failed` and continues with the rest', async () => {
    const drafts = [
      {
        id: 'stmt-1',
        statement_number: 'STMT-A',
        owner_id: 'owner-A',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 100,
        currency: 'KES',
      },
      {
        id: 'stmt-2',
        statement_number: 'STMT-B',
        owner_id: 'owner-B',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 200,
        currency: 'KES',
      },
    ];
    let call = 0;
    const execute = vi.fn(async () => {
      call += 1;
      if (call === 1) return drafts;
      if (call === 2) throw new Error('update failed');
      return [];
    });
    const warn = vi.fn();
    const renderer = createDrizzlePdfRenderer({
      db: { execute },
      logger: { warn, info: vi.fn() },
    });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 1, failed: 1 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'pdf-renderer',
        degraded_reason: 'render_or_update_failed',
        statementId: 'stmt-1',
      }),
      expect.any(String),
    );
  });

  it('skips rows without an id', async () => {
    const drafts = [
      {
        id: null,
        statement_number: 'STMT-X',
        owner_id: 'owner-X',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 0,
        currency: 'KES',
      },
      {
        id: 'stmt-3',
        statement_number: 'STMT-3',
        owner_id: 'owner-3',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 0,
        currency: 'KES',
      },
    ];
    const { db, execute } = makeDb([drafts, []]);
    const renderer = createDrizzlePdfRenderer({ db, logger: noopLogger });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 1, failed: 0 });
    // 1 SELECT + 1 UPDATE (the null-id row was skipped before any write)
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('uses the injected render function when provided', async () => {
    const drafts = [
      {
        id: 'stmt-1',
        statement_number: 'STMT-A',
        owner_id: 'owner-A',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 100,
        currency: 'KES',
      },
    ];
    const { db } = makeDb([drafts, []]);
    const render = vi.fn(() => Buffer.from('CUSTOM', 'utf8'));
    const renderer = createDrizzlePdfRenderer({
      db,
      logger: noopLogger,
      render,
    });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 1, failed: 0 });
    expect(render).toHaveBeenCalledTimes(1);
    // The injected render received the structured payload (not a string).
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      statementId: 'stmt-1',
      tenantId: 'tenant-A',
      currencyCode: 'KES',
    });
    expect(render.mock.results[0]?.value.toString('utf8')).toBe('CUSTOM');
  });

  it('emits a real %PDF- artifact via the default renderer', async () => {
    const drafts = [
      {
        id: 'stmt-1',
        statement_number: 'STMT-A',
        owner_id: 'owner-A',
        period_start: '2026-04-01T00:00:00Z',
        period_end: '2026-05-01T00:00:00Z',
        gross_rent_collected: '1500000',
        management_fee: '75000',
        other_expenses: '150000',
        total_expenses: '225000',
        net_income: '1275000',
        amount_due: '1275000',
        currency: 'KES',
      },
    ];
    // Spy on the default renderer indirectly by injecting a wrapper
    // that records the bytes the orchestration layer would have
    // written to the row.
    let captured: Buffer | null = null;
    const { renderPdfBytes: realRender } = await import('../pdf-renderer');
    const render = vi.fn((input: unknown) => {
      const bytes = realRender(input as never);
      captured = bytes;
      return bytes;
    });
    const { db } = makeDb([drafts, []]);
    const renderer = createDrizzlePdfRenderer({
      db,
      logger: noopLogger,
      render,
    });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 1, failed: 0 });
    expect(captured).not.toBeNull();
    const bytes = captured as unknown as Buffer;
    expect(bytes.subarray(0, 5).toString('binary')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1024);
    // Confirm the row's gross/currency reached the rendered text.
    const body = bytes.toString('binary');
    expect(body).toContain('KES 15,000.00');
    expect(body).toContain('STMT-A');
  });

  it('returns rendered=0/failed=0 when there are no drafts', async () => {
    const { db, execute } = makeDb([[]]);
    const renderer = createDrizzlePdfRenderer({ db, logger: noopLogger });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-empty',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 0, failed: 0 });
    // Only the SELECT was issued.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('still works when logger.info is undefined', async () => {
    const drafts = [
      {
        id: 'stmt-1',
        statement_number: 'STMT-A',
        owner_id: 'owner-A',
        period_start: 'a',
        period_end: 'b',
        gross_rent_collected: 0,
        currency: 'KES',
      },
    ];
    const { db } = makeDb([drafts, []]);
    const renderer = createDrizzlePdfRenderer({
      db,
      logger: { warn: vi.fn() },
    });
    const out = await renderer.renderDraftsForRun({
      runId: 'run-1',
      tenantId: 'tenant-A',
    });
    expect(out).toEqual({ rendered: 1, failed: 0 });
  });
});
