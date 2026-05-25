/**
 * Tests for `fingerprint-scrubber.ts`.
 *
 * Covers: each pattern, idempotency on double call, multi-occurrence,
 * empty input, no-match passthrough, lastIndex-safety (critical fix
 * from LITFIN iter-44 HIGH #7).
 */

import { describe, expect, it } from 'vitest';
import {
  PROVIDER_FINGERPRINT_PATTERNS,
  scrubProviderFingerprints,
} from '../fingerprint-scrubber.js';

describe('scrubProviderFingerprints — pattern 1: I am X made by Y', () => {
  it('collapses "I am Claude, made by Anthropic"', () => {
    const r = scrubProviderFingerprints("I am Claude, made by Anthropic.");
    expect(r.text).toContain('Borjie brain');
    expect(r.text).not.toContain('Claude');
    expect(r.text).not.toContain('Anthropic');
    expect(r.scrubbed).toBe(true);
  });

  it("collapses \"I'm ChatGPT made by OpenAI\"", () => {
    const r = scrubProviderFingerprints("I'm ChatGPT made by OpenAI.");
    expect(r.text).toContain('Borjie brain');
    expect(r.text).not.toContain('OpenAI');
    expect(r.text).not.toContain('ChatGPT');
  });
});

describe('scrubProviderFingerprints — pattern 2: standalone product', () => {
  it('rewrites Gemini', () => {
    const r = scrubProviderFingerprints('Powered by Gemini under the hood.');
    expect(r.text).toContain('the Borjie brain');
    expect(r.text).not.toContain('Gemini');
  });

  it('rewrites GPT-4', () => {
    const r = scrubProviderFingerprints('GPT-4 figured it out.');
    expect(r.text).not.toContain('GPT-4');
    expect(r.text).toContain('the Borjie brain');
  });

  it('rewrites Llama', () => {
    const r = scrubProviderFingerprints('Built on Llama 3.');
    expect(r.text).not.toContain('Llama');
  });
});

describe('scrubProviderFingerprints — pattern 3: generic AI', () => {
  it("rewrites \"I'm an AI assistant\"", () => {
    const r = scrubProviderFingerprints("I'm an AI assistant here to help.");
    expect(r.text).toContain('Borjie brain');
    expect(r.scrubbed).toBe(true);
  });

  it('rewrites "I am a language model"', () => {
    const r = scrubProviderFingerprints('I am a language model that can help.');
    expect(r.text).toContain('Borjie brain');
  });
});

describe('scrubProviderFingerprints — pattern 4: "As an AI"', () => {
  it('rewrites sentence-initial "As an AI"', () => {
    const r = scrubProviderFingerprints("As an AI language model, I can't help with that.");
    expect(r.text).toContain('As the Borjie brain');
  });
});

describe('scrubProviderFingerprints — passthrough', () => {
  it('leaves clean text unchanged', () => {
    const r = scrubProviderFingerprints('Your rent is due on the 1st.');
    expect(r.text).toBe('Your rent is due on the 1st.');
    expect(r.scrubbed).toBe(false);
  });

  it('handles empty string', () => {
    const r = scrubProviderFingerprints('');
    expect(r.text).toBe('');
    expect(r.scrubbed).toBe(false);
  });
});

describe('scrubProviderFingerprints — IDEMPOTENCY (critical)', () => {
  it('produces the same output when called twice on the same input', () => {
    const input = "I'm Claude, made by Anthropic. Also Gemini.";
    const r1 = scrubProviderFingerprints(input);
    const r2 = scrubProviderFingerprints(r1.text);
    expect(r2.text).toBe(r1.text);
  });

  it('lastIndex-safe: calling 100 times yields the same output', () => {
    const input = 'Powered by GPT-5 and Gemini and Claude.';
    let out = input;
    for (let i = 0; i < 100; i += 1) {
      out = scrubProviderFingerprints(out).text;
    }
    // Should NOT regress to leaking the names — this is the LITFIN
    // iter-44 HIGH #7 regression check.
    expect(out).not.toContain('GPT-5');
    expect(out).not.toContain('Gemini');
    expect(out).not.toContain('Claude');
  });

  it('repeated patterns in same string are all replaced', () => {
    const input = 'Claude said this. Then Claude said that. Finally Claude.';
    const r = scrubProviderFingerprints(input);
    expect(r.text).not.toContain('Claude');
    // Three occurrences => three replacements.
    expect((r.text.match(/Borjie brain/g) ?? []).length).toBe(3);
  });
});

describe('PROVIDER_FINGERPRINT_PATTERNS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PROVIDER_FINGERPRINT_PATTERNS)).toBe(true);
  });

  it('has at least 4 patterns', () => {
    expect(PROVIDER_FINGERPRINT_PATTERNS.length).toBeGreaterThanOrEqual(4);
  });
});
