/**
 * Record store + generic record validator + capability registry + widget
 * binding tests (Keystone K1a).
 *
 * Proves the generative contract:
 *   - a record validated against a tab's OWN fields (required + dropdown
 *     options + number min/max) accepts a good payload and rejects a bad one,
 *   - the capability registry rejects an unknown resource / tool,
 *   - a widget `binding` with an unknown resource is rejected at parse time.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryRecordStore,
  validateRecordPayload,
  validateRecordAgainstTab,
  RecordValidationError,
} from '../persistence/index.js';
import {
  isKnownResource,
  isKnownTool,
  getResourceLabel,
} from '../capabilities/index.js';
import {
  PortalTabWidgetSchema,
  PortalTabWidgetBindingSchema,
  type PortalTab,
  type PortalTabField,
} from '../types.js';
import { buildFallbackTab } from '../generator/fallbacks.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures — a tab whose fields exercise required + options + min/max.
// ────────────────────────────────────────────────────────────────────

const FIELDS: ReadonlyArray<PortalTabField> = [
  { key: 'employee_name', label: 'Employee name', kind: 'text', required: true },
  {
    key: 'department',
    label: 'Department',
    kind: 'dropdown',
    required: true,
    options: [
      { value: 'extraction', label: 'Extraction' },
      { value: 'processing', label: 'Processing' },
    ],
  },
  {
    key: 'monthly_salary',
    label: 'Monthly salary',
    kind: 'number',
    required: true,
    min: 0,
    max: 10_000_000,
  },
  { key: 'notes', label: 'Notes', kind: 'long_text' },
  {
    key: 'system_ref',
    label: 'System ref',
    kind: 'text',
    readonly: true,
  },
];

function mkTab(overrides: Partial<PortalTab> = {}): PortalTab {
  const base = buildFallbackTab({
    intent: {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    },
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
    nowIso: '2026-06-09T12:00:00.000Z',
    id: 'tab_payroll',
    sourceConversationId: undefined,
  });
  return {
    ...base,
    record: { enabled: true },
    sections: [
      {
        key: 'payroll',
        title: 'Payroll',
        fields: [...FIELDS],
        widgets: [],
      },
    ],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// Generic record validator
// ────────────────────────────────────────────────────────────────────

describe('validateRecordPayload (generic, from PortalTabField[])', () => {
  it('accepts a good payload (required present, option member, in-range)', () => {
    const result = validateRecordPayload(FIELDS, {
      employee_name: 'Asha',
      department: 'extraction',
      monthly_salary: 1_500_000,
      notes: 'Night shift lead',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing required field', () => {
    const result = validateRecordPayload(FIELDS, {
      department: 'extraction',
      monthly_salary: 1_500_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidFieldKeys).toContain('employee_name');
    }
  });

  it('rejects a dropdown value outside the declared options', () => {
    const result = validateRecordPayload(FIELDS, {
      employee_name: 'Asha',
      department: 'NOT_A_DEPARTMENT',
      monthly_salary: 1_500_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidFieldKeys).toContain('department');
    }
  });

  it('rejects a number above the declared max', () => {
    const result = validateRecordPayload(FIELDS, {
      employee_name: 'Asha',
      department: 'extraction',
      monthly_salary: 99_999_999,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidFieldKeys).toContain('monthly_salary');
    }
  });

  it('rejects an unknown key (strict — cannot exceed the tab shape)', () => {
    const result = validateRecordPayload(FIELDS, {
      employee_name: 'Asha',
      department: 'extraction',
      monthly_salary: 1,
      smuggled: 'value',
    });
    expect(result.ok).toBe(false);
  });

  it('drops read-only fields from the writable shape', () => {
    // Providing a read-only field's value is rejected (it is not writable).
    const result = validateRecordPayload(FIELDS, {
      employee_name: 'Asha',
      department: 'extraction',
      monthly_salary: 1,
      system_ref: 'forged',
    });
    expect(result.ok).toBe(false);
  });

  it('validateRecordAgainstTab flattens sections to the field list', () => {
    const tab = mkTab();
    const result = validateRecordAgainstTab(tab, {
      employee_name: 'Asha',
      department: 'processing',
      monthly_salary: 2_000_000,
    });
    expect(result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Record store
// ────────────────────────────────────────────────────────────────────

describe('createInMemoryRecordStore', () => {
  it('saves a valid record + lists it back', async () => {
    const store = createInMemoryRecordStore();
    const tab = mkTab();
    const saved = await store.saveRecord({
      tenantId: 't1',
      tab,
      payload: {
        employee_name: 'Asha',
        department: 'extraction',
        monthly_salary: 1_500_000,
      },
      userId: 'u1',
    });
    expect(saved.id).toBeTruthy();
    expect(saved.tabKey).toBe('hr.payroll');

    const records = await store.listRecords({ tenantId: 't1', tabId: tab.id });
    expect(records.length).toBe(1);
    expect(records[0]?.payload.employee_name).toBe('Asha');
  });

  it('throws RecordValidationError on a bad payload (no insert)', async () => {
    const store = createInMemoryRecordStore();
    const tab = mkTab();
    await expect(
      store.saveRecord({
        tenantId: 't1',
        tab,
        payload: { department: 'extraction' /* missing required name+salary */ },
        userId: 'u1',
      }),
    ).rejects.toBeInstanceOf(RecordValidationError);
    const records = await store.listRecords({ tenantId: 't1', tabId: tab.id });
    expect(records.length).toBe(0);
  });

  it('isolates records by tenant on list + get', async () => {
    const store = createInMemoryRecordStore();
    const tab = mkTab();
    const saved = await store.saveRecord({
      tenantId: 't1',
      tab,
      payload: {
        employee_name: 'Asha',
        department: 'extraction',
        monthly_salary: 1,
      },
      userId: 'u1',
    });
    // Another tenant sees nothing.
    expect(
      (await store.listRecords({ tenantId: 'other', tabId: tab.id })).length,
    ).toBe(0);
    expect(
      await store.getRecord({ tenantId: 'other', recordId: saved.id }),
    ).toBeNull();
    expect(
      await store.getRecord({ tenantId: 't1', recordId: saved.id }),
    ).not.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Capability registry
// ────────────────────────────────────────────────────────────────────

describe('capability registry', () => {
  it('accepts a known resource + tool', () => {
    expect(isKnownResource('licences')).toBe(true);
    expect(isKnownResource('royalty_returns')).toBe(true);
    expect(isKnownTool('create_reminder')).toBe(true);
  });

  it('rejects an unknown resource + tool', () => {
    expect(isKnownResource('drop_all_tables')).toBe(false);
    expect(isKnownTool('post_to_ledger')).toBe(false);
  });

  it('exposes a human label for a known resource', () => {
    expect(getResourceLabel('licences')).toBe('Mining licences');
    expect(getResourceLabel('unknown')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Widget binding — parse-time registry validation
// ────────────────────────────────────────────────────────────────────

describe('PortalTabWidgetBindingSchema', () => {
  it('accepts a query binding to a known resource', () => {
    const result = PortalTabWidgetBindingSchema.safeParse({
      kind: 'query',
      resource: 'licences',
      filters: { status: 'overdue' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a query binding to an unknown resource', () => {
    const result = PortalTabWidgetBindingSchema.safeParse({
      kind: 'query',
      resource: 'secret_admin_table',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tool binding to a known tool', () => {
    const result = PortalTabWidgetBindingSchema.safeParse({
      kind: 'tool',
      toolId: 'create_reminder',
      args: { dueInDays: 7 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a tool binding to an unknown tool', () => {
    const result = PortalTabWidgetBindingSchema.safeParse({
      kind: 'tool',
      toolId: 'rm_minus_rf',
    });
    expect(result.success).toBe(false);
  });

  it('a widget with a bound query parses cleanly', () => {
    const result = PortalTabWidgetSchema.safeParse({
      key: 'w1',
      kind: 'table',
      title: 'Overdue licences',
      config: null,
      binding: { kind: 'query', resource: 'licences' },
    });
    expect(result.success).toBe(true);
  });

  it('a widget with a bound UNKNOWN resource is rejected', () => {
    const result = PortalTabWidgetSchema.safeParse({
      key: 'w1',
      kind: 'table',
      title: 'x',
      config: null,
      binding: { kind: 'query', resource: 'nope' },
    });
    expect(result.success).toBe(false);
  });
});
