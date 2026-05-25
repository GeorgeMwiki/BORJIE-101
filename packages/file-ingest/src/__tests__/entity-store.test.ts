/**
 * InMemoryEntityStoreService — exercise the IEntityStoreService contract
 * directly. This is the same surface area J1 will implement; tests here
 * pin the contract semantics.
 */

import { describe, expect, it } from 'vitest';

import { InMemoryEntityStoreService } from '../entity-store/InMemoryEntityStoreService.js';
import { buildProvenance } from '../provenance/hash.js';

const TENANT = 'tenant-store-test';

const baseProvenanceSeed = {
  tenant_id: TENANT,
  file_hash: 'fh',
  conversation_id: 'cv',
  message_id: 'msg',
  llm_inferred_schema_version: 'sniff-v1',
  ingest_plan_id: 'plan-1',
  timestamp: '2026-05-19T00:00:00.000Z',
};

describe('InMemoryEntityStoreService', () => {
  it('listEntityTypes returns default set with at least employee + property', async () => {
    const store = new InMemoryEntityStoreService();
    const types = await store.listEntityTypes(TENANT);
    const names = types.map((t) => t.entity_type);
    expect(names).toContain('employee');
    expect(names).toContain('property');
    expect(names).toContain('lead');
  });

  it('getEntityType returns null for unknown types', async () => {
    const store = new InMemoryEntityStoreService();
    expect(await store.getEntityType(TENANT, 'unknown-type')).toBeNull();
  });

  it('upsertEntity creates new entity and reports created=true', async () => {
    const store = new InMemoryEntityStoreService();
    const result = await store.upsertEntity(TENANT, {
      entity_type: 'employee',
      entity_id: 'emp-1',
      attributes: [
        {
          attribute_key: 'full_name',
          value: 'Asha Mwangi',
          provenance: buildProvenance({ ...baseProvenanceSeed, row_idx: 0 }),
        },
      ],
    });
    expect(result.created).toBe(true);
    expect(result.attributes_written).toEqual(1);
    expect(result.attributes_skipped).toEqual(0);
  });

  it('second upsert with same provenance hash is a no-op', async () => {
    const store = new InMemoryEntityStoreService();
    const prov = buildProvenance({ ...baseProvenanceSeed, row_idx: 5 });
    const attrs = [
      {
        attribute_key: 'full_name',
        value: 'Asha',
        provenance: prov,
      },
    ];

    await store.upsertEntity(TENANT, {
      entity_type: 'employee',
      entity_id: 'emp-1',
      attributes: attrs,
    });
    const second = await store.upsertEntity(TENANT, {
      entity_type: 'employee',
      entity_id: 'emp-1',
      attributes: attrs,
    });
    expect(second.created).toBe(false);
    expect(second.attributes_written).toEqual(0);
    expect(second.attributes_skipped).toEqual(1);
  });

  it('throws on unknown entity_type', async () => {
    const store = new InMemoryEntityStoreService();
    await expect(
      store.upsertEntity(TENANT, {
        entity_type: 'mystery',
        entity_id: 'x',
        attributes: [],
      })
    ).rejects.toThrow(/Unknown entity_type/);
  });

  it('upsertEntitiesBatch preserves per-entity atomicity', async () => {
    const store = new InMemoryEntityStoreService();
    const results = await store.upsertEntitiesBatch(TENANT, [
      {
        entity_type: 'employee',
        entity_id: 'a',
        attributes: [
          {
            attribute_key: 'full_name',
            value: 'A',
            provenance: buildProvenance({ ...baseProvenanceSeed, row_idx: 0 }),
          },
        ],
      },
      {
        entity_type: 'employee',
        entity_id: 'b',
        attributes: [
          {
            attribute_key: 'full_name',
            value: 'B',
            provenance: buildProvenance({ ...baseProvenanceSeed, row_idx: 1 }),
          },
        ],
      },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.created)).toBe(true);
    expect(store.count(TENANT, 'employee')).toEqual(2);
  });

  it('inspect helper returns the stored attribute map for a known entity', async () => {
    const store = new InMemoryEntityStoreService();
    await store.upsertEntity(TENANT, {
      entity_type: 'employee',
      entity_id: 'emp-z',
      attributes: [
        {
          attribute_key: 'full_name',
          value: 'Zuhura',
          provenance: buildProvenance({ ...baseProvenanceSeed, row_idx: 11 }),
        },
      ],
    });
    const inspected = store.inspect(TENANT, 'employee', 'emp-z');
    expect(inspected).not.toBeNull();
    expect(inspected!.attributes.get('full_name')?.value).toEqual('Zuhura');
  });

  it('custom entity-type registry replaces the default set', async () => {
    const store = new InMemoryEntityStoreService({
      entityTypes: [
        {
          entity_type: 'custom_one',
          label: 'Custom one',
          attribute_keys: ['x', 'y'],
        },
      ],
    });
    const types = await store.listEntityTypes(TENANT);
    expect(types).toHaveLength(1);
    expect(types[0]?.entity_type).toEqual('custom_one');
  });
});
