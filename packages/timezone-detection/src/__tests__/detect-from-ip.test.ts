import { describe, expect, it, vi } from 'vitest';
import {
  createIpapiAdapterStub,
  createIpgeolocationAdapterStub,
  createMaxMindAdapterStub,
  createStubGeoIPAdapter,
  detectFromIP,
} from '../detect/detect-from-ip.js';

describe('detectFromIP', () => {
  it('returns the mapped TZ when the stub adapter knows the ip', async () => {
    const geoip = createStubGeoIPAdapter({
      '41.222.3.4': 'Africa/Nairobi',
      '8.8.8.8': 'America/Los_Angeles',
    });
    const r = await detectFromIP({ ip: '41.222.3.4', geoip });
    expect(r?.timezone).toBe('Africa/Nairobi');
    expect(r?.source).toBe('ip');
    expect(r?.confidence).toBe(0.7);
  });

  it('returns null when the adapter has no mapping', async () => {
    const geoip = createStubGeoIPAdapter({});
    const r = await detectFromIP({ ip: '127.0.0.1', geoip });
    expect(r).toBeNull();
  });

  it('returns null when the adapter throws', async () => {
    const geoip = {
      name: 'stub' as const,
      lookup: vi.fn().mockRejectedValue(new Error('upstream-503')),
    };
    const r = await detectFromIP({ ip: '8.8.8.8', geoip });
    expect(r).toBeNull();
  });

  it('returns null on empty ip', async () => {
    const geoip = createStubGeoIPAdapter({});
    const r = await detectFromIP({ ip: '', geoip });
    expect(r).toBeNull();
  });

  it('rejects an adapter that returns an invalid TZ', async () => {
    const geoip = createStubGeoIPAdapter({ '1.1.1.1': 'Mars/Olympus_Mons' });
    const r = await detectFromIP({ ip: '1.1.1.1', geoip });
    expect(r).toBeNull();
  });
});

describe('GeoIP adapter stubs (production wiring sketches)', () => {
  it('MaxMind stub throws a helpful "wire-real-impl" error', async () => {
    const a = createMaxMindAdapterStub();
    expect(a.name).toBe('maxmind');
    await expect(a.lookup('1.1.1.1')).rejects.toThrow(/MaxMind adapter stub/);
  });

  it('ipapi stub throws a helpful "wire-real-impl" error', async () => {
    const a = createIpapiAdapterStub();
    expect(a.name).toBe('ipapi');
    await expect(a.lookup('1.1.1.1')).rejects.toThrow(/ipapi adapter stub/);
  });

  it('ipgeolocation stub throws a helpful "wire-real-impl" error', async () => {
    const a = createIpgeolocationAdapterStub();
    expect(a.name).toBe('ipgeolocation');
    await expect(a.lookup('1.1.1.1')).rejects.toThrow(
      /ipgeolocation adapter stub/,
    );
  });
});
