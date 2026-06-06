/**
 * Tiny RFC-4180 CSV parser + column-mapper for the bulk staff-ingest path
 * (migration 0280). Ported from the BN org-team-csv parser (itself a LitFin
 * bulk-ingest-employees port) and retargeted real-estate → mining.
 *
 * Pure functions — no DB, no IO. The operator's file lives in memory just
 * long enough to parse. The repository (`OrgTeamRepository.bulkIngestStaff`)
 * consumes the `BulkParsedRow[]` this module produces.
 */

import type { BulkParsedRow, BulkRowOutcome } from './org-team-repository';

export const BULK_MAX_ROWS = 500;
const MAX_NAME_LEN = 200;
const MAX_ROLE_LEN = 120;
const PHONE_RE = /^\+?[0-9]{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParseCsvOptions {
  /**
   * When true, structural-but-empty rows (a physical line that contained
   * at least one delimiter, e.g. `,` → `['', '']`) are KEPT rather than
   * dropped. A genuinely blank line (no content and no delimiter) is still
   * skipped. Defaults to false (legacy "drop all wholly-empty rows").
   *
   * The bulk-staff path needs this so a CSV whose data rows are present but
   * blank-valued surfaces as ALL_REJECTED (every row rejected) instead of
   * being mistaken for a header-only EMPTY file.
   */
  readonly keepEmptyRows?: boolean;
}

/**
 * RFC-4180 parser — handles quoted fields with commas and doubled quotes.
 * Wholly-empty rows (trailing newlines) are skipped unless
 * `keepEmptyRows` keeps the structural ones (see ParseCsvOptions).
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const keepEmpty = options.keepEmptyRows ?? false;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  // A row with >1 field necessarily contained a delimiter — a structural
  // (intentional) row even when every field is blank.
  const keepRow = (r: ReadonlyArray<string>): boolean =>
    r.some((v) => v.trim().length > 0) || (keepEmpty && r.length > 1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      if (keepRow(row)) rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (keepRow(row)) rows.push(row);
  }
  return rows;
}

function findColumn(
  header: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
): number {
  for (const c of candidates) {
    const idx = header.findIndex(
      (h) => h.trim().toLowerCase() === c.toLowerCase(),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface CsvParseSuccess {
  readonly ok: true;
  readonly totalDataRows: number;
  readonly parsedRows: readonly BulkParsedRow[];
  readonly preInsertOutcomes: readonly BulkRowOutcome[];
}

export interface CsvParseFailure {
  readonly ok: false;
  readonly code:
    | 'EMPTY'
    | 'TOO_MANY_ROWS'
    | 'MISSING_REQUIRED_COLUMNS'
    | 'ALL_REJECTED';
  readonly message: string;
  readonly outcomes?: readonly BulkRowOutcome[];
  readonly totalDataRows?: number;
}

export type CsvParseResult = CsvParseSuccess | CsvParseFailure;

/**
 * Parse + validate a raw CSV string into staff rows. Required columns: name +
 * role. Optional: hire_date, whatsapp, phone, email, manager_name, notes. Bad
 * rows are collected into `preInsertOutcomes` (rejected) while the good rows
 * proceed to insert — mirroring the BN / LitFin per-row contract.
 */
export function parseStaffCsv(csvText: string): CsvParseResult {
  // Keep structural-but-empty data rows so a file that HAS data rows whose
  // values are all blank surfaces as ALL_REJECTED (every row rejected),
  // not EMPTY (which means header-only / no data rows at all).
  const rows = parseCsv(csvText, { keepEmptyRows: true });
  if (rows.length < 2) {
    return {
      ok: false,
      code: 'EMPTY',
      message: 'CSV must include a header row plus at least one data row.',
    };
  }
  const header = rows[0]!;
  const dataRows = rows.slice(1);
  if (dataRows.length > BULK_MAX_ROWS) {
    return {
      ok: false,
      code: 'TOO_MANY_ROWS',
      message: `CSV has ${dataRows.length} rows; max ${BULK_MAX_ROWS} per call. Split the file.`,
    };
  }

  const nameIdx = findColumn(header, ['name', 'full_name', 'staff_name']);
  const roleIdx = findColumn(header, ['role', 'title', 'job_title', 'position']);
  if (nameIdx === -1 || roleIdx === -1) {
    return {
      ok: false,
      code: 'MISSING_REQUIRED_COLUMNS',
      message:
        "CSV header must include 'name' (or full_name / staff_name) AND 'role' (or title / job_title).",
    };
  }
  const hireDateIdx = findColumn(header, ['hire_date', 'hired', 'start_date']);
  const whatsappIdx = findColumn(header, ['whatsapp']);
  const phoneIdx = findColumn(header, ['phone', 'mobile']);
  const emailIdx = findColumn(header, ['email']);
  const managerIdx = findColumn(header, [
    'manager_name',
    'manager',
    'reports_to',
  ]);
  const notesIdx = findColumn(header, ['notes', 'note']);

  const parsedRows: BulkParsedRow[] = [];
  const preInsertOutcomes: BulkRowOutcome[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const line = i + 2; // header is line 1
    const cols = dataRows[i]!;
    const fullName = (cols[nameIdx] ?? '').trim();
    const role = (cols[roleIdx] ?? '').trim();
    if (!fullName || !role) {
      preInsertOutcomes.push({
        line,
        status: 'rejected',
        reason: 'name or role is empty',
      });
      continue;
    }
    let hireDateIso = new Date().toISOString();
    if (hireDateIdx !== -1) {
      const raw = (cols[hireDateIdx] ?? '').trim();
      if (raw.length > 0) {
        const ts = Date.parse(raw);
        if (Number.isNaN(ts)) {
          preInsertOutcomes.push({
            line,
            status: 'rejected',
            reason: `hire_date "${raw}" is not a parseable date`,
          });
          continue;
        }
        hireDateIso = new Date(ts).toISOString();
      }
    }
    const metadata: Record<string, unknown> = {};
    if (whatsappIdx !== -1) {
      const v = (cols[whatsappIdx] ?? '').trim();
      if (v && PHONE_RE.test(v)) metadata.whatsapp = v;
    }
    if (phoneIdx !== -1) {
      const v = (cols[phoneIdx] ?? '').trim();
      if (v && PHONE_RE.test(v)) metadata.phone = v;
    }
    if (emailIdx !== -1) {
      const v = (cols[emailIdx] ?? '').trim();
      if (v && EMAIL_RE.test(v)) metadata.email = v;
    }
    if (notesIdx !== -1) {
      const v = (cols[notesIdx] ?? '').trim();
      if (v.length > 0) metadata.notes = v.slice(0, 2_000);
    }
    const managerName =
      managerIdx !== -1 ? (cols[managerIdx] ?? '').trim() || null : null;
    parsedRows.push({
      line,
      fullName: fullName.slice(0, MAX_NAME_LEN),
      role: role.slice(0, MAX_ROLE_LEN),
      hireDateIso,
      managerName,
      metadata,
    });
  }

  if (parsedRows.length === 0) {
    return {
      ok: false,
      code: 'ALL_REJECTED',
      message: 'Every data row was rejected before insert (see outcomes).',
      outcomes: preInsertOutcomes,
      totalDataRows: dataRows.length,
    };
  }

  return {
    ok: true,
    totalDataRows: dataRows.length,
    parsedRows,
    preInsertOutcomes,
  };
}
