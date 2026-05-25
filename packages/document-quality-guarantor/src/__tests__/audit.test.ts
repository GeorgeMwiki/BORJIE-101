/**
 * Audit chain tests — append, list-by-operation, verify-tamper, replay.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryAuditChainStore, replayOperation } from '../audit/index.js';

const TENANT = 'tenant-1';

describe('audit chain', () => {
  it('appends entries with linked hashes', async () => {
    const store = createInMemoryAuditChainStore();
    const e1 = await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_attempt',
      operationId: 'op-1',
      engineId: 'tesseract',
      details: { mime: 'image/png' },
      recordedAtIso: new Date().toISOString(),
    });
    const e2 = await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_success',
      operationId: 'op-1',
      engineId: 'tesseract',
      details: { confidence: 0.92 },
      recordedAtIso: new Date().toISOString(),
    });
    expect(e1.previousChainHash).toBeNull();
    expect(e2.previousChainHash).toBe(e1.chainHash);
  });

  it('verify() reports ok on an untampered chain', async () => {
    const store = createInMemoryAuditChainStore();
    for (let i = 0; i < 5; i += 1) {
      await store.append({
        tenantId: TENANT,
        kind: 'retry_scheduled',
        operationId: `op-${i}`,
        engineId: null,
        details: { attempt: i },
        recordedAtIso: new Date().toISOString(),
      });
    }
    const verdict = await store.verify(TENANT);
    expect(verdict.ok).toBe(true);
  });

  it('listByOperation filters to one operation', async () => {
    const store = createInMemoryAuditChainStore();
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_attempt',
      operationId: 'op-A',
      engineId: 'tesseract',
      details: {},
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_attempt',
      operationId: 'op-B',
      engineId: 'paddleocr',
      details: {},
      recordedAtIso: new Date().toISOString(),
    });
    const onlyA = await store.listByOperation(TENANT, 'op-A');
    expect(onlyA.length).toBe(1);
    expect(onlyA[0]!.engineId).toBe('tesseract');
  });

  it('replayOperation reconstructs engine attempts + verdicts', async () => {
    const store = createInMemoryAuditChainStore();
    const opId = 'replay-op-1';
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_attempt',
      operationId: opId,
      engineId: 'tesseract',
      details: {},
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_failure',
      operationId: opId,
      engineId: 'tesseract',
      details: { error: 'confidence_below_threshold:0.4<0.85' },
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_attempt',
      operationId: opId,
      engineId: 'paddleocr',
      details: {},
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'intake_engine_success',
      operationId: opId,
      engineId: 'paddleocr',
      details: { confidence: 0.93 },
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'quality_gate_pass',
      operationId: opId,
      engineId: null,
      details: { gateId: 'confidenceGate', score: 0.93 },
      recordedAtIso: new Date().toISOString(),
    });
    await store.append({
      tenantId: TENANT,
      kind: 'retry_scheduled',
      operationId: opId,
      engineId: null,
      details: { attempt: 1 },
      recordedAtIso: new Date().toISOString(),
    });
    const replay = await replayOperation(store, TENANT, opId);
    expect(replay.attemptsByEngine.length).toBe(2);
    const tesseract = replay.attemptsByEngine.find((a) => a.engineId === 'tesseract')!;
    const paddle = replay.attemptsByEngine.find((a) => a.engineId === 'paddleocr')!;
    expect(tesseract.succeeded).toBe(false);
    expect(tesseract.lastFailureReason).toContain('confidence_below_threshold');
    expect(paddle.succeeded).toBe(true);
    expect(replay.gateVerdicts.length).toBe(1);
    expect(replay.gateVerdicts[0]!.passed).toBe(true);
    expect(replay.retries).toBe(1);
    expect(replay.escalated).toBe(false);
  });

  it('flags escalation in replay when escalation_dispatched present', async () => {
    const store = createInMemoryAuditChainStore();
    await store.append({
      tenantId: TENANT,
      kind: 'escalation_dispatched',
      operationId: 'op-esc',
      engineId: null,
      details: { cause: 'extraction_failed_n_times' },
      recordedAtIso: new Date().toISOString(),
    });
    const replay = await replayOperation(store, TENANT, 'op-esc');
    expect(replay.escalated).toBe(true);
  });
});
