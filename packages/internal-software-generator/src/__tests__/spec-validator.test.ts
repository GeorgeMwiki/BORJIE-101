import { describe, it, expect } from 'vitest';
import { validateToolSpec } from '../spec/spec-validator.js';

const validRaw = {
  form: {
    title: 'Scan worker shifts for missed safety steps',
    fields: [
      {
        name: 'scope',
        label: 'Scope',
        kind: 'text',
        required: true,
      },
      {
        name: 'window_days',
        label: 'Lookback (days)',
        kind: 'number',
        required: true,
      },
    ],
  },
  handler: {
    handlerId: 'auto.report.scan_safety',
    readsFields: ['scope', 'window_days'],
    readsSources: ['worker_shifts', 'safety_events'],
    writesSources: [],
  },
  archetype: 'table',
  auditHook: {
    enabled: true,
    redactFields: [],
  },
};

describe('spec-validator', () => {
  it('accepts a well-formed spec and returns a frozen ToolSpec', () => {
    const result = validateToolSpec(validRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.archetype).toBe('table');
      expect(result.spec.form.fields).toHaveLength(2);
      expect(result.spec.handler.readsSources).toContain('worker_shifts');
    }
  });

  it('rejects duplicate field names', () => {
    const bad = {
      ...validRaw,
      form: {
        title: 'x',
        fields: [
          { name: 'scope', label: 'a', kind: 'text', required: true },
          { name: 'scope', label: 'b', kind: 'text', required: false },
        ],
      },
    };
    const result = validateToolSpec(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toContain('duplicate field names');
    }
  });

  it('rejects select fields without options[]', () => {
    const bad = {
      ...validRaw,
      form: {
        title: 'x',
        fields: [
          {
            name: 'category',
            label: 'Cat',
            kind: 'select',
            required: true,
          },
        ],
      },
      handler: {
        ...validRaw.handler,
        readsFields: ['category'],
      },
    };
    const result = validateToolSpec(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toContain('select fields must declare options');
    }
  });

  it('rejects writesSources non-empty when audit hook is disabled', () => {
    const bad = {
      ...validRaw,
      handler: {
        ...validRaw.handler,
        writesSources: ['outbox'],
      },
      auditHook: { enabled: false, redactFields: [] },
    };
    const result = validateToolSpec(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toContain(
        'auditHook.enabled: must be true when handler.writesSources is non-empty',
      );
    }
  });

  it('rejects readsFields references that don\'t match a real field', () => {
    const bad = {
      ...validRaw,
      handler: {
        ...validRaw.handler,
        readsFields: ['nonexistent_field'],
      },
    };
    const result = validateToolSpec(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toContain('unknown form field');
    }
  });
});
