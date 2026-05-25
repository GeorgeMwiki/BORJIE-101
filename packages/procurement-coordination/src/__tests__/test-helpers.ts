/**
 * Test helpers — deterministic clock + id factory so assertions are
 * stable. Every test should construct its own store via
 * `createInMemoryStore()` so suites stay isolated.
 */

import {
  createInMemoryStore,
  inMemoryDataPort,
  type InMemoryStore,
  createProcurementCoordination,
  type ProcurementCoordination,
  type ProcurementDataPort,
} from '../index.js';

export function createDeterministicIdFactory(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `t${n.toString().padStart(4, '0')}`;
  };
}

export function createFrozenClock(iso: string = '2026-05-01T00:00:00.000Z') {
  let now = new Date(iso);
  return {
    now: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    set(iso2: string) {
      now = new Date(iso2);
    },
  };
}

export interface TestHarness {
  readonly store: InMemoryStore;
  readonly dataPort: ProcurementDataPort;
  readonly platform: ProcurementCoordination;
  readonly clock: ReturnType<typeof createFrozenClock>;
}

export function createTestHarness(): TestHarness {
  const store = createInMemoryStore();
  const dataPort = inMemoryDataPort(store);
  const clock = createFrozenClock();
  const idFactory = createDeterministicIdFactory();
  const platform = createProcurementCoordination({
    dataPort,
    clock,
    idFactory,
  });
  return { store, dataPort, platform, clock };
}
