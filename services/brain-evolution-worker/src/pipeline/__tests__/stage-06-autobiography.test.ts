import { describe, it, expect } from 'vitest';
import { generateAutobiographyDeltas } from '../stage-06-autobiography.js';
import type { InteractionTrace } from '../../types.js';

function trace(over: Partial<InteractionTrace>): InteractionTrace {
  return {
    traceId: 't-1',
    tenantId: 'tenant-a',
    userId: 'u-1',
    personaId: 'md-default',
    threadId: 'th-1',
    capturedAt: '2026-05-24T12:00:00.000Z',
    kind: 'agent-action',
    summary: 'looked up lease',
    payload: { confidence: 0.85, topic: 'lease-lookup' },
    outcome: 'success',
    ...over,
  };
}

describe('generateAutobiographyDeltas', () => {
  it('produces no deltas for an empty trace window', () => {
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [],
    });
    expect(deltas).toEqual([]);
  });

  it('produces one delta per persona seen in the window', () => {
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [
        trace({ personaId: 'mr-mwikila' }),
        trace({ personaId: 'mr-mwikila', traceId: 't-2' }),
        trace({ personaId: 'mr-mwikila', traceId: 't-3' }),
        trace({ personaId: 'discovery-md', traceId: 't-4' }),
        trace({ personaId: 'discovery-md', traceId: 't-5' }),
        trace({ personaId: 'discovery-md', traceId: 't-6' }),
      ],
    });
    expect(deltas).toHaveLength(2);
    const personas = deltas.map((d) => d.personaId).sort();
    expect(personas).toEqual(['discovery-md', 'mr-mwikila']);
    for (const d of deltas) {
      expect(d.blockKind).toBe('core');
      expect(d.coreSubKind).toBe('persona');
      expect(d.tenantId).toBe('tenant-a');
      expect(d.actionTag).toBe('memory.persona.autobiography');
      expect(d.content.length).toBeGreaterThan(0);
    }
  });

  it('bucket-defaults traces with null personaId under default-persona', () => {
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [
        trace({ personaId: null }),
        trace({ personaId: null, traceId: 't-2' }),
        trace({ personaId: null, traceId: 't-3' }),
      ],
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.personaId).toBe('default-persona');
  });

  it('emits the same idempotencyKey for the same (tenant, persona, window)', () => {
    const args = {
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [trace({}), trace({ traceId: 't-2' }), trace({ traceId: 't-3' })],
    };
    const a = generateAutobiographyDeltas(args);
    const b = generateAutobiographyDeltas(args);
    expect(a[0]!.idempotencyKey).toBe(b[0]!.idempotencyKey);
  });

  it('different windows produce different idempotencyKeys', () => {
    const baseTraces = [trace({}), trace({ traceId: 't-2' }), trace({ traceId: 't-3' })];
    const dayA = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: baseTraces,
    });
    const dayB = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-25T00:00:00.000Z',
      windowEnd: '2026-05-26T00:00:00.000Z',
      traces: baseTraces,
    });
    expect(dayA[0]!.idempotencyKey).not.toBe(dayB[0]!.idempotencyKey);
  });

  it('clamps avgConfidence into [0,1] in the delta', () => {
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [
        trace({ payload: { confidence: 5 } }),
        trace({ traceId: 't-2', payload: { confidence: -1 } }),
        trace({ traceId: 't-3', payload: { confidence: NaN } }),
      ],
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.confidence).toBeGreaterThanOrEqual(0);
    expect(deltas[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('maps explicit refusal payload to outcome=refusal in the histogram', () => {
    // refusals appear in the narrative; we assert the narrative contains a
    // refusal count by checking the rationale text the stage produces.
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [
        trace({ payload: { refusal: true } }),
        trace({ traceId: 't-2', payload: { refusal: true } }),
        trace({ traceId: 't-3', payload: { refusal: true } }),
      ],
    });
    expect(deltas[0]!.rationale).toContain('3 refused');
  });

  it('flags payment-tagged actions as critical-stakes', () => {
    const deltas = generateAutobiographyDeltas({
      tenantId: 'tenant-a',
      windowStart: '2026-05-24T00:00:00.000Z',
      windowEnd: '2026-05-25T00:00:00.000Z',
      traces: [
        trace({ payload: { actionTag: 'payment.disburse' } }),
        trace({ traceId: 't-2', payload: { actionTag: 'payment.disburse' } }),
        trace({ traceId: 't-3', payload: { actionTag: 'payment.disburse' } }),
      ],
    });
    expect(deltas[0]!.rationale).toContain('3 critical-stakes');
  });
});
