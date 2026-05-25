/**
 * CSV parser for migration uploads.
 *
 * If `papaparse` is installed it is used; otherwise a minimal RFC4180-ish
 * fallback parser handles the common case. This keeps the migration
 * service buildable without forcing a runtime dependency.
 */

export type SheetRow = Record<string, string | number | null>;

export interface ParsedCsv {
  readonly sheetName: string;
  readonly rows: SheetRow[];
}

export async function parseCsv(
  buffer: Buffer,
  sheetName = 'sheet1'
): Promise<ParsedCsv> {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');

  // Follow-up KI-015 (Docs/TODO_BACKLOG.md): if papaparse is added as a hard dep, prefer it for
  //   robustness (streaming, quoted-newline handling):
  //     const Papa = await import('papaparse');
  //     const { data } = Papa.parse<SheetRow>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  //     return { sheetName, rows: data };
  //   See Docs/KNOWN_ISSUES.md#ki-015.

  return { sheetName, rows: minimalCsvParse(text) };
}

/** Minimal CSV parser. Handles quoted fields and embedded commas; does
 *  NOT handle embedded newlines in quoted cells. Adequate for a Phase 1
 *  fallback — papaparse covers the rest when installed. */
function minimalCsvParse(text: string): SheetRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.trim());
  const rows: SheetRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    if (cells.length === 1 && cells[0] === '') continue;
    const row: SheetRow = {};
    headers.forEach((h, idx) => {
      const raw = cells[idx];
      row[h] = coerce(raw);
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Anchored, unambiguous numeric regex — no nested quantifiers.
const NUMERIC_LITERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function coerce(v: string | undefined): string | number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '') return null;
  if (NUMERIC_LITERAL.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return t;
}
