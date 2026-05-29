/**
 * Tests for CSA-1 capability-registry — disclosure-safe contract.
 *
 * Focus:
 *   - Registry boots with 50+ entries (deliverable threshold).
 *   - Every entry parses against the zod schema.
 *   - related[] foreign keys all resolve back into the registry.
 *   - No accidental leakage tokens in public_description / example_*.
 *   - Topic + visibility filters behave.
 */

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_COUNT,
  CAPABILITY_REGISTRY,
  CapabilityEntrySchema,
  getCapabilityById,
  isDisclosable,
  listCapabilitiesByTopic,
  listCapabilitiesByVisibility,
  listDisclosableCapabilities,
  parseCapabilityEntry,
} from '../capabilities/index.js';

/**
 * The disclosure rules in routes/public-chat.hono.ts MUST be mirrored
 * inside the registry data itself — these tokens NEVER appear in a
 * public description or example response. They name internal
 * architecture, model providers, source paths.
 */
const FORBIDDEN_LEAK_TOKENS = [
  'anthropic',
  'openai',
  'deepseek',
  'gpt-',
  'claude-',
  'sonnet',
  'haiku',
  'mcp',
  '/services/',
  '/packages/',
  'kernel',
  '12-agent',
  '27 specialist juniors',
  '27 juniors',
  'prompt template',
  'central-intelligence',
  'brain-tools',
  'drizzle',
  'pgvector',
  'lats',
  'postgres',
];

describe('CSA-1 capability registry', () => {
  it('exposes at least 50 entries (deliverable threshold)', () => {
    expect(CAPABILITY_COUNT).toBeGreaterThanOrEqual(50);
    expect(CAPABILITY_REGISTRY.length).toBe(CAPABILITY_COUNT);
  });

  it('parses every entry against the zod schema', () => {
    for (const entry of CAPABILITY_REGISTRY) {
      expect(() => CapabilityEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it('exposes a stable id->entry lookup', () => {
    for (const entry of CAPABILITY_REGISTRY) {
      const looked = getCapabilityById(entry.id);
      expect(looked).toBeDefined();
      expect(looked?.id).toBe(entry.id);
    }
    expect(getCapabilityById('nonexistent.id')).toBeUndefined();
  });

  it('resolves every related[] back into the registry', () => {
    for (const entry of CAPABILITY_REGISTRY) {
      for (const relatedId of entry.related) {
        const target = getCapabilityById(relatedId);
        expect(target, `${entry.id} -> ${relatedId} unresolved`).toBeDefined();
      }
    }
  });

  it('keeps PUBLIC + EXPERIMENTAL visible to disclosure helpers', () => {
    const disclosable = listDisclosableCapabilities();
    for (const entry of disclosable) {
      expect(entry.visibility === 'PUBLIC' || entry.visibility === 'EXPERIMENTAL').toBe(true);
      expect(isDisclosable(entry)).toBe(true);
    }
    const internal = listCapabilitiesByVisibility('INTERNAL');
    for (const entry of internal) {
      expect(isDisclosable(entry)).toBe(false);
    }
  });

  it('filters by topic correctly', () => {
    const drafting = listCapabilitiesByTopic('drafting');
    expect(drafting.length).toBeGreaterThan(0);
    for (const entry of drafting) {
      expect(entry.topic).toBe('drafting');
    }
  });

  it('refuses leakage tokens in any disclosable surface (bilingual)', () => {
    const disclosable = listDisclosableCapabilities();
    for (const entry of disclosable) {
      const surfaces: ReadonlyArray<string> = [
        entry.public_description.en,
        entry.public_description.sw,
        entry.example_response_pattern.en,
        entry.example_response_pattern.sw,
        entry.public_name.en,
        entry.public_name.sw,
      ];
      for (const surface of surfaces) {
        const lower = surface.toLowerCase();
        for (const token of FORBIDDEN_LEAK_TOKENS) {
          expect(
            lower.includes(token),
            `${entry.id} surface leaks "${token}": "${surface}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('parseCapabilityEntry hard-fails on malformed payload', () => {
    expect(() =>
      parseCapabilityEntry({
        id: 'broken.entry',
        topic: 'drafting',
        user_outcome: 'x',
        public_name: { en: 'EN only' },
        public_description: { en: 'EN', sw: 'SW' },
        example_question: { en: 'EN', sw: 'SW' },
        example_response_pattern: { en: 'EN', sw: 'SW' },
        related: [],
        visibility: 'PUBLIC',
      }),
    ).toThrow();
  });

  it('covers every documented topic surface (no orphan topic)', () => {
    const requiredTopics = [
      'drafting',
      'tracking',
      'alerting',
      'forecasting',
      'communicating',
      'searching',
      'compliance',
      'marketplace',
      'hr',
      'safety',
      'decision-making',
      'memory',
      'multi-device',
      'multi-language',
      'multi-currency',
      'multi-scale',
      'meta',
    ] as const;
    for (const topic of requiredTopics) {
      expect(
        listCapabilitiesByTopic(topic).length,
        `topic "${topic}" is empty`,
      ).toBeGreaterThan(0);
    }
  });
});
