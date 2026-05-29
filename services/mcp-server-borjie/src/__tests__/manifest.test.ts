import { describe, it, expect } from 'vitest';
import { buildManifest } from '../manifest.js';

describe('buildManifest', () => {
  it('produces a complete public manifest', () => {
    const m = buildManifest({ publicBaseUrl: 'https://api.borjie.co.tz/' });
    expect(m.name).toBe('borjie-mcp-server');
    expect(m.httpEndpoint).toBe('https://api.borjie.co.tz/mcp');
    expect(m.sseEndpoint).toBe('https://api.borjie.co.tz/mcp/sse');
    expect(m.auth.flow).toBe('oauth2_device');
    expect(m.tools.length).toBeGreaterThanOrEqual(15);
    expect(m.scopes.length).toBeGreaterThanOrEqual(6);
    expect(m.transports).toEqual(['stdio', 'http', 'sse']);
  });
  it('strips trailing slash from base url', () => {
    const m = buildManifest({ publicBaseUrl: 'https://x/' });
    expect(m.httpEndpoint).toBe('https://x/mcp');
    expect(m.sseEndpoint).toBe('https://x/mcp/sse');
  });
  it('exposes all 12 SOTA primitives', () => {
    const m = buildManifest({ publicBaseUrl: 'https://api.borjie.app' });
    expect(m.primitives.sse).toBe(true);
    expect(m.primitives.sampling).toBe(true);
    expect(m.primitives.roots).toBe(true);
    expect(m.primitives.logging).toBe(true);
    expect(m.primitives.progress).toBe(true);
    expect(m.primitives.resultPartial).toBe(true);
    expect(m.primitives.subscriptions).toBe(true);
    expect(m.primitives.sessions).toBe(true);
    expect(m.primitives.actions).toEqual(['navigate', 'prefill', 'share', 'undo']);
    expect(m.primitives.perScopeRateLimit).toBe(true);
    expect(m.primitives.fourEye).toEqual([
      'kill_switch',
      'four_eye',
      'sovereign',
      'policy_rollout',
    ]);
    expect(m.primitives.workspaceMirror).toBe(true);
    expect(m.primitives.discoveryFilters).toBe(true);
  });
  it('exposes per-scope rate limits', () => {
    const m = buildManifest({ publicBaseUrl: 'https://x' });
    expect(m.rateLimits['owner:read']?.capacity).toBeGreaterThan(0);
    expect(m.rateLimits['owner:write']?.refillPerMinute).toBeGreaterThan(0);
  });
});
