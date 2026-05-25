/**
 * Delta capture — compute the field-level diff between a "before"
 * snapshot and the "after" snapshot the worker proposes.
 *
 * The diff is intentionally shallow over the top-level keys. For nested
 * structural changes (polygon GeoJSON, document attachments), the
 * `ProposedChange.snapshot` field carries the whole replacement document
 * and the committer prefers that over the field-by-field merge.
 *
 * Design rationale:
 *   - shallow diff keeps the audit dump readable.
 *   - structural changes don't pretend to be cell-level edits — they
 *     ship as a snapshot.
 */

import type { FieldDiff } from '../types.js';

export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ReadonlyArray<FieldDiff> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldDiff[] = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (!deepEqual(b, a)) {
      out.push(Object.freeze({ path: key, before: b, after: a }));
    }
  }
  return Object.freeze(out);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
