/**
 * Build a correlation matrix across a set of named columns.
 * Defers to the per-pair function: pearson / spearman / kendall.
 */

import type { CorrelationMatrix } from '../types.js';
import { pearson } from './pearson.js';
import { spearman } from './spearman.js';
import { kendall } from './kendall.js';

export interface NamedColumn {
  readonly name: string;
  readonly values: ReadonlyArray<number>;
}

export function correlationMatrix(
  columns: ReadonlyArray<NamedColumn>,
  method: 'pearson' | 'spearman' | 'kendall' = 'pearson',
): CorrelationMatrix {
  if (columns.length < 1) {
    throw new Error('correlationMatrix: need ≥ 1 column');
  }
  const n = columns.length;
  const len = (columns[0] as NamedColumn).values.length;
  for (const col of columns) {
    if (col.values.length !== len) {
      throw new Error('correlationMatrix: columns must have equal length');
    }
  }
  const fn = method === 'pearson' ? pearson : method === 'spearman' ? spearman : kendall;
  const values: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < n; j += 1) {
      if (i === j) {
        row.push(1);
      } else {
        row.push(
          fn(
            (columns[i] as NamedColumn).values,
            (columns[j] as NamedColumn).values,
          ),
        );
      }
    }
    values.push(row);
  }
  return {
    method,
    columns: columns.map((c) => c.name),
    values,
    n: len,
  };
}
