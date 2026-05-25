import { describe, expect, it } from 'vitest';
import { projectEvent, projectEvents } from '../projector.js';
import type { CurrentEdgeLookupPort, OutboxEvent } from '../index.js';

const NEVER_LOOKUP: CurrentEdgeLookupPort = {
  async findCurrentEdgeId() {
    return null;
  },
};

const TENANT = 'ten_trc';
const NOW = new Date('2026-05-22T06:00:00.000Z');

function event(type: string, payload: Record<string, unknown>): OutboxEvent {
  return { type, tenantId: TENANT, payload, occurredAt: NOW };
}

describe('projectEvent', () => {
  it('emits a leased_to edge from lease.activated', async () => {
    const result = await projectEvent(
      event('lease.activated', {
        lease_id: 'lease_1',
        unit_entity_id: 'ent_unit_4b',
        person_entity_id: 'ent_person_juma',
        start_date: '2026-05-01',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts).toHaveLength(1);
    expect(result.updates).toHaveLength(0);
    const insert = result.inserts[0]!;
    expect(insert.edgeType).toBe('leased_to');
    expect(insert.srcEntityId).toBe('ent_unit_4b');
    expect(insert.dstEntityId).toBe('ent_person_juma');
    expect(insert.tenantId).toBe(TENANT);
    expect(insert.evidenceRefs).toContain('lease:lease_1');
  });

  it('closes the prior leased_to edge on lease.terminated', async () => {
    const result = await projectEvent(
      event('lease.terminated', {
        lease_id: 'lease_1',
        unit_entity_id: 'ent_unit_4b',
        person_entity_id: 'ent_person_juma',
        end_date: '2026-06-01',
      }),
      {
        async findCurrentEdgeId() {
          return 'edge_42';
        },
      },
    );
    expect(result.inserts).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.id).toBe('edge_42');
    expect(result.updates[0]!.validTo).toBeInstanceOf(Date);
  });

  it('drops lease.terminated when no prior edge exists', async () => {
    const result = await projectEvent(
      event('lease.terminated', {
        lease_id: 'lease_1',
        unit_entity_id: 'ent_unit_4b',
        person_entity_id: 'ent_person_juma',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });

  it('emits paid_by from lease.payment.posted', async () => {
    const result = await projectEvent(
      event('lease.payment.posted', {
        lease_id: 'lease_1',
        lease_entity_id: 'ent_lease_1',
        person_entity_id: 'ent_person_juma',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('paid_by');
    expect(result.inserts[0]!.srcEntityId).toBe('ent_lease_1');
  });

  it('emits managed_by from unit.assigned_manager', async () => {
    const result = await projectEvent(
      event('unit.assigned_manager', {
        unit_entity_id: 'ent_unit_4b',
        manager_entity_id: 'ent_person_manager',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('managed_by');
  });

  it('emits reports_to from org.parent_assigned', async () => {
    const result = await projectEvent(
      event('org.parent_assigned', {
        child_entity_id: 'ent_person_b',
        parent_entity_id: 'ent_person_a',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('reports_to');
    expect(result.inserts[0]!.srcEntityId).toBe('ent_person_b');
    expect(result.inserts[0]!.dstEntityId).toBe('ent_person_a');
  });

  it('emits subdivides from subdivision.created', async () => {
    const result = await projectEvent(
      event('subdivision.created', {
        parent_entity_id: 'ent_building_1',
        child_entity_id: 'ent_unit_1a',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('subdivides');
  });

  it('emits invoiced_for from invoice.created', async () => {
    const result = await projectEvent(
      event('invoice.created', {
        invoice_entity_id: 'ent_inv_1',
        lease_entity_id: 'ent_lease_1',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('invoiced_for');
  });

  it('emits inspected_by from inspection.completed', async () => {
    const result = await projectEvent(
      event('inspection.completed', {
        asset_entity_id: 'ent_vehicle_1',
        inspector_entity_id: 'ent_person_insp',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.edgeType).toBe('inspected_by');
  });

  it('ignores unknown event types', async () => {
    const result = await projectEvent(
      event('something.unrelated', { foo: 'bar' }),
      NEVER_LOOKUP,
    );
    expect(result.inserts).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });

  it('drops events with malformed payloads', async () => {
    const result = await projectEvent(
      event('lease.activated', { lease_id: 'l_1' /* missing fields */ }),
      NEVER_LOOKUP,
    );
    expect(result.inserts).toHaveLength(0);
  });

  it('projectEvents concatenates results', async () => {
    const result = await projectEvents(
      [
        event('lease.activated', {
          lease_id: 'l_1',
          unit_entity_id: 'u_1',
          person_entity_id: 'p_1',
        }),
        event('lease.activated', {
          lease_id: 'l_2',
          unit_entity_id: 'u_2',
          person_entity_id: 'p_2',
        }),
      ],
      NEVER_LOOKUP,
    );
    expect(result.inserts).toHaveLength(2);
  });

  it('preserves tenant_id on every insert', async () => {
    const result = await projectEvent(
      event('lease.activated', {
        lease_id: 'l_1',
        unit_entity_id: 'u_1',
        person_entity_id: 'p_1',
      }),
      NEVER_LOOKUP,
    );
    expect(result.inserts[0]!.tenantId).toBe(TENANT);
  });
});
