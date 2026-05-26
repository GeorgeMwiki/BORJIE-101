/**
 * Lineage tracker tests — OpenLineage-compatible events + downgrade check.
 */

import { describe, expect, it } from 'vitest';

import {
  detectDowngrade,
  emit,
  type LineageDataset,
} from '../lineage/provenance-tracker.js';

const piiInput: LineageDataset = Object.freeze({
  uri: 'pg://t1/users',
  rowCount: 10,
  classes: ['pii'],
});

const publicOutput: LineageDataset = Object.freeze({
  uri: 's3://reports/users.json',
  rowCount: 10,
  classes: ['public'],
});

const internalOutput: LineageDataset = Object.freeze({
  uri: 'pg://t1/users_internal',
  rowCount: 10,
  classes: ['internal'],
});

describe('lineage/provenance-tracker', () => {
  it('emits an event with a deterministic lineageHash', () => {
    const a = emit({
      runId: 'r1',
      job: 'consolidator',
      producer: 'consolidator-worker',
      inputs: [piiInput],
      outputs: [internalOutput],
    });
    const b = emit({
      runId: 'r1',
      job: 'consolidator',
      producer: 'consolidator-worker',
      inputs: [piiInput],
      outputs: [internalOutput],
    });
    expect(a.lineageHash).toBe(b.lineageHash);
    expect(a.lineageHash).toHaveLength(64);
  });

  it('detectDowngrade flags pii → public flow', () => {
    const event = emit({
      runId: 'r2',
      job: 'leaky-job',
      producer: 'p',
      inputs: [piiInput],
      outputs: [publicOutput],
    });
    expect(detectDowngrade(event)).toBe(true);
  });

  it('detectDowngrade allows pii → pii', () => {
    const event = emit({
      runId: 'r3',
      job: 'within-class-job',
      producer: 'p',
      inputs: [piiInput],
      outputs: [{ uri: 's3://x', rowCount: 10, classes: ['pii'] }],
    });
    expect(detectDowngrade(event)).toBe(false);
  });

  it('carries the consentStateAtRead and ZKP proof slot', () => {
    const event = emit({
      runId: 'r4',
      job: 'zk-attestation',
      producer: 'p',
      inputs: [piiInput],
      outputs: [internalOutput],
      consentStateAtRead: 'granted',
      proof: 'zk:0xdeadbeef',
    });
    expect(event.consentStateAtRead).toBe('granted');
    expect(event.proof).toBe('zk:0xdeadbeef');
  });
});
