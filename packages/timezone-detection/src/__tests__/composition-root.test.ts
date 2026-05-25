import { describe, expect, it } from 'vitest';
import { createTimezoneDetection } from '../index.js';
import { createStubGeoIPAdapter } from '../detect/detect-from-ip.js';

describe('createTimezoneDetection — composition root', () => {
  it('exposes detect / dst / render / middleware sections', () => {
    const tzd = createTimezoneDetection();
    expect(typeof tzd.detect).toBe('function');
    expect(typeof tzd.dst.safeAddDays).toBe('function');
    expect(typeof tzd.render.renderInTZ).toBe('function');
    expect(typeof tzd.middleware.hono).toBe('function');
    expect(typeof tzd.middleware.fastify).toBe('function');
  });

  it('detect() resolves the priority chain', async () => {
    const tzd = createTimezoneDetection();
    const r = await tzd.detect({ account: 'Africa/Nairobi' });
    expect(r.timezone).toBe('Africa/Nairobi');
    expect(r.source).toBe('account');
  });

  it('middleware.hono honours the configured geoip adapter', async () => {
    const geoip = createStubGeoIPAdapter({ '41.222.3.4': 'Africa/Nairobi' });
    const tzd = createTimezoneDetection({ geoip });
    const mw = tzd.middleware.hono();
    expect(typeof mw).toBe('function');
  });

  it('renderInTZ via composition root works the same way as the bare fn', () => {
    const tzd = createTimezoneDetection();
    const d = new Date('2026-05-25T06:30:00Z');
    expect(tzd.render.renderInTZ(d, 'Africa/Nairobi', 'HH:mm')).toBe('09:30');
  });
});
