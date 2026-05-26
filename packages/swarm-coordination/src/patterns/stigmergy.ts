/**
 * Stigmergy coordination pattern.
 *
 * Wave 18HH. Loose, low-traffic coordination via the shared
 * environment. Agents leave signals (`pheromones`) without directly
 * addressing any peer. Other agents pick up signals later when they
 * touch the same environment.
 *
 * Borjie's pheromone substrate is `cognitive_memory_cells` (Wave
 * 18AA): a memory cell with `kind = 'pattern'` and a populated
 * `reinforced_by_specialisations` list IS a stigmergic signal.
 *
 * This package does NOT depend on `@borjie/cognitive-memory` (avoids
 * a cycle); instead it exposes a port the persona-runtime composition
 * root wires to the cognitive-memory observe/reinforce calls.
 */

import type { AgentSubject } from '../types.js';

export interface PheromoneDepositInput {
  readonly tenantId: string;
  readonly depositorAgentId: string;
  readonly subject: AgentSubject;
  readonly signalKind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PheromoneReadInput {
  readonly tenantId: string;
  readonly readerAgentId: string;
  readonly subject: AgentSubject;
}

export interface PheromoneSignal {
  readonly depositorAgentId: string;
  readonly subject: AgentSubject;
  readonly signalKind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly strength: number;
}

/**
 * The port the cognitive-memory layer implements. The
 * persona-runtime composition root wires the actual observe/recall
 * calls; this package only declares the contract.
 */
export interface StigmergyPort {
  deposit(input: PheromoneDepositInput): Promise<void>;
  read(
    input: PheromoneReadInput,
  ): Promise<ReadonlyArray<PheromoneSignal>>;
}

/**
 * Convenience wrapper — no behaviour, but makes the pattern explicit
 * in caller code. The actual coordination happens entirely through
 * the cognitive-memory substrate that backs the `StigmergyPort`.
 */
export function createStigmergyCoordinator(port: StigmergyPort): {
  leaveSignal(input: PheromoneDepositInput): Promise<void>;
  observeSignals(
    input: PheromoneReadInput,
  ): Promise<ReadonlyArray<PheromoneSignal>>;
} {
  return {
    leaveSignal(input) {
      return port.deposit(input);
    },
    observeSignals(input) {
      return port.read(input);
    },
  };
}
