import { describe, expect, it } from 'vitest';
import { minimizePII } from '../pii-minimizer.js';
import type { Snippet } from '../../types.js';

function snip(content: string): Snippet {
  return {
    source: 'src',
    content,
    citation: { kind: 'document', id: 'd1' },
    confidence: 0.8,
  };
}

describe('minimizePII', () => {
  it('passes through when audience is data_subject', () => {
    const s = snip('Call me at +254700123456 or alice@example.com');
    expect(minimizePII(s, 'data_subject')).toBe(s);
  });

  it('redacts email when audience differs', () => {
    const s = snip('Email is alice@example.com please');
    const out = minimizePII(s, 'pm');
    expect(out.content).not.toContain('alice@example.com');
    expect(out.content).toContain('[redacted:email]');
  });

  it('redacts phone when audience differs', () => {
    const s = snip('Call +254700123456 today');
    const out = minimizePII(s, 'owner');
    expect(out.content).not.toContain('254700123456');
    expect(out.content).toContain('[redacted:phone]');
  });

  it('redacts name marker when audience differs', () => {
    const s = snip('The contact is [name:Alice Wanjiru] today');
    const out = minimizePII(s, 'admin');
    expect(out.content).toContain('[redacted:name]');
    expect(out.content).not.toContain('Alice Wanjiru');
  });

  it('returns the same reference when no PII present', () => {
    const s = snip('No personal data here');
    expect(minimizePII(s, 'pm')).toBe(s);
  });

  it('does not mutate the original snippet', () => {
    const s = snip('Email alice@example.com');
    const out = minimizePII(s, 'pm');
    expect(s.content).toBe('Email alice@example.com');
    expect(out).not.toBe(s);
  });
});
