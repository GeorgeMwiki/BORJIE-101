/**
 * In-memory transport pair — for tests and for wiring a client + server in
 * the same process (e.g. embedding our own domain server inside a node
 * process without serialising over a pipe).
 *
 * `createInMemoryTransportPair()` returns two ports that are linked:
 * a frame `send`-ed on one port is `onMessage`-fired on the other.
 */

import {
  type MCPMessage,
  type TransportPort,
  MCPClosedError,
} from '../types.js';

interface MemoryPortInternals {
  readonly messageHandlers: Set<(m: MCPMessage) => void>;
  readonly errorHandlers: Set<(e: Error) => void>;
  readonly closeHandlers: Set<() => void>;
  open: boolean;
}

function createPort(
  self: MemoryPortInternals,
  peer: MemoryPortInternals,
): TransportPort {
  return {
    get isOpen() {
      return self.open;
    },
    async send(message: MCPMessage): Promise<void> {
      if (!self.open) throw new MCPClosedError();
      // Deliver asynchronously so tests can `await` send + then assert
      // ordering. Use microtask (queueMicrotask) so timers aren't required.
      queueMicrotask(() => {
        if (!peer.open) return;
        for (const h of peer.messageHandlers) h(message);
      });
    },
    onMessage(handler) {
      self.messageHandlers.add(handler);
      return () => self.messageHandlers.delete(handler);
    },
    onError(handler) {
      self.errorHandlers.add(handler);
      return () => self.errorHandlers.delete(handler);
    },
    onClose(handler) {
      self.closeHandlers.add(handler);
      return () => self.closeHandlers.delete(handler);
    },
    async close(): Promise<void> {
      if (!self.open) return;
      self.open = false;
      for (const h of self.closeHandlers) h();
      // Cascade close to peer so request/response flows don't hang.
      if (peer.open) {
        peer.open = false;
        for (const h of peer.closeHandlers) h();
      }
    },
  };
}

export interface InMemoryTransportPair {
  readonly client: TransportPort;
  readonly server: TransportPort;
}

export function createInMemoryTransportPair(): InMemoryTransportPair {
  const a: MemoryPortInternals = {
    messageHandlers: new Set(),
    errorHandlers: new Set(),
    closeHandlers: new Set(),
    open: true,
  };
  const b: MemoryPortInternals = {
    messageHandlers: new Set(),
    errorHandlers: new Set(),
    closeHandlers: new Set(),
    open: true,
  };
  return {
    client: createPort(a, b),
    server: createPort(b, a),
  };
}
