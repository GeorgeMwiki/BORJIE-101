import { describe, it, expect } from 'vitest';
import { createObservationRecorder } from '../collection/observation-recorder.js';
import { createOutcomeResolver } from '../collection/outcome-resolver.js';
import { createInMemoryObservationRepository } from '../storage/observation-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import {
  CalibrationMonitorError,
  type CalibrationWriteContext,
} from '../types.js';

const fixedNow = (): Date => new Date('2026-05-26T10:00:00Z');
const ctx: CalibrationWriteContext = {
  tenant_id: 't1',
  now: fixedNow,
};

describe('observation-recorder', () => {
  it('writes a row and stamps an audit hash', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });

    const row = await record(ctx, {
      prediction_kind: 'mining_licence_renewal',
      entity_id: 'lic-7',
      predicted_confidence: 0.83,
      predicted_label: 'approve',
    });

    expect(row.tenant_id).toBe('t1');
    expect(row.predicted_confidence).toBe(0.83);
    expect(row.outcome_value).toBeNull();
    expect(row.audit_hash).toMatch(/^cm-chain-/);
    expect(audit.history().length).toBe(1);
  });

  it('rejects predicted_confidence > 1', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });
    await expect(
      record(ctx, {
        prediction_kind: 'k',
        entity_id: 'e',
        predicted_confidence: 1.2,
        predicted_label: 'l',
      }),
    ).rejects.toBeInstanceOf(CalibrationMonitorError);
  });

  it('rejects duplicate observations for the same triple', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });

    await record(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      predicted_confidence: 0.5,
      predicted_label: 'l',
    });
    await expect(
      record(ctx, {
        prediction_kind: 'k',
        entity_id: 'e',
        predicted_confidence: 0.6,
        predicted_label: 'l',
      }),
    ).rejects.toBeInstanceOf(CalibrationMonitorError);
  });

  it('requires a tenant_id', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });
    await expect(
      record(
        { tenant_id: '', now: fixedNow },
        {
          prediction_kind: 'k',
          entity_id: 'e',
          predicted_confidence: 0.5,
          predicted_label: 'l',
        },
      ),
    ).rejects.toBeInstanceOf(CalibrationMonitorError);
  });
});

describe('outcome-resolver', () => {
  it('resolves an existing observation and stamps audit', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });
    const resolve = createOutcomeResolver({ repo, audit });

    await record(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      predicted_confidence: 0.7,
      predicted_label: 'approve',
    });
    const resolved = await resolve(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      outcome_label: 'approved',
      outcome_value: 1,
    });
    expect(resolved.outcome_value).toBe(1);
    expect(resolved.resolved_at).not.toBeNull();
    expect(audit.history().length).toBe(2);
  });

  it('is idempotent on identical re-resolution', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });
    const resolve = createOutcomeResolver({ repo, audit });

    await record(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      predicted_confidence: 0.7,
      predicted_label: 'approve',
    });
    await resolve(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      outcome_label: 'ok',
      outcome_value: 1,
    });
    // Identical second call → no error; same outcome retained.
    const second = await resolve(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      outcome_label: 'ok',
      outcome_value: 1,
    });
    expect(second.outcome_value).toBe(1);
  });

  it('raises RESOLUTION_CONFLICT on conflicting re-resolution', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const record = createObservationRecorder({ repo, audit });
    const resolve = createOutcomeResolver({ repo, audit });

    await record(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      predicted_confidence: 0.7,
      predicted_label: 'approve',
    });
    await resolve(ctx, {
      prediction_kind: 'k',
      entity_id: 'e',
      outcome_label: 'ok',
      outcome_value: 1,
    });
    await expect(
      resolve(ctx, {
        prediction_kind: 'k',
        entity_id: 'e',
        outcome_label: 'rejected',
        outcome_value: 0,
      }),
    ).rejects.toBeInstanceOf(CalibrationMonitorError);
  });

  it('raises OBSERVATION_NOT_FOUND when resolving an unknown triple', async () => {
    const repo = createInMemoryObservationRepository();
    const audit = createInMemoryAuditChain();
    const resolve = createOutcomeResolver({ repo, audit });
    await expect(
      resolve(ctx, {
        prediction_kind: 'k',
        entity_id: 'e',
        outcome_label: 'ok',
        outcome_value: 1,
      }),
    ).rejects.toBeInstanceOf(CalibrationMonitorError);
  });
});
