/**
 * Tests for the `/.well-known/agent.json` server.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAgentCard,
  deserializeAgentCard,
  type A2AAgentCardInput,
} from '../agent-card.js';
import { generateStubKey, verifyAgentCard } from '../agent-card-signer.js';
import { serveAgentCard, serveAgentCardStatic } from '../well-known-server.js';

function fixture(): A2AAgentCardInput {
  return {
    id: 'bn',
    name: 'BN',
    description: 'BORJIE A2A endpoint',
    version: '1.0.0',
    capabilities: [
      {
        id: 'cap.x',
        description: 'x',
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
    skills: [],
    authentication: { schemes: ['bearer'] },
    endpoints: { tasks: 'https://api.example.com/a2a/tasks' },
  };
}

describe('serveAgentCard', () => {
  it('returns a 200 with the spec-required content type', async () => {
    const card = buildAgentCard(fixture());
    const res = await serveAgentCard({ card });
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/^application\/json/);
    expect(res.headers['X-A2A-Spec-Version']).toBe('1.0');
  });

  it('renders a card that round-trips through deserialize', async () => {
    const card = buildAgentCard(fixture());
    const res = await serveAgentCard({ card });
    const parsed = deserializeAgentCard(res.body);
    expect(parsed.id).toBe('bn');
    expect(parsed.version).toBe('1.0.0');
  });

  it('signs the card when a signing key is supplied', async () => {
    const card = buildAgentCard(fixture());
    const key = generateStubKey('well-known');
    const res = await serveAgentCard({ card, signingKey: key });
    const parsed = deserializeAgentCard(res.body);
    expect(parsed.signature).toBeDefined();
    expect(parsed.signature?.keyId).toBe('well-known');
    const ok = await verifyAgentCard(parsed, key.publicKey);
    expect(ok).toBe(true);
  });

  it('omits the signature block when no key is supplied', async () => {
    const card = buildAgentCard(fixture());
    const res = await serveAgentCard({ card });
    const parsed = deserializeAgentCard(res.body);
    expect(parsed.signature).toBeUndefined();
  });

  it('respects a custom cache max-age', async () => {
    const card = buildAgentCard(fixture());
    const res = await serveAgentCard({ card, cacheMaxAgeSeconds: 30 });
    expect(res.headers['Cache-Control']).toBe('public, max-age=30');
  });

  it('clamps negative cache max-age to zero', async () => {
    const card = buildAgentCard(fixture());
    const res = await serveAgentCardStatic(card, -10);
    expect(res.headers['Cache-Control']).toBe('public, max-age=0');
  });
});

describe('serveAgentCardStatic', () => {
  it('serves a pre-signed card without resigning', () => {
    const card = buildAgentCard(fixture());
    const res = serveAgentCardStatic(card);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"id":"bn"');
  });
});
