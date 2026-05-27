/**
 * Lite DataFrame — minimal immutable in-process tabular structure.
 *
 * Far less than pandas / Danfo.js by design. Supports the four
 * operations the mining-domain wrappers (and Mr. Mwikila's voice-agent)
 * actually need:
 *
 *   - select(cols)        → drop down to a subset of columns
 *   - filter(pred)        → predicate-based row filter
 *   - groupBy(col)        → Map<value, DataFrame> partitioned by col
 *   - aggregate(col, fn)  → reduce a single numeric column
 *
 * Day we need joins / windowed aggregates / arbitrary expressions, we
 * revisit DuckDB-WASM.
 */

import type { CellValue, DataFrame } from '../types.js';

function rowToRecord(
  cols: ReadonlyArray<string>,
  row: ReadonlyArray<CellValue>,
): Record<string, CellValue> {
  const r: Record<string, CellValue> = {};
  for (let i = 0; i < cols.length; i += 1) {
    r[cols[i] as string] = (row[i] as CellValue) ?? null;
  }
  return r;
}

class LiteDataFrame implements DataFrame {
  public readonly columns: ReadonlyArray<string>;
  public readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  public readonly nRows: number;
  public readonly nCols: number;

  public constructor(
    columns: ReadonlyArray<string>,
    rows: ReadonlyArray<ReadonlyArray<CellValue>>,
  ) {
    if (new Set(columns).size !== columns.length) {
      throw new Error('LiteDataFrame: column names must be unique');
    }
    for (const r of rows) {
      if (r.length !== columns.length) {
        throw new Error('LiteDataFrame: row width mismatch');
      }
    }
    this.columns = columns;
    this.rows = rows;
    this.nRows = rows.length;
    this.nCols = columns.length;
  }

  public select(cols: ReadonlyArray<string>): DataFrame {
    const indices = cols.map((c) => {
      const i = this.columns.indexOf(c);
      if (i === -1) throw new Error(`select: unknown column "${c}"`);
      return i;
    });
    const newRows: CellValue[][] = [];
    for (const row of this.rows) {
      newRows.push(indices.map((i) => (row[i] as CellValue) ?? null));
    }
    return new LiteDataFrame(cols, newRows);
  }

  public filter(
    pred: (row: Readonly<Record<string, CellValue>>) => boolean,
  ): DataFrame {
    const out: ReadonlyArray<CellValue>[] = [];
    for (const row of this.rows) {
      if (pred(rowToRecord(this.columns, row))) out.push(row);
    }
    return new LiteDataFrame(this.columns, out);
  }

  public groupBy(col: string): ReadonlyMap<CellValue, DataFrame> {
    const idx = this.columns.indexOf(col);
    if (idx === -1) throw new Error(`groupBy: unknown column "${col}"`);
    const groups = new Map<CellValue, ReadonlyArray<CellValue>[]>();
    for (const row of this.rows) {
      const key = (row[idx] as CellValue) ?? null;
      let arr = groups.get(key);
      if (arr === undefined) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push(row);
    }
    const out = new Map<CellValue, DataFrame>();
    for (const [k, v] of groups.entries()) {
      out.set(k, new LiteDataFrame(this.columns, v));
    }
    return out;
  }

  public column(col: string): ReadonlyArray<CellValue> {
    const idx = this.columns.indexOf(col);
    if (idx === -1) throw new Error(`column: unknown column "${col}"`);
    return this.rows.map((r) => (r[idx] as CellValue) ?? null);
  }

  public numericColumn(col: string): ReadonlyArray<number> {
    const raw = this.column(col);
    const out: number[] = [];
    for (const v of raw) {
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
      else if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) {
        out.push(Number(v));
      }
      // skip nulls / non-numeric
    }
    return out;
  }

  public aggregate<R>(
    col: string,
    fn: (xs: ReadonlyArray<number>) => R,
  ): R {
    return fn(this.numericColumn(col));
  }
}

export function dataFrame(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<CellValue>>,
): DataFrame {
  return new LiteDataFrame(columns, rows);
}

export function dataFrameFromRecords(
  records: ReadonlyArray<Readonly<Record<string, CellValue>>>,
): DataFrame {
  if (records.length === 0) {
    return new LiteDataFrame([], []);
  }
  const colSet = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const cols = [...colSet];
  const rows: CellValue[][] = [];
  for (const r of records) {
    const row = cols.map((c) => (r[c] ?? null) as CellValue);
    rows.push(row);
  }
  return new LiteDataFrame(cols, rows);
}
