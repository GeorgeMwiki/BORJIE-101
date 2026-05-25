/**
 * Tests for agent-card.ts — the A2A capability advertisement.
 */
import { describe, expect, it } from 'vitest';
import { generateAgentCard } from '../agent-card.js';

describe('generateAgentCard', () => {
  it('uses the supplied baseUrl for url + provider.url', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      tools: [],
      resources: [],
    });
    expect(card.url).toBe('https://api.example.com');
    expect(card.provider.url).toBe('https://api.example.com');
  });

  it('builds the registration URL from the baseUrl', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      tools: [],
      resources: [],
    });
    expect(card.authentication.registrationUrl).toBe(
      'https://api.example.com/api/v1/agent/register',
    );
  });

  it('defaults the version to 0.1.0', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      tools: [],
      resources: [],
    });
    expect(card.version).toBe('0.1.0');
  });

  it('honours an explicit version', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      version: '2.5.0',
      tools: [],
      resources: [],
    });
    expect(card.version).toBe('2.5.0');
  });

  it('uses an explicit contact when supplied', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      contact: 'ops@example.com',
      tools: [],
      resources: [],
    });
    expect(card.provider.contact).toBe('ops@example.com');
  });

  it('exposes hmac-sha256, bearer, and api-key auth schemes', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api.example.com',
      tools: [],
      resources: [],
    });
    expect(card.authentication.schemes).toContain('hmac-sha256');
    expect(card.authentication.schemes).toContain('bearer');
    expect(card.authentication.schemes).toContain('api-key');
  });

  it('passes through the supplied tools array', () => {
    const tools = [
      {
        name: 'create_case',
        description: 'create a case',
        inputSchema: { type: 'object' as const },
        requiredScopes: ['write:cases' as const],
        category: 'cases',
      },
    ];
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools,
      resources: [],
    });
    expect(card.tools).toBe(tools);
  });

  it('passes through the supplied resources array', () => {
    const resources = [
      {
        uri: 'borjie://x',
        name: 'X',
        description: 'd',
        mimeType: 'application/json',
      },
    ];
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools: [],
      resources,
    });
    expect(card.resources).toBe(resources);
  });

  it('declares the standard rateLimit envelope', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools: [],
      resources: [],
    });
    expect(card.rateLimit.defaultRpm).toBe(60);
    expect(card.rateLimit.maxRpm).toBe(600);
    expect(card.rateLimit.burstLimit).toBe(20);
  });

  it('exposes BORJIE-branded provider name', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools: [],
      resources: [],
    });
    expect(card.provider.organization).toBe('BORJIE');
    expect(card.name).toBe('BORJIE Agent Platform');
  });

  it('returns a frozen object (immutability)', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools: [],
      resources: [],
    });
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.provider)).toBe(true);
    expect(Object.isFrozen(card.authentication)).toBe(true);
    expect(Object.isFrozen(card.capabilities)).toBe(true);
  });

  it('lists key capability names', () => {
    const card = generateAgentCard({
      baseUrl: 'https://api',
      tools: [],
      resources: [],
    });
    const names = card.capabilities.map((c) => c.name);
    expect(names).toContain('property-graph-query');
    expect(names).toContain('tenant-risk-scoring');
    expect(names).toContain('maintenance-lifecycle');
    expect(names).toContain('universal-skill-dispatch');
  });
});
