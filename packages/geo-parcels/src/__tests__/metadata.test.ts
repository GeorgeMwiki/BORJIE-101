import { describe, expect, it } from 'vitest';

import { listParcelMetadata, setParcelMetadata } from '../metadata.js';
import { GeoParcelsError } from '../types.js';
import { InMemoryPort } from './in-memory-port.js';

describe('setParcelMetadata', () => {
  it('persists text metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm1',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value: 'loam',
    });
    expect((row.value_jsonb as { value: string }).value).toBe('loam');
    const list = await listParcelMetadata(port, 'p1', 't1');
    expect(list).toHaveLength(1);
  });

  it('persists number metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm2',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'gate_count',
      value_kind: 'number',
      value: 3,
    });
    expect((row.value_jsonb as { value: number }).value).toBe(3);
  });

  it('persists boolean metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm3',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'fencing',
      value_kind: 'boolean',
      value: true,
    });
    expect((row.value_jsonb as { value: boolean }).value).toBe(true);
  });

  it('persists date metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm4',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'last_survey_date',
      value_kind: 'date',
      value: '2025-12-01',
    });
    expect((row.value_jsonb as { value: string }).value).toBe('2025-12-01');
  });

  it('persists enum metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm5',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'flood_risk',
      value_kind: 'enum',
      value: { value: 'high', options: ['low', 'medium', 'high'] },
    });
    expect((row.value_jsonb as { value: string }).value).toBe('high');
  });

  it('persists jsonb metadata', async () => {
    const port = new InMemoryPort();
    const row = await setParcelMetadata(port, {
      id: 'm6',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'infra_extras',
      value_kind: 'jsonb',
      value: { water: true, electricity: 'pending' },
    });
    expect((row.value_jsonb as { water: boolean }).water).toBe(true);
  });

  it('rejects text with non-string value', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb1',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'soil_type',
        value_kind: 'text',
        value: 42,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });
  });

  it('rejects number with NaN', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb2',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'gate_count',
        value_kind: 'number',
        value: NaN,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });
  });

  it('rejects boolean with string', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb3',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'fencing',
        value_kind: 'boolean',
        value: 'true',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('rejects unparseable date', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb4',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'last_survey_date',
        value_kind: 'date',
        value: 'whenever',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });
  });

  it('rejects enum value not in options', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb5',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'flood_risk',
        value_kind: 'enum',
        value: { value: 'extreme', options: ['low', 'high'] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });
  });

  it('rejects enum without options field', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb6',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'flood_risk',
        value_kind: 'enum',
        value: { value: 'high' },
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('rejects enum where options is not all strings', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb7',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'flood_risk',
        value_kind: 'enum',
        value: { value: 'high', options: ['low', 42, 'high'] },
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('rejects jsonb with non-object value', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb8',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'something',
        value_kind: 'jsonb',
        value: 'not-an-object',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA_VALUE' });
  });

  it('rejects invalid key format', async () => {
    const port = new InMemoryPort();
    await expect(
      setParcelMetadata(port, {
        id: 'mb9',
        tenant_id: 't1',
        parcel_id: 'p1',
        key: 'Bad-Key',
        value_kind: 'text',
        value: 'x',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('overwrites on the same key (upsert)', async () => {
    const port = new InMemoryPort();
    await setParcelMetadata(port, {
      id: 'm-up-1',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value: 'loam',
    });
    await setParcelMetadata(port, {
      id: 'm-up-2',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value: 'clay',
    });
    const list = await listParcelMetadata(port, 'p1', 't1');
    expect(list).toHaveLength(1);
    expect((list[0]!.value_jsonb as { value: string }).value).toBe('clay');
  });

  it('emits an activity-log event by default', async () => {
    const port = new InMemoryPort();
    await setParcelMetadata(port, {
      id: 'm-evt',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value: 'loam',
      actor_user_id: 'u1',
    });
    const events = await port.listActivityLog('p1', 't1');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_kind).toBe('metadata_changed');
  });

  it('skips activity log when log_activity=false', async () => {
    const port = new InMemoryPort();
    await setParcelMetadata(port, {
      id: 'm-no-evt',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value: 'loam',
      log_activity: false,
    });
    const events = await port.listActivityLog('p1', 't1');
    expect(events).toHaveLength(0);
  });
});
