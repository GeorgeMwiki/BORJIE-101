import { describe, expect, it } from 'vitest';
import { detectComposite } from '../detect/detect-composite.js';
import { createStubGeoIPAdapter } from '../detect/detect-from-ip.js';

const geoip = createStubGeoIPAdapter({
  '41.222.3.4': 'Africa/Nairobi',
});

describe('detectComposite — priority chain', () => {
  it('account beats every other source', async () => {
    const r = await detectComposite({
      account: 'Africa/Kigali',
      jwt: { zoneinfo: 'Africa/Lagos' },
      browser: 'Europe/London',
      ip: { ip: '41.222.3.4', geoip },
      jurisdiction: 'US',
    });
    expect(r.timezone).toBe('Africa/Kigali');
    expect(r.source).toBe('account');
    expect(r.confidence).toBe(1.0);
  });

  it('jwt beats browser when account missing', async () => {
    const r = await detectComposite({
      jwt: { zoneinfo: 'Africa/Lagos' },
      browser: 'Europe/London',
      ip: { ip: '41.222.3.4', geoip },
      jurisdiction: 'US',
    });
    expect(r.timezone).toBe('Africa/Lagos');
    expect(r.source).toBe('jwt-claim');
  });

  it('browser beats ip when jwt missing', async () => {
    const r = await detectComposite({
      browser: 'Europe/London',
      ip: { ip: '41.222.3.4', geoip },
      jurisdiction: 'US',
    });
    expect(r.timezone).toBe('Europe/London');
    expect(r.source).toBe('browser');
  });

  it('ip beats jurisdiction when browser missing', async () => {
    const r = await detectComposite({
      ip: { ip: '41.222.3.4', geoip },
      jurisdiction: 'US',
    });
    expect(r.timezone).toBe('Africa/Nairobi');
    expect(r.source).toBe('ip');
  });

  it('jurisdiction is used as last detector before UTC', async () => {
    const r = await detectComposite({ jurisdiction: 'TZ' });
    expect(r.timezone).toBe('Africa/Dar_es_Salaam');
    expect(r.source).toBe('jurisdiction');
  });

  it('falls back to UTC when no source detected', async () => {
    const r = await detectComposite({});
    expect(r.timezone).toBe('UTC');
    expect(r.source).toBe('default-utc');
    expect(r.confidence).toBe(0.0);
  });

  it('invalid account TZ falls through to the next source', async () => {
    const r = await detectComposite({
      account: 'Mars/Olympus_Mons',
      jwt: { zoneinfo: 'Africa/Lagos' },
    });
    expect(r.timezone).toBe('Africa/Lagos');
    expect(r.source).toBe('jwt-claim');
  });

  it('invalid jwt claim falls through to the next source', async () => {
    const r = await detectComposite({
      jwt: { zoneinfo: 'Mars/Olympus_Mons' },
      browser: 'Europe/London',
    });
    expect(r.timezone).toBe('Europe/London');
    expect(r.source).toBe('browser');
  });

  it('ip adapter that returns null falls through to jurisdiction', async () => {
    const r = await detectComposite({
      ip: { ip: '127.0.0.1', geoip },
      jurisdiction: 'KE',
    });
    expect(r.timezone).toBe('Africa/Nairobi');
    expect(r.source).toBe('jurisdiction');
  });
});
