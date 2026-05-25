/**
 * Unit tests for the OTel bootstrap.
 *
 * The SDK side-effects are intentionally light here — we don't spin up
 * a real OTLP collector. We assert the handle shape, env-driven
 * disable, sample-rate parsing, and shutdown idempotency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootstrapOTel, __resetOtelForTests, getOtelHandle } from '../otel-bootstrap';

describe('bootstrapOTel', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    __resetOtelForTests();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_SAMPLE_RATE;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(async () => {
    const h = getOtelHandle();
    if (h) {
      await h.shutdown();
    }
    __resetOtelForTests();
    process.env = { ...savedEnv };
  });

  it('returns a no-op handle when OTEL_ENABLED=false', async () => {
    process.env.OTEL_ENABLED = 'false';
    const handle = bootstrapOTel();
    expect(handle.enabled).toBe(false);
    expect(handle.sdk).toBeNull();
    // shutdown is safe even on a no-op handle
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('respects the configured sample rate', () => {
    process.env.OTEL_ENABLED = 'false'; // skip SDK start, keep handle metadata
    const handle = bootstrapOTel({ sampleRate: 0.42 });
    expect(handle.sampleRate).toBeCloseTo(0.42);
  });

  it('clamps invalid env sample rates to the fallback default', () => {
    process.env.OTEL_ENABLED = 'false';
    process.env.OTEL_SAMPLE_RATE = 'banana';
    const handle = bootstrapOTel({ sampleRate: 0.25 });
    expect(handle.sampleRate).toBeCloseTo(0.25);
  });

  it('reads sample rate from env when valid', () => {
    process.env.OTEL_ENABLED = 'false';
    process.env.OTEL_SAMPLE_RATE = '0.7';
    const handle = bootstrapOTel({ sampleRate: 0.1 });
    expect(handle.sampleRate).toBeCloseTo(0.7);
  });

  it('records the configured OTLP endpoint on the handle', () => {
    process.env.OTEL_ENABLED = 'false';
    const handle = bootstrapOTel({ otlpEndpoint: 'http://otel-collector:4318' });
    expect(handle.endpoint).toBe('http://otel-collector:4318');
  });

  it('reads service name from env override when no config supplied', () => {
    process.env.OTEL_ENABLED = 'false';
    process.env.OTEL_SERVICE_NAME = 'custom-svc';
    const handle = bootstrapOTel();
    expect(handle.serviceName).toBe('custom-svc');
  });

  it('shutdown is idempotent', async () => {
    process.env.OTEL_ENABLED = 'false';
    const handle = bootstrapOTel();
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns the cached singleton on repeated bootstrap calls', () => {
    process.env.OTEL_ENABLED = 'false';
    const a = bootstrapOTel();
    const b = bootstrapOTel({ serviceName: 'second-call-name' });
    expect(b).toBe(a);
  });
});
