import { describe, it, expect } from 'vitest';
import { buildManifest } from '../manifest.js';

describe('buildManifest', () => {
  it('produces a complete public manifest', () => {
    const m = buildManifest({ publicBaseUrl: 'https://api.borjie.co.tz/' });
    expect(m.name).toBe('borjie-mcp-server');
    expect(m.httpEndpoint).toBe('https://api.borjie.co.tz/mcp');
    expect(m.auth.flow).toBe('oauth2_device');
    expect(m.tools.length).toBeGreaterThanOrEqual(15);
    expect(m.scopes.length).toBeGreaterThanOrEqual(6);
    expect(m.transports).toEqual(['stdio', 'http']);
  });
  it('strips trailing slash from base url', () => {
    const m = buildManifest({ publicBaseUrl: 'https://x/' });
    expect(m.httpEndpoint).toBe('https://x/mcp');
  });
});
