// Typst sub-service: health/readyz/metrics smoke tests.
//
// Tests inject the readiness state so they pass without typst
// installed on the test host (CI lacks it; only the runtime image does).

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTypstApp } from '../typst-server.js';

describe('typst server: health / readyz / metrics', () => {
  it('GET /health returns 200 with ok payload', async () => {
    const { app } = buildTypstApp({ readyState: { ready: true, version: 'typst 0.13.1' } });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'typst' });
  });

  it('GET /readyz returns 200 with version when boot probe succeeded', async () => {
    const { app } = buildTypstApp({ readyState: { ready: true, version: 'typst 0.13.1' } });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ready: true,
      service: 'typst',
      version: 'typst 0.13.1',
    });
  });

  it('GET /readyz returns 503 when typst probe failed', async () => {
    const { app } = buildTypstApp({
      readyState: { ready: false, reason: 'typst --version exit 127' },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ready: false,
      service: 'typst',
      reason: 'typst --version exit 127',
    });
  });

  it('GET /metrics emits Prometheus exposition with the typst service tag', async () => {
    const { app } = buildTypstApp({ readyState: { ready: true, version: 'x' } });
    await request(app).get('/health');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('service="typst"');
  });
});
