/**
 * Bias detector — every flag has at least one positive + one negative
 * fixture.
 */

import { describe, expect, it } from 'vitest';

import { detectBiasFlags } from '../scorer/bias-detector.js';

describe('detectBiasFlags', () => {
  it('detects opinion via content pattern', () => {
    const out = detectBiasFlags({
      uri: 'https://x.com',
      content: 'In my opinion this is the best stock pick',
    });
    expect(out).toContain('opinion');
  });

  it('detects opinion via URL path', () => {
    const out = detectBiasFlags({
      uri: 'https://www.bbc.com/opinion/123',
      content: 'normal content',
    });
    expect(out).toContain('opinion');
  });

  it('detects paid_promotion', () => {
    const out = detectBiasFlags({
      uri: 'https://x.com',
      content: 'This sponsored post explains...',
    });
    expect(out).toContain('paid_promotion');
  });

  it('detects sponsored via URL params', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com/article?utm_campaign=sponsored',
      content: 'Article body',
    });
    expect(out).toContain('sponsored');
    expect(out).toContain('paid_promotion');
  });

  it('detects press_release via host', () => {
    const out = detectBiasFlags({
      uri: 'https://www.prnewswire.com/release/abc',
      content: 'Company X announces',
    });
    expect(out).toContain('press_release');
  });

  it('detects press_release via content', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content: 'FOR IMMEDIATE RELEASE: Company X has announced',
    });
    expect(out).toContain('press_release');
  });

  it('detects syndicated', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content: 'This article originally appeared on bloomberg.com.',
    });
    expect(out).toContain('syndicated');
  });

  it('detects ai_generated boilerplate', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content: 'As an AI language model, I cannot access real-time prices.',
    });
    expect(out).toContain('ai_generated');
  });

  it('detects ai_generated explicit attribution', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content: 'This article was written by AI using GPT-5.',
    });
    expect(out).toContain('ai_generated');
  });

  it('detects unverified for forum/blog with no author + date', () => {
    const out = detectBiasFlags({
      uri: 'https://random-blog.com/x',
      content: 'Some content',
      source_class_hint: 'generic_blog',
    });
    expect(out).toContain('unverified');
  });

  it('does NOT flag unverified when author present', () => {
    const out = detectBiasFlags({
      uri: 'https://random-blog.com/x',
      content: 'Some content',
      author: 'Jane Doe',
      source_class_hint: 'generic_blog',
    });
    expect(out).not.toContain('unverified');
  });

  it('detects low_authority on plain HTTP', () => {
    const out = detectBiasFlags({
      uri: 'http://example.com/x',
      content: 'page',
    });
    expect(out).toContain('low_authority');
  });

  it('detects low_authority on IP-only host', () => {
    const out = detectBiasFlags({
      uri: 'http://192.168.1.1/x',
      content: 'page',
    });
    expect(out).toContain('low_authority');
  });

  it('detects stale via content marker', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content: 'This is a legacy article no longer updated',
    });
    expect(out).toContain('stale');
  });

  it('returns no flags for a clean Tier-1 source', () => {
    const out = detectBiasFlags({
      uri: 'https://www.lme.com/copper',
      content: 'Today copper closed at $9,500/MT.',
    });
    expect(out).toEqual([]);
  });

  it('returns deterministic ordering matching the BIAS_FLAGS const', () => {
    const out = detectBiasFlags({
      uri: 'https://example.com',
      content:
        'In my opinion, this sponsored post explains why As an AI language model I think the gold price is rising.',
    });
    const opinionIdx = out.indexOf('opinion');
    const paidIdx = out.indexOf('paid_promotion');
    const aiIdx = out.indexOf('ai_generated');
    // The const order is [opinion, paid_promotion, unverified, ai_generated, ...].
    // detectBiasFlags filters in that order, so detected flags appear sorted.
    expect(opinionIdx).toBeGreaterThanOrEqual(0);
    expect(paidIdx).toBeGreaterThan(opinionIdx);
    expect(aiIdx).toBeGreaterThan(paidIdx);
  });
});
