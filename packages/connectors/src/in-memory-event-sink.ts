/**
 * In-memory event sink — deterministic, append-only. Useful for tests and
 * local dev. Production wires a real sink (NATS, Kafka, OpenTelemetry).
 */

import type { ConnectorEvent, ConnectorEventSink } from './base-connector.js';

export interface InMemoryEventSink extends ConnectorEventSink {
  events(): readonly ConnectorEvent[];
  clear(): void;
}

export function createInMemoryEventSink(): InMemoryEventSink {
  // Mutable inside the closure; the public surface only exposes a frozen
  // snapshot via `events()`, preserving immutability for callers.
  const buffer: ConnectorEvent[] = [];

  return {
    emit(event: ConnectorEvent): void {
      buffer.push(event);
    },
    events(): readonly ConnectorEvent[] {
      return Object.freeze(buffer.slice());
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}
