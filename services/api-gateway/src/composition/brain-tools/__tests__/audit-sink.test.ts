/**
 * Tests for the persona-tool audit sink (G-D closure).
 *
 * Verifies:
 *   1. The Pino-backed sink emits exactly one `tool.persona_audit`
 *      event per `append()` call with every documented field.
 *   2. The in-memory sink collects entries for downstream assertions.
 *   3. Multiple appends accumulate in arrival order (so a tester can
 *      verify denied → ok → denied sequences).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createPinoAuditSink,
  createInMemoryAuditSink,
} from '../audit-sink';
import type { PersonaToolAuditEntry } from '../types';

const sampleEntry: PersonaToolAuditEntry = Object.freeze({
  toolId: 'mining.cockpit.daily-brief',
  tenantId: 'tn_audit_test',
  actorId: 'usr_audit_test',
  personaSlug: 'T1_owner_strategist',
  stakes: 'LOW',
  inputDigest: 'sha-djb2:deadbeef',
  outcome: 'ok',
  occurredAt: '2026-05-29T15:00:00.000Z',
});

describe('createPinoAuditSink', () => {
  it('emits one info log per append with the canonical event name', async () => {
    const logger = { info: vi.fn() };
    const sink = createPinoAuditSink(logger);
    await sink.append(sampleEntry);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [ctx, msg] = logger.info.mock.calls[0]!;
    expect(msg).toBe('persona-tool audit');
    const fields = ctx as Record<string, unknown>;
    expect(fields.event).toBe('tool.persona_audit');
    expect(fields.toolId).toBe('mining.cockpit.daily-brief');
    expect(fields.tenantId).toBe('tn_audit_test');
    expect(fields.actorId).toBe('usr_audit_test');
    expect(fields.personaSlug).toBe('T1_owner_strategist');
    expect(fields.stakes).toBe('LOW');
    expect(fields.inputDigest).toBe('sha-djb2:deadbeef');
    expect(fields.outcome).toBe('ok');
    expect(fields.occurredAt).toBe('2026-05-29T15:00:00.000Z');
  });

  it('emits a structured log for each of denied / ok / error outcomes', async () => {
    const logger = { info: vi.fn() };
    const sink = createPinoAuditSink(logger);
    await sink.append({ ...sampleEntry, outcome: 'denied' });
    await sink.append({ ...sampleEntry, outcome: 'ok' });
    await sink.append({ ...sampleEntry, outcome: 'error' });

    expect(logger.info).toHaveBeenCalledTimes(3);
    const outcomes = logger.info.mock.calls.map(
      (args: unknown[]) => (args[0] as { outcome?: string }).outcome,
    );
    expect(outcomes).toEqual(['denied', 'ok', 'error']);
  });
});

describe('createInMemoryAuditSink', () => {
  it('exposes appended entries via the entries getter in arrival order', async () => {
    const sink = createInMemoryAuditSink();
    expect(sink.entries).toHaveLength(0);

    await sink.append({ ...sampleEntry, toolId: 'first.tool' });
    await sink.append({ ...sampleEntry, toolId: 'second.tool', outcome: 'denied' });
    await sink.append({ ...sampleEntry, toolId: 'third.tool', outcome: 'error' });

    expect(sink.entries).toHaveLength(3);
    expect(sink.entries[0]?.toolId).toBe('first.tool');
    expect(sink.entries[1]?.toolId).toBe('second.tool');
    expect(sink.entries[1]?.outcome).toBe('denied');
    expect(sink.entries[2]?.outcome).toBe('error');
  });
});
