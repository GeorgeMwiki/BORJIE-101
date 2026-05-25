// Puppeteer sub-service: health/readyz/metrics smoke tests.
//
// We never launch a real Chromium during tests — the browser factory
// is stubbed to a tiny object that responds to `newPage()` / `close()`.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildPuppeteerApp } from '../puppeteer-server.js';

function buildStubBrowser({ throwOnNewPage = false } = {}) {
  const closeSpy = vi.fn(async () => undefined);
  const newPage = vi.fn(async () => {
    if (throwOnNewPage) throw new Error('chromium crashed');
    return { close: closeSpy };
  });
  return {
    connected: true,
    newPage,
    closeSpy,
  };
}

describe('puppeteer server: health / readyz / metrics', () => {
  it('GET /health returns 200 with ok payload', async () => {
    const browser = buildStubBrowser();
    const { app } = buildPuppeteerApp({ browserFactory: async () => browser });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'puppeteer' });
  });

  it('GET /readyz returns 200 when newPage() then close() succeed', async () => {
    const browser = buildStubBrowser();
    const { app } = buildPuppeteerApp({ browserFactory: async () => browser });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ready: true, service: 'puppeteer', connected: true });
    // The probe must actually exercise the browser, not just check a flag.
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(browser.closeSpy).toHaveBeenCalledTimes(1);
  });

  it('GET /readyz returns 503 when newPage() throws', async () => {
    const browser = buildStubBrowser({ throwOnNewPage: true });
    const { app } = buildPuppeteerApp({ browserFactory: async () => browser });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ready: false,
      service: 'puppeteer',
      reason: 'chromium crashed',
    });
  });

  it('GET /metrics emits Prometheus exposition with the puppeteer service tag', async () => {
    const browser = buildStubBrowser();
    const { app } = buildPuppeteerApp({ browserFactory: async () => browser });
    await request(app).get('/health');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('service="puppeteer"');
  });
});
