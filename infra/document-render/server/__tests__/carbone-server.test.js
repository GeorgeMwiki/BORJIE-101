// Carbone sub-service: health/readyz/metrics smoke tests.
//
// We import `buildCarboneApp` with `skipCarboneInit: true` so the test
// doesn't pull in carbone's runtime. The readiness state is driven via
// the injected `readyState` object instead.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildCarboneApp } from '../carbone-server.js';

describe('carbone server: health / readyz / metrics', () => {
  it('GET /health returns 200 with ok payload', async () => {
    const { app } = buildCarboneApp({
      skipCarboneInit: true,
      readyState: { ready: true },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'carbone' });
  });

  it('GET /readyz returns 200 when carbone init succeeded', async () => {
    const { app } = buildCarboneApp({
      skipCarboneInit: true,
      readyState: { ready: true },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ready: true, service: 'carbone' });
  });

  it('GET /readyz returns 503 when carbone init failed', async () => {
    const { app } = buildCarboneApp({
      skipCarboneInit: true,
      readyState: { ready: false, reason: 'carbone.set failed: boom' },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ready: false,
      service: 'carbone',
      reason: 'carbone.set failed: boom',
    });
  });

  it('GET /metrics returns Prometheus exposition with http metrics', async () => {
    const { app } = buildCarboneApp({
      skipCarboneInit: true,
      readyState: { ready: true },
    });
    // Touch /health first so the http_requests_total counter has at
    // least one sample to expose.
    await request(app).get('/health');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_requests_total');
    // Default labels carry the per-service tag so multi-service
    // dashboards can group correctly.
    expect(res.text).toContain('service="carbone"');
  });
});
