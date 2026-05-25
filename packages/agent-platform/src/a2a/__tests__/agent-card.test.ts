/**
 * Tests for the A2A Agent Card builder + canonical serialiser.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAgentCard,
  deserializeAgentCard,
  serializeAgentCard,
  serializeAgentCardForSigning,
  type A2AAgentCardInput,
} from '../agent-card.js';

function fixtureInput(): A2AAgentCardInput {
  return {
    id: 'borjie-agent',
    name: 'BORJIE',
    description: 'Multi-tenant property-management agent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'maintenance.case.create',
        description: 'Create a maintenance case',
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
      },
    ],
    skills: [
      {
        id: 'arrears.project',
        name: 'Project arrears curve',
        description: 'Project tenant arrears over the next 90 days',
        tags: ['finance', 'forecast'],
        examples: ['What will tenant T-42 owe by month-end?'],
      },
    ],
    authentication: {
      schemes: ['bearer', 'hmac-sha256'],
      credentialsUrl: 'https://api.example.com/agents/register',
    },
    endpoints: {
      tasks: 'https://api.example.com/a2a/tasks',
      cancel: 'https://api.example.com/a2a/tasks/cancel',
    },
  };
}

describe('buildAgentCard', () => {
  it('returns a deeply frozen card', () => {
    const card = buildAgentCard(fixtureInput());
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.capabilities)).toBe(true);
    expect(Object.isFrozen(card.skills)).toBe(true);
    expect(Object.isFrozen(card.authentication)).toBe(true);
    expect(Object.isFrozen(card.endpoints)).toBe(true);
  });

  it('preserves all input fields', () => {
    const input = fixtureInput();
    const card = buildAgentCard(input);
    expect(card.id).toBe(input.id);
    expect(card.name).toBe(input.name);
    expect(card.version).toBe(input.version);
    expect(card.capabilities).toEqual(input.capabilities);
    expect(card.skills).toEqual(input.skills);
    expect(card.authentication).toEqual(input.authentication);
    expect(card.endpoints).toEqual(input.endpoints);
  });
});

describe('serializeAgentCard round-trip', () => {
  it('round-trips through serialize -> deserialize', () => {
    const card = buildAgentCard(fixtureInput());
    const json = serializeAgentCard(card);
    const restored = deserializeAgentCard(json);
    expect(restored.id).toBe(card.id);
    expect(restored.version).toBe(card.version);
    expect(restored.capabilities).toEqual(card.capabilities);
    expect(restored.skills).toEqual(card.skills);
    expect(restored.authentication).toEqual(card.authentication);
    expect(restored.endpoints).toEqual(card.endpoints);
  });

  it('produces deterministic canonical JSON regardless of input key order', () => {
    const input = fixtureInput();
    const card1 = buildAgentCard(input);
    const card2 = buildAgentCard({
      // Same data, different declaration order.
      endpoints: input.endpoints,
      authentication: input.authentication,
      skills: input.skills,
      capabilities: input.capabilities,
      version: input.version,
      description: input.description,
      name: input.name,
      id: input.id,
    });
    expect(serializeAgentCard(card1)).toBe(serializeAgentCard(card2));
  });

  it('canonical serialisation does not contain whitespace', () => {
    const json = serializeAgentCard(buildAgentCard(fixtureInput()));
    expect(json).not.toMatch(/\n/);
    expect(json).not.toMatch(/: /);
  });
});

describe('serializeAgentCardForSigning', () => {
  it('excludes the signature field from the signed payload', () => {
    const card = buildAgentCard(fixtureInput());
    const withSig = {
      ...card,
      signature: {
        algorithm: 'ed25519' as const,
        keyId: 'k1',
        value: 'abc',
        signedAt: '2026-05-23T00:00:00Z',
      },
    };
    const a = serializeAgentCardForSigning(card);
    const b = serializeAgentCardForSigning(withSig);
    expect(a).toBe(b);
    expect(a).not.toContain('signature');
  });
});

describe('deserializeAgentCard', () => {
  it('rejects non-JSON input', () => {
    expect(() => deserializeAgentCard('not json')).toThrow(/Invalid Agent Card JSON/);
  });

  it('rejects an array', () => {
    expect(() => deserializeAgentCard('[]')).toThrow(
      /Agent Card must be a JSON object/,
    );
  });

  it('rejects a card missing required fields', () => {
    expect(() => deserializeAgentCard('{"id":"x"}')).toThrow(
      /missing required field/,
    );
  });
});
