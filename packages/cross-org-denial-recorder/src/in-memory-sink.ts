/**
 * In-memory denial sink — for tests and small deployments.
 *
 * Holds rows in a bounded ring buffer; oldest entries fall off when
 * the buffer is full. Pure, no I/O.
 */

import type { DenialRow, DenialSink } from "./types.js";

export interface InMemorySink extends DenialSink {
  rows(): ReadonlyArray<DenialRow>;
  clear(): void;
  size(): number;
}

export function createInMemorySink(maxRows = 10_000): InMemorySink {
  const buffer: DenialRow[] = [];

  return {
    async write(row: DenialRow): Promise<void> {
      buffer.push(row);
      while (buffer.length > maxRows) buffer.shift();
    },
    rows(): ReadonlyArray<DenialRow> {
      return [...buffer];
    },
    clear(): void {
      buffer.length = 0;
    },
    size(): number {
      return buffer.length;
    },
  };
}
