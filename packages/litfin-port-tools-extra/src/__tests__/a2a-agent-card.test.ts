import { describe, expect, it } from 'vitest';
import {
  buildAgentCard,
  findCapableSkills,
  validateAgentCard,
  type A2ASkill,
} from '../a2a-agent-card.js';

const sampleSkills: readonly A2ASkill[] = [
  {
    id: 'rent-balance',
    name: 'Get rent balance',
    description: 'Returns current rent balance for tenant',
    tags: ['rent', 'finance', 'read'],
    sideEffects: false,
  },
  {
    id: 'send-receipt',
    name: 'Send receipt',
    description: 'Send a payment receipt by email/SMS',
    tags: ['payment', 'comm', 'write'],
    sideEffects: true,
  },
];

describe('a2a-agent-card', () => {
  it('buildAgentCard returns a valid card', () => {
    const card = buildAgentCard({
      name: 'Mwikila',
      version: '1.0.0',
      description: 'Property mgmt assistant',
      publisher: 'Borjie',
      baseUrl: 'https://api.example.com',
      authModes: ['oauth2'],
      skills: sampleSkills,
    });
    expect(card.endpoints.invoke).toBe('https://api.example.com/a2a/invoke');
    expect(card.endpoints.health).toBe('https://api.example.com/a2a/health');
  });

  it('strips trailing slash from baseUrl', () => {
    const card = buildAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      baseUrl: 'https://api.example.com/',
      authModes: ['none'],
      skills: sampleSkills,
    });
    expect(card.endpoints.invoke).toBe('https://api.example.com/a2a/invoke');
  });

  it('validates a well-formed card', () => {
    const card = buildAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      baseUrl: 'https://x.example.com',
      authModes: ['api-key'],
      skills: sampleSkills,
    });
    const out = validateAgentCard(card);
    expect(out.ok).toBe(true);
  });

  it('rejects card with missing skills', () => {
    const out = validateAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      endpoints: {
        invoke: 'https://x.example/invoke',
        health: 'https://x.example/health',
      },
      auth: { modes: ['none'] },
      skills: [],
    });
    expect(out.ok).toBe(false);
  });

  it('rejects card with unknown auth mode', () => {
    const out = validateAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      endpoints: {
        invoke: 'https://x.example/invoke',
        health: 'https://x.example/health',
      },
      auth: { modes: ['weird-mode'] },
      skills: sampleSkills,
    });
    expect(out.ok).toBe(false);
  });

  it('rejects card with strict extra field', () => {
    const out = validateAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      endpoints: {
        invoke: 'https://x.example/invoke',
        health: 'https://x.example/health',
      },
      auth: { modes: ['none'] },
      skills: sampleSkills,
      extra: 'nope',
    });
    expect(out.ok).toBe(false);
  });

  it('rejects card with non-URL endpoints', () => {
    const out = validateAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      endpoints: { invoke: 'not a url', health: 'still not' },
      auth: { modes: ['none'] },
      skills: sampleSkills,
    });
    expect(out.ok).toBe(false);
  });

  it('findCapableSkills matches on tag', () => {
    const card = buildAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      baseUrl: 'https://x.example',
      authModes: ['none'],
      skills: sampleSkills,
    });
    const matches = findCapableSkills(card, ['rent']);
    expect(matches.length).toBe(1);
    expect(matches[0]?.id).toBe('rent-balance');
  });

  it('findCapableSkills returns empty when no tag matches', () => {
    const card = buildAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      baseUrl: 'https://x.example',
      authModes: ['none'],
      skills: sampleSkills,
    });
    expect(findCapableSkills(card, ['nope']).length).toBe(0);
  });

  it('findCapableSkills can match multiple skills', () => {
    const card = buildAgentCard({
      name: 'X',
      version: '1.0.0',
      description: 'x',
      publisher: 'p',
      baseUrl: 'https://x.example',
      authModes: ['none'],
      skills: sampleSkills,
    });
    const matches = findCapableSkills(card, ['read', 'write']);
    expect(matches.length).toBe(2);
  });
});
