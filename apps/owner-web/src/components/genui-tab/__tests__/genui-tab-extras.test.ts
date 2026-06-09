/**
 * genui-tab-extras tests — the K1a overlay reader.
 *
 * The strict `PortalTab` schema drops the keys that make a tab ACT (widget
 * `binding`, tab `record` flag, widget `actions`); this module reads them off
 * the UN-stripped tab JSON. These tests lock the generative contract: ANY
 * generated tab's overlay is read by key with zero per-tab branching, and a
 * malformed overlay degrades to "no extras" (inert preview) instead of
 * throwing.
 */

import { describe, it, expect } from 'vitest';

import {
  readGenuiTabExtras,
  widgetExtrasFor,
} from '../genui-tab-extras';

function rawTab(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tab_x',
    record: { enabled: true },
    sections: [
      {
        key: 'main',
        widgets: [
          {
            key: 'roster',
            kind: 'table',
            binding: { kind: 'query', ref: 'hr.payroll.records', params: { limit: 10 } },
            actions: [
              { id: 'run', label: 'Run payroll', verb: 'run_payroll', params: { month: '2026-06' } },
            ],
          },
          {
            key: 'plain',
            kind: 'kpi_card',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('readGenuiTabExtras', () => {
  it('reads the record flag, widget binding, and actions by key', () => {
    const extras = readGenuiTabExtras(rawTab());
    expect(extras.recordEnabled).toBe(true);

    const roster = widgetExtrasFor(extras, 'roster');
    expect(roster.binding).toEqual({
      kind: 'query',
      ref: 'hr.payroll.records',
      params: { limit: 10 },
    });
    expect(roster.actions).toHaveLength(1);
    expect(roster.actions[0]).toMatchObject({ verb: 'run_payroll', id: 'run' });
  });

  it('returns empty extras for a widget with no binding or actions', () => {
    const extras = readGenuiTabExtras(rawTab());
    const plain = widgetExtrasFor(extras, 'plain');
    expect(plain.binding).toBeNull();
    expect(plain.actions).toEqual([]);
  });

  it('treats a missing record flag as not-enabled', () => {
    const extras = readGenuiTabExtras(rawTab({ record: undefined }));
    expect(extras.recordEnabled).toBe(false);
  });

  it('drops a malformed binding but keeps valid actions (degrade-safe)', () => {
    const raw = rawTab({
      sections: [
        {
          key: 'main',
          widgets: [
            {
              key: 'roster',
              kind: 'table',
              binding: { kind: 'not_a_kind', ref: '' },
              actions: [{ id: 'a', verb: 'do_thing' }],
            },
          ],
        },
      ],
    });
    const extras = readGenuiTabExtras(raw);
    const roster = widgetExtrasFor(extras, 'roster');
    expect(roster.binding).toBeNull();
    expect(roster.actions).toHaveLength(1);
  });

  it('returns empty extras for null / malformed raw input', () => {
    expect(readGenuiTabExtras(null).recordEnabled).toBe(false);
    expect(readGenuiTabExtras(undefined).widgets.size).toBe(0);
    expect(readGenuiTabExtras({ sections: 'nope' } as never).widgets.size).toBe(0);
  });
});
