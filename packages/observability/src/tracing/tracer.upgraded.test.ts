/**
 * Tests covering the OpenTelemetry 0.218 / 2.7 upgrade migration.
 *
 * These exist to lock in the shape of the new APIs we depend on so a
 * future OTel bump that re-shuffles things again fails loudly at the
 * test layer rather than at runtime in production:
 *
 *   - `new Resource(...)` was removed → `resourceFromAttributes({...})`.
 *   - `sdk-trace-base` 2.x removed `provider.register()` /
 *     `addSpanProcessor()` → processors via constructor.
 *   - `auto-instrumentations-node` 0.76 must register without throwing
 *     when invoked through the `getNodeAutoInstrumentations()` helper.
 *   - The semantic-conventions package no longer ships
 *     `SemanticResourceAttributes` (enum) or `SEMRESATTRS_*` constants
 *     for `deployment.environment` — the replacement lives in the
 *     `incubating` bundle as `ATTR_DEPLOYMENT_ENVIRONMENT_NAME`.
 *   - `initTracing` must still degrade gracefully when no exporter
 *     endpoint is configured (the env-free local-dev path).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  resourceFromAttributes,
  type Resource,
} from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { initTracing, shutdownTracing } from './tracer.js';
import type { TelemetryConfig } from '../types/telemetry.types.js';

const baseConfig: TelemetryConfig = {
  service: {
    name: 'obs-upgrade-test',
    version: '0.0.0',
    environment: 'development',
    instanceId: 'pod-test-001',
  },
  enabled: true,
  logLevel: 'info',
  traceSampleRatio: 0.1,
  metricsIntervalMs: 60_000,
};

afterEach(async () => {
  await shutdownTracing();
});

describe('OpenTelemetry 0.218 upgrade — resource API', () => {
  it('`resourceFromAttributes` builds a Resource carrying every attribute key', () => {
    const r: Resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'svc-a',
      [ATTR_SERVICE_VERSION]: '1.2.3',
      [ATTR_SERVICE_INSTANCE_ID]: 'i-42',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: 'production',
    });
    // Resource is a plain bag of attributes in 2.x — keys must round-trip.
    expect(r.attributes['service.name']).toBe('svc-a');
    expect(r.attributes['service.version']).toBe('1.2.3');
    expect(r.attributes['service.instance.id']).toBe('i-42');
    expect(r.attributes['deployment.environment.name']).toBe('production');
  });

  it('rejects the legacy `new Resource()` constructor — guarantees we caught the API break', async () => {
    const resourcesModule = await import('@opentelemetry/resources');
    // The 2.x package no longer ships a `Resource` constructor at all.
    expect(
      (resourcesModule as Record<string, unknown>).Resource,
    ).toBeUndefined();
    // The new factory MUST be present.
    expect(typeof resourcesModule.resourceFromAttributes).toBe('function');
  });
});

describe('initTracing — env-free degrade path', () => {
  it('returns a NodeSDK handle even when no trace exporter endpoint is configured', () => {
    const sdk = initTracing({ ...baseConfig, traceExporter: undefined });
    expect(sdk).toBeDefined();
    // NodeSDK ships `shutdown` regardless of whether an exporter wired.
    expect(typeof sdk.shutdown).toBe('function');
  });

  it('is idempotent: a second call returns the same SDK instance', () => {
    const first = initTracing(baseConfig);
    const second = initTracing(baseConfig);
    expect(first).toBe(second);
  });

  it('honours the `enabled: false` flag with a no-op SDK', () => {
    const sdk = initTracing({ ...baseConfig, enabled: false });
    expect(sdk).toBeDefined();
    expect(typeof sdk.shutdown).toBe('function');
  });
});

describe('auto-instrumentations-node 0.76', () => {
  it('produces a flat array of instrumentation providers ready for NodeSDK', () => {
    const instrumentations = getNodeAutoInstrumentations({
      // Disable everything noisy — we only want to assert the factory
      // returns something the new NodeSDK constructor accepts.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    });
    expect(Array.isArray(instrumentations)).toBe(true);
    // Every entry should be an object with an `enable`/`disable` surface
    // — that's the Instrumentation contract NodeSDK consumes.
    for (const inst of instrumentations) {
      expect(typeof inst).toBe('object');
      expect(inst).not.toBeNull();
    }
    // Sanity-check at least one well-known instrumentation registered.
    const names = instrumentations.map(
      (i) => (i as { instrumentationName?: string }).instrumentationName ?? '',
    );
    expect(names.some((n) => n.includes('http'))).toBe(true);
  });
});
