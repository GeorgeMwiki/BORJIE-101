import { describe, expect, it, vi } from 'vitest';
import { createStubGeoIPAdapter } from '../detect/detect-from-ip.js';
import {
  fastifyTimezonePlugin,
  honoTimezoneMiddleware,
} from '../middleware/index.js';
import { extractTimezone } from '../middleware/extract-timezone.js';
import type { ExtractRequest } from '../middleware/extract-timezone.js';

function mockReq(
  headers: Record<string, string>,
  ip?: string | null,
): ExtractRequest {
  const lc = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    header(name: string) {
      return lc[name.toLowerCase()] ?? null;
    },
    ip: ip ?? null,
  };
}

describe('extractTimezone — priority chain', () => {
  it('jwt claim wins over X-Timezone header and ip', async () => {
    const decoded = { zoneinfo: 'Africa/Lagos' };
    const req = mockReq({ 'X-Timezone': 'Europe/London' }, '41.222.3.4');
    const geoip = createStubGeoIPAdapter({ '41.222.3.4': 'Africa/Nairobi' });
    const tz = await extractTimezone(req, { decodedJWT: decoded, geoip });
    expect(tz).toBe('Africa/Lagos');
  });

  it('X-Timezone header wins over IP when JWT absent', async () => {
    const req = mockReq({ 'X-Timezone': 'Europe/London' }, '41.222.3.4');
    const geoip = createStubGeoIPAdapter({ '41.222.3.4': 'Africa/Nairobi' });
    const tz = await extractTimezone(req, { geoip });
    expect(tz).toBe('Europe/London');
  });

  it('IP wins over jurisdiction when no JWT + no X-Timezone', async () => {
    const req = mockReq({}, '41.222.3.4');
    const geoip = createStubGeoIPAdapter({ '41.222.3.4': 'Africa/Nairobi' });
    const tz = await extractTimezone(req, {
      geoip,
      jurisdiction: 'GB',
    });
    expect(tz).toBe('Africa/Nairobi');
  });

  it('Jurisdiction wins when JWT + header + IP all missing', async () => {
    const req = mockReq({}, null);
    const tz = await extractTimezone(req, { jurisdiction: 'TZ' });
    expect(tz).toBe('Africa/Dar_es_Salaam');
  });

  it('UTC when all sources are missing', async () => {
    const req = mockReq({}, null);
    const tz = await extractTimezone(req, {});
    expect(tz).toBe('UTC');
  });

  it('Authorization Bearer JWT extracts zoneinfo when payload present', async () => {
    const payload = { zoneinfo: 'Africa/Kampala' };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const req = mockReq({ Authorization: `Bearer header.${b64}.sig` }, null);
    const tz = await extractTimezone(req, {});
    expect(tz).toBe('Africa/Kampala');
  });
});

describe('honoTimezoneMiddleware', () => {
  it('sets c.set("tz", ...) and calls next()', async () => {
    const set = vi.fn();
    const next = vi.fn().mockResolvedValue(undefined);
    const c = {
      req: {
        header(name: string) {
          if (name === 'X-Timezone') return 'Africa/Kigali';
          return undefined;
        },
      },
      set,
    };
    const mw = honoTimezoneMiddleware();
    await mw(c, next);
    expect(set).toHaveBeenCalledWith('tz', 'Africa/Kigali');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to UTC on internal failure', async () => {
    const set = vi.fn();
    const next = vi.fn().mockResolvedValue(undefined);
    const c = {
      req: {
        header() {
          throw new Error('boom');
        },
      },
      set,
    };
    const mw = honoTimezoneMiddleware();
    await mw(c, next);
    expect(set).toHaveBeenCalledWith('tz', 'UTC');
  });
});

describe('fastifyTimezonePlugin', () => {
  it('attaches req.tz from X-Timezone header', async () => {
    const req: { headers: Record<string, string>; ip?: string; tz?: string } = {
      headers: { 'x-timezone': 'Africa/Nairobi' },
      ip: '127.0.0.1',
    };
    const plugin = fastifyTimezonePlugin();
    await plugin(req, {});
    expect(req.tz).toBe('Africa/Nairobi');
  });

  it('falls back to UTC when no source available', async () => {
    const req: { headers: Record<string, string>; ip?: string; tz?: string } = {
      headers: {},
    };
    const plugin = fastifyTimezonePlugin();
    await plugin(req, {});
    expect(req.tz).toBe('UTC');
  });
});
