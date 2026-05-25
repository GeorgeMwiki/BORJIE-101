/**
 * Tests for types.ts — Zod schema validation + config resolution.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DETECTOR_CONFIG,
  detectorStateConfigSchema,
  newSignalInputSchema,
  proposalStatusSchema,
  resolveDetectorConfig,
  signalKindSchema,
} from '../types.js';

describe('signalKindSchema', () => {
  it('accepts valid kinds', () => {
    expect(signalKindSchema.parse('search_keyword')).toBe('search_keyword');
    expect(signalKindSchema.parse('conversation_intent')).toBe('conversation_intent');
    expect(signalKindSchema.parse('doc_upload')).toBe('doc_upload');
    expect(signalKindSchema.parse('tab_event_pattern')).toBe('tab_event_pattern');
    expect(signalKindSchema.parse('external_trigger')).toBe('external_trigger');
  });

  it('rejects unknown kinds', () => {
    expect(() => signalKindSchema.parse('weather')).toThrow();
  });
});

describe('proposalStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(proposalStatusSchema.parse('pending')).toBe('pending');
    expect(proposalStatusSchema.parse('accepted')).toBe('accepted');
    expect(proposalStatusSchema.parse('declined')).toBe('declined');
    expect(proposalStatusSchema.parse('expired')).toBe('expired');
    expect(proposalStatusSchema.parse('snoozed')).toBe('snoozed');
  });

  it('rejects unknown statuses', () => {
    expect(() => proposalStatusSchema.parse('rejected')).toThrow();
  });
});

describe('newSignalInputSchema', () => {
  it('validates a minimal signal input', () => {
    const out = newSignalInputSchema.parse({
      tenantId: 't1',
      userId: 'u1',
      signalKind: 'search_keyword',
      signalPayload: { query: 'compliance' },
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.0,
    });
    expect(out.signalKind).toBe('search_keyword');
  });

  it('rejects missing required fields', () => {
    expect(() =>
      newSignalInputSchema.parse({
        userId: 'u1',
        signalKind: 'search_keyword',
        signalPayload: {},
        suggestedModuleTemplateId: 'COMPLIANCE',
        weight: 1.0,
      }),
    ).toThrow();
  });

  it('rejects weight out of range', () => {
    expect(() =>
      newSignalInputSchema.parse({
        tenantId: 't1',
        userId: 'u1',
        signalKind: 'search_keyword',
        signalPayload: {},
        suggestedModuleTemplateId: 'COMPLIANCE',
        weight: 999.99,
      }),
    ).toThrow();
  });
});

describe('detectorStateConfigSchema', () => {
  it('accepts a partial config', () => {
    const out = detectorStateConfigSchema.parse({ scoreThreshold: 4.5 });
    expect(out.scoreThreshold).toBe(4.5);
  });

  it('accepts an empty config', () => {
    const out = detectorStateConfigSchema.parse({});
    expect(out).toEqual({});
  });

  it('rejects out-of-range thresholds', () => {
    expect(() =>
      detectorStateConfigSchema.parse({ scoreThreshold: -1 }),
    ).toThrow();
    expect(() =>
      detectorStateConfigSchema.parse({ declineSnoozeDays: 500 }),
    ).toThrow();
  });
});

describe('resolveDetectorConfig', () => {
  it('returns defaults when input is undefined', () => {
    const resolved = resolveDetectorConfig(undefined);
    expect(resolved).toEqual(DEFAULT_DETECTOR_CONFIG);
  });

  it('returns defaults when input is empty', () => {
    const resolved = resolveDetectorConfig({});
    expect(resolved.scoreThreshold).toBe(5.0);
    expect(resolved.declineSnoozeDays).toBe(30);
    expect(resolved.proposalExpiryDays).toBe(14);
    expect(resolved.signalHalfLifeDays).toBe(7);
    expect(resolved.lookbackDays).toBe(14);
    expect(resolved.scanIntervalHours).toBe(6);
  });

  it('merges partial overrides with defaults', () => {
    const resolved = resolveDetectorConfig({
      scoreThreshold: 3.0,
      lookbackDays: 7,
    });
    expect(resolved.scoreThreshold).toBe(3.0);
    expect(resolved.lookbackDays).toBe(7);
    expect(resolved.declineSnoozeDays).toBe(30); // default kept
  });

  it('returns a frozen object', () => {
    const resolved = resolveDetectorConfig({});
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});
