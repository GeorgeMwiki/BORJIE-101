/**
 * emit-field-change.test — the redact + emit pipeline that backs
 * `useFieldCapture`. Tests the wire-event shape directly.
 */

import { describe, expect, it } from 'vitest';
import { emitFieldChange } from '../field-capture/emit-field-change.js';
import type { CaptureEvent } from '../types.js';

describe('emitFieldChange', () => {
  it('emits a field_change with plaintext for non-PII values', async () => {
    const events: CaptureEvent[] = [];
    await emitFieldChange({
      tenantId: 'tenant_1',
      sessionId: 'sess_1',
      tabId: 'tab_buyer_kyb_1',
      fieldId: 'company_name',
      value: 'Jamhuri Mining Co',
      emit: (e) => events.push(e),
    });
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev?.kind).toBe('field_change');
    if (ev?.kind === 'field_change') {
      expect(ev.tabId).toBe('tab_buyer_kyb_1');
      expect(ev.fieldId).toBe('company_name');
      expect(ev.value.valuePlaintext).toBe('Jamhuri Mining Co');
      expect(ev.value.piiKind).toBe('none');
      expect(ev.value.valueHash).toBeUndefined();
    }
  });

  it('emits a hashed value when PII is detected', async () => {
    const events: CaptureEvent[] = [];
    await emitFieldChange({
      tenantId: 'tenant_1',
      sessionId: 'sess_1',
      tabId: 'tab_buyer_kyb_1',
      fieldId: 'contact_email',
      value: 'finance@jamhuri.co.tz',
      emit: (e) => events.push(e),
      hasher: async () => 'hashed-email-xyz',
    });
    expect(events.length).toBe(1);
    const ev = events[0];
    if (ev?.kind === 'field_change') {
      expect(ev.value.piiKind).toBe('email');
      expect(ev.value.valuePlaintext).toBeUndefined();
      expect(ev.value.valueHash).toBe('hashed-email-xyz');
    }
  });

  it('emits a hashed value when fieldType signals sensitivity', async () => {
    const events: CaptureEvent[] = [];
    await emitFieldChange({
      tenantId: 'tenant_1',
      sessionId: 'sess_1',
      tabId: 'tab_login',
      fieldId: 'pw',
      fieldType: 'password',
      value: 'super-safe-password',
      emit: (e) => events.push(e),
      hasher: async () => 'h',
    });
    const ev = events[0];
    if (ev?.kind === 'field_change') {
      expect(ev.value.valuePlaintext).toBeUndefined();
      expect(ev.value.valueHash).toBe('h');
    }
  });
});
