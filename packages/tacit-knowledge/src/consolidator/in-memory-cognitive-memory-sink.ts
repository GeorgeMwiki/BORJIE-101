/**
 * In-memory `CognitiveMemorySink` reference adapter.
 *
 * Wave HARVEST. The package's tests use this in place of a live
 * `@borjie/cognitive-memory` wiring. Records every `observe` /
 * `reinforce` call against a deterministic id sequence so tests can
 * assert what was written.
 */

import type {
  CognitiveMemoryObserveInput,
  CognitiveMemoryReinforceInput,
  CognitiveMemorySink,
} from '../types.js';

export interface InMemoryCognitiveMemorySink extends CognitiveMemorySink {
  readonly observeCalls: ReadonlyArray<CognitiveMemoryObserveInput>;
  readonly reinforceCalls: ReadonlyArray<CognitiveMemoryReinforceInput>;
  /** Test helper — reset the call log. */
  reset(): void;
}

interface SinkOptions {
  /** Deterministic cellId generator for tests. */
  readonly nextId: () => string;
}

function defaultNextId(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `cell-${n.toString().padStart(4, '0')}`;
  };
}

export function createInMemoryCognitiveMemorySink(
  options: Partial<SinkOptions> = {},
): InMemoryCognitiveMemorySink {
  const observeCalls: CognitiveMemoryObserveInput[] = [];
  const reinforceCalls: CognitiveMemoryReinforceInput[] = [];
  const nextId = options.nextId ?? defaultNextId();

  return {
    get observeCalls() {
      return Object.freeze([...observeCalls]);
    },
    get reinforceCalls() {
      return Object.freeze([...reinforceCalls]);
    },

    reset() {
      observeCalls.length = 0;
      reinforceCalls.length = 0;
    },

    async observe(input: CognitiveMemoryObserveInput) {
      observeCalls.push(input);
      return { cellId: nextId() };
    },

    async reinforce(input: CognitiveMemoryReinforceInput) {
      reinforceCalls.push(input);
      return { cellId: input.cellId };
    },
  };
}
