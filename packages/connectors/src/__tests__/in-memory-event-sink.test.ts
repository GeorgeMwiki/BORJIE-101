/**
 * Unit tests for createInMemoryEventSink — append-only buffer used in
 * tests + local dev. Verifies frozen-snapshot semantics and that
 * production callers cannot mutate internal state.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import type { ConnectorEvent } from '../base-connector.js';

function event(kind: ConnectorEvent['kind'], path?: string): ConnectorEvent {
  return path !== undefined
    ? { connectorId: 'c', kind, path, at: '2026-01-01T00:00:00Z' }
    : { connectorId: 'c', kind, at: '2026-01-01T00:00:00Z' };
}

describe('createInMemoryEventSink — basics', () => {
  it('starts empty', () => {
    const sink = createInMemoryEventSink();
    expect(sink.events()).toEqual([]);
    expect(sink.events()).toHaveLength(0);
  });

  it('records a single emitted event', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request', '/x'));

    expect(sink.events()).toHaveLength(1);
    expect(sink.events()[0]).toMatchObject({ kind: 'request', path: '/x' });
  });

  it('preserves emission order across many events', () => {
    const sink = createInMemoryEventSink();
    const kinds: ConnectorEvent['kind'][] = [
      'request',
      'response',
      'error',
      'rate-limited',
      'circuit-opened',
    ];

    for (const k of kinds) sink.emit(event(k));

    expect(sink.events().map((e) => e.kind)).toEqual(kinds);
  });
});

describe('createInMemoryEventSink — immutability of snapshots', () => {
  it('events() returns a frozen snapshot', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));

    const snap = sink.events();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('mutating a snapshot throws and does not affect the buffer', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));

    const snap = sink.events();
    expect(() => {
      (snap as ConnectorEvent[]).push(event('response'));
    }).toThrow();

    expect(sink.events()).toHaveLength(1);
  });

  it('subsequent events() calls reflect new emissions', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));
    const before = sink.events();

    sink.emit(event('response'));
    const after = sink.events();

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe('createInMemoryEventSink — clear()', () => {
  it('empties the buffer', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));
    sink.emit(event('response'));

    sink.clear();
    expect(sink.events()).toEqual([]);
  });

  it('does not affect previously taken snapshots', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));
    const snap = sink.events();

    sink.clear();

    expect(snap).toHaveLength(1);
    expect(sink.events()).toHaveLength(0);
  });

  it('allows new emissions after clear', () => {
    const sink = createInMemoryEventSink();
    sink.emit(event('request'));
    sink.clear();
    sink.emit(event('response'));

    expect(sink.events().map((e) => e.kind)).toEqual(['response']);
  });
});

describe('createInMemoryEventSink — independence', () => {
  it('two sinks have independent buffers', () => {
    const a = createInMemoryEventSink();
    const b = createInMemoryEventSink();

    a.emit(event('request'));
    b.emit(event('response'));

    expect(a.events().map((e) => e.kind)).toEqual(['request']);
    expect(b.events().map((e) => e.kind)).toEqual(['response']);
  });
});
