/**
 * `synth_outputs` repository.
 *
 * In-memory implementation. Insert returns the persisted row with
 * `auditHash` set; consumers should never construct an output row
 * outside this repository.
 *
 * Frozen on insert.
 */

import { randomUUID } from 'node:crypto';
import type { SynthOutput, SynthOutputRepository } from '../types.js';
import { computeSynthAuditHash } from '../audit/audit-chain-link.js';

export interface InMemorySynthOutputRepoDeps {
  readonly now: () => Date;
}

export function createInMemorySynthOutputRepository(
  deps: InMemorySynthOutputRepoDeps = { now: () => new Date() },
): SynthOutputRepository {
  const rows = new Map<string, SynthOutput>();

  return {
    async insert(input) {
      const id = randomUUID();
      const emittedAt = deps.now();
      const auditHash = computeSynthAuditHash({
        op: 'emit',
        synthRunId: input.synthRunId,
        tenantId: input.tenantId,
        outputLength: input.output.length,
        citationCount: input.citations.length,
        calibratedConfidence: input.calibratedConfidence,
        disagreementCount: input.disagreements.length,
        emittedAt: emittedAt.toISOString(),
      });
      const row: SynthOutput = Object.freeze({
        id,
        synthRunId: input.synthRunId,
        tenantId: input.tenantId,
        output: input.output,
        citations: Object.freeze([...input.citations]),
        calibratedConfidence: input.calibratedConfidence,
        disagreements: Object.freeze([...input.disagreements]),
        auditHash,
        emittedAt,
      });
      rows.set(id, row);
      return row;
    },

    async findByRun(tenantId, synthRunId) {
      const matches: SynthOutput[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.synthRunId === synthRunId) {
          matches.push(row);
        }
      }
      matches.sort((a, b) => a.emittedAt.getTime() - b.emittedAt.getTime());
      return matches;
    },
  };
}
