/**
 * Source-quality scorer — rubric correctness tests.
 *
 * Pins every base score from DEEP_RESEARCH_SPEC §7 against fixture
 * sources. Also tests every modifier path: recency decay, corroboration
 * boost, internal-corpus contradiction, AI-generated cap.
 */

import { describe, expect, it } from 'vitest';

import {
  classifySource,
  scoreSource,
  SOURCE_BASE_SCORE,
} from '../scorer/source-quality.js';

const NOW_ISO = new Date().toISOString();

describe('classifySource', () => {
  it('classifies the 9 source classes', () => {
    expect(classifySource('https://www.tumemadini.go.tz/x')).toBe('tz_official');
    expect(classifySource('https://eg.gov.tz/x')).toBe('tz_official');
    expect(classifySource('https://www.lme.com/copper')).toBe('tier1_market');
    expect(classifySource('https://kitco.com/gold')).toBe('tier1_market');
    expect(classifySource('https://arxiv.org/abs/123')).toBe('academic');
    expect(classifySource('https://stanford.edu/paper')).toBe('academic');
    expect(classifySource('https://www.bbc.com/news/x')).toBe('established_news');
    expect(classifySource('https://www.mining.com/article')).toBe('trade_press');
    expect(classifySource('https://sec.gov/Archives/edgar')).toBe('corporate_filing');
    expect(classifySource('https://www.reddit.com/r/mining')).toBe('forum');
    expect(classifySource('https://example.com/random')).toBe('generic_blog');
  });

  it('falls back to generic_blog on unrecognised host', () => {
    expect(classifySource('https://random-unknown-host.io/page')).toBe('generic_blog');
  });

  it('handles malformed URI safely', () => {
    expect(classifySource('not a url')).toBe('generic_blog');
    expect(classifySource('')).toBe('generic_blog');
  });
});

describe('SOURCE_BASE_SCORE', () => {
  it('matches the 9-class rubric from the spec verbatim', () => {
    expect(SOURCE_BASE_SCORE.tz_official).toBe(0.95);
    expect(SOURCE_BASE_SCORE.tier1_market).toBe(0.9);
    expect(SOURCE_BASE_SCORE.academic).toBe(0.85);
    expect(SOURCE_BASE_SCORE.corporate_filing).toBe(0.85);
    expect(SOURCE_BASE_SCORE.established_news).toBe(0.75);
    expect(SOURCE_BASE_SCORE.trade_press).toBe(0.7);
    expect(SOURCE_BASE_SCORE.forum).toBe(0.3);
    expect(SOURCE_BASE_SCORE.generic_blog).toBe(0.2);
    expect(SOURCE_BASE_SCORE.ai_generated).toBe(0.1);
  });
});

describe('scoreSource', () => {
  it('scores a Tanzanian government URL at 0.95 baseline', () => {
    const out = scoreSource({
      uri: 'https://tumemadini.go.tz/circular/123',
      content: 'Official circular text',
      retrieved_at: NOW_ISO,
    });
    expect(out.score).toBe(0.95);
    expect(out.class).toBe('tz_official');
    expect(out.bias_flags).toEqual([]);
  });

  it('applies recency decay for stale fast-moving topic', () => {
    const stale = new Date(Date.now() - 365 * 24 * 60 * 60 * 1_000).toISOString();
    const out = scoreSource({
      uri: 'https://www.lme.com/copper',
      content: 'Copper at $9,500',
      retrieved_at: NOW_ISO,
      published_at: stale,
      is_fast_moving_topic: true,
    });
    expect(out.score).toBeCloseTo(0.9 * 0.7, 5);
  });

  it('applies corroboration boost when 2+ high-quality sources concur', () => {
    const out = scoreSource({
      uri: 'https://www.mining.com/copper-trends',
      content: 'Copper outlook',
      retrieved_at: NOW_ISO,
      corroborating_high_quality_sources: 3,
    });
    // base 0.7 + 0.10 = 0.80
    expect(out.score).toBeCloseTo(0.8, 5);
  });

  it('caps score when internal corpus contradicts', () => {
    const out = scoreSource({
      uri: 'https://www.bbc.com/news/x',
      content: 'Tanzania gold reserves dropped',
      retrieved_at: NOW_ISO,
      contradicts_internal_corpus: true,
    });
    // 0.75 × 0.5 = 0.375
    expect(out.score).toBeCloseTo(0.375, 5);
  });

  it('caps AI-generated content at 0.20 without corroboration', () => {
    const out = scoreSource({
      uri: 'https://example.com/blog',
      content:
        'As an AI language model, I do not have access to real-time data, but Tanzania mining is...',
      retrieved_at: NOW_ISO,
    });
    expect(out.bias_flags).toContain('ai_generated');
    expect(out.score).toBeLessThanOrEqual(0.2);
  });

  it('lifts AI-generated cap when tier-1 corroborated', () => {
    const out = scoreSource({
      uri: 'https://example.com/blog',
      content: 'As an AI language model, generated content describes copper trends.',
      retrieved_at: NOW_ISO,
      corroborating_high_quality_sources: 2,
    });
    expect(out.bias_flags).toContain('ai_generated');
    // base 0.2 + 0.10 = 0.30 (corroboration), not capped
    expect(out.score).toBeGreaterThan(0.2);
  });

  it('caps forum + opinion to 0.25', () => {
    const out = scoreSource({
      uri: 'https://www.reddit.com/r/mining',
      content: 'In my opinion, this is a great investment',
      retrieved_at: NOW_ISO,
    });
    expect(out.class).toBe('forum');
    expect(out.bias_flags).toContain('opinion');
    expect(out.score).toBeLessThanOrEqual(0.25);
  });

  it('caps generic_blog + paid_promotion to 0.10', () => {
    const out = scoreSource({
      uri: 'https://example.com/blog',
      content: 'This sponsored post explains how XYZ mining stock is the best buy.',
      retrieved_at: NOW_ISO,
    });
    expect(out.class).toBe('generic_blog');
    expect(out.bias_flags).toContain('paid_promotion');
    expect(out.score).toBeLessThanOrEqual(0.1);
  });

  it('exposes a human-readable rationale', () => {
    const out = scoreSource({
      uri: 'https://www.lme.com/copper',
      content: 'price feed',
      retrieved_at: NOW_ISO,
      corroborating_high_quality_sources: 2,
    });
    expect(out.rationale).toContain('base=');
    expect(out.rationale).toContain('corroborated');
  });

  it('clamps score to [0, 1]', () => {
    const out = scoreSource({
      uri: 'https://tumemadini.go.tz/x',
      content: 'fresh',
      retrieved_at: NOW_ISO,
      corroborating_high_quality_sources: 100,
    });
    expect(out.score).toBeLessThanOrEqual(1);
    expect(out.score).toBeGreaterThanOrEqual(0);
  });

  it('all 9 source classes covered in classifier', () => {
    const fixtures: Array<[string, string]> = [
      ['https://tumemadini.go.tz/x', 'tz_official'],
      ['https://lme.com/x', 'tier1_market'],
      ['https://arxiv.org/x', 'academic'],
      ['https://sec.gov/x', 'corporate_filing'],
      ['https://bbc.com/x', 'established_news'],
      ['https://mining.com/x', 'trade_press'],
      ['https://reddit.com/x', 'forum'],
      ['https://example.com/x', 'generic_blog'],
      // ai_generated is detected via content, not URL; covered separately above.
    ];
    for (const [uri, expected] of fixtures) {
      expect(classifySource(uri)).toBe(expected);
    }
  });
});
