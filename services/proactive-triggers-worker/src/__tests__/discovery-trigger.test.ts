/**
 * Discovery-trigger — fail-safe-to-skip + happy-path proof.
 *
 * The headline guarantees this proves:
 *   - default-OFF: with the flag unset the trigger is a clean no-op,
 *   - degrade-graceful: when the sidecar is null OR `health()` rejects,
 *     the trigger SKIPS and NEVER throws (the tick continues),
 *   - happy path: with the flag on + a recurring mapped anomaly + a
 *     healthy sidecar + a data pointer, exactly one discovery card is
 *     published through the injected publisher.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnomalyEvent, Recommendation } from '@borjie/proactive-intel';
import type { LLMClient, SidecarClient } from '@borjie/scientific-discovery';
import {
  runDiscoveryTrigger,
  isDiscoveryEnabled,
  DISCOVERY_ENABLED_ENV,
  type DiscoveryTriggerWiring,
} from '../discovery/discovery-trigger.js';
import { mapAnomalyKindToDiscoveryArea } from '../discovery/area-map.js';
import type { RecommendationPublisher } from '../schedule/intel-tick.js';

const NOW = '2026-06-09T00:00:00.000Z';

function anomaly(kind: AnomalyEvent['kind']): AnomalyEvent {
  return {
    type: 'anomaly',
    kind,
    id: `${kind}-1`,
    tenantId: 'tenant-a',
    scope: 'tenant',
    detectedAt: NOW,
    confidence: { label: 'high', score: 0.9 },
    severity: 'P1',
    headline: `${kind} fired`,
    evidence: {},
  };
}

// LLM that returns a valid DAG JSON for the proposer and short text for
// the agents — enough to drive a full runDiscovery round deterministically.
const STUB_LLM: LLMClient = {
  complete: async (req) => {
    if (req.system?.includes('causal DAG')) {
      return {
        text: JSON.stringify({
          nodes: ['royalty_rate', 'collection_rate_pct', 'season'],
          edges: [{ from: 'royalty_rate', to: 'collection_rate_pct' }],
          candidateEdges: [],
        }),
      };
    }
    return { text: 'A' };
  },
};

function healthySidecar(): SidecarClient {
  return {
    refute: async () => ({
      scores: { placebo: 0.8, bootstrap: 0.8, unobservedConfounder: 0.8 },
      diagnostics: 'ok',
    }),
    pcmciplus: async () => {
      throw new Error('not used');
    },
    health: async () => ({ ok: true, version: 'test' }),
  };
}

function makeWiring(over: Partial<DiscoveryTriggerWiring> = {}): {
  wiring: DiscoveryTriggerWiring;
  published: Recommendation[];
} {
  const published: Recommendation[] = [];
  const publisher: RecommendationPublisher = {
    publish: (_t, rec) => {
      published.push(rec);
    },
  };
  const wiring: DiscoveryTriggerWiring = {
    llm: STUB_LLM,
    sidecar: healthySidecar(),
    recurrence: { isRecurring: () => true },
    dataRef: { build: () => 'rows://[]' },
    publisher,
    ...over,
  };
  return { wiring, published };
}

const original = process.env[DISCOVERY_ENABLED_ENV];
afterEach(() => {
  if (original === undefined) delete process.env[DISCOVERY_ENABLED_ENV];
  else process.env[DISCOVERY_ENABLED_ENV] = original;
});

describe('isDiscoveryEnabled', () => {
  it('defaults OFF when the flag is unset', () => {
    delete process.env[DISCOVERY_ENABLED_ENV];
    expect(isDiscoveryEnabled()).toBe(false);
  });
  it('is ON only for truthy values', () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    expect(isDiscoveryEnabled()).toBe(true);
    process.env[DISCOVERY_ENABLED_ENV] = '0';
    expect(isDiscoveryEnabled()).toBe(false);
  });
});

describe('mapAnomalyKindToDiscoveryArea', () => {
  it('maps the documented kinds', () => {
    expect(mapAnomalyKindToDiscoveryArea('cashflow-dip')).toBe('pricing');
    expect(mapAnomalyKindToDiscoveryArea('cost-anomaly')).toBe('pricing');
    expect(mapAnomalyKindToDiscoveryArea('royalty-arrears-spike')).toBe(
      'outstanding_royalties',
    );
    expect(mapAnomalyKindToDiscoveryArea('churn-risk')).toBe('churn');
    expect(mapAnomalyKindToDiscoveryArea('vendor-reliability-drop')).toBe('maintenance');
  });
  it('returns undefined for unmapped kinds', () => {
    expect(mapAnomalyKindToDiscoveryArea('slo-breach')).toBeUndefined();
    expect(mapAnomalyKindToDiscoveryArea('compliance-deadline-near')).toBeUndefined();
  });
});

describe('runDiscoveryTrigger — fail-safe', () => {
  beforeEach(() => {
    delete process.env[DISCOVERY_ENABLED_ENV];
  });

  it('is a no-op when the flag is OFF', async () => {
    const { wiring, published } = makeWiring();
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('disabled');
    expect(published).toHaveLength(0);
  });

  it('SKIPS without throwing when the sidecar is null (URL unset)', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring, published } = makeWiring({ sidecar: null });
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('sidecar-unavailable');
    expect(result.published).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('SKIPS without throwing when sidecar.health() rejects', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const sidecar: SidecarClient = {
      ...healthySidecar(),
      health: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const { wiring, published } = makeWiring({ sidecar });
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('sidecar-unavailable');
    expect(published).toHaveLength(0);
  });

  it('SKIPS when no anomaly maps to a recurring discovery area', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring, published } = makeWiring();
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('slo-breach')], // unmapped
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('no-recurring-area');
    expect(published).toHaveLength(0);
  });

  it('SKIPS when the anomaly is one-shot (not recurring)', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring, published } = makeWiring({
      recurrence: { isRecurring: () => false },
    });
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('no-recurring-area');
    expect(published).toHaveLength(0);
  });

  it('SKIPS when no tenant-scoped data pointer is available', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring, published } = makeWiring({ dataRef: { build: () => null } });
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    expect(result.skippedReason).toBe('no-data-ref');
    expect(published).toHaveLength(0);
  });
});

describe('runDiscoveryTrigger — happy path', () => {
  it('publishes exactly one discovery card when fully wired + enabled', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring, published } = makeWiring();
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('royalty-arrears-spike')],
      wiring,
      nowIso: NOW,
    });
    expect(result.ran).toBe(true);
    expect(result.published).toBe(1);
    expect(result.skippedReason).toBeNull();
    expect(published).toHaveLength(1);
    const rec = published[0]!;
    expect(rec.type).toBe('anomaly');
    expect(rec.kind).toBe('royalty-arrears-spike');
    expect(rec.summary).toContain('Causal discovery');
    expect(rec.id.startsWith('discovery-')).toBe(true);
  });

  it('never throws even if the publisher itself throws', async () => {
    process.env[DISCOVERY_ENABLED_ENV] = 'true';
    const { wiring } = makeWiring({
      publisher: {
        publish: () => {
          throw new Error('sink exploded');
        },
      },
    });
    const result = await runDiscoveryTrigger({
      tenantId: 'tenant-a',
      anomalies: [anomaly('churn-risk')],
      wiring,
      nowIso: NOW,
    });
    // Caught internally → reported as a skip, not a throw.
    expect(result.published).toBe(0);
  });
});
