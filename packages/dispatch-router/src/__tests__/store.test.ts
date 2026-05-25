/**
 * In-memory store tests — partitioning, filtering, ordering.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryCaptureStore,
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
} from '../store.js';
import type {
  ConversationCapture,
  ModuleUpdateProposal,
  TabEventLogEntry,
} from '../types.js';

const mkCapture = (
  overrides: Partial<ConversationCapture> = {},
): ConversationCapture => ({
  id: 'cap_1',
  tenant_id: 't1',
  thread_id: null,
  message_id: null,
  persona_id: 'p1',
  user_id: null,
  user_text: 'u',
  assistant_text: 'a',
  decision_kind: 'answer',
  entities: [],
  intent: 'request_info',
  intent_confidence: 0.9,
  capture_confidence: 0.7,
  persona_trust: 0.85,
  tenant_trust: 0.9,
  attributes: {},
  exchange_hash: 'h1',
  latency_ms: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const mkProposal = (
  overrides: Partial<ModuleUpdateProposal> = {},
): ModuleUpdateProposal => ({
  id: 'prop_1',
  tenant_id: 't1',
  capture_id: 'cap_1',
  module_template_id: 'ESTATE',
  action: 'create_lease_application',
  persona_id: 'p1',
  status: 'pending_hitl',
  confidence: 0.8,
  hitl_required: true,
  priority: 'high',
  payload: {},
  entity_refs: [],
  matrix_row_id: 'L-ROW-01',
  approver_tier: null,
  approver_user_id: null,
  decline_reason: null,
  edited_from_id: null,
  failure_reason: null,
  resolved_at: null,
  expires_at: '2026-02-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('createInMemoryCaptureStore', () => {
  it('inserts + finds by id', async () => {
    const store = createInMemoryCaptureStore();
    await store.insert(mkCapture());
    const found = await store.findById('t1', 'cap_1');
    expect(found?.id).toBe('cap_1');
  });

  it('findById returns null for unknown id', async () => {
    const store = createInMemoryCaptureStore();
    expect(await store.findById('t1', 'missing')).toBeNull();
  });

  it('findByHash matches by exchange_hash', async () => {
    const store = createInMemoryCaptureStore();
    await store.insert(mkCapture({ exchange_hash: 'abc' }));
    const found = await store.findByHash('t1', 'abc');
    expect(found?.exchange_hash).toBe('abc');
  });

  it('listByTenant filters by tenant + applies limit', async () => {
    const store = createInMemoryCaptureStore();
    await store.insert(mkCapture({ id: 'a' }));
    await store.insert(mkCapture({ id: 'b' }));
    await store.insert(mkCapture({ id: 'c', tenant_id: 't2' }));
    const t1 = await store.listByTenant('t1');
    expect(t1.length).toBe(2);
    const limited = await store.listByTenant('t1', 1);
    expect(limited.length).toBe(1);
  });
});

describe('createInMemoryProposalStore', () => {
  it('inserts + updates + finds', async () => {
    const store = createInMemoryProposalStore();
    await store.insert(mkProposal());
    const updated = await store.update('t1', 'prop_1', {
      status: 'accepted',
      approver_user_id: 'u1',
    });
    expect(updated.status).toBe('accepted');
    expect(updated.approver_user_id).toBe('u1');
  });

  it('update throws when row missing', async () => {
    const store = createInMemoryProposalStore();
    await expect(store.update('t1', 'missing', {})).rejects.toThrow();
  });

  it('listByTenant filters by status + module + persona', async () => {
    const store = createInMemoryProposalStore();
    await store.insert(mkProposal({ id: 'a', status: 'pending_hitl' }));
    await store.insert(
      mkProposal({ id: 'b', status: 'accepted', persona_id: 'p2' }),
    );
    await store.insert(
      mkProposal({
        id: 'c',
        module_template_id: 'LITFIN',
        persona_id: 'p2',
      }),
    );

    const pending = await store.listByTenant('t1', { status: 'pending_hitl' });
    expect(pending.length).toBe(2); // a + c (both default pending_hitl)
    const litfin = await store.listByTenant('t1', {
      module_template_id: 'LITFIN',
    });
    expect(litfin.length).toBe(1);
    const p2 = await store.listByTenant('t1', { persona_id: 'p2' });
    expect(p2.length).toBe(2);
  });

  it('findById null when missing', async () => {
    const store = createInMemoryProposalStore();
    expect(await store.findById('t1', 'missing')).toBeNull();
  });
});

describe('createInMemoryEventLogStore', () => {
  it('appends + lists by proposal sorted by sequence', async () => {
    const store = createInMemoryEventLogStore();
    const mk = (sequence: number): TabEventLogEntry => ({
      id: `evt_${sequence}`,
      tenant_id: 't1',
      capture_id: 'cap_1',
      proposal_id: 'prop_1',
      module_template_id: 'ESTATE',
      persona_id: 'p1',
      event_kind: 'proposal_created',
      actor: 'system',
      transport: 'api',
      snapshot: {},
      notes: null,
      sequence,
      created_at: '2026-01-01T00:00:00Z',
    });
    await store.append(mk(3));
    await store.append(mk(1));
    await store.append(mk(2));
    const list = await store.listByProposal('t1', 'prop_1');
    expect(list.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('listByTenant filters + limits', async () => {
    const store = createInMemoryEventLogStore();
    const mk = (id: string, tenant: string): TabEventLogEntry => ({
      id,
      tenant_id: tenant,
      capture_id: null,
      proposal_id: null,
      module_template_id: null,
      persona_id: 'p',
      event_kind: 'capture_emitted',
      actor: 'system',
      transport: 'chat',
      snapshot: {},
      notes: null,
      sequence: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
    await store.append(mk('a', 't1'));
    await store.append(mk('b', 't1'));
    await store.append(mk('c', 't2'));
    const t1All = await store.listByTenant('t1');
    expect(t1All.length).toBe(2);
    const t1Limited = await store.listByTenant('t1', 1);
    expect(t1Limited.length).toBe(1);
  });
});
