/**
 * provenance-tracker — emit OpenLineage-compatible events for every
 * cross-classification flow.
 *
 * The tracker is stateless: it returns the JSON payload the calling
 * service writes into `audit_events`. A downstream consolidator
 * (`@borjie/info-synthesis`) reconstructs the DAG.
 *
 * Spec §7. Citation: OpenLineage object model — https://openlineage.io
 * /docs/spec/object-model (refreshed 2025-09).
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { Classification } from '../types.js';

export interface LineageDataset {
  readonly uri: string;
  readonly rowCount: number;
  readonly classes: ReadonlyArray<Classification>;
}

export interface LineageEvent {
  readonly eventTime: string;
  readonly runId: string;
  readonly job: string;
  readonly producer: string;
  readonly inputs: ReadonlyArray<LineageDataset>;
  readonly outputs: ReadonlyArray<LineageDataset>;
  /** Recipient-consent state at read time. */
  readonly consentStateAtRead: 'granted' | 'revoked' | 'unknown';
  /** Optional ZKP placeholder — populated when zk-SNARK proof is generated. */
  readonly proof?: string;
  /** Deterministic hash over (job, runId, inputs[].uri, outputs[].uri). */
  readonly lineageHash: string;
}

function lineageHashOf(input: {
  readonly runId: string;
  readonly job: string;
  readonly producer: string;
  readonly inputs: ReadonlyArray<LineageDataset>;
  readonly outputs: ReadonlyArray<LineageDataset>;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [
          input.runId,
          input.job,
          input.producer,
          input.inputs.map((i) => `${i.uri}#${i.rowCount}`).join(','),
          input.outputs.map((o) => `${o.uri}#${o.rowCount}`).join(','),
        ].join('|'),
      ),
    ),
  );
}

export function emit(input: {
  readonly runId: string;
  readonly job: string;
  readonly producer: string;
  readonly inputs: ReadonlyArray<LineageDataset>;
  readonly outputs: ReadonlyArray<LineageDataset>;
  readonly consentStateAtRead?: LineageEvent['consentStateAtRead'];
  readonly eventTime?: Date;
  readonly proof?: string;
}): LineageEvent {
  const lineageHash = lineageHashOf({
    runId: input.runId,
    job: input.job,
    producer: input.producer,
    inputs: input.inputs,
    outputs: input.outputs,
  });
  return Object.freeze({
    eventTime: (input.eventTime ?? new Date()).toISOString(),
    runId: input.runId,
    job: input.job,
    producer: input.producer,
    inputs: Object.freeze(
      input.inputs.map((i) =>
        Object.freeze({
          uri: i.uri,
          rowCount: i.rowCount,
          classes: Object.freeze([...i.classes]),
        }),
      ),
    ),
    outputs: Object.freeze(
      input.outputs.map((o) =>
        Object.freeze({
          uri: o.uri,
          rowCount: o.rowCount,
          classes: Object.freeze([...o.classes]),
        }),
      ),
    ),
    consentStateAtRead: input.consentStateAtRead ?? 'unknown',
    ...(input.proof !== undefined ? { proof: input.proof } : {}),
    lineageHash,
  });
}

/**
 * Downgrade-check: if the strictest input class > the strictest output
 * class declared, the flow is downgrading sensitive data. Caller should
 * reject the job.
 */
export function detectDowngrade(event: LineageEvent): boolean {
  const RANK: Readonly<Record<Classification, number>> = Object.freeze({
    public: 0,
    internal: 1,
    confidential: 2,
    restricted: 3,
    financial: 4,
    pii: 5,
    phi: 6,
    critical: 7,
  });
  let maxIn = 0;
  for (const ds of event.inputs) {
    for (const c of ds.classes) {
      maxIn = Math.max(maxIn, RANK[c]);
    }
  }
  let maxOut = 0;
  for (const ds of event.outputs) {
    for (const c of ds.classes) {
      maxOut = Math.max(maxOut, RANK[c]);
    }
  }
  return maxIn > maxOut;
}
