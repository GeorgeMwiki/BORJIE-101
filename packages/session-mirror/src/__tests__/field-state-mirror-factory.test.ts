/**
 * field-state-mirror-factory tests — server-side snapshot reader
 * contract: read / snapshot / waitForChange.
 *
 * The factory is dependency-injected with a row store; the tests use
 * an in-memory store so the Drizzle layer is not pulled into the
 * package's test surface.
 */

import { describe, expect, it } from 'vitest';
import { createFieldStateMirror } from '../snapshot-reader/field-state-mirror-factory.js';
import type {
  FieldStateRow,
  FieldStateRowStore,
} from '../snapshot-reader/field-state-mirror-factory.js';
import type { FieldValue } from '../types.js';

function makeRow(args: {
  readonly tabId: string;
  readonly fieldId: string;
  readonly plaintext: string;
  readonly capturedAt: string;
}): FieldStateRow {
  const value: FieldValue = {
    tabId: args.tabId,
    fieldId: args.fieldId,
    capturedAt: args.capturedAt,
    valuePlaintext: args.plaintext,
    piiKind: 'none',
  };
  return {
    tabId: args.tabId,
    fieldId: args.fieldId,
    capturedAt: args.capturedAt,
    value,
  };
}

function makeStore(rows: ReadonlyArray<FieldStateRow>): FieldStateRowStore {
  return {
    latestForSession: async () =>
      [...rows].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)),
    latestForField: async (_sessionId, tabId, fieldId) => {
      const matches = rows.filter(
        (r) => r.tabId === tabId && r.fieldId === fieldId,
      );
      if (matches.length === 0) return null;
      return matches.reduce((acc, r) =>
        r.capturedAt > acc.capturedAt ? r : acc,
      );
    },
    waitForNext: async ({ tabId, fieldId, sinceIso }) => {
      const next = rows.find(
        (r) =>
          r.tabId === tabId &&
          r.fieldId === fieldId &&
          r.capturedAt > sinceIso,
      );
      return next ?? null;
    },
  };
}

describe('createFieldStateMirror', () => {
  it('returns the latest value for a tab/field', async () => {
    const mirror = createFieldStateMirror({
      sessionId: 'sess_1',
      store: makeStore([
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'Jam',
          capturedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'Jamhuri',
          capturedAt: '2026-01-01T00:00:10.000Z',
        }),
      ]),
    });
    const result = await mirror.read('tab_1', 'company_name');
    expect(result?.valuePlaintext).toBe('Jamhuri');
  });

  it('returns null when no row exists', async () => {
    const mirror = createFieldStateMirror({
      sessionId: 'sess_1',
      store: makeStore([]),
    });
    expect(await mirror.read('tab_x', 'field_y')).toBeNull();
  });

  it('snapshot returns newest-wins per (tabId, fieldId)', async () => {
    const mirror = createFieldStateMirror({
      sessionId: 'sess_1',
      store: makeStore([
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'Old',
          capturedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'New',
          capturedAt: '2026-01-01T00:00:30.000Z',
        }),
        makeRow({
          tabId: 'tab_2',
          fieldId: 'tonnage',
          plaintext: '8.5',
          capturedAt: '2026-01-01T00:00:20.000Z',
        }),
      ]),
    });
    const snap = await mirror.snapshot();
    expect(snap.size).toBe(2);
    expect(snap.get('tab_1::company_name')?.valuePlaintext).toBe('New');
    expect(snap.get('tab_2::tonnage')?.valuePlaintext).toBe('8.5');
  });

  it('waitForChange uses the injected clock', async () => {
    const mirror = createFieldStateMirror({
      sessionId: 'sess_1',
      now: () => '2026-01-01T00:00:00.000Z',
      store: makeStore([
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'before',
          capturedAt: '2025-12-31T23:59:00.000Z',
        }),
        makeRow({
          tabId: 'tab_1',
          fieldId: 'company_name',
          plaintext: 'after',
          capturedAt: '2026-01-01T00:01:00.000Z',
        }),
      ]),
    });
    const next = await mirror.waitForChange('tab_1', 'company_name', 5_000);
    expect(next?.valuePlaintext).toBe('after');
  });
});
