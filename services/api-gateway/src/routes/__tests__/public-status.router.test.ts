/**
 * Regression guard for KI-016 — public status honesty.
 *
 * The marketing /status page is fed by GET /api/v1/public/status. When
 * DATABASE_URL is unset we have ZERO measurements of any component, so
 * the response MUST be an honest all-`unknown` board (overall 'unknown',
 * 0% uptime, all 90 days 'unknown') — NOT a fabricated all-green
 * ('ok' / 100% / "All systems operational"). Asserting uptime off no
 * data is a lie; this test locks the fix in.
 *
 * Each case re-imports the router with `vi.resetModules()` so the
 * module-level 30 s cache never leaks state between cases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type SimpleStatus = 'ok' | 'degraded' | 'outage' | 'unknown';

interface ComponentSummary {
  readonly component: string;
  readonly current: SimpleStatus;
  readonly history: ReadonlyArray<{ date: string; status: SimpleStatus }>;
  readonly uptimePct: number;
}
interface StatusResponse {
  readonly overall: SimpleStatus;
  readonly components: ReadonlyArray<ComponentSummary>;
  readonly windowDays: number;
}

async function callStatus(): Promise<StatusResponse> {
  vi.resetModules();
  const mod = await import('../public-status.router');
  const router = mod.default;
  const res = await router.request('/', { method: 'GET' });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { success: boolean; data: StatusResponse };
  expect(json.success).toBe(true);
  return json.data;
}

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

describe('GET /public/status — no-data honesty (DATABASE_URL unset)', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  });

  it('reports overall "unknown" — never a fabricated all-green', async () => {
    const data = await callStatus();
    expect(data.overall).toBe('unknown');
    // The pre-fix bug returned 'ok' here.
    expect(data.overall).not.toBe('ok');
  });

  it('every component is "unknown" with 0% uptime (no data == no uptime claim)', async () => {
    const data = await callStatus();
    expect(data.components.length).toBeGreaterThan(0);
    for (const comp of data.components) {
      expect(comp.current).toBe('unknown');
      expect(comp.uptimePct).toBe(0);
      // The pre-fix bug claimed 100% uptime off zero measurements.
      expect(comp.uptimePct).not.toBe(100);
    }
  });

  it('the full 90-day history strip is "unknown", not fabricated "ok"', async () => {
    const data = await callStatus();
    for (const comp of data.components) {
      expect(comp.history.length).toBe(data.windowDays);
      expect(comp.history.every((d) => d.status === 'unknown')).toBe(true);
      expect(comp.history.some((d) => d.status === 'ok')).toBe(false);
    }
  });
});
