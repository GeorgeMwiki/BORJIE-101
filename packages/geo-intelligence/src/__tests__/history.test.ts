import { describe, expect, it } from 'vitest';
import {
  createInMemoryEventStore,
  defaultReducer,
  emptyParcelSnapshot,
} from '../history/index.js';

describe('history — event store', () => {
  it('records and lists events in chronological order', () => {
    const store = createInMemoryEventStore();
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'acquired', occurredAt: '2026-01-01T00:00:00Z' });
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'photo_added', occurredAt: '2026-02-01T00:00:00Z' });
    const events = store.getHistory('p1');
    expect(events.length).toBe(2);
    expect(events[0]?.kind).toBe('acquired');
    expect(events[1]?.kind).toBe('photo_added');
  });

  it('filters by kind', () => {
    const store = createInMemoryEventStore();
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'photo_added', occurredAt: '2026-01-01T00:00:00Z' });
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'video_added', occurredAt: '2026-02-01T00:00:00Z' });
    const filtered = store.getHistory('p1', { kinds: ['video_added'] });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.kind).toBe('video_added');
  });

  it('filters by since/until window', () => {
    const store = createInMemoryEventStore();
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'photo_added', occurredAt: '2026-01-01T00:00:00Z' });
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'video_added', occurredAt: '2026-03-01T00:00:00Z' });
    const filtered = store.getHistory('p1', { since: '2026-02-01T00:00:00Z' });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.kind).toBe('video_added');
  });

  it('returns empty when parcel has no events', () => {
    const store = createInMemoryEventStore();
    expect(store.getHistory('unknown')).toEqual([]);
  });

  it('replayState reconstructs state at given timestamp', () => {
    const store = createInMemoryEventStore();
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'acquired', occurredAt: '2026-01-01T00:00:00Z' });
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'metadata_updated', payload: { key: 'value' }, occurredAt: '2026-02-01T00:00:00Z' });
    store.recordEvent({ parcelId: 'p1', tenantId: 't1', kind: 'disposed', occurredAt: '2026-03-01T00:00:00Z' });

    const earlyState = store.replayState({
      parcelId: 'p1',
      atTimestamp: '2026-01-15T00:00:00Z',
      initialState: emptyParcelSnapshot(),
      reducer: defaultReducer,
    });
    expect(earlyState.status).toBe('active');

    const midState = store.replayState({
      parcelId: 'p1',
      atTimestamp: '2026-02-15T00:00:00Z',
      initialState: emptyParcelSnapshot(),
      reducer: defaultReducer,
    });
    expect((midState.metadata as Record<string, unknown>).key).toBe('value');

    const lateState = store.replayState({
      parcelId: 'p1',
      atTimestamp: '2026-04-15T00:00:00Z',
      initialState: emptyParcelSnapshot(),
      reducer: defaultReducer,
    });
    expect(lateState.status).toBe('disposed');
  });

  it('event payload is frozen', () => {
    const store = createInMemoryEventStore();
    const event = store.recordEvent({
      parcelId: 'p1',
      tenantId: 't1',
      kind: 'metadata_updated',
      payload: { existing: 'value' },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });
});
